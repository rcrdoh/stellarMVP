import { z } from "zod";
import {
	reconciliationRunSchema,
	settlementStatusSchema,
} from "../domain/reconciliation.js";

/**
 * `POST /v1/payment-intents/{intentId}/reconcile` asks the server to re-check a
 * single indeterminate intent against Horizon immediately, instead of waiting
 * for the background worker. An optional `transactionHash` lets an operator
 * supply the hash observed out-of-band when the submission response was lost;
 * when omitted the intent's own hash is used.
 */
export const reconcilePaymentRequestSchema = z
	.object({
		transactionHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/, "Transaction hash must be 64 hex characters")
			.optional(),
	})
	.strict();
export type ReconcilePaymentRequest = z.infer<
	typeof reconcilePaymentRequestSchema
>;

/** Receipt projection returned by the confirm/reconcile endpoints. */
export const paymentReceiptResponseSchema = z
	.object({
		intentId: z.string().uuid(),
		orderId: z.string(),
		status: settlementStatusSchema,
		transactionHash: z.string(),
		ledger: z.number().int().positive().nullable(),
		amountAtomic: z.string(),
		assetCode: z.string(),
		payerAddress: z.string(),
		networkPassphrase: z.string(),
		confirmedAt: z.string().optional(),
		updatedAt: z.string(),
		stellarExpertUrl: z.string().url(),
	})
	.strict();
export type PaymentReceiptResponse = z.infer<
	typeof paymentReceiptResponseSchema
>;

/** Response of an operator-triggered batch reconciliation sweep. */
export const reconciliationReportResponseSchema = reconciliationRunSchema;
export type ReconciliationReportResponse = z.infer<
	typeof reconciliationReportResponseSchema
>;

/**
 * Body of `POST /v1/payment-intents/reconcile`. `limit` bounds how many
 * indeterminate intents a single sweep touches so the route cannot be turned
 * into an unbounded Horizon fan-out.
 */
export const reconcileBatchRequestSchema = z
	.object({
		limit: z.number().int().positive().max(100).default(25),
	})
	.strict();
export type ReconcileBatchRequest = z.infer<typeof reconcileBatchRequestSchema>;
