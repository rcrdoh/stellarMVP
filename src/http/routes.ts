import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Env, env } from "../config/env.js";
import {
	agentCheckoutRequestSchema,
	agentSearchQuerySchema,
} from "../domain/agent.js";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import { createItemSchema } from "../domain/items.js";
import type { AgentAuthService } from "../services/agent-auth.js";
import { AGENT_SCOPES } from "../services/agent-auth.js";
import type { AgentCheckoutService } from "../services/agent-checkout.js";
import type { AgentSearchService } from "../services/agent-search.js";
import type { ItemService } from "../services/item-service.js";
import type { PaymentRuntime } from "../services/payment-runtime.js";
import type { AppIntegrations } from "./server.js";

declare const Bun: {
	file(path: URL | string): {
		json(): Promise<unknown>;
	};
};

const openApiSpecUrl = new URL("../../specs/openapi.json", import.meta.url);

export type AgentRoutes = Readonly<{
	auth: AgentAuthService;
	search: AgentSearchService;
	checkout: AgentCheckoutService;
}>;

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

function requireAgentToken(request: FastifyRequest): string {
	const token = serviceTokenFromHeader(request);
	if (token === undefined || token.length === 0) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	return token;
}

export function registerRoutes(
	app: FastifyInstance,
	itemService: ItemService,
	runtimeEnv: Env = env,
	integrations?: AppIntegrations,
	agentRoutes?: AgentRoutes,
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

	if (agentRoutes === undefined) {
		return;
	}

	app.post(
		"/v1/agent/search",
		{
			schema: {
				body: agentSearchQuerySchema,
			},
		},
		async (request) => {
			const token = requireAgentToken(request);
			await agentRoutes.auth.verifyAgentScope(token, AGENT_SCOPES.SEARCH);
			const query = agentSearchQuerySchema.parse(request.body);
			return agentRoutes.search.search(query);
		},
	);

	app.post(
		"/v1/agent/checkout",
		{
			schema: {
				body: agentCheckoutRequestSchema,
			},
		},
		async (request, reply) => {
			const token = requireAgentToken(request);
			const paymentTokenHeader = request.headers["x-402-payment-token"];
			const paymentToken = Array.isArray(paymentTokenHeader)
				? paymentTokenHeader[0]
				: paymentTokenHeader;
			const input = agentCheckoutRequestSchema.parse(request.body);
			const order = await agentRoutes.checkout.checkout({
				token,
				paymentToken,
				request: input,
			});
			return reply.code(201).send(order);
		},
	);
}
