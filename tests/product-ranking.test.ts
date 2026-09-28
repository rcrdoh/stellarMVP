import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { MerchantProduct } from "../src/domain/catalog/types.js";
import type { ProductOffer } from "../src/domain/ranking/types.js";
import { buildServer } from "../src/http/server.js";
import type { RedisLike } from "../src/integrations/redis.js";
import { ProductNormalizationService } from "../src/services/agents/normalization.js";
import type { SearchRepository } from "../src/services/agents/ports/search-repository.js";
import { ProductHandoffService } from "../src/services/agents/product-handoff.js";
import { ProductRankingEngine } from "../src/services/agents/ranking-engine.js";

const AGENT_TOKEN = "ranking-agent-secret";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const products: MerchantProduct[] = [
	{
		id: "prod_1",
		merchantId: "merch_a",
		title: "Wireless Noise Canceling Headphones",
		description: "High fidelity audio headphones",
		price: 200,
		currency: "USD",
		category: "electronics",
		inStock: true,
		metadata: {},
		score: 0.9,
		url: "https://shop.example.com/headphones",
	},
	{
		id: "prod_2",
		merchantId: "merch_b",
		title: "Mechanical Gaming Keyboard",
		description: "RGB mechanical switches",
		price: 90,
		currency: "USD",
		category: "electronics",
		inStock: true,
		metadata: {},
		score: 0.7,
	},
	{
		// Duplicate of prod_1 by canonical URL (different merchant/source).
		id: "prod_1_dup",
		merchantId: "merch_c",
		title: "Wireless Noise Canceling Headphones",
		description: "Same listing mirrored by a third-party feed",
		price: 195,
		currency: "USD",
		category: "electronics",
		inStock: true,
		metadata: {},
		score: 0.85,
		url: "https://shop.example.com/headphones",
	},
];

describe("ProductNormalizationService (Module 7)", () => {
	test("converts foreign currency prices into base minor units", () => {
		const normalizer = new ProductNormalizationService({
			baseCurrency: "USD",
			exchangeRates: { USD: 1.0, PEN: 0.27 },
		});

		// 100 PEN * 0.27 = 27.00 USD -> 2700 cents.
		expect(normalizer.convertToMinorUnits(100, "PEN")).toBe(2700);
		expect(normalizer.convertToMinorUnits(10, "USD")).toBe(1000);
	});

	test("treats an unknown currency as a 1:1 rate instead of zeroing it", () => {
		const normalizer = new ProductNormalizationService({
			baseCurrency: "USD",
			exchangeRates: { USD: 1.0 },
		});

		expect(normalizer.convertToMinorUnits(42.5, "XYZ")).toBe(4250);
	});

	test("deduplicates by canonical URL keeping the first occurrence", () => {
		const normalizer = new ProductNormalizationService({
			baseCurrency: "USD",
			exchangeRates: { USD: 1.0 },
		});

		const withUrl: MerchantProduct[] = [
			{
				...products[0],
				url: "https://shop.example.com/headphones",
			} as MerchantProduct,
			{ ...(products[2] as MerchantProduct) },
		];
		const result = normalizer.normalizeAndDeduplicate(withUrl);

		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("prod_1");
	});
});

