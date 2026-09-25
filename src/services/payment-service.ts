import { createHash, randomUUID } from "node:crypto";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import {
	type ApprovedPaymentQuote,
	approvedPaymentQuoteSchema,
	type PaymentIntent,
	type PaymentIntentStatus,
	paymentIntentSchema,
	sumPaymentLegs,
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

export type CreatePaymentIntentResult = Readonly<{
	intent: PaymentIntent;
	replayed: boolean;
}>;

export class PaymentIntentConflictError extends Error {
	constructor() {
		super("A payment intent conflicts with a unique payment constraint.");
		this.name = "PaymentIntentConflictError";
	}
}

export interface PaymentQuoteReader {
	findQuoteById(quoteId: string): Promise<unknown | undefined>;
}

export interface PaymentIntentRepository {
	findByIdempotencyKey(
		principalId: string,
		idempotencyKey: string,
	): Promise<PaymentIntent | undefined>;
	findIntentById(intentId: string): Promise<PaymentIntent | undefined>;
	insert(intent: PaymentIntent): Promise<void>;
	expireUnsignedForPayer(payerAddress: string, asOf: string): Promise<void>;
	compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean>;
}

export interface StellarPaymentGateway {
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

export type PaymentServiceDependencies = Readonly<{
	quotes: PaymentQuoteReader;
	intents: PaymentIntentRepository;
	stellar: StellarPaymentGateway;
	networkPassphrase: string;
	usdcIssuer: string;
	now?: () => Date;
}>;

export class PaymentService {
	private readonly now: () => Date;

	constructor(private readonly dependencies: PaymentServiceDependencies) {
		this.now = dependencies.now ?? (() => new Date());
	}

	async createIntent(
		input: Readonly<{
			quoteId: string;
			principalId: string;
			idempotencyKey: string;
		}>,
	): Promise<CreatePaymentIntentResult> {
		const requestFingerprint = createHash("sha256")
			.update(JSON.stringify([input.principalId, input.quoteId]))
			.digest("hex");
		const existing = await this.persistence(() =>
			this.dependencies.intents.findByIdempotencyKey(
				input.principalId,
				input.idempotencyKey,
			),
		);
		if (existing) {
			return {
				intent: this.replayOrConflict(existing, requestFingerprint),
				replayed: true,
			};
		}

		const quoteDocument = await this.persistence(() =>
			this.dependencies.quotes.findQuoteById(input.quoteId),
		);
		if (quoteDocument === undefined) {
			throw new AppError(errorCodes.PAYMENT_QUOTE_NOT_FOUND);
		}
		let quote: ApprovedPaymentQuote;
		try {
			quote = approvedPaymentQuoteSchema.parse(quoteDocument);
		} catch {
			throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
		}
		if (quote.principalId !== input.principalId) {
			throw new AppError(errorCodes.PAYMENT_PRINCIPAL_NOT_AUTHORIZED);
		}
		if (quote.networkPassphrase !== this.dependencies.networkPassphrase) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
		if (
			quote.assetCode !== "USDC" ||
			quote.assetIssuer !== this.dependencies.usdcIssuer
		) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}

		const now = this.now();
		if (Date.parse(quote.expiresAt) <= now.getTime()) {
			throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
		}
		const totalAmountAtomic = sumPaymentLegs(quote.paymentLegs);
		await this.persistence(() =>
			this.dependencies.intents.expireUnsignedForPayer(
				quote.payerAddress,
				now.toISOString(),
			),
		);
		const intentId = randomUUID();
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
			intentId,
			quoteId: quote.quoteId,
			orderId: quote.orderId,
			quoteHash: quote.quoteHash,
			principalId: input.principalId,
			idempotencyKey: input.idempotencyKey,
			requestFingerprint,
			status: "awaiting_signature",
			networkPassphrase: quote.networkPassphrase,
			payerAddress: quote.payerAddress,
			assetCode: quote.assetCode,
			assetIssuer: quote.assetIssuer,
			assetDecimals: quote.assetDecimals,
			totalAmountAtomic,
			paymentLegs: quote.paymentLegs,
			unsignedXdr: built.unsignedXdr,
			...(quote.memo !== undefined ? { memo: quote.memo } : {}),
			transactionHash: built.transactionHash,
			ledger: null,
			expiresAt,
			createdAt: timestamp,
			updatedAt: timestamp,
		});

		try {
			await this.persistence(() => this.dependencies.intents.insert(intent));
			return { intent, replayed: false };
		} catch (error) {
			const racedIntent = await this.persistence(() =>
				this.dependencies.intents.findByIdempotencyKey(
					input.principalId,
					input.idempotencyKey,
				),
			);
			if (!racedIntent) {
				if (error instanceof PaymentIntentConflictError) {
					throw new AppError(errorCodes.RESOURCE_STATE_CONFLICT);
				}
				throw error;
			}
			return {
				intent: this.replayOrConflict(racedIntent, requestFingerprint),
				replayed: true,
			};
		}
	}

	async submitSignedTransaction(
		intentId: string,
		principalId: string,
		signedXdr: string,
	): Promise<PaymentIntent> {
		let intent = await this.getOwnedIntent(intentId, principalId);
		if (intent.status === "confirmed" || intent.status === "failed") {
			return intent;
		}
		if (intent.status === "expired") {
			throw new AppError(errorCodes.RESOURCE_STATE_CONFLICT);
		}
		const transactionHash = this.dependencies.stellar.verifySignedTransaction(
			signedXdr,
			intent,
		);
		if (intent.transactionHash !== transactionHash) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}

		if (intent.status === "awaiting_signature") {
			if (Date.parse(intent.expiresAt) <= this.now().getTime()) {
				const expired = paymentIntentSchema.parse({
					...intent,
					status: "expired",
					updatedAt: this.now().toISOString(),
				});
				await this.dependencies.intents.compareAndSet(
					expired,
					"awaiting_signature",
				);
				return this.getIntent(intentId, principalId);
			}
			const submitting = paymentIntentSchema.parse({
				...intent,
				status: "submitting",
				updatedAt: this.now().toISOString(),
			});
			const claimed = await this.persistence(() =>
				this.dependencies.intents.compareAndSet(
					submitting,
					"awaiting_signature",
				),
			);
			if (!claimed) {
				return this.getOwnedIntent(intentId, principalId);
			}
			intent = submitting;
			try {
				await this.dependencies.stellar.submitSignedTransaction(
					signedXdr,
					intent,
				);
			} catch {
				throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
			}
			return this.afterSubmission(intent);
		}

		if (intent.status === "submitting") {
			const current = await this.reconcile(intent);
			if (current.status !== "submitting") {
				return current;
			}
			const lookup = await this.dependencies.stellar.lookupTransaction(current);
			if (lookup.status === "pending") {
				return current;
			}
			if (lookup.status === "confirmed" || lookup.status === "failed") {
				return this.reconcile(current);
			}
			try {
				await this.dependencies.stellar.submitSignedTransaction(
					signedXdr,
					current,
				);
			} catch {
				throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
			}
			return this.afterSubmission(current);
		}

		return this.reconcile(intent);
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
			const updated = await this.persistence(() =>
				this.dependencies.intents.compareAndSet(expired, "awaiting_signature"),
			);
			intent = updated
				? expired
				: await this.getOwnedIntent(intentId, principalId);
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
		const result = await this.dependencies.stellar.lookupTransaction(intent);
		if (result.status === "pending" || result.status === "not_found") {
			return intent;
		}
		const nextStatus = result.status === "confirmed" ? "confirmed" : "failed";
		const reconciled = paymentIntentSchema.parse({
			...intent,
			status: nextStatus,
			ledger: result.status === "confirmed" ? result.ledger : null,
			updatedAt: this.now().toISOString(),
		});
		let updated: boolean;
		try {
			updated = await this.persistence(() =>
				this.dependencies.intents.compareAndSet(reconciled, intent.status),
			);
		} catch {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
		if (updated) {
			return reconciled;
		}
		try {
			return (
				(await this.persistence(() =>
					this.dependencies.intents.findIntentById(intent.intentId),
				)) ?? intent
			);
		} catch {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
	}

	private async afterSubmission(intent: PaymentIntent): Promise<PaymentIntent> {
		try {
			return await this.recordSubmitted(intent);
		} catch {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
	}

	private async recordSubmitted(intent: PaymentIntent): Promise<PaymentIntent> {
		const submitted = paymentIntentSchema.parse({
			...intent,
			status: "submitted",
			updatedAt: this.now().toISOString(),
		});
		await this.persistence(() =>
			this.dependencies.intents.compareAndSet(submitted, "submitting"),
		);
		return this.getIntent(intent.intentId, intent.principalId);
	}

	private async getOwnedIntent(
		intentId: string,
		principalId: string,
	): Promise<PaymentIntent> {
		const intent = await this.persistence(() =>
			this.dependencies.intents.findIntentById(intentId),
		);
		if (!intent) {
			throw new AppError(errorCodes.PAYMENT_INTENT_NOT_FOUND);
		}
		if (intent.principalId !== principalId) {
			throw new AppError(errorCodes.PAYMENT_PRINCIPAL_NOT_AUTHORIZED);
		}
		return intent;
	}

	private replayOrConflict(
		intent: PaymentIntent,
		requestFingerprint: string,
	): PaymentIntent {
		if (intent.requestFingerprint !== requestFingerprint) {
			throw new AppError(
				errorCodes.IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD,
			);
		}
		return intent;
	}

	private async persistence<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (
				error instanceof AppError ||
				error instanceof PaymentIntentConflictError
			) {
				throw error;
			}
			throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
		}
	}
}

export function isPaymentIntentTerminal(status: PaymentIntentStatus): boolean {
	return status === "confirmed" || status === "failed" || status === "expired";
}
