import { z } from "zod";

const maximumStroops = 9_223_372_036_854_775_807n;
const publicKeyPattern = /^G[A-Z2-7]{55}$/;
const isoTimestamp = z.iso
	.datetime()
	.refine((value) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));

export const paymentLegSchema = z.strictObject({
	purpose: z.literal("merchant"),
	payTo: z.string().regex(publicKeyPattern),
	amountAtomic: z
		.string()
		.regex(/^[1-9][0-9]*$/)
		.refine((value) => BigInt(value) <= maximumStroops),
});
export type PaymentLeg = z.infer<typeof paymentLegSchema>;

export const approvedPaymentQuoteSchema = z
	.strictObject({
		quoteId: z.string().min(1).max(128),
		orderId: z.string().min(1).max(128),
		sessionId: z.string().min(1).max(128),
		principalId: z.string().min(1).max(128),
		quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
		status: z.literal("approved"),
		networkPassphrase: z.string().min(1).max(128),
		payerAddress: z.string().regex(publicKeyPattern),
		assetCode: z.literal("USDC"),
		assetIssuer: z.string().regex(publicKeyPattern),
		assetDecimals: z.literal(7),
		paymentLeg: paymentLegSchema,
		expiresAt: isoTimestamp,
	})
	.superRefine((quote, context) => {
		if (quote.paymentLeg.amountAtomic.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["paymentLeg", "amountAtomic"],
				message: "Payment amount is required.",
			});
		}
	});
export type ApprovedPaymentQuote = z.infer<typeof approvedPaymentQuoteSchema>;

export const paymentIntentStatusSchema = z.enum([
	"awaiting_signature",
	"submitting",
	"submitted",
	"confirmed",
	"failed",
	"expired",
]);
export type PaymentIntentStatus = z.infer<typeof paymentIntentStatusSchema>;

export const paymentIntentSchema = z
	.strictObject({
		intentId: z.string().uuid(),
		quoteId: z.string().min(1).max(128),
		orderId: z.string().min(1).max(128),
		principalId: z.string().min(1).max(128),
		quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
		idempotencyKey: z.string().min(8).max(128),
		requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
		status: paymentIntentStatusSchema,
		networkPassphrase: z.string().min(1).max(128),
		payerAddress: z.string().regex(publicKeyPattern),
		assetCode: z.literal("USDC"),
		assetIssuer: z.string().regex(publicKeyPattern),
		assetDecimals: z.literal(7),
		totalAmountAtomic: z
			.string()
			.regex(/^[1-9][0-9]*$/)
			.refine((value) => BigInt(value) <= maximumStroops),
		paymentLeg: paymentLegSchema,
		unsignedXdr: z.string().min(1).max(100_000),
		transactionHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.nullable(),
		ledger: z.number().int().positive().nullable(),
		expiresAt: isoTimestamp,
		createdAt: isoTimestamp,
		updatedAt: isoTimestamp,
	})
	.superRefine((intent, context) => {
		if (intent.totalAmountAtomic !== intent.paymentLeg.amountAtomic) {
			context.addIssue({
				code: "custom",
				path: ["totalAmountAtomic"],
				message: "Intent total must equal the payment leg amount.",
			});
		}
	});
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const createPaymentIntentRequestSchema = z.strictObject({
	quoteId: z.string().min(1).max(128),
});

export const createPaymentQuoteRequestSchema = z.strictObject({
	payerAddress: z.string().regex(publicKeyPattern),
});

export const submitPaymentTransactionRequestSchema = z.strictObject({
	signedXdr: z.string().min(1).max(100_000),
});

export const paymentIntentIdSchema = z.string().uuid();
export const idempotencyKeySchema = z.string().min(8).max(128);
export const principalIdSchema = z.string().trim().min(1).max(128);

export function amountAtomicToStellar(amountAtomic: string): string {
	const amount = BigInt(amountAtomic);
	if (amount <= 0n || amount > maximumStroops) {
		throw new RangeError("Payment amount is outside Stellar's range.");
	}
	const whole = amount / 10_000_000n;
	const fractional = (amount % 10_000_000n)
		.toString()
		.padStart(7, "0")
		.replace(/0+$/, "");
	return fractional.length > 0 ? `${whole}.${fractional}` : whole.toString();
}

export function stellarAmountToAtomic(amount: string): string | undefined {
	if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,7})?$/.test(amount)) {
		return undefined;
	}
	const [whole = "0", fraction = ""] = amount.split(".");
	const atomic = BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
	if (atomic <= 0n || atomic > maximumStroops) return undefined;
	return atomic.toString();
}