describe("ProductRankingEngine (Module 7)", () => {
	function buildEngine() {
		let counter = 0;
		return new ProductRankingEngine(
			{ baseCurrency: "USD", exchangeRates: { USD: 1.0, PEN: 0.27 } },
			{
				idFactory: () => {
					counter += 1;
					return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
				},
			},
		);
	}

	test("ranks by composite score and truncates to topK", () => {
		const engine = buildEngine();
		const offers = engine.rankCandidates(products.slice(0, 2), {
			sessionId: SESSION_ID,
			topK: 1,
		});

		expect(offers).toHaveLength(1);
		// prod_2 wins: its cheapest-candidate price score outweighs the higher
		// vector relevance of prod_1 under the default weights.
		expect(offers[0]?.title).toBe("Mechanical Gaming Keyboard");
		expect(offers[0]?.compositeScore).toBeGreaterThan(0);
	});

	test("deduplicates mirrored listings before scoring", () => {
		const engine = buildEngine();
		const offers = engine.rankCandidates(products, {
			sessionId: SESSION_ID,
			topK: 5,
		});

		expect(offers).toHaveLength(2);
	});

	test("produces integer minor-unit prices and a required URL", () => {
		const engine = buildEngine();
		const offers = engine.rankCandidates([products[1] as MerchantProduct], {
			sessionId: SESSION_ID,
			topK: 5,
		});

		const offer = offers[0] as ProductOffer;
		expect(Number.isInteger(offer.normalizedPriceMinor)).toBe(true);
		expect(offer.normalizedPriceMinor).toBe(9000);
		expect(offer.url).toBe("https://catalog.stellar.local/offers/prod_2");
	});

	test("rejects an invalid sessionId via Zod (Audit L2)", () => {
		const engine = buildEngine();
		expect(() =>
			engine.rankCandidates([products[0] as MerchantProduct], {
				sessionId: "not-a-uuid",
			}),
		).toThrow();
	});
});

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

class InMemorySearchRepository implements SearchRepository {
	sessions: Array<{ sessionId: string; query: string }> = [];
	results: Array<{ sessionId: string; offers: ProductOffer[] }> = [];

	async saveSearchSession(sessionId: string, query: string): Promise<void> {
		this.sessions.push({ sessionId, query });
	}

	async saveSearchResults(
		sessionId: string,
		offers: ProductOffer[],
	): Promise<void> {
		this.results.push({ sessionId, offers });
	}
}

function buildRankingServer(
	options: { scopes?: string; repository?: SearchRepository } = {},
) {
	const engine = new ProductRankingEngine({
		baseCurrency: "USD",
		exchangeRates: { USD: 1.0 },
	});
	const service = new ProductHandoffService(engine, options.repository ?? null);
	return buildServer({
		agent: {
			redis: inMemoryRedis(authEntries(options.scopes ?? "agent:search")),
			orders: {} as never,
			stellar: {} as never,
			embeddings: {} as never,
			vectors: {} as never,
			ranking: () => service,
		},
	});
}

describe("POST /v1/agent/products/rank (Module 7)", () => {
	test("requires an agent token (401)", async () => {
		const app = await buildRankingServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/products/rank",
			payload: { sessionId: SESSION_ID, products },
		});

		expect(response.statusCode).toBe(401);
	});

	test("rejects a token without the search scope (403)", async () => {
		const app = await buildRankingServer({ scopes: "agent:shopping" });
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/products/rank",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { sessionId: SESSION_ID, products },
		});

		expect(response.statusCode).toBe(403);
	});

	test("returns ranked offers without persistence when no repository is wired", async () => {
		const app = await buildRankingServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/products/rank",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { sessionId: SESSION_ID, products, topK: 5 },
		});

		expect(response.statusCode).toBe(200);
		const body = response.json();
		expect(body.count).toBe(2);
		expect(body.persisted).toBe(false);
		expect(body.normalizedCurrency).toBe("USD");
	});

	test("persists the session and ranked results through the repository port", async () => {
		const repository = new InMemorySearchRepository();
		const app = await buildRankingServer({ repository });
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/products/rank",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { sessionId: SESSION_ID, products, topK: 3 },
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().persisted).toBe(true);
		expect(repository.sessions).toHaveLength(1);
		expect(repository.sessions[0]?.sessionId).toBe(SESSION_ID);
		expect(repository.results[0]?.offers).toHaveLength(2);
	});

	test("rejects invalid ranking parameters (422) before the engine", async () => {
		const app = await buildRankingServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/products/rank",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { sessionId: SESSION_ID, products, topK: 99 },
		});

		expect(response.statusCode).toBe(422);
	});
});
