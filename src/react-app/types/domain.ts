/** Shared domain types for the React ACP x402 frontend.
 * Mirrors the backend contract described in `specs/openapi.json` and
 * `src/domain` (the backend wins on any disagreement). */

export type Offer = {
	id: string;
	title: string;
	merchant: string;
	description: string;
	category: string;
	price: number;
	currency: string;
	inStock: boolean;
	matchScore: number;
	url: string;
	image?: string | undefined;
};

export type CartLine = {
	offerId: string;
	quantity: number;
};

export type CartItem = {
	line: CartLine;
	offer: Offer;
};

export type SwapView = {
	id: string;
	inputMoney: { amount: number; asset: string };
	inputValueUsd: number;
	outputMoney: { amount: number; asset: string };
	outputValueUsd: number;
	rateLabel: string;
	protocolFeeUsd: number;
	/** Estimated ledger close. Null while unmeasured. */
	estimatedTimeMs: number | null;
	provider: "soroswap" | "phoenix";
	status: "QUOTED" | "EXECUTED" | "FAILED";
};
