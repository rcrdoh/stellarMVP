import { z } from "zod";

const maximumStroops = 9_223_372_036_854_775_807n;
const publicKeyPattern = /^G[A-Z2-7]{55}$/;
const utcTimestampSchema = z.iso
	.datetime()
	.refine((value) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));

export const paymentLegSchema = z.strictObject({
	purpose: z.enum(["merchant", "platform"]),
	payTo: z.string().regex(publicKeyPattern),
	amountAtomic: z
		.string()
		.regex(/^[1-9][0-9]*$/)
		.refine((value) => BigInt(value) <= maximumStroops),
});

export type PaymentLeg = z.infer<typeof paymentLegSchema>;

const paymentLegsSchema = z
	.array(paymentLegSchema)
	.min(1)
	.max(2)
	.superRefine((legs, context) => {
		const merchants = legs.filter((leg) => leg.purpose === "merchant");
		const platforms = legs.filter((leg) => leg.purpose === "platform");
		if (merchants.length !== 1 || platforms.length > 1) {
			context.addIssue({
				code: "custom",
				message:
					"An approved quote must contain one merchant leg and at most one platform leg.",
			});
		}
		const total = legs.reduce((sum, leg) => sum + BigInt(leg.amountAtomic), 0n);
		if (total > maximumStroops) {
			context.addIssue({
				code: "custom",
				message: "Payment legs exceed Stellar's supported amount range.",
			});
		}
	});

export const approvedPaymentQuoteSchema = z
	.strictObject({
		quoteId: z.string().min(1).max(128),
		orderId: z.string().min(1).max(128),
		quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
		principalId: z.string().min(1).max(128),
		status: z.literal("approved"),
		networkPassphrase: z.string().min(1).max(128),
		payerAddress: z.string().regex(publicKeyPattern),
		assetCode: z.literal("USDC"),
		assetIssuer: z.string().regex(publicKeyPattern),
		assetDecimals: z.literal(7),
		paymentLegs: paymentLegsSchema,
		expiresAt: utcTimestampSchema,
		memo: z.string().max(28).optional(),
	})
	.superRefine((quote, context) => {
		const merchants = quote.paymentLegs.filter(
			(leg) => leg.purpose === "merchant",
		);
		const platforms = quote.paymentLegs.filter(
			(leg) => leg.purpose === "platform",
		);
		if (merchants.length !== 1 || platforms.length > 1) {
			context.addIssue({
				code: "custom",
				message:
					"An approved quote must contain one merchant leg and at most one platform leg.",
				path: ["paymentLegs"],
			});
		}
		if (
			quote.memo !== undefined &&
			new TextEncoder().encode(quote.memo).length > 28
		) {
			context.addIssue({
				code: "custom",
				message: "Stellar text memos are limited to 28 bytes.",
				path: ["memo"],
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
		quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
		principalId: z.string().min(1).max(128),
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
		paymentLegs: paymentLegsSchema,
		unsignedXdr: z.string().min(1).max(100_000),
		memo: z.string().max(28).optional(),
		transactionHash: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.nullable(),
		ledger: z.number().int().positive().nullable(),
		expiresAt: utcTimestampSchema,
		createdAt: utcTimestampSchema,
		updatedAt: utcTimestampSchema,
	})
	.superRefine((intent, context) => {
		const total = intent.paymentLegs.reduce(
			(sum, leg) => sum + BigInt(leg.amountAtomic),
			0n,
		);
		if (total.toString() !== intent.totalAmountAtomic) {
			context.addIssue({
				code: "custom",
				message: "The intent total must equal the sum of its payment legs.",
				path: ["totalAmountAtomic"],
			});
		}
		if (
			intent.memo !== undefined &&
			new TextEncoder().encode(intent.memo).length > 28
		) {
			context.addIssue({
				code: "custom",
				message: "Stellar text memos are limited to 28 bytes.",
				path: ["memo"],
			});
		}
	});

export type PaymentIntent = z.infer<typeof paymentIntentSchema>;

export const createPaymentIntentRequestSchema = z.strictObject({
	quoteId: z.string().min(1).max(128),
});

export const submitPaymentTransactionRequestSchema = z.strictObject({
	signedXdr: z.string().min(1).max(100_000),
});

export const paymentIntentIdSchema = z.string().uuid();
export const idempotencyKeySchema = z.string().min(8).max(128);

export function sumPaymentLegs(paymentLegs: readonly PaymentLeg[]): string {
	const total = paymentLegs.reduce(
		(sum, leg) => sum + BigInt(leg.amountAtomic),
		0n,
	);
	if (total <= 0n || total > maximumStroops) {
		throw new RangeError(
			"Payment total is outside Stellar's supported amount range.",
		);
	}
	return total.toString();
}

export function amountAtomicToStellar(amountAtomic: string): string {
	const amount = BigInt(amountAtomic);
	if (amount <= 0n || amount > maximumStroops) {
		throw new RangeError(
			"Payment amount is outside Stellar's supported amount range.",
		);
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
	if (atomic > maximumStroops) {
		return undefined;
	}
	return atomic.toString();
}
