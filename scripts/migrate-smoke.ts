#!/usr/bin/env bun
/**
 * Applies every Supabase migration to a live PostgreSQL database and asserts the
 * resulting behaviour. Closes audit finding M2-1: migrations were only checked
 * for DDL shape, never executed against a real engine.
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun run scripts/migrate-smoke.ts
 *
 * Exits non-zero on any failure so CI fails loudly.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { Client } from "pg";

const migrationsDir = join(import.meta.dir, "..", "supabase", "migrations");
const EXPECTED_TABLES = [
	"sources",
	"products_raw",
	"products_ranked",
	"search_sessions",
	"search_results",
	"wallets",
	"purchase_intents",
	"purchase_records",
];

function fail(message: string): never {
	console.error(`✗ ${message}`);
	process.exit(1);
}

function ok(message: string): void {
	console.log(`✓ ${message}`);
}

async function main(): Promise<void> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		fail("DATABASE_URL is required");
	}

	const client = new Client({ connectionString });
	await client.connect();

	try {
		const files = (await readdir(migrationsDir))
			.filter((name) => name.endsWith(".sql"))
			.sort();
		if (files.length === 0) {
			fail("no migration files found");
		}
		for (const file of files) {
			const sql = await readFile(join(migrationsDir, file), "utf8");
			await client.query(sql);
			ok(`applied ${file}`);
		}

		for (const table of EXPECTED_TABLES) {
			const { rows } = await client.query<{ present: string | null }>(
				"select to_regclass($1)::text as present",
				[`public.${table}`],
			);
			if (rows[0]?.present == null) {
				fail(`table ${table} was not created`);
			}
		}
		ok(`all ${EXPECTED_TABLES.length} tables exist`);

		const trigger = await client.query<{ tgname: string }>(
			"select tgname from pg_trigger where tgname = 'trg_validate_purchase_intent_status'",
		);
		if (trigger.rowCount === 0) {
			fail("purchase intent status trigger is missing");
		}
		ok("purchase intent status trigger registered");

		const purge = await client.query<{ purge_expired_search_results: number }>(
			"select purge_expired_search_results() as purge_expired_search_results",
		);
		if (purge.rows[0]?.purge_expired_search_results !== 0) {
			fail("purge_expired_search_results() should return 0 on an empty table");
		}
		ok("purge_expired_search_results() callable");

		await assertTransitionGuards(client);
	} finally {
		await client.end();
	}
}

/**
 * Exercises the trigger against live rows: a skipped transition must raise, a
 * legal transition must succeed and a terminal state must be immutable.
 */
async function assertTransitionGuards(client: Client): Promise<void> {
	await client.query("begin");
	try {
		const wallet = await client.query<{ wallet_id: string }>(
			`insert into wallets (principal_id, address)
			 values ('smoke-principal', 'GSMOKEWALLETADDRESSTEST000000000000000000000000000000000000')
			 returning wallet_id`,
		);
		const walletId = wallet.rows[0]?.wallet_id;
		if (!walletId) fail("failed to seed wallet");

		const intent = await client.query<{ purchase_intent_id: string }>(
			`insert into purchase_intents
			   (wallet_id, principal_id, product_snapshot, amount, destination, currency, idempotency_key, status)
			 values ($1, 'smoke-principal', '{"productId":"p1"}'::jsonb, 12500,
			         'GDESTINATIONADDRESSTEST0000000000000000000000000000000000000',
			         'USD', 'smoke-idem-1', 'pending')
			 returning purchase_intent_id`,
			[walletId],
		);
		const intentId = intent.rows[0]?.purchase_intent_id;
		if (!intentId) fail("failed to seed purchase intent");

		let rejected = false;
		await client.query("savepoint bad_transition");
		try {
			await client.query(
				"update purchase_intents set status = 'paid' where purchase_intent_id = $1",
				[intentId],
			);
		} catch {
			rejected = true;
			await client.query("rollback to savepoint bad_transition");
		}
		if (!rejected) fail("pending -> paid transition was not rejected");
		ok("invalid transition pending -> paid rejected");

		await client.query(
			"update purchase_intents set status = 'approved' where purchase_intent_id = $1",
			[intentId],
		);
		ok("valid transition pending -> approved accepted");

		let terminalRejected = false;
		await client.query("savepoint terminal");
		try {
			await client.query(
				"update purchase_intents set status = 'cancelled' where purchase_intent_id = $1",
				[intentId],
			);
			await client.query(
				"update purchase_intents set status = 'approved' where purchase_intent_id = $1",
				[intentId],
			);
		} catch {
			terminalRejected = true;
			await client.query("rollback to savepoint terminal");
		}
		if (!terminalRejected) fail("cancelled terminal state was mutable");
		ok("terminal state cancelled is immutable");
	} finally {
		await client.query("rollback");
	}
}

await main();
