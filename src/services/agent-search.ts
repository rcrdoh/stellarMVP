import type { AgentSearchQuery, AgentSearchResponse } from "../domain/agent.js";
import type { EmbeddingsLike } from "../integrations/openai.js";
import type { VectorSearchClient } from "../integrations/qdrant.js";
import type { MerchantSearchAgent } from "./agents/ports/shopping-agent.js";

export type AgentSearchOptions = Readonly<{
	collection: string;
	fallback?: MerchantSearchAgent;
}>;

/**
 * Executes the agentic vector search use case. Depends only on ports
 * (`EmbeddingsLike`, `VectorSearchClient`) so adapters stay swappable and the
 * domain keeps no dependency on a concrete vector database.
 */
export class AgentSearchService {
	constructor(
		private readonly embeddings: EmbeddingsLike | undefined,
		private readonly vectors: VectorSearchClient | undefined,
		private readonly options: AgentSearchOptions,
	) {}

	async search(input: AgentSearchQuery): Promise<AgentSearchResponse> {
		let vectorError: unknown;
		if (this.embeddings !== undefined && this.vectors !== undefined) {
			try {
				const vector = await this.embeddings.embedQuery(input.query);
				const hits = await this.vectors.search({
					collection: this.options.collection,
					vector,
					limit: input.limit,
					...(input.filters === undefined ? {} : { filters: input.filters }),
				});
				if (hits.length > 0 || this.options.fallback === undefined) {
					const results = hits.map((hit) => ({
						id: hit.id,
						score: hit.score,
						payload: hit.payload,
					}));
					return { results, count: results.length };
				}
			} catch (error) {
				vectorError = error;
			}
		}

		if (this.options.fallback !== undefined) {
			const fallback = await this.options.fallback.search({
				query: input.query,
				limit: input.limit,
				filters: { inStock: input.filters?.inStock !== "false" },
			});
			const results = fallback.offers.map((offer, index) => ({
				id: offer.offerId,
				score: 1 - index / Math.max(fallback.offers.length, 1),
				payload: { ...offer, retrievalSource: "ucp-live" },
			}));
			return { results, count: results.length };
		}

		if (vectorError instanceof Error) throw vectorError;
		throw new Error("No vector search or UCP catalog source is configured");
	}
}
