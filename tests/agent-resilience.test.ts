import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { buildServer } from "../src/http/server.js";
import type { RedisLike } from "../src/integrations/redis.js";
import { DiscoveryAgentService } from "../src/services/agents/discovery-agent.js";
import {
	circuitOptions,
	createLLMCircuitBreaker,
} from "../src/utils/circuit-breaker.js";

const AGENT_TOKEN = "discovery-agent-secret";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

/**
 * In-memory `RedisLike` double. `counter` is the value the `@fastify/rate-limit`
 * Lua command reports as the current window total; anything above the configured
 * `max` (20) drives the 429 branch, anything below keeps the request allowed.
 * Auth hashes are resolved through `entries` so the real `AgentAuthService` runs.
 */
function inMemoryRedis(options: {
	entries?: Record<string, Record<string, string>>;
	counter?: number;
}): RedisLike {
	const strings = new Map<string, string>();
	const counter = options.counter ?? 1;
	const store = {
		async hget(key: string, field: string) {
			return options.entries?.[key]?.[field] ?? null;
		},
		async get(key: string) {
			return strings.get(key) ?? null;
		},
		async set(key: string, value: string) {
			strings.set(key, value);
			return "OK";
		},
		async incrbyfloat(key: string, by: number) {
			const next = Number.parseFloat(strings.get(key) ?? "0") + by;
			strings.set(key, next.toString());
			return next;
		},
		async expire() {
			return 1;
		},
		async ping() {
			return "PONG";
		},
		async quit() {
			return "OK";
		},
		defineCommand(_name: string) {},
		rateLimit(...args: unknown[]) {
			// `RedisStore.incr` reads result[0] as the current count and result[1]
			// as the window TTL in milliseconds.
			const result = [counter, 60_000, 0];
			const callback = args.at(-1);
			if (typeof callback === "function") {
				(callback as (err: Error | null, value: number[]) => void)(
					null,
					result,
				);
				return;
			}
			return Promise.resolve(result);
		},
	};
	return store as unknown as RedisLike;
}

function authEntries(scopes: string): Record<string, Record<string, string>> {
	const hash = createHash("sha256").update(AGENT_TOKEN).digest("hex");
	return { [`agent:token:${hash}`]: { scopes, max_daily_spend: "1000" } };
}

/** Deterministic extractor: yields a fixed intent without touching any provider. */
function fixedExtractor() {
	return {
		extract: async () => ({
			rawQuery: "cafetera",
			category: "kitchen",
			keywords: ["cafetera"],
			currency: "USD",
			specifications: {},
			preferredBrands: [],
			isReadyToPurchase: false,
		}),
	};
}

function discoveryAgent(extractor = fixedExtractor()): DiscoveryAgentService {
	return new DiscoveryAgentService({ extractor });
}

function buildChatServer(options: {
	counter?: number;
	scopes?: string;
	agent?: DiscoveryAgentService;
}) {
	return buildServer({
		agent: {
			redis: inMemoryRedis({
				entries: authEntries(options.scopes ?? "agent:discovery"),
				...(options.counter === undefined ? {} : { counter: options.counter }),
			}),
			orders: {} as never,
			stellar: {} as never,
			embeddings: {} as never,
			vectors: {} as never,
			discoveryAgent: () => options.agent ?? discoveryAgent(),
		},
	});
}

const validPayload = { sessionId: SESSION_ID, message: "busco una cafetera" };

describe("POST /v1/agent/chat", () => {
	test("rejects requests without an agent token (401)", async () => {
		const app = await buildChatServer({});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			payload: validPayload,
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	test("rejects a token without the discovery scope (403)", async () => {
		const app = await buildChatServer({ scopes: "agent:shopping" });
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: validPayload,
		});
		expect(response.statusCode).toBe(403);
		await app.close();
	});

	test("rejects a malformed turn body (422)", async () => {
		const app = await buildChatServer({});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { sessionId: "not-a-uuid" },
		});
		expect(response.statusCode).toBe(422);
		await app.close();
	});

	test("extracts a structured intent from a valid message (200)", async () => {
		const app = await buildChatServer({});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: validPayload,
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "success",
			intent: { rawQuery: "cafetera", category: "kitchen", currency: "USD" },
		});
		await app.close();
	});
});

describe("rate limiting scoped to /v1/agent/*", () => {
	test("returns a RATE_LIMITED problem once the agent window is exceeded (429)", async () => {
		const app = await buildChatServer({ counter: 21 });
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: validPayload,
		});
		expect(response.statusCode).toBe(429);
		expect(response.headers["content-type"]).toContain(
			"application/problem+json",
		);
		expect(response.headers["retry-after"]).toBeDefined();
		expect(response.json()).toMatchObject({
			status: 429,
			code: "SVC-CORE-5003",
			title: "rate_limited",
			category: "DEPENDENCY",
		});
		await app.close();
	});

	test("leaves non-agent routes unthrottled even when the window is exceeded", async () => {
		const app = await buildChatServer({ counter: 21 });
		const response = await app.inject({
			method: "GET",
			url: "/v1/health/live",
		});
		expect(response.statusCode).toBe(200);
		await app.close();
	});
});

describe("LLM circuit breaker", () => {
	test("passes through the resolved value while healthy", async () => {
		const breaker = createLLMCircuitBreaker(async (message: string) =>
			message.toUpperCase(),
		);
		expect(await breaker.fire("hola")).toBe("HOLA");
		expect(circuitOptions.timeout).toBe(10_000);
	});

	test("degrades to a typed 503 fallback once the circuit opens", async () => {
		let calls = 0;
		const breaker = createLLMCircuitBreaker(async (_message: string) => {
			calls += 1;
			throw new Error("upstream exploded");
		});
		await breaker.fire("a").catch(() => undefined);
		const callsAfterFirstFailure = calls;
		// Open the circuit explicitly so the assertion does not depend on
		// opossum's internal volume/half-open timing.
		breaker.open();
		let captured: unknown;
		await breaker.fire("c").catch((error: unknown) => {
			captured = error;
		});
		// The fallback runs without invoking the wrapped function again while open.
		expect(calls).toBe(callsAfterFirstFailure);
		expect(captured).toBeInstanceOf(Error);
		expect(
			(captured as { errorCode?: { status?: number } }).errorCode?.status,
		).toBe(503);
	});

	test("surfaces a failure problem when the extractor keeps failing", async () => {
		const app = await buildChatServer({
			counter: 1,
			agent: discoveryAgent({
				extract: async () => {
					throw new Error("provider down");
				},
			}),
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/chat",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: validPayload,
		});
		// A hard extractor failure is not a rate-limit trip, so the first request
		// reports the upstream failure through the shared error pipeline.
		expect([500, 503]).toContain(response.statusCode);
		await app.close();
	});
});
