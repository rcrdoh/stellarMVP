import { randomUUID } from "node:crypto";
import {
	type MerchantOffer,
	type QuoteSnapshot,
	quoteSnapshotSchema,
	type ShoppingIntent,
} from "../../domain/agents/contracts.js";
import type { MerchantCatalog } from "../../services/agents/ports/merchant-catalog.js";
import type { ShoppingQuoteProvider } from "../../services/agents/ports/shopping-agent.js";

export type CatalogQuoteProviderOptions = Readonly<{
	/** Lifetime of a quote before it is considered expired. */
	ttlMs?: number;
	now?: () => Date;
	newQuoteId?: () => string;
}>;

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Deterministic quote provider built on the same catalog read model as the
 * search agent. It re-reads the selected offer, rejects offers that no longer
 * exist, and computes the total in minor units without trusting client input.
 * The resulting snapshot is validated against `quoteSnapshotSchema` before it
 * is returned to the graph.
 */
export class CatalogShoppingQuoteProvider implements ShoppingQuoteProvider {
	private readonly ttlMs: number;
	private readonly now: () => Date;
	private readonly newQuoteId: () => string;

	constructor(
		private readonly catalog: MerchantCatalog,
		options: CatalogQuoteProviderOptions = {},
	) {
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.now = options.now ?? (() => new Date());
		this.newQuoteId = options.newQuoteId ?? (() => randomUUID());
	}

	async createQuote(input: {
		sessionId: string;
		intent: ShoppingIntent;
		offerId: string;
		quantity: number;
	}): Promise<QuoteSnapshot> {
		const offer = await this.catalog.findOfferById(input.offerId);
		if (offer === null) {
			throw new Error("Selected offer is no longer available");
		}
		return quoteSnapshotSchema.parse({
			quoteId: this.newQuoteId(),
			offer,
			quantity: input.quantity,
			totalAmountMinor: this.total(offer, input.quantity),
			currency: offer.currency,
			expiresAt: new Date(this.now().getTime() + this.ttlMs).toISOString(),
		});
	}

	private total(offer: MerchantOffer, quantity: number): number {
		return offer.priceMinor * quantity;
	}
}
