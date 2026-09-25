import type {
	MerchantSearchResult,
	ProductSearchRequest,
	QuoteSnapshot,
	ShoppingDecisionSignal,
	ShoppingIntent,
} from "../../../domain/agents/contracts.js";

export interface ShoppingDecisionProvider {
	assess(input: { message: string }): Promise<ShoppingDecisionSignal | null>;
}

export interface MerchantSearchAgent {
	search(request: ProductSearchRequest): Promise<MerchantSearchResult>;
}

export interface ShoppingQuoteProvider {
	createQuote(input: {
		sessionId: string;
		intent: ShoppingIntent;
		offerId: string;
		quantity: number;
	}): Promise<QuoteSnapshot>;
}
