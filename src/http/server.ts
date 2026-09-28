import type { BaseCheckpointSaver } from "@langchain/langgraph";
import apiReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import { type Env, env } from "../config/env.js";
import { LocalBucket, type ObjectBucket } from "../integrations/bucket.js";
import { type Cache, LocalCache } from "../integrations/cache.js";
import { type Database, LocalDatabase } from "../integrations/database.js";
import {
	type ItemStore,
	MemoryItemStore,
} from "../integrations/memory-item-store.js";
import type { EmbeddingsLike } from "../integrations/openai.js";
import type { OrdersRepository } from "../integrations/postgres.js";
import type { VectorSearchClient } from "../integrations/qdrant.js";
import type { RedisLike } from "../integrations/redis.js";
import type { StellarPaymentGateway } from "../integrations/stellar.js";
import { AgentAuthService } from "../services/agent-auth.js";
import { AgentCheckoutService } from "../services/agent-checkout.js";
import { AgentSearchService } from "../services/agent-search.js";
import type { DiscoveryAgentService } from "../services/agents/discovery-agent.js";
import type { AgentShoppingConversationService } from "../services/agents/shopping-conversation.js";
import { ItemService } from "../services/item-service.js";
import type { PaymentRuntime } from "../services/payment-runtime.js";
import {
	registerErrorHandler,
	registerValidatorCompiler,
} from "./error-handler.js";
import { registerPaymentRoutes } from "./payment-routes.js";
import { type AgentRoutes, registerRoutes } from "./routes.js";

export type AgentIntegrations = Readonly<{
	redis: RedisLike;
	orders: OrdersRepository;
	stellar: StellarPaymentGateway;
	embeddings: EmbeddingsLike;
	vectors: VectorSearchClient;
	vectorCollection?: string;
	/**
	 * Durable LangGraph checkpointer. When absent the shopping agent keeps no
	 * persisted conversation state, which is only acceptable for tests.
	 */
	checkpointer?: BaseCheckpointSaver;
	/**
	 * Lazy accessor for the composed shopping-agent use case. Kept as a function
	 * so the provider graph is built on first conversation, not at startup.
	 */
	shoppingConversation?: () => Promise<AgentShoppingConversationService>;
	/**
	 * Lazy accessor for the Discovery Agent (free-text -> structured intent).
	 * When absent the `/v1/agent/chat` route stays unregistered.
	 */
	discoveryAgent?: () => DiscoveryAgentService;
}>;

export type AppIntegrations = Readonly<{
	database: Database;
	bucket: ObjectBucket;
	cache: Cache;
	/**
	 * Optional agentic-commerce dependencies. When absent the `/v1/agent/*`
	 * routes stay unregistered, keeping the default surface to core items.
	 */
	agent?: AgentIntegrations;
}>;

type BuildServerOptions = Readonly<{
	env?: Env;
	fastifyFactory?: typeof Fastify;
	integrations?: AppIntegrations;
	agent?: AgentIntegrations;
	itemStore?: ItemStore;
	closeClient?: () => Promise<void>;
	payments?: PaymentRuntime;
}>;

function buildAgentRoutes(
	itemStore: ItemStore,
	agent: AgentIntegrations,
): AgentRoutes {
	return {
		auth: new AgentAuthService(agent.redis),
		search: new AgentSearchService(agent.embeddings, agent.vectors, {
			collection: agent.vectorCollection ?? "items",
		}),
		checkout: new AgentCheckoutService({
			auth: new AgentAuthService(agent.redis),
			orders: agent.orders,
			stellar: agent.stellar,
			markItemPurchased: (itemId) =>
				itemStore.updateStatus(itemId, "purchased"),
		}),
		...(agent.shoppingConversation === undefined
			? {}
			: { shopping: agent.shoppingConversation }),
		...(agent.discoveryAgent === undefined
			? {}
			: { chat: agent.discoveryAgent }),
	};
}

export async function buildServer(options: BuildServerOptions = {}) {
	const runtimeEnv = options.env ?? env;
	const integrations = options.integrations ?? {
		database: new LocalDatabase(),
		bucket: new LocalBucket(),
		cache: new LocalCache(),
	};
	const agent = options.agent ?? integrations.agent;
	const resolvedIntegrations: AppIntegrations =
		agent === undefined || agent === integrations.agent
			? integrations
			: { ...integrations, agent };
	const itemStore = options.itemStore ?? new MemoryItemStore();
	const createFastify = options.fastifyFactory ?? Fastify;
	const app = createFastify({
		logger: {
			level: runtimeEnv.LOG_LEVEL,
		},
	});

	if (resolvedIntegrations.agent !== undefined) {
		const { default: rateLimit } = await import("@fastify/rate-limit");
		await app.register(rateLimit, {
			redis: resolvedIntegrations.agent.redis,
			max: 20,
			timeWindow: "1 minute",
			// Resilience posture: only the agentic-commerce surface is throttled.
			// Everything else (health, docs, catalog) is left untouched so a burst
			// of LLM-driven traffic cannot starve the read APIs.
			allowList: (request) => !request.url.startsWith("/v1/agent/"),
			// The plugin throws this result into the Fastify error pipeline, so it
			// must carry `statusCode: 429` to be classified into the shared
			// `RATE_LIMITED` Problem response (SVC-CORE-5003) with Retry-After.
			errorResponseBuilder: () => {
				const error = new Error("Rate limit exceeded") as Error & {
					statusCode: number;
				};
				error.statusCode = 429;
				return error;
			},
		});
	}

	registerErrorHandler(app);
	registerValidatorCompiler(app);
	registerRoutes(
		app,
		new ItemService(itemStore),
		runtimeEnv,
		resolvedIntegrations,
		resolvedIntegrations.agent === undefined
			? undefined
			: buildAgentRoutes(itemStore, resolvedIntegrations.agent),
		options.payments,
	);
	registerPaymentRoutes(app, runtimeEnv, options.payments);
	await app.register(apiReference, {
		routePrefix: "/docs",
		configuration: {
			url: "/openapi.json",
		},
	});

	if (options.closeClient !== undefined) {
		const closeClient = options.closeClient;
		app.addHook("onClose", async () => {
			await closeClient();
		});
	}
	if (options.payments?.close !== undefined) {
		const closePayments = options.payments.close;
		app.addHook("onClose", async () => {
			await closePayments();
		});
	}

	return app;
}
