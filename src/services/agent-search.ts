import type { AgentSearchQuery, AgentSearchResponse } from "../domain/agent.js";
import type { EmbeddingsLike } from "../integrations/openai.js";
import type { VectorSearchClient } from "../integrations/qdrant.js";

export type AgentSearchOptions = Readonly<{
	collection: string;
}>;

/**
 * Executes the agentic vector search use case. Depends only on ports
 * (`EmbeddingsLike`, `VectorSearchClient`) so adapters stay swappable and the
 * domain keeps no dependency on a concrete vector database.
 */
export class AgentSearchService {
	constructor(
		private readonly embeddings: EmbeddingsLike,
		private readonly vectors: VectorSearchClient,
		private readonly options: AgentSearchOptions,
	) {}

	async search(input: AgentSearchQuery): Promise<AgentSearchResponse> {
		const vector = await this.embeddings.embedQuery(input.query);
		const hits = await this.vectors.search({
			collection: this.options.collection,
			vector,
			limit: input.limit,
			...(input.filters === undefined ? {} : { filters: input.filters }),
		});
		const results = hits.map((hit) => ({
			id: hit.id,
			score: hit.score,
			payload: hit.payload,
		}));
		return { results, count: results.length };
	}
}
