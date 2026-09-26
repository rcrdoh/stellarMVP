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
			errorResponseBuilder: () => ({
				type: "https://api.stellarmvp.dev/errors/rate-limited",
				title: "rate_limited",
				status: 429,
				code: "SVC-CORE-5003",
				category: "DEPENDENCY",
				detail_key: "core.rate_limited",
				detail: "Rate limit exceeded",
			}),
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
