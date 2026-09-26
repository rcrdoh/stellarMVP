import { createHash, randomUUID } from "node:crypto";
import type {
	MerchantOffer,
	ProductSearchRequest,
} from "../domain/agents/contracts.js";
import type { CatalogIngestionResult } from "../domain/catalog.js";
import type { DocumentEmbeddingsLike } from "../integrations/openai.js";
import type { VectorIndexClient, VectorPoint } from "../integrations/qdrant.js";

export interface CatalogSource {
	search(request: ProductSearchRequest): Promise<{ offers: MerchantOffer[] }>;
}

export type CatalogIngestionOptions = Readonly<{
	merchantId: string;
	collection: string;
	query: string;
	limit: number;
}>;

export class CatalogIngestionService {
	constructor(
		private readonly source: CatalogSource,
		private readonly embeddings: DocumentEmbeddingsLike,
		private readonly vectors: VectorIndexClient,
		private readonly options: CatalogIngestionOptions,
	) {}

	async run(jobId: string = randomUUID()): Promise<CatalogIngestionResult> {
		const result = await this.source.search({
			query: this.options.query,
			limit: this.options.limit,
			filters: { inStock: true },
		});
		const offers = result.offers;
		if (offers.length === 0) {
			return {
				jobId,
				status: "completed",
				merchantId: this.options.merchantId,
				collection: this.options.collection,
				products: 0,
				points: 0,
				completedAt: new Date().toISOString(),
			};
		}

		const documents = offers.map((offer) =>
			[
				offer.title,
				offer.description ?? "",
				`merchant:${offer.merchantId}`,
				`currency:${offer.currency}`,
				...(offer.paymentTerms ?? []).map(
					(term) => `payment:${term.network}:${term.asset ?? "unknown"}`,
				),
			].join("\n"),
		);
		const vectors = await this.embeddings.embedDocuments(documents);
		const vectorSize = vectors[0]?.length ?? 0;
		if (vectorSize === 0 || vectors.length !== offers.length) {
			throw new Error("Embedding provider returned an invalid vector batch");
		}

		const points: VectorPoint[] = offers.map((offer, index) => ({
			id: stablePointId(offer.offerId),
			vector: vectors[index] ?? [],
			payload: { ...offer, indexedAt: new Date().toISOString() },
		}));
		await this.vectors.ensureCollection(this.options.collection, vectorSize);
		await this.vectors.upsert(this.options.collection, points);

		return {
			jobId,
			status: "completed",
			merchantId: this.options.merchantId,
			collection: this.options.collection,
			products: offers.length,
			points: points.length,
			completedAt: new Date().toISOString(),
		};
	}
}

export type CatalogIngestionJob = Readonly<{
	id: string;
	status: "queued" | "running" | "completed" | "failed";
	result?: CatalogIngestionResult;
	error?: string;
	createdAt: string;
	updatedAt: string;
}>;

export class CatalogIngestionJobService {
	private readonly jobs = new Map<string, CatalogIngestionJob>();

	constructor(private readonly ingestion: CatalogIngestionService) {}

	start(): CatalogIngestionJob {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.jobs.set(id, { id, status: "queued", createdAt: now, updatedAt: now });
		void this.execute(id);
		return this.jobs.get(id) as CatalogIngestionJob;
	}

	get(id: string): CatalogIngestionJob | undefined {
		return this.jobs.get(id);
	}

	private async execute(id: string): Promise<void> {
		this.update(id, { status: "running" });
		try {
			const result = await this.ingestion.run(id);
			this.update(id, { status: "completed", result });
		} catch (error) {
			this.update(id, {
				status: "failed",
				error:
					error instanceof Error ? error.message : "catalog-ingestion-failed",
			});
		}
	}

	private update(
		id: string,
		patch: Pick<CatalogIngestionJob, "status" | "result" | "error">,
	): void {
		const current = this.jobs.get(id);
		if (current === undefined) return;
		this.jobs.set(id, {
			...current,
			...patch,
			updatedAt: new Date().toISOString(),
		});
	}
}

function stablePointId(value: string): string {
	const digest = createHash("sha256").update(value).digest("hex");
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}
