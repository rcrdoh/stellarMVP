import {
	CatalogSearchRequestSchema,
	type CatalogSearchResponse,
	CatalogSearchResponseSchema,
} from "../../schemas/catalog.schema.js";
import type { CatalogSearchEngine } from "./ports/catalog-search-engine.js";

/**
 * Use case behind `POST /v1/agent/catalog/search`. It sanitizes the transport
 * payload (Audit L2), delegates retrieval to the injected vector engine and
 * projects the result to the typed response contract.
 *
 * `fallback` reports whether the engine could not reach Qdrant and served the
 * deterministic offline catalog instead, so callers can surface degraded mode.
 */
export class CatalogSearchService {
	constructor(private readonly engine: CatalogSearchEngine) {}

	async search(payload: unknown): Promise<CatalogSearchResponse> {
		const request = CatalogSearchRequestSchema.parse(payload);
		const results = await this.engine.searchCandidates(request);

		return CatalogSearchResponseSchema.parse({
			results,
			count: results.length,
			fallback: this.engine.isFallback?.() ?? false,
		});
	}
}
