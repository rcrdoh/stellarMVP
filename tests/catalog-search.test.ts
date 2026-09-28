import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { MerchantProduct } from "../src/domain/catalog/types.js";
import { buildServer } from "../src/http/server.js";
import { QdrantCatalogEngine } from "../src/integrations/agents/qdrant-catalog-engine.js";
import type { RedisLike } from "../src/integrations/redis.js";
import { CatalogSearchService } from "../src/services/agents/catalog-search.js";

const AGENT_TOKEN = "catalog-agent-secret";

const products: MerchantProduct[] = [
	{
		id: "prod_1",
		merchantId: "merch_a",
		title: "Wireless Noise Canceling Headphones",
		description: "High fidelity audio headphones",
		price: 199.99,
		currency: "USD",
		category: "electronics",
		inStock: true,
		metadata: {},
	},
	{
		id: "prod_2",
		merchantId: "merch_b",
		title: "Mechanical Gaming Keyboard",
		description: "RGB mechanical switches",
		price: 89.99,
		currency: "USD",
		category: "electronics",
		inStock: true,
		metadata: {},
	},
];

function inMemoryRedis(
	entries: Record<string, Record<string, string>>,
): RedisLike {
	const strings = new Map<string, string>();
	return {
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
		defineCommand() {},
		rateLimit(...args: unknown[]) {
			const result = [1, 60_000, 0];
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
	} as unknown as RedisLike;
}

function authEntries(scopes: string): Record<string, Record<string, string>> {
	const hash = createHash("sha256").update(AGENT_TOKEN).digest("hex");
	return { [`agent:token:${hash}`]: { scopes, max_daily_spend: "1000" } };
}

function buildCatalogServer(options: { scopes?: string } = {}) {
	const engine = new QdrantCatalogEngine({ client: null });
	engine.setFallbackCatalog(products);
	return buildServer({
		agent: {
			redis: inMemoryRedis(authEntries(options.scopes ?? "agent:search")),
			orders: {} as never,
			stellar: {} as never,
			embeddings: {} as never,
			vectors: {} as never,
			catalogEngine: engine,
		},
	});
}

describe("CatalogSearchService", () => {
	test("sanitizes payloads and reports fallback mode", async () => {
		const engine = new QdrantCatalogEngine({ client: null });
		engine.setFallbackCatalog(products);
		const service = new CatalogSearchService(engine);

		const response = await service.search({
			queryText: "headphones",
			limit: 5,
		});

		expect(response.count).toBe(2);
		expect(response.fallback).toBe(true);
		expect(response.results[0]?.id).toBe("prod_1");
	});

	test("rejects an empty retrieval key", async () => {
		const engine = new QdrantCatalogEngine({ client: null });
		const service = new CatalogSearchService(engine);

		await expect(service.search({ limit: 5 })).rejects.toThrow();
	});

	test("rejects out-of-bounds parameters (Audit L2)", async () => {
		const engine = new QdrantCatalogEngine({ client: null });
		const service = new CatalogSearchService(engine);

		await expect(
			service.search({ queryText: "tv", limit: -1 }),
		).rejects.toThrow();
		await expect(
			service.search({ queryText: "tv", maxPrice: -10 }),
		).rejects.toThrow();
	});
});

describe("POST /v1/agent/catalog/search", () => {
	test("requires an agent token (401)", async () => {
		const app = await buildCatalogServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/catalog/search",
			payload: { queryText: "headphones" },
		});

		expect(response.statusCode).toBe(401);
	});

	test("rejects a token without the search scope (403)", async () => {
		const app = await buildCatalogServer({ scopes: "agent:shopping" });
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/catalog/search",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { queryText: "headphones" },
		});

		expect(response.statusCode).toBe(403);
	});

	test("returns fallback products for a valid request", async () => {
		const app = await buildCatalogServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/catalog/search",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { queryText: "headphones", category: "electronics", limit: 3 },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.count).toBe(2);
		expect(body.fallback).toBe(true);
		expect(body.results).toHaveLength(2);
	});

	test("rejects invalid parameters (422) before reaching the engine", async () => {
		const app = await buildCatalogServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/catalog/search",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { queryText: "headphones", limit: 999 },
		});

		expect(response.statusCode).toBe(422);
	});
});
