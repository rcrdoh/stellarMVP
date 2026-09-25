import type { FastifyInstance } from "fastify";
import { type Env, env } from "../config/env.js";
import { createItemSchema } from "../domain/items.js";
import type { ItemService } from "../services/item-service.js";
import { requireOptionalServiceToken } from "./auth.js";
import type { PaymentRuntime } from "./payment-routes.js";
import type { AppIntegrations } from "./server.js";

declare const Bun: {
	file(path: URL | string): {
		json(): Promise<unknown>;
	};
};

const openApiSpecUrl = new URL("../../specs/openapi.json", import.meta.url);

type IntegrationStatus = "disabled" | "ready" | "degraded";

function optionalIntegrationStatus(
	enabled: boolean,
	ready: boolean,
): IntegrationStatus {
	if (!enabled) {
		return "disabled";
	}
	return ready ? "ready" : "degraded";
}

export function registerRoutes(
	app: FastifyInstance,
	itemService: ItemService,
	runtimeEnv: Env = env,
	integrations?: AppIntegrations,
	payments?: PaymentRuntime,
): void {
	app.get("/", async (_request, reply) => reply.redirect("/docs"));

	app.get("/openapi.json", async () => Bun.file(openApiSpecUrl).json());

	app.get("/v1/health/live", async () => ({
		status: "ok",
		service: runtimeEnv.APP_NAME,
	}));

	app.get("/api/hello_api", async () => ({
		stellarNetworkConfigured: runtimeEnv.STELLAR_NETWORK.length > 0,
	}));

	app.get("/v1/health/ready", async () => {
		const storeReady = await itemService.isReady();
		const databaseReady =
			runtimeEnv.DATABASE_ENABLED && integrations
				? await integrations.database.isReady()
				: true;
		const bucketReady =
			runtimeEnv.BUCKET_ENABLED && integrations
				? await integrations.bucket.isReady()
				: true;
		const cacheReady =
			runtimeEnv.CACHE_ENABLED && integrations
				? await integrations.cache.isReady()
				: true;
		const paymentsReady = runtimeEnv.PAYMENTS_ENABLED
			? ((await payments?.isReady()) ?? false)
			: true;
		const ready =
			storeReady && databaseReady && bucketReady && cacheReady && paymentsReady;

		return {
			status: ready ? "ok" : "degraded",
			service: runtimeEnv.APP_NAME,
			details: {
				environment: runtimeEnv.APP_ENV,
				storeReady,
				database: optionalIntegrationStatus(
					runtimeEnv.DATABASE_ENABLED,
					databaseReady,
				),
				bucket: optionalIntegrationStatus(
					runtimeEnv.BUCKET_ENABLED,
					bucketReady,
				),
				cache: optionalIntegrationStatus(runtimeEnv.CACHE_ENABLED, cacheReady),
				payments: optionalIntegrationStatus(
					runtimeEnv.PAYMENTS_ENABLED,
					paymentsReady,
				),
			},
		};
	});

	app.post("/v1/items", async (request, reply) => {
		requireOptionalServiceToken(request, runtimeEnv);
		const input = createItemSchema.parse(request.body);
		const item = await itemService.create(input);
		return reply.code(201).send(item);
	});

	app.get("/v1/items/:itemId", async (request) => {
		requireOptionalServiceToken(request, runtimeEnv);
		const params = request.params as { itemId: string };
		return itemService.get(params.itemId);
	});
}
