import { Pool } from "pg";

export type PoolQuery = (
	text: string,
	values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

export type PoolClientLike = Readonly<{
	query: PoolQuery;
	release(): void;
}>;

export type PoolLike = {
	query: PoolQuery;
	connect?: () => Promise<PoolClientLike>;
	end: () => Promise<void>;
};

export type OrderStatus = "pending_payment" | "paid" | "failed" | "fulfilled";

export type OrderRecord = Readonly<{
	id: string;
	item_id: string;
	agent_token_hash: string;
	amount: string;
	currency: string;
	status: OrderStatus;
	stellar_transaction_hash: string | null;
	idempotency_key: string | null;
	created_at: string;
	updated_at: string;
}>;

export interface OrdersRepository {
	createOrder(input: {
		id: string;
		itemId: string;
		agentTokenHash: string;
		amount: string;
		currency: string;
		status: OrderStatus;
		stellarTransactionHash: string | null;
		idempotencyKey: string | null;
	}): Promise<OrderRecord>;
	markStatus(
		id: string,
		status: OrderStatus,
		stellarTransactionHash?: string | null,
	): Promise<void>;
	findById(id: string): Promise<OrderRecord | null>;
}

export const ORDERS_DDL = `
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  agent_token_hash TEXT NOT NULL,
  amount NUMERIC(20, 7) NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  stellar_transaction_hash TEXT,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export function createPostgresPool(
	connectionString = process.env.DATABASE_URL,
): PoolLike {
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}
	return new Pool({ connectionString });
}

export class PostgresOrdersRepository implements OrdersRepository {
	constructor(private readonly pool: PoolLike) {}

	async migrate(): Promise<void> {
		await this.pool.query(ORDERS_DDL);
	}

	async createOrder(input: {
		id: string;
		itemId: string;
		agentTokenHash: string;
		amount: string;
		currency: string;
		status: OrderStatus;
		stellarTransactionHash: string | null;
		idempotencyKey: string | null;
	}): Promise<OrderRecord> {
		const result = await this.pool.query(
			`INSERT INTO orders (id, item_id, agent_token_hash, amount, currency, status, stellar_transaction_hash, idempotency_key)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			 RETURNING *`,
			[
				input.id,
				input.itemId,
				input.agentTokenHash,
				input.amount,
				input.currency,
				input.status,
				input.stellarTransactionHash,
				input.idempotencyKey,
			],
		);
		const row = result.rows[0];
		if (!row) throw new Error("Order insert returned no row");
		return row as unknown as OrderRecord;
	}

	async markStatus(
		id: string,
		status: OrderStatus,
		stellarTransactionHash?: string | null,
	): Promise<void> {
		await this.pool.query(
			`UPDATE orders
			 SET status = $2,
			     stellar_transaction_hash = COALESCE($3, stellar_transaction_hash),
			     updated_at = now()
			 WHERE id = $1`,
			[id, status, stellarTransactionHash ?? null],
		);
	}

	async findById(id: string): Promise<OrderRecord | null> {
		const result = await this.pool.query("SELECT * FROM orders WHERE id = $1", [
			id,
		]);
		const row = result.rows[0];
		return row ? (row as unknown as OrderRecord) : null;
	}
}
