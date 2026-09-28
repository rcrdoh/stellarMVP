import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

export type PostgresAgentCheckpointer = {
	checkpointer: BaseCheckpointSaver;
	close(): Promise<void>;
};

/**
 * Minimal pool surface the checkpointer depends on. Declared as an interface so
 * composition can inject a test double without monkey-patching `pg`; production
 * wiring passes a `pg.Pool`.
 */
export interface PoolLike {
	query(...args: unknown[]): Promise<unknown>;
	end(): Promise<void>;
}

export type PostgresAgentCheckpointerOptions = {
	connectionString: string;
	schema?: string;
	/**
	 * Pool factory seam. Defaults to `pg.Pool`; injected only by tests to prove
	 * that an empty connection string fails before any socket is opened.
	 */
	createPool?: (connectionString: string) => PoolLike;
};

/**
 * Production pool factory. Kept behind a function so the checkpointer can be
 * exercised without touching a live database.
 */
function defaultPoolFactory(connectionString: string): PoolLike {
	return new Pool({ connectionString });
}

/**
 * Durable LangGraph checkpointer backed by PostgreSQL (Supabase).
 *
 * Replaces volatile in-memory state so an agent conversation survives process
 * and container restarts (audit finding H3). `setup()` is idempotent and runs
 * the checkpoint migrations on first use; it must be awaited before the graph
 * is invoked.
 *
 * Validates `connectionString` *before* the pool factory runs, so a misconfigured
 * deployment fails fast instead of leaking a pending network socket.
 */
export async function createPostgresAgentCheckpointer(
	options: PostgresAgentCheckpointerOptions,
): Promise<PostgresAgentCheckpointer> {
	if (options.connectionString.trim().length === 0) {
		throw new Error("connectionString is required");
	}
	const pool = (options.createPool ?? defaultPoolFactory)(
		options.connectionString,
	);
	try {
		const checkpointer = new PostgresSaver(
			pool as unknown as Pool,
			undefined,
			options.schema === undefined ? undefined : { schema: options.schema },
		);
		await checkpointer.setup();
		return { checkpointer, close: () => pool.end() };
	} catch (error) {
		await pool.end().catch(() => undefined);
		throw error;
	}
}
