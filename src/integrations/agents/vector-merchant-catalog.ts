import {
	type MerchantOffer,
	merchantOfferSchema,
	type ProductSearchRequest,
} from "../../domain/agents/contracts.js";
import type { MerchantCatalog } from "../../services/agents/ports/merchant-catalog.js";
import type { EmbeddingsLike } from "../openai.js";
import type { VectorSearchClient } from "../qdrant.js";

export type VectorMerchantCatalogOptions = Readonly<{
	collection: string;
}>;

/**
 * `MerchantCatalog` adapter over an embeddings provider and a vector store.
 * Offers are expected to be indexed as `MerchantOffer.payload`-shaped objects;
 * each hit is parsed with the strict `merchantOfferSchema` so an incompatible
 * index fails closed instead of feeding partial data into the graph.
 */
export class VectorMerchantCatalog implements MerchantCatalog {
	constructor(
		private readonly embeddings: EmbeddingsLike,
		private readonly vectors: VectorSearchClient,
		private readonly options: VectorMerchantCatalogOptions,
	) {}

	async findOffers(request: ProductSearchRequest): Promise<MerchantOffer[]> {
		const vector = await this.embeddings.embedQuery(request.query);
		const hits = await this.vectors.search({
			collection: this.options.collection,
			vector,
			limit: request.limit,
			...this.buildFilters(request),
		});
		return this.parseOffers(hits.map((hit) => hit.payload));
	}

	async findOfferById(offerId: string): Promise<MerchantOffer | null> {
		const [hit] = await this.vectors.search({
			collection: this.options.collection,
			vector: await this.embeddings.embedQuery(offerId),
			limit: 1,
			filters: { offerId },
		});
		if (hit === undefined) {
			return null;
		}
		const [offer] = this.parseOffers([hit.payload]);
		return offer ?? null;
	}

	private buildFilters(
		request: ProductSearchRequest,
	): { filters: Record<string, string> } | Record<string, never> {
		const filters: Record<string, string> = {};
		const { currency, inStock } = request.filters;
		if (currency !== undefined) {
			filters.currency = currency;
		}
		if (inStock) {
			filters.availability = "in_stock";
		}
		return Object.keys(filters).length === 0 ? {} : { filters };
	}

	private parseOffers(payloads: Record<string, unknown>[]): MerchantOffer[] {
		const offers: MerchantOffer[] = [];
		for (const payload of payloads) {
			const parsed = merchantOfferSchema.safeParse(payload);
			if (parsed.success) {
				offers.push(parsed.data);
			}
		}
		return offers;
	}
}
