import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Horizon, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Env } from "../config/env.js";
import type { AgentIntegrations } from "../http/server.js";
import {
	CatalogIngestionJobService,
	CatalogIngestionService,
} from "../services/catalog-ingestion.js";
import { BazaarCatalogClient } from "./bazaar-catalog.js";
import { OpenAIAdapter } from "./openai.js";
import { createPostgresPool, PostgresOrdersRepository } from "./postgres.js";
import {
	QdrantAdapter,
	QdrantIndexAdapter,
	type VectorIndexClient,
	type VectorSearchClient,
} from "./qdrant.js";
import { getRedisClient } from "./redis.js";
import {
	type StellarPaymentRequest,
	StellarPaymentService,
	type StellarServer,
} from "./stellar.js";
import { UcpCatalogClient } from "./ucp-catalog.js";

export type AgentRuntime = Readonly<{
	integrations: AgentIntegrations;
	close: () => Promise<void>;
}>;

function createQdrantClients(runtimeEnv: Env): {
	search: VectorSearchClient;
	index: VectorIndexClient;
} {
	const client = new QdrantClient({
		url: runtimeEnv.QDRANT_URL,
		...(runtimeEnv.QDRANT_API_KEY.length === 0
			? {}
			: { apiKey: runtimeEnv.QDRANT_API_KEY }),
	});
	return {
		search: new QdrantAdapter({
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
		}),
		index: new QdrantIndexAdapter(client),
	};
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

	const catalog =
		runtimeEnv.CATALOG_ADAPTER === "ucp"
			? new UcpCatalogClient({
					merchantUrl: runtimeEnv.CATALOG_MERCHANT_URL,
					merchantId: runtimeEnv.CATALOG_MERCHANT_ID,
					agentProfileUrl: runtimeEnv.UCP_AGENT_PROFILE_URL,
					timeoutMs: runtimeEnv.CATALOG_REQUEST_TIMEOUT_MS,
					maxProducts: runtimeEnv.CATALOG_MAX_PRODUCTS,
				})
			: new BazaarCatalogClient({
					merchantUrl: runtimeEnv.CATALOG_MERCHANT_URL,
					merchantId: runtimeEnv.CATALOG_MERCHANT_ID,
					...(runtimeEnv.CATALOG_SOURCE_URL.length === 0
						? {}
						: { catalogUrl: runtimeEnv.CATALOG_SOURCE_URL }),
					timeoutMs: runtimeEnv.CATALOG_REQUEST_TIMEOUT_MS,
					maxProducts: runtimeEnv.CATALOG_MAX_PRODUCTS,
				});
	const embeddings =
		runtimeEnv.EMBEDDINGS_API_KEY.length > 0
			? new OpenAIAdapter(
					{ invoke: async () => ({ content: "" }) },
					new OpenAIEmbeddings({
						apiKey: runtimeEnv.EMBEDDINGS_API_KEY,
						model: runtimeEnv.EMBEDDINGS_MODEL,
						...(runtimeEnv.EMBEDDINGS_API_BASE_URL.length === 0
							? {}
							: {
									configuration: {
										baseURL: runtimeEnv.EMBEDDINGS_API_BASE_URL,
									},
								}),
					}),
				)
			: undefined;
	const qdrant =
		runtimeEnv.QDRANT_URL.length > 0
			? createQdrantClients(runtimeEnv)
			: undefined;
	const catalogIngestion =
		catalog !== undefined && embeddings !== undefined && qdrant !== undefined
			? new CatalogIngestionJobService(
					new CatalogIngestionService(catalog, embeddings, qdrant.index, {
						merchantId: runtimeEnv.CATALOG_MERCHANT_ID,
						collection: runtimeEnv.QDRANT_COLLECTION,
						query: runtimeEnv.CATALOG_QUERY,
						limit: runtimeEnv.CATALOG_MAX_PRODUCTS,
					}),
				)
			: undefined;

	return {
		integrations: {
			redis,
			orders,
			stellar,
			...(embeddings === undefined ? {} : { embeddings }),
			...(qdrant === undefined ? {} : { vectors: qdrant.search }),
			...(catalog === undefined ? {} : { catalog }),
			...(catalogIngestion === undefined ? {} : { catalogIngestion }),
			vectorCollection: runtimeEnv.QDRANT_COLLECTION,
		},
		close: async () => {
			await pool.end();
			await redis.quit().catch(() => undefined);
		},
	};
}
