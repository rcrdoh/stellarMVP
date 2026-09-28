import type {
	MerchantOffer,
	ProductSearchRequest,
} from "../../../domain/agents/contracts.js";

/**
 * Read model for merchant offers. Implementations may back it with a vector
 * index, a relational catalog or a remote UCP endpoint; the Shopping Agent only
 * depends on this port so the discovery source stays swappable.
 */
export interface MerchantCatalog {
	findOffers(request: ProductSearchRequest): Promise<MerchantOffer[]>;
	findOfferById(offerId: string): Promise<MerchantOffer | null>;
}
