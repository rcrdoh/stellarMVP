import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { Horizon, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Env } from "../config/env.js";
import type { AgentIntegrations } from "../http/server.js";
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
	close: () => Promise<void>;
}>;

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

	return {
		integrations: {
			redis,
			orders,
			stellar,
			embeddings: openai,
			vectors: createQdrantClient(runtimeEnv),
			vectorCollection: runtimeEnv.QDRANT_COLLECTION,
		},
		close: async () => {
			await pool.end();
			await redis.quit().catch(() => undefined);
		},
	};
}
