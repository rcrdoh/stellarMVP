import { randomUUID } from "node:crypto";
import {
	type ApprovedPaymentQuote,
	approvedPaymentQuoteSchema,
	type PaymentIntent,
	type PaymentIntentStatus,
	paymentIntentSchema,
} from "../domain/payments.js";
import type {
	PaymentIntentRepository,
	PaymentQuoteRepository,
} from "../services/payment-intent-service.js";
import type { PoolLike, PoolQuery } from "./postgres.js";

export const COMMERCE_PAYMENT_DDL = `
CREATE TABLE IF NOT EXISTS commerce_quotes (
  quote_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  quote_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  payer_address TEXT NOT NULL,
  network_passphrase TEXT NOT NULL,
  asset_code TEXT NOT NULL,
  asset_issuer TEXT NOT NULL,
  asset_decimals INTEGER NOT NULL,
  payment_leg JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commerce_orders (
  order_id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES commerce_quotes(quote_id),
  principal_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stellar_transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_intents (
  intent_id UUID PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES commerce_quotes(quote_id),
  order_id TEXT NOT NULL REFERENCES commerce_orders(order_id),
  principal_id TEXT NOT NULL,
  quote_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  network_passphrase TEXT NOT NULL,
  payer_address TEXT NOT NULL,
  asset_code TEXT NOT NULL,
  asset_issuer TEXT NOT NULL,
  asset_decimals INTEGER NOT NULL,
  total_amount_atomic NUMERIC(20,0) NOT NULL,
  payment_leg JSONB NOT NULL,
  unsigned_xdr TEXT NOT NULL,
  transaction_hash TEXT,
  ledger BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (principal_id, idempotency_key),
  UNIQUE (transaction_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_payer
  ON payment_intents (payer_address)
  WHERE status IN ('awaiting_signature', 'submitting', 'submitted');
CREATE TABLE IF NOT EXISTS payment_attempts (
  attempt_id UUID PRIMARY KEY,
  intent_id UUID NOT NULL REFERENCES payment_intents(intent_id),
  outcome TEXT NOT NULL,
  provider_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

type QuoteInput = ApprovedPaymentQuote & { approvedAt: string };

export interface PaymentQuoteWriter {
	saveApprovedQuote(quote: QuoteInput): Promise<void>;
}

export class PostgresPaymentRepository
	implements PaymentQuoteRepository, PaymentIntentRepository, PaymentQuoteWriter
{
	constructor(private readonly pool: PoolLike) {}

	async migrate(): Promise<void> {
		await this.pool.query(COMMERCE_PAYMENT_DDL);
	}

	async isReady(): Promise<boolean> {
		try {
			await this.pool.query("SELECT 1");
			return true;
		} catch {
			return false;
		}
	}

	async saveApprovedQuote(quote: QuoteInput): Promise<void> {
		const { approvedAt, ...quoteData } = quote;
		const validated = approvedPaymentQuoteSchema.parse(quoteData);
		await this.pool.query(
			`INSERT INTO commerce_quotes
			 (quote_id, order_id, session_id, principal_id, quote_hash, status,
			  payer_address, network_passphrase, asset_code, asset_issuer,
			  asset_decimals, payment_leg, expires_at, approved_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
			 ON CONFLICT (quote_id) DO NOTHING`,
			[
				validated.quoteId,
				validated.orderId,
				validated.sessionId,
				validated.principalId,
				validated.quoteHash,
				validated.status,
				validated.payerAddress,
				validated.networkPassphrase,
				validated.assetCode,
				validated.assetIssuer,
				validated.assetDecimals,
				JSON.stringify(validated.paymentLeg),
				validated.expiresAt,
				approvedAt,
			],
		);
		await this.pool.query(
			`INSERT INTO commerce_orders (order_id, quote_id, principal_id, status)
			 VALUES ($1,$2,$3,'pending_payment')
			 ON CONFLICT (quote_id) DO NOTHING`,
			[validated.orderId, validated.quoteId, validated.principalId],
		);
	}

	async findApprovedQuote(
		quoteId: string,
	): Promise<ApprovedPaymentQuote | null> {
		const result = await this.pool.query(
			`SELECT quote_id, order_id, session_id, principal_id, quote_hash,
			 status, payer_address, network_passphrase, asset_code, asset_issuer,
			 asset_decimals, payment_leg, expires_at
			 FROM commerce_quotes WHERE quote_id = $1 AND status = 'approved'`,
			[quoteId],
		);
		const row = result.rows[0];
		if (!row) return null;
		return approvedPaymentQuoteSchema.parse({
			quoteId: row.quote_id,
			orderId: row.order_id,
			sessionId: row.session_id,
			principalId: row.principal_id,
			quoteHash: row.quote_hash,
			status: row.status,
			networkPassphrase: row.network_passphrase,
			payerAddress: row.payer_address,
			assetCode: row.asset_code,
			assetIssuer: row.asset_issuer,
			assetDecimals: Number(row.asset_decimals),
			paymentLeg: parseJson(row.payment_leg),
			expiresAt: toIso(row.expires_at),
		});
	}

	async findByIdempotencyKey(
		principalId: string,
		idempotencyKey: string,
	): Promise<PaymentIntent | null> {
		const result = await this.pool.query(
			"SELECT * FROM payment_intents WHERE principal_id = $1 AND idempotency_key = $2",
			[principalId, idempotencyKey],
		);
		return result.rows[0] ? paymentIntentFromRow(result.rows[0]) : null;
	}

	async findIntentById(intentId: string): Promise<PaymentIntent | null> {
		const result = await this.pool.query(
			"SELECT * FROM payment_intents WHERE intent_id = $1",
			[intentId],
		);
		return result.rows[0] ? paymentIntentFromRow(result.rows[0]) : null;
	}

	async insertIntent(intent: PaymentIntent): Promise<void> {
		await this.pool.query(
			`INSERT INTO payment_intents
			 (intent_id, quote_id, order_id, principal_id, quote_hash,
			  idempotency_key, request_fingerprint, status, network_passphrase,
			  payer_address, asset_code, asset_issuer, asset_decimals,
			  total_amount_atomic, payment_leg, unsigned_xdr, transaction_hash,
			  ledger, expires_at, created_at, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21)`,
			[
				intent.intentId,
				intent.quoteId,
				intent.orderId,
				intent.principalId,
				intent.quoteHash,
				intent.idempotencyKey,
				intent.requestFingerprint,
				intent.status,
				intent.networkPassphrase,
				intent.payerAddress,
				intent.assetCode,
				intent.assetIssuer,
				intent.assetDecimals,
				intent.totalAmountAtomic,
				JSON.stringify(intent.paymentLeg),
				intent.unsignedXdr,
				intent.transactionHash,
				intent.ledger,
				intent.expiresAt,
				intent.createdAt,
				intent.updatedAt,
			],
		);
	}

	async expireUnsignedForPayer(
		payerAddress: string,
		asOf: string,
	): Promise<void> {
		await this.pool.query(
			`UPDATE payment_intents SET status = 'expired', updated_at = $2
			 WHERE payer_address = $1 AND status = 'awaiting_signature' AND expires_at <= $2`,
			[payerAddress, asOf],
		);
	}

	async compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean> {
		const result = await this.pool.query(
			`UPDATE payment_intents SET status = $2, ledger = $3,
			 transaction_hash = $4, updated_at = $5
			 WHERE intent_id = $1 AND status = $6
			 RETURNING intent_id`,
			[
				intent.intentId,
				intent.status,
				intent.ledger,
				intent.transactionHash,
				intent.updatedAt,
				expectedStatus,
			],
		);
		return result.rows.length > 0;
	}

	async settleConfirmed(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean> {
		return this.withTransaction(async (query) => {
			const intentResult = await query(
				`UPDATE payment_intents SET status = $2, ledger = $3,
				 transaction_hash = $4, updated_at = $5
				 WHERE intent_id = $1 AND status = $6
				 RETURNING intent_id`,
				[
					intent.intentId,
					intent.status,
					intent.ledger,
					intent.transactionHash,
					intent.updatedAt,
					expectedStatus,
				],
			);
			if (intentResult.rows.length === 0) return false;
			const orderResult = await query(
				`UPDATE commerce_orders SET status = 'paid', stellar_transaction_hash = $2,
				 paid_at = COALESCE(paid_at, now()), updated_at = now()
				 WHERE order_id = $1 AND (
				   status = 'pending_payment' OR
				   (status = 'paid' AND stellar_transaction_hash = $2)
				 )
				 RETURNING order_id`,
				[intent.orderId, intent.transactionHash],
			);
			if (orderResult.rows.length === 0) {
				throw new Error("Payment order could not be settled atomically");
			}
			await query(
				`INSERT INTO payment_attempts
				 (attempt_id, intent_id, outcome, provider_reference)
				 VALUES ($1,$2,'confirmed',$3)`,
				[randomUUID(), intent.intentId, intent.transactionHash],
			);
			return true;
		});
	}

	async settleFailed(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	): Promise<boolean> {
		return this.withTransaction(async (query) => {
			const intentResult = await query(
				`UPDATE payment_intents SET status = 'failed', ledger = NULL,
				 updated_at = $2 WHERE intent_id = $1 AND status = $3
				 RETURNING intent_id`,
				[intent.intentId, intent.updatedAt, expectedStatus],
			);
			if (intentResult.rows.length === 0) return false;
			const orderResult = await query(
				`UPDATE commerce_orders SET status = 'payment_failed', updated_at = now()
				 WHERE order_id = $1 AND (status = 'pending_payment' OR status = 'payment_failed')
				 RETURNING order_id`,
				[intent.orderId],
			);
			if (orderResult.rows.length === 0) {
				throw new Error("Payment order could not be failed atomically");
			}
			await query(
				`INSERT INTO payment_attempts
				 (attempt_id, intent_id, outcome)
				 VALUES ($1,$2,'failed')`,
				[randomUUID(), intent.intentId],
			);
			return true;
		});
	}

	private async withTransaction<T>(
		work: (query: PoolQuery) => Promise<T>,
	): Promise<T> {
		if (this.pool.connect === undefined) return work(this.pool.query);
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const result = await work(client.query);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw error;
		} finally {
			client.release();
		}
	}
}

function parseJson(value: unknown): unknown {
	return typeof value === "string" ? JSON.parse(value) : value;
}

function toIso(value: unknown): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

function paymentIntentFromRow(row: Record<string, unknown>): PaymentIntent {
	return paymentIntentSchema.parse({
		intentId: String(row.intent_id),
		quoteId: row.quote_id,
		orderId: row.order_id,
		principalId: row.principal_id,
		quoteHash: row.quote_hash,
		idempotencyKey: row.idempotency_key,
		requestFingerprint: row.request_fingerprint,
		status: row.status,
		networkPassphrase: row.network_passphrase,
		payerAddress: row.payer_address,
		assetCode: row.asset_code,
		assetIssuer: row.asset_issuer,
		assetDecimals: Number(row.asset_decimals),
		totalAmountAtomic: String(row.total_amount_atomic),
		paymentLeg: parseJson(row.payment_leg),
		unsignedXdr: row.unsigned_xdr,
		transactionHash: row.transaction_hash,
		ledger: row.ledger === null ? null : Number(row.ledger),
		expiresAt: toIso(row.expires_at),
		createdAt: toIso(row.created_at),
		updatedAt: toIso(row.updated_at),
	});
}
