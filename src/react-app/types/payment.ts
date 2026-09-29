/** Payment intent / submission / receipt types.
 * Mirrors the backend payment schemas (USDC-only, 7 decimals, stroops). */

export type PaymentIntentStatus =
	| "awaiting_signature"
	| "submitting"
	| "submitted"
	| "confirmed"
	| "failed"
	| "expired";

export type PaymentIntent = {
	intentId: string;
	quoteId: string;
	orderId: string;
	principalId: string;
	quoteHash: string;
	idempotencyKey: string;
	requestFingerprint: string;
	status: PaymentIntentStatus;
	networkPassphrase: string;
	payerAddress: string;
	assetCode: "USDC";
	assetIssuer: string;
	assetDecimals: 7;
	totalAmountAtomic: string;
	unsignedXdr: string;
	transactionHash?: string | undefined;
	ledger?: number | undefined;
	expiresAt: string;
	createdAt: string;
	updatedAt: string;
};

export type PaymentReceiptStatus =
	| "pending_confirmation"
	| "submitted"
	| "paid"
	| "failed";

export type PaymentReceipt = {
	intentId: string;
	orderId: string;
	status: PaymentReceiptStatus;
	transactionHash?: string | undefined;
	ledger?: number | undefined;
	amountAtomic: string;
	assetCode: string;
	payerAddress: string;
	networkPassphrase: string;
	confirmedAt?: string | undefined;
	updatedAt: string;
	stellarExpertUrl?: string | undefined;
};

/** A backend-approved quote. There is no HTTP endpoint to create one: quotes
 * come from the agent shopping flow (`/v1/agent/shopping`). The frontend only
 * needs the `quoteId`; amounts are derived server-side. */
export type ApprovedQuote = {
	quoteId: string;
	orderId: string;
};
