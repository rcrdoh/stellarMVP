import type {
	CatalogQueryInput,
	MerchantProduct,
} from "../../../domain/catalog/types.js";

/**
 * Read model for the vector merchant catalog (Module 6). The HTTP layer depends
 * on this port so the Qdrant REST engine can be swapped for a deterministic
 * offline implementation without touching transport code.
 */
export interface CatalogSearchEngine {
	searchCandidates(options: CatalogQueryInput): Promise<MerchantProduct[]>;
	/** Whether the most recent search served the deterministic offline catalog. */
	isFallback?(): boolean;
}
