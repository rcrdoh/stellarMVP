import type { Collection, Db, Document } from "mongodb";
import {
	type PaymentIntent,
	type PaymentIntentStatus,
	paymentIntentSchema,
} from "../../domain/payments.js";
import type {
	PaymentIntentRepository,
	PaymentQuoteReader,
} from "../../services/payment-service.js";
import { PaymentIntentConflictError } from "../../services/payment-service.js";

export class MongoPaymentStore
	implements PaymentQuoteReader, PaymentIntentRepository
{
	private readonly quotes: Collection<Document>;
	private readonly intents: Collection<Document & { _id: string }>;

	constructor(private readonly database: Db) {
		this.quotes = database.collection<Document>("approved_quotes");
		this.intents = database.collection<Document & { _id: string }>(
			"payment_intents",
		);
	}

	async ensureIndexes(): Promise<void> {
		await Promise.all([
			this.quotes.createIndex({ quoteId: 1 }, { unique: true }),
			this.intents.createIndex(
				{ principalId: 1, idempotencyKey: 1 },
				{ unique: true, name: "principal_idempotency_key_unique" },
			),
			this.intents.createIndex(
				{ networkPassphrase: 1, transactionHash: 1 },
				{
					unique: true,
					name: "network_transaction_hash_unique",
					partialFilterExpression: {
						transactionHash: { $type: "string" },
					},
				},
			),
			this.intents.createIndex(
				{ payerAddress: 1 },
				{
					unique: true,
					name: "one_active_payment_per_payer",
					partialFilterExpression: {
						status: {
							$in: ["awaiting_signature", "submitting", "submitted"],
						},
					},
				},
			),
		]);
	}

	async isReady(): Promise<boolean> {
		try {
			await this.database.command({ ping: 1 });
			return true;
		} catch {
			return false;
		}
	}

	async findQuoteById(quoteId: string): Promise<unknown | undefined> {
		const document = await this.quotes.findOne(
			{ quoteId, status: "approved" },
			{
				projection: {
					_id: 0,
					quoteId: 1,
					orderId: 1,
					quoteHash: 1,
					principalId: 1,
					status: 1,
					networkPassphrase: 1,
					payerAddress: 1,
					assetCode: 1,
					assetIssuer: 1,
					assetDecimals: 1,
					paymentLegs: 1,
					expiresAt: 1,
					memo: 1,
				},
			},
		);
		if (!document) {
			return undefined;
		}
		return document;
	}

	async findByIdempotencyKey(
		principalId: string,
		idempotencyKey: string,
	): Promise<PaymentIntent | undefined> {
		const document = await this.intents.findOne({
			principalId,
			idempotencyKey,
		});
		return document ? paymentIntentFromDocument(document) : undefined;
	}

	async findIntentById(intentId: string): Promise<PaymentIntent | undefined> {
		const document = await this.intents.findOne({ _id: intentId });
		return document ? paymentIntentFromDocument(document) : undefined;
	}

	async insert(intent: PaymentIntent): Promise<void> {
		try {
			await this.intents.insertOne(intentToDocument(intent));
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new PaymentIntentConflictError();
			}
			throw error;
		}
	}

	async expireUnsignedForPayer(
		payerAddress: string,
		asOf: string,
	): Promise<void> {
		await this.intents.updateMany(
			{
				payerAddress,
				status: "awaiting_signature",
				expiresAt: { $lte: asOf },
			},
			{
				$set: { status: "expired", updatedAt: asOf },
			},
		);
	}

	async compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean> {
		const { _id: _ignored, ...fields } = intentToDocument(intent);
		const result = await this.intents.updateOne(
			{ _id: intent.intentId, status: expectedStatus },
			{ $set: fields },
		);
		return result.modifiedCount === 1;
	}
}

function intentToDocument(intent: PaymentIntent): Document & { _id: string } {
	const { intentId, ...fields } = intent;
	return { _id: intentId, ...fields };
}

function paymentIntentFromDocument(document: Document): PaymentIntent {
	const { _id, ...fields } = document;
	return paymentIntentSchema.parse({ ...fields, intentId: String(_id) });
}

function isDuplicateKeyError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === 11000
	);
}
