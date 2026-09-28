import { z } from "zod";
import { X402ChallengePayloadSchema } from "../domain/checkout/types.js";

/**
 * Canonical checkout request handled by the agentic payment firewall. The
 * `amountAtomic` is an integer count of atomic asset units so money never
 * round-trips through a float in the spend ledger (Audit H2). `idempotencyKey`
 * guarantees a retried checkout cannot double-charge a service token.
 */
export const CheckoutRequestSchema = z
	.object({
		itemId: z.string().min(1).max(128),
		merchantId: z.string().min(1).max(128),
		amountAtomic: z.number().int().positive().max(1_000_000_000_000),
		currency: z.string().min(1).max(12).default("USDC"),
		destination: z.string().min(1).max(128),
		idempotencyKey: z.string().min(1).max(128),
	})
	.strict();

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
export type CheckoutRequestInput = z.input<typeof CheckoutRequestSchema>;

/** Successful checkout acknowledgement returned to the calling agent. */
export const CheckoutResponseSchema = z.object({
	orderId: z.string().min(1),
	itemId: z.string().min(1),
	amountAtomic: z.number().int().nonnegative(),
	currency: z.string().min(1),
	status: z.enum(["paid", "fulfilled"]),
	transactionHash: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

/**
 * 402 body handed back when the payment firewall refuses to settle. `challenge`
 * is the base64-encoded JSON also mirrored on the `X-402-Challenge` header so a
 * client can settle out-of-band and retry the same idempotency key.
 */
export const X402ChallengeResponseSchema = z.object({
	challenge: z.string().min(1),
	payload: X402ChallengePayloadSchema,
});

export type X402ChallengeResponse = z.infer<typeof X402ChallengeResponseSchema>;
