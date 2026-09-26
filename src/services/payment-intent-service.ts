import { createHash, randomUUID } from "node:crypto";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import {
	type ApprovedPaymentQuote,
	type PaymentIntent,
	type PaymentIntentStatus,
	paymentIntentSchema,
} from "../domain/payments.js";

export type BuiltPaymentTransaction = Readonly<{
	unsignedXdr: string;
	transactionHash: string;
	expiresAt: string;
}>;

export type PaymentLookup =
	| Readonly<{ status: "pending" | "not_found" }>
	| Readonly<{ status: "confirmed"; ledger: number }>
	| Readonly<{ status: "failed" }>;

export interface PaymentQuoteRepository {
	findApprovedQuote(quoteId: string): Promise<ApprovedPaymentQuote | null>;
}

export interface PaymentIntentRepository {
	findByIdempotencyKey(
		principalId: string,
		idempotencyKey: string,
	): Promise<PaymentIntent | null>;
	findIntentById(intentId: string): Promise<PaymentIntent | null>;
	insertIntent(intent: PaymentIntent): Promise<void>;
	expireUnsignedForPayer(payerAddress: string, asOf: string): Promise<void>;
	compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean>;
	settleConfirmed(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean>;
	settleFailed(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean>;
}

export interface StellarIntentGateway {
	buildUnsignedTransaction(
		quote: ApprovedPaymentQuote,
	): Promise<BuiltPaymentTransaction>;
	verifySignedTransaction(signedXdr: string, intent: PaymentIntent): string;
	submitSignedTransaction(
		signedXdr: string,
		intent: PaymentIntent,
	): Promise<void>;
	lookupTransaction(intent: PaymentIntent): Promise<PaymentLookup>;
}

export type PaymentIntentRuntime = Readonly<{
	quotes: PaymentQuoteRepository;
	intents: PaymentIntentRepository;
	stellar: StellarIntentGateway;
	networkPassphrase: string;
	usdcIssuer: string;
	now?: () => Date;
}>;

export class PaymentIntentService {
	private readonly now: () => Date;

	constructor(private readonly dependencies: PaymentIntentRuntime) {
		this.now = dependencies.now ?? (() => new Date());
	}

	async createIntent(input: {
		quoteId: string;
		principalId: string;
		idempotencyKey: string;
	}): Promise<{ intent: PaymentIntent; replayed: boolean }> {
		const requestFingerprint = createHash("sha256")
			.update(JSON.stringify([input.principalId, input.quoteId]))
			.digest("hex");
		const existing = await this.dependencies.intents.findByIdempotencyKey(
			input.principalId,
			input.idempotencyKey,
		);
		if (existing) {
			if (existing.requestFingerprint !== requestFingerprint) {
				throw new AppError(
					errorCodes.IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD,
				);
			}
			return { intent: existing, replayed: true };
		}

		const quote = await this.dependencies.quotes.findApprovedQuote(
			input.quoteId,
		);
		if (!quote) throw new AppError(errorCodes.PAYMENT_QUOTE_NOT_FOUND);
		if (quote.principalId !== input.principalId) {
			throw new AppError(errorCodes.PAYMENT_PRINCIPAL_NOT_AUTHORIZED);
		}
		if (
			quote.networkPassphrase !== this.dependencies.networkPassphrase ||
			quote.assetCode !== "USDC" ||
			quote.assetIssuer !== this.dependencies.usdcIssuer
		) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
		const now = this.now();
		if (Date.parse(quote.expiresAt) <= now.getTime()) {
			throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
		}

		await this.dependencies.intents.expireUnsignedForPayer(
			quote.payerAddress,
			now.toISOString(),
		);
		const built =
			await this.dependencies.stellar.buildUnsignedTransaction(quote);
		const expiresAt = new Date(
			Math.min(Date.parse(quote.expiresAt), Date.parse(built.expiresAt)),
		).toISOString();
		if (Date.parse(expiresAt) <= now.getTime()) {
			throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
		}
		const timestamp = now.toISOString();
		const intent = paymentIntentSchema.parse({
			intentId: randomUUID(),
			quoteId: quote.quoteId,
			orderId: quote.orderId,
			principalId: quote.principalId,
			quoteHash: quote.quoteHash,
			idempotencyKey: input.idempotencyKey,
			requestFingerprint,
			status: "awaiting_signature",
			networkPassphrase: quote.networkPassphrase,
			payerAddress: quote.payerAddress,
			assetCode: quote.assetCode,
			assetIssuer: quote.assetIssuer,
			assetDecimals: quote.assetDecimals,
			totalAmountAtomic: quote.paymentLeg.amountAtomic,
			paymentLeg: quote.paymentLeg,
			unsignedXdr: built.unsignedXdr,
			transactionHash: built.transactionHash,
			ledger: null,
			expiresAt,
			createdAt: timestamp,
			updatedAt: timestamp,
		});

		try {
			await this.dependencies.intents.insertIntent(intent);
			return { intent, replayed: false };
		} catch (error) {
			if (!isUniqueViolation(error)) {
				throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
			}
			const raced = await this.dependencies.intents.findByIdempotencyKey(
				input.principalId,
				input.idempotencyKey,
			);
			if (!raced) throw new AppError(errorCodes.RESOURCE_STATE_CONFLICT);
			if (raced.requestFingerprint !== requestFingerprint) {
				throw new AppError(
					errorCodes.IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD,
				);
			}
			return { intent: raced, replayed: true };
		}
	}

	async getIntent(
		intentId: string,
		principalId: string,
	): Promise<PaymentIntent> {
		let intent = await this.getOwnedIntent(intentId, principalId);
		if (
			intent.status === "awaiting_signature" &&
			Date.parse(intent.expiresAt) <= this.now().getTime()
		) {
			const expired = paymentIntentSchema.parse({
				...intent,
				status: "expired",
				updatedAt: this.now().toISOString(),
			});
			const changed = await this.dependencies.intents.compareAndSet(
				expired,
				"awaiting_signature",
			);
			if (changed) intent = expired;
		}
		return this.reconcile(intent);
	}

	async submitSignedTransaction(input: {
		intentId: string;
		principalId: string;
		signedXdr: string;
	}): Promise<PaymentIntent> {
		let intent = await this.getOwnedIntent(input.intentId, input.principalId);
		if (intent.status === "confirmed" || intent.status === "failed")
			return intent;
		if (intent.status === "expired") {
			throw new AppError(errorCodes.RESOURCE_STATE_CONFLICT);
		}
		const transactionHash = this.dependencies.stellar.verifySignedTransaction(
			input.signedXdr,
			intent,
		);
		if (intent.transactionHash !== transactionHash) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}

		if (intent.status === "awaiting_signature") {
			if (Date.parse(intent.expiresAt) <= this.now().getTime()) {
				throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
			}
			const submitting = paymentIntentSchema.parse({
				...intent,
				status: "submitting",
				updatedAt: this.now().toISOString(),
			});
			const claimed = await this.dependencies.intents.compareAndSet(
				submitting,
				"awaiting_signature",
			);
			if (!claimed) return this.getIntent(input.intentId, input.principalId);
			intent = submitting;
			try {
				await this.dependencies.stellar.submitSignedTransaction(
					input.signedXdr,
					intent,
				);
			} catch {
				throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
			}
			const submitted = paymentIntentSchema.parse({
				...intent,
				status: "submitted",
				updatedAt: this.now().toISOString(),
			});
			await this.dependencies.intents.compareAndSet(submitted, "submitting");
			return this.reconcile(submitted);
		}

		return this.reconcile(intent);
	}

	private async reconcile(intent: PaymentIntent): Promise<PaymentIntent> {
		if (
			(intent.status !== "submitting" && intent.status !== "submitted") ||
			intent.transactionHash === null
		) {
			return intent;
		}
		const lookup = await this.dependencies.stellar.lookupTransaction(intent);
		if (lookup.status === "pending" || lookup.status === "not_found")
			return intent;
		const next = paymentIntentSchema.parse({
			...intent,
			status: lookup.status === "confirmed" ? "confirmed" : "failed",
			ledger: lookup.status === "confirmed" ? lookup.ledger : null,
			updatedAt: this.now().toISOString(),
		});
		const updated =
			next.status === "confirmed"
				? await this.dependencies.intents.settleConfirmed(next, intent.status)
				: await this.dependencies.intents.settleFailed(next, intent.status);
		if (!updated) {
			return this.getOwnedIntent(intent.intentId, intent.principalId);
		}
		return next;
	}

	private async getOwnedIntent(
		intentId: string,
		principalId: string,
	): Promise<PaymentIntent> {
		const intent = await this.dependencies.intents.findIntentById(intentId);
		if (!intent) throw new AppError(errorCodes.PAYMENT_INTENT_NOT_FOUND);
		if (intent.principalId !== principalId) {
			throw new AppError(errorCodes.PAYMENT_PRINCIPAL_NOT_AUTHORIZED);
		}
		return intent;
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}
