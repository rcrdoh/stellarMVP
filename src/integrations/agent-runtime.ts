import { MemorySaver } from "@langchain/langgraph";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Horizon, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Env } from "../config/env.js";
import type { AgentIntegrations } from "../http/server.js";
import { DiscoveryAgentService } from "../services/agents/discovery-agent.js";
import { AgentShoppingConversationService } from "../services/agents/shopping-conversation.js";
import { CatalogMerchantSearchAgent } from "./agents/catalog-merchant-search-agent.js";
import { CatalogShoppingQuoteProvider } from "./agents/catalog-quote-provider.js";
import { createShoppingAgent } from "./agents/create-shopping-agent.js";
import {
	createPostgresAgentCheckpointer,
	type PostgresAgentCheckpointer,
} from "./agents/postgres-checkpointer.js";
import { VectorMerchantCatalog } from "./agents/vector-merchant-catalog.js";
import { OpenAIAdapter } from "./openai.js";
import { createPostgresPool, PostgresOrdersRepository } from "./postgres.js";
import { QdrantAdapter, type VectorSearchClient } from "./qdrant.js";
import { getRedisClient } from "./redis.js";
import {
	type StellarPaymentRequest,
	StellarPaymentService,
	type StellarServer,
} from "./stellar.js";

export type AgentRuntime = Readonly<{
	integrations: AgentIntegrations;
	/**
	 * Lazily creates (and caches) the durable LangGraph checkpointer the first
	 * time an agent actually needs persistent conversation state. Returns
	 * `undefined` when no database URL is configured, so the caller can fall
	 * back to volatile in-memory state instead of failing startup.
	 */
	getCheckpointer: () => Promise<AgentIntegrations["checkpointer"]>;
	/**
	 * Composed shopping-agent use case. Like the checkpointer, it is resolved on
	 * first use so startup pays for no provider until a conversation is opened.
	 */
	getShoppingConversation: () => Promise<AgentShoppingConversationService>;
	close: () => Promise<void>;
}>;

/**
 * Cached checkpointer handle. Module-scoped so repeated calls within a process
 * reuse a single pool; `close()` resets it. Kept out of the eager runtime path
 * so server startup pays no database connection cost (finding M2-2).
 */
let cachedCheckpointer: PostgresAgentCheckpointer | null = null;

/**
 * Resolves the durable checkpointer on demand, preferring the dedicated
 * Supabase connection string and falling back to the shared database URL.
 * Concurrency-safe enough for a single-threaded runtime: concurrent first calls
 * may both construct a pool, but the last assignment wins and the runtime is
 * the only caller.
 */
export async function getAgentCheckpointer(
	runtimeEnv: Env,
): Promise<AgentIntegrations["checkpointer"]> {
	if (cachedCheckpointer !== null) {
		return cachedCheckpointer.checkpointer;
	}
	const connectionString =
		runtimeEnv.SUPABASE_DB_URL.length > 0
			? runtimeEnv.SUPABASE_DB_URL
			: runtimeEnv.DATABASE_URL;
	if (connectionString.trim().length === 0) {
		return undefined;
	}
	cachedCheckpointer = await createPostgresAgentCheckpointer({
		connectionString,
	});
	return cachedCheckpointer.checkpointer;
}

/** Closes the cached checkpointer pool, if one was opened, and clears the cache. */
export async function closeAgentCheckpointer(): Promise<void> {
	const current = cachedCheckpointer;
	cachedCheckpointer = null;
	if (current !== null) {
		await current.close().catch(() => undefined);
	}
}

/**
 * Cached shopping conversation, module-scoped for the same reason as the
 * checkpointer: one composed agent per process, reset by `close()`.
 */
let cachedShoppingConversation: AgentShoppingConversationService | null = null;

/**
 * Cached Discovery Agent. Module-scoped like the other lazily composed pieces;
 * the default constructor builds the LLM client on first message.
 */
let cachedDiscoveryAgent: DiscoveryAgentService | null = null;

/** Returns the process-wide Discovery Agent, constructing it on first use. */
export function getDiscoveryAgent(): DiscoveryAgentService {
	if (cachedDiscoveryAgent === null) {
		cachedDiscoveryAgent = new DiscoveryAgentService();
	}
	return cachedDiscoveryAgent;
}

/**
 * Composes the shopping agent from its real adapters: the vector-backed
 * merchant catalog, the catalog search/quote adapters, the JE\/V decision
 * provider and the Groq model. Uses the durable checkpointer when configured
 * and a volatile `MemorySaver` otherwise, so the graph still runs in local/dev
 * without a database.
 */
