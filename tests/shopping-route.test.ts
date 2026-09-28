import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import { buildServer } from "../src/http/server.js";
import type { RedisLike } from "../src/integrations/redis.js";
import { ShoppingAgent } from "../src/services/agents/shopping-agent.js";
import { AgentShoppingConversationService } from "../src/services/agents/shopping-conversation.js";

const AGENT_TOKEN = "shopping-agent-secret";

/**
 * Minimal in-memory `RedisLike` for agent-scope lookups. It implements only the
 * commands `AgentAuthService` uses so the route under test runs against real
 * service code, not a mocked service.
 */
function inMemoryRedis(
	entries: Record<string, Record<string, string>>,
): RedisLike {
	const strings = new Map<string, string>();
	const store = {
		async hget(key: string, field: string) {
			return entries[key]?.[field] ?? null;
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
		// `@fastify/rate-limit` registers a Lua command on the redis client at
		// plugin boot. The in-memory double accepts the definition and answers the
		// generated command as "under the limit". ioredis-style generated commands
		// may be invoked with a trailing node callback, so both call styles must
		// resolve.
		defineCommand(_name: string) {},
		rateLimit(...args: unknown[]) {
			const result = [1, 1, 0];
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

function tokenStore(): RedisLike {
	const hash = createHash("sha256").update(AGENT_TOKEN).digest("hex");
	return inMemoryRedis({
		[`agent:token:${hash}`]: {
			scopes: "agent:search,agent:checkout,agent:shopping",
			max_daily_spend: "1000",
		},
	});
}

/**
 * Builds the composed shopping use case on top of a real `ShoppingAgent` whose
 * external ports are deterministic in-memory adapters. This exercises the full
 * HTTP -> service -> graph path without mocking any service.
 */
function shoppingConversation(): Promise<AgentShoppingConversationService> {
	const agent = new ShoppingAgent(new MemorySaver(), {
		decisionProvider: {
			assess: async () => ({
				provider: "test",
				domain: "in_domain",
				routeHint: "rag",
				allowedRoutes: ["rag"],
				domainConfidence: 0.7,
				routeConfidence: 0.99,
				riskLevel: "low",
				evidenceSufficient: true,
				requiresEscalation: false,
				modelVersion: "test",
			}),
		},
		merchantSearchAgent: {
			search: async () => ({ offers: [] }),
		},
		quoteProvider: {
			createQuote: async () => {
				throw new Error("quote creation is not expected in this scenario");
			},
		},
		model: {} as never,
	});
	return Promise.resolve(new AgentShoppingConversationService(agent));
}

function serverWithShopping() {
	return buildServer({
		agent: {
			redis: tokenStore(),
			orders: {} as never,
			stellar: {} as never,
			embeddings: {} as never,
			vectors: {} as never,
			shoppingConversation,
		},
	});
}

describe("POST /v1/agent/shopping", () => {
	test("rejects requests without an agent token", async () => {
		const app = await serverWithShopping();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/shopping",
			payload: {
				type: "start",
				threadId: "thread-unauthorized",
				input: { sessionId: "session-1", message: "busco una cafetera" },
			},
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	test("rejects a token without the shopping scope", async () => {
		const hash = createHash("sha256").update("search-only").digest("hex");
		const app = await buildServer({
			agent: {
				redis: inMemoryRedis({
					[`agent:token:${hash}`]: { scopes: "agent:search" },
				}),
				orders: {} as never,
				stellar: {} as never,
				embeddings: {} as never,
				vectors: {} as never,
				shoppingConversation,
			},
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/shopping",
			headers: { authorization: "Bearer search-only" },
			payload: {
				type: "start",
				threadId: "thread-scope",
				input: { sessionId: "session-1", message: "busco una cafetera" },
			},
		});
		expect(response.statusCode).toBe(403);
		await app.close();
	});

	test("rejects a body that is not a valid conversation turn", async () => {
		const app = await serverWithShopping();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/shopping",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { type: "start" },
		});
		expect(response.statusCode).toBe(422);
		await app.close();
	});

	test("advances a start turn and returns the validated shopping state", async () => {
		const app = await serverWithShopping();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/shopping",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: {
				type: "start",
				threadId: "thread-happy",
				input: { sessionId: "session-happy", message: "busco una cafetera" },
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			sessionId: "session-happy",
			principalId: "local-dev",
			status: expect.any(String),
			candidates: [],
		});
		await app.close();
	});
});
