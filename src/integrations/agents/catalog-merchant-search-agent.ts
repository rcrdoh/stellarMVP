import {
	type MerchantSearchResult,
	merchantSearchResultSchema,
	type ProductSearchRequest,
} from "../../domain/agents/contracts.js";
import type { MerchantCatalog } from "../../services/agents/ports/merchant-catalog.js";
import type { MerchantSearchAgent } from "../../services/agents/ports/shopping-agent.js";

/**
 * Adapts a `MerchantCatalog` read model to the `MerchantSearchAgent` port the
 * Shopping Agent expects. The result is validated against the strict
 * `merchantSearchResultSchema` so malformed catalog rows fail closed instead of
 * leaking into the graph.
 */
export class CatalogMerchantSearchAgent implements MerchantSearchAgent {
	constructor(private readonly catalog: MerchantCatalog) {}

	async search(request: ProductSearchRequest): Promise<MerchantSearchResult> {
		const offers = await this.catalog.findOffers(request);
		return merchantSearchResultSchema.parse({ offers: offers.slice(0, 10) });
	}
}
