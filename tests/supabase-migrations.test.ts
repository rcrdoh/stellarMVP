import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { envSchema } from "../src/config/env.js";
import {
	closeAgentCheckpointer,
	getAgentCheckpointer,
} from "../src/integrations/agent-runtime.js";
import { createPostgresAgentCheckpointer } from "../src/integrations/agents/postgres-checkpointer.js";

const migrationsDir = join(import.meta.dir, "..", "supabase", "migrations");
const baseEnv = envSchema.parse({});

function readMigrations(): string {
	return readdirSync(migrationsDir)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(join(migrationsDir, name), "utf8"))
		.join("\n");
}

describe("supabase migrations", () => {
	const sql = readMigrations();

	test("declares every core table", () => {
		const tables = [
			"products_raw",
			"products_ranked",
			"search_sessions",
			"search_results",
			"wallets",
			"purchase_intents",
			"purchase_records",
			"sources",
		];
		for (const table of tables) {
			expect(sql).toContain(`create table if not exists ${table}`);
		}
	});

	test("purchase_intents locks the deterministic handoff fields", () => {
		expect(sql).toContain("purchase_intents_lock_handoff");
		expect(sql).toContain(
			"new.product_snapshot is distinct from old.product_snapshot",
		);
		expect(sql).toContain("new.amount is distinct from old.amount");
		expect(sql).toContain("new.destination is distinct from old.destination");
	});

	test("search_results carries a TTL column and expiry index", () => {
		expect(sql).toContain("ttl_seconds integer not null default 900");
		expect(sql).toContain("expires_at timestamptz not null");
		expect(sql).toContain("search_results_expires_at_idx");
	});

	test("separates discovery and payment agent access scopes", () => {
		expect(sql).toContain("create role discovery_agent nologin");
		expect(sql).toContain("create role payment_agent nologin");
		expect(sql).toContain(
			"grant select, insert, update on search_sessions, search_results to discovery_agent",
		);
		expect(sql).toContain(
			"revoke all on wallets, purchase_records from discovery_agent",
		);
		expect(sql).toContain(
			"grant select, insert on purchase_records to payment_agent",
		);
		expect(sql).toContain(
			"revoke all on sources, products_raw, products_ranked, search_sessions, search_results",
		);
		expect(sql).toContain("payment_read_pending_intents");
		expect(sql).toContain("status = 'pending'");
	});

	test("enables row level security on every table", () => {
		const normalized = sql.replace(/\s+/g, " ");
		for (const table of [
			"sources",
			"products_raw",
			"products_ranked",
			"search_sessions",
			"search_results",
			"wallets",
			"purchase_intents",
			"purchase_records",
		]) {
			expect(normalized).toContain(
				`alter table ${table} enable row level security;`,
			);
		}
	});

	test("guards purchase intent status transitions (M2-4)", () => {
		expect(sql).toContain("validate_purchase_intent_status_transition");
		expect(sql).toContain("trg_validate_purchase_intent_status");
		expect(sql).toContain("before update of status on purchase_intents");
		expect(sql).toContain("Invalid status transition from pending to %");
		expect(sql).toContain(
			"Invalid status transition from payment_submitted to %",
		);
		expect(sql).toContain("Terminal state % cannot be modified");
	});

	test("exposes a TTL purge procedure for expired search results (M2-3)", () => {
		expect(sql).toContain(
			"create or replace function purge_expired_search_results()",
		);
		expect(sql).toContain("expires_at < now()");
		expect(sql).toContain("get diagnostics deleted_count = row_count");
	});
});

describe("postgres agent checkpointer", () => {
	test("rejects an empty connection string before opening a pool", async () => {
		await expect(
			createPostgresAgentCheckpointer({ connectionString: "   " }),
		).rejects.toThrow("connectionString is required");
	});

	test("rejects an empty connection string without calling the pool factory (no socket)", async () => {
		let factoryCalls = 0;
		await expect(
			createPostgresAgentCheckpointer({
				connectionString: "",
				createPool: () => {
					factoryCalls += 1;
					throw new Error("pool factory must not run for an empty URL");
				},
			}),
		).rejects.toThrow("connectionString is required");
		expect(factoryCalls).toBe(0);
	});

	test("closes the pool when setup fails after a valid connection string", async () => {
		let closeCalls = 0;
		await expect(
			createPostgresAgentCheckpointer({
				connectionString: "postgres://user:pass@127.0.0.1:1/db",
				createPool: () => ({
					query: async () => {
						throw new Error("unreachable");
					},
					end: async () => {
						closeCalls += 1;
					},
				}),
			}),
		).rejects.toBeInstanceOf(Error);
		expect(closeCalls).toBe(1);
	});

	test("lazy factory resolves to undefined without a database URL (M2-2)", async () => {
		await closeAgentCheckpointer();
		const result = await getAgentCheckpointer({
			...baseEnv,
			SUPABASE_DB_URL: "",
			DATABASE_URL: "",
		});
		expect(result).toBeUndefined();
	});

	test("closing without an open checkpointer is a no-op (M2-2)", async () => {
		await closeAgentCheckpointer();
		await expect(closeAgentCheckpointer()).resolves.toBeUndefined();
	});
});
