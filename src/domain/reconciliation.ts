import { z } from "zod";
import {
	type PaymentIntent,
	type PaymentIntentStatus,
	paymentIntentStatusSchema,
} from "./payments.js";

/**
 * Public settlement vocabulary surfaced to shoppers and receipts. It condenses
 * the persisted {@link PaymentIntentStatus} state machine into the coarse
 * status a human (or a receipt UI) needs: a payment is either still being
 * confirmed, settled, or did not settle.
 *
 * `submitted` is the indeterminate state: Horizon accepted the submission or we
 * lost the response, but the transaction has not been observed in a ledger yet.
 * The reconciliation worker promotes it to `paid`/`failed` once the ledger
 * outcome is known (Audit H1).
 */
export const settlementStatusSchema = z.enum([
	"pending_confirmation",
	"submitted",
	"paid",
	"failed",
]);
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;

/**
 * Deterministic projection from the persisted intent status to the settlement
 * vocabulary. `expired` degrades to `failed`: from the payer's perspective an
 * intent that was never signed is a terminal non-payment, not a pending charge.
 */
export function toSettlementStatus(
	status: PaymentIntentStatus,
): SettlementStatus {
	switch (status) {
		case "awaiting_signature":
			return "pending_confirmation";
		case "submitting":
		case "submitted":
			return "submitted";
		case "confirmed":
			return "paid";
		case "failed":
		case "expired":
			return "failed";
	}
}

/** True for statuses the reconciliation worker must revisit. */
export function isIndeterminateStatus(status: PaymentIntentStatus): boolean {
	return status === "submitting" || status === "submitted";
}

const EXPLORER_BY_NETWORK: Record<string, string> = {
	"Test SDF Network ; September 2015": "testnet",
	"Public Global Stellar Network ; September 2015": "public",
	"Test SDF Future Network ; October 2022": "futurenet",
};

/**
 * Derives the Stellar Expert explorer slug from the network passphrase carried
 * by the intent. Falling back to `testnet` keeps the link well-formed for
 * local/sandbox networks without inventing a nonexistent explorer route.
 */
export function stellarExpertNetwork(networkPassphrase: string): string {
	return EXPLORER_BY_NETWORK[networkPassphrase] ?? "testnet";
}

/** Builds a Stellar Expert transaction link. Hashes are hex, never user text. */
export function stellarExpertTransactionUrl(
	transactionHash: string,
	networkPassphrase: string,
): string {
	const slug = stellarExpertNetwork(networkPassphrase);
	return `https://stellar.expert/explorer/${slug}/tx/${transactionHash}`;
}

export const paymentReceiptSchema = z
	.object({
		intentId: z.string().uuid(),
		orderId: z.string().min(1).max(128),
		status: settlementStatusSchema,
		transactionHash: z.string().regex(/^[a-f0-9]{64}$/),
		ledger: z.number().int().positive().nullable(),
		amountAtomic: z.string().regex(/^[1-9][0-9]*$/),
		assetCode: z.string().min(1),
		payerAddress: z.string().regex(/^G[A-Z2-7]{55}$/),
		networkPassphrase: z.string().min(1),
		confirmedAt: z.string().optional(),
		updatedAt: z.string(),
		stellarExpertUrl: z.string().url(),
	})
	.strict();
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;

/**
 * Projects a persisted intent into a receipt suitable for the HTTP layer and
 * the UI. `confirmedAt` is only present once the intent is `paid`; a still
 * indeterminate intent carries the last `updatedAt` instead so the client can
 * poll without inventing a settlement timestamp.
 */
export function toPaymentReceipt(intent: PaymentIntent): PaymentReceipt {
	const status = toSettlementStatus(intent.status);
	const transactionHash = intent.transactionHash;
	if (transactionHash === null) {
		throw new Error("Cannot build a receipt for an intent without a hash.");
	}
	return paymentReceiptSchema.parse({
		intentId: intent.intentId,
		orderId: intent.orderId,
		status,
		transactionHash,
		ledger: intent.ledger,
		amountAtomic: intent.totalAmountAtomic,
		assetCode: intent.assetCode,
		payerAddress: intent.payerAddress,
		networkPassphrase: intent.networkPassphrase,
		...(status === "paid" ? { confirmedAt: intent.updatedAt } : {}),
		updatedAt: intent.updatedAt,
		stellarExpertUrl: stellarExpertTransactionUrl(
			transactionHash,
			intent.networkPassphrase,
		),
	});
}

export const reconciliationOutcomeSchema = z
	.object({
		intentId: z.string().uuid(),
		previousStatus: paymentIntentStatusSchema,
		status: paymentIntentStatusSchema,
		resolved: z.boolean(),
		ledger: z.number().int().positive().nullable(),
	})
	.strict();
export type ReconciliationOutcome = z.infer<typeof reconciliationOutcomeSchema>;

export const reconciliationRunSchema = z
	.object({
		scanned: z.number().int().nonnegative(),
		confirmed: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		unresolved: z.number().int().nonnegative(),
		outcomes: z.array(reconciliationOutcomeSchema),
	})
	.strict();
export type ReconciliationRun = z.infer<typeof reconciliationRunSchema>;