export async function getShoppingConversation(
	runtimeEnv: Env,
	dependencies: {
		embeddings: OpenAIAdapter;
		vectors: VectorSearchClient;
	},
): Promise<AgentShoppingConversationService> {
	if (cachedShoppingConversation !== null) {
		return cachedShoppingConversation;
	}
	const checkpointer =
		(await getAgentCheckpointer(runtimeEnv)) ?? new MemorySaver();
	const catalog = new VectorMerchantCatalog(
		dependencies.embeddings,
		dependencies.vectors,
		{ collection: runtimeEnv.QDRANT_COLLECTION },
	);
	const agent = createShoppingAgent({
		env: runtimeEnv,
		checkpointer,
		merchantSearchAgent: new CatalogMerchantSearchAgent(catalog),
		quoteProvider: new CatalogShoppingQuoteProvider(catalog),
	});
	cachedShoppingConversation = new AgentShoppingConversationService(agent);
	return cachedShoppingConversation;
}

function createQdrantClient(runtimeEnv: Env): VectorSearchClient {
	const client = new QdrantClient({
		url: runtimeEnv.QDRANT_URL,
		...(runtimeEnv.QDRANT_API_KEY.length === 0
			? {}
			: { apiKey: runtimeEnv.QDRANT_API_KEY }),
	});
	return new QdrantAdapter({
		search: async (request) => {
			const response = await client.query(request.collection, {
				query: request.vector,
				limit: request.limit,
				with_payload: true,
				...(request.filters === undefined
					? {}
					: {
							filter: {
								must: Object.entries(request.filters).map(([key, value]) => ({
									key,
									match: { value },
								})),
							},
						}),
			});
			return response.points.map((hit) => ({
				id: String(hit.id),
				score: hit.score,
				payload: (hit.payload ?? {}) as Record<string, unknown>,
			}));
		},
	});
}

/**
 * Builds the concrete agentic-commerce adapters from environment
 * configuration. Kept separate from `index.ts` so the composition root stays
 * declarative and adapters remain testable in isolation.
 *
 * When `AGENT_COMMERCE_ENABLED` is unset the caller skips this factory and the
 * `/v1/agent/*` routes stay unregistered, so no outbound provider is required.
 */
export async function createAgentRuntime(
	runtimeEnv: Env,
): Promise<AgentRuntime> {
	if (runtimeEnv.DATABASE_URL.length === 0) {
		throw new Error("DATABASE_URL is required");
	}
	if (runtimeEnv.REDIS_URL.length === 0) {
		throw new Error("REDIS_URL is required");
	}
	const pool = createPostgresPool(runtimeEnv.DATABASE_URL);
	const orders = new PostgresOrdersRepository(pool);
	await orders.migrate();

	const redis = getRedisClient(runtimeEnv.REDIS_URL);

	const horizon = new Horizon.Server(runtimeEnv.STELLAR_HORIZON_URL);
	const networkPassphrase =
		runtimeEnv.STELLAR_NETWORK === "public"
			? Networks.PUBLIC
			: Networks.TESTNET;
	const stellar = new StellarPaymentService(
		horizon as unknown as StellarServer,
		async (_server, request: StellarPaymentRequest) =>
			horizon.submitTransaction(
				TransactionBuilder.fromXDR(request.paymentToken, networkPassphrase),
			),
	);

	const openai = new OpenAIAdapter(
		{ invoke: async () => ({ content: "" }) },
		new OpenAIEmbeddings({
			apiKey: runtimeEnv.OPENAI_API_KEY,
			model: runtimeEnv.OPENAI_EMBEDDINGS_MODEL,
		}),
	);
	const vectors = createQdrantClient(runtimeEnv);

	return {
		integrations: {
			redis,
			orders,
			stellar,
			embeddings: openai,
			vectors,
			vectorCollection: runtimeEnv.QDRANT_COLLECTION,
			discoveryAgent: () => getDiscoveryAgent(),
		},
		getCheckpointer: () => getAgentCheckpointer(runtimeEnv),
		getShoppingConversation: () =>
			getShoppingConversation(runtimeEnv, { embeddings: openai, vectors }),
		close: async () => {
			cachedShoppingConversation = null;
			cachedDiscoveryAgent = null;
			await closeAgentCheckpointer();
			await pool.end();
			await redis.quit().catch(() => undefined);
		},
	};
}
