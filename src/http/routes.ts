import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Env, env } from "../config/env.js";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import { createItemSchema } from "../domain/items.js";
import type { ItemService } from "../services/item-service.js";
import type { AppIntegrations } from "./server.js";

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

function serviceTokenFromHeader(request: FastifyRequest): string | undefined {
	const header = request.headers.authorization;
	if (header === undefined || !header.startsWith("Bearer ")) {
		return undefined;
	}
	return header.slice("Bearer ".length);
}

function tokensMatch(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return (
		actualBuffer.length === expectedBuffer.length &&
		timingSafeEqual(actualBuffer, expectedBuffer)
	);
}

function requireServiceToken(request: FastifyRequest, runtimeEnv: Env): void {
	if (runtimeEnv.SERVICE_TOKEN.length === 0) {
		return;
	}
	const token = serviceTokenFromHeader(request);
	if (token === undefined) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	if (!tokensMatch(token, runtimeEnv.SERVICE_TOKEN)) {
		throw new AppError(errorCodes.CREDENTIALS_INVALID_OR_EXPIRED);
	}
}

export function registerRoutes(
	app: FastifyInstance,
	itemService: ItemService,
	runtimeEnv: Env = env,
	integrations?: AppIntegrations,
): void {
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
		const ready = storeReady && databaseReady && bucketReady && cacheReady;

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
			},
		};
	});

	app.post("/v1/items", async (request, reply) => {
		requireServiceToken(request, runtimeEnv);
		const input = createItemSchema.parse(request.body);
		const item = await itemService.create(input);
		return reply.code(201).send(item);
	});

	app.get("/v1/items/:itemId", async (request) => {
		requireServiceToken(request, runtimeEnv);
		const params = request.params as { itemId: string };
		return itemService.get(params.itemId);
	});
}
