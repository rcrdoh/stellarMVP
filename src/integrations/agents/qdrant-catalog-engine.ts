import { QdrantClient } from "@qdrant/js-client-rest";
import {
	type CatalogQueryInput,
	type CatalogQueryOptions,
	CatalogQueryOptionsSchema,
	type MerchantProduct,
	MerchantProductSchema,
} from "../../domain/catalog/types.js";

/**
 * Minimal structural view of the Qdrant client surface the catalog engine needs.
 * Depending on this port (instead of the concrete `QdrantClient`) keeps the engine
 * unit-testable: tests inject a deterministic double, production injects the real
 * REST client built from `QDRANT_URL`.
 */
export interface QdrantCatalogClient {
	query(
		collectionName: string,
		request: {
			query: number[];
			limit: number;
			score_threshold?: number;
			filter?: {
				must?: Array<Record<string, unknown>>;
			};
		},
	): Promise<{
		points: Array<{ id: string | number; score: number; payload?: unknown }>;
	}>;
}

/**
 * Vector retrieval and catalog extraction engine (Module 6).
 *
 * Responsibilities:
 * - Sanitize every incoming query through `CatalogQueryOptionsSchema` before it
 *   reaches the vector engine or the fallback evaluator (Audit L2).
 * - Issue a top-K vector query against the configured Qdrant collection and map
 *   each hit payload into a validated `MerchantProduct`.
 * - Fall back to a deterministic in-memory catalog when Qdrant is unconfigured,
 *   unreachable or returns an unparseable document, so offline/test runs stay
 *   deterministic.
 */
export class QdrantCatalogEngine {
	private readonly client: QdrantCatalogClient | null;
	private readonly collectionName: string;
	private fallbackCatalog: MerchantProduct[] = [];
	private usedFallback = false;

	constructor(
		options: {
			client?: QdrantCatalogClient | null;
			collectionName?: string;
		} = {},
	) {
		this.collectionName =
			options.collectionName ?? process.env.QDRANT_COLLECTION ?? "products";

		if (options.client !== undefined) {
			this.client = options.client;
			return;
		}

		const qdrantUrl = process.env.QDRANT_URL;
		const apiKey = process.env.QDRANT_API_KEY;
		this.client = qdrantUrl
			? (new QdrantClient({
					url: qdrantUrl,
					...(apiKey ? { apiKey } : {}),
				}) as unknown as QdrantCatalogClient)
			: null;
	}

	/** Registers the deterministic offline catalog used when Qdrant is unavailable. */
	public setFallbackCatalog(products: MerchantProduct[]): void {
		this.fallbackCatalog = products.map((product) =>
			MerchantProductSchema.parse(product),
		);
	}

	/** Whether the most recent `searchCandidates` call served the offline catalog. */
	public isFallback(): boolean {
		return this.usedFallback;
	}

	/**
	 * Retrieves candidate products for a shopping query. Throws a `ZodError` when
	 * the raw options are invalid (e.g. negative `limit`), guaranteeing no
	 * unsanitized parameter reaches the vector backend.
	 */
	public async searchCandidates(
		rawOptions: CatalogQueryInput,
	): Promise<MerchantProduct[]> {
		const options = CatalogQueryOptionsSchema.parse(rawOptions);

		if (!this.client || !options.vector?.length) {
			return this.searchFallback(options);
		}

		try {
			const filterConditions: Array<Record<string, unknown>> = [];
			if (options.category) {
				filterConditions.push({
					key: "category",
					match: { value: options.category },
				});
			}
			if (options.maxPrice !== undefined) {
				filterConditions.push({
					key: "price",
					range: { lte: options.maxPrice },
				});
			}

			const response = await this.client.query(this.collectionName, {
				query: options.vector,
				limit: options.limit,
				score_threshold: options.minScore,
				...(filterConditions.length > 0
					? { filter: { must: filterConditions } }
					: {}),
			});

			const products = response.points.map((hit) => {
				const payload = (hit.payload as Record<string, unknown>) ?? {};
				return MerchantProductSchema.parse({
					...payload,
					id: String(hit.id),
					score: hit.score,
				});
			});
			this.usedFallback = false;
			return products;
		} catch {
			return this.searchFallback(options);
		}
	}

	/** Deterministic filter-and-slice over the registered fallback catalog. */
	private searchFallback(options: CatalogQueryOptions): MerchantProduct[] {
		this.usedFallback = true;
		return this.fallbackCatalog
			.filter((item) => !options.category || item.category === options.category)
			.filter(
				(item) =>
					options.maxPrice === undefined || item.price <= options.maxPrice,
			)
			.slice(0, options.limit);
	}
}
