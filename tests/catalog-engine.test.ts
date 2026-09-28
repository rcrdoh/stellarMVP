import { beforeEach, describe, expect, test } from "bun:test";
import {
	type MerchantProduct,
	MerchantProductSchema,
} from "../src/domain/catalog/types.js";
import {
	type QdrantCatalogClient,
	QdrantCatalogEngine,
} from "../src/integrations/agents/qdrant-catalog-engine.js";

const seedProducts: MerchantProduct[] = [
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
	{
		id: "prod_3",
		merchantId: "merch_c",
		title: "Cotton Bath Towel",
		description: "Soft absorbent towel",
		price: 12.5,
		currency: "USD",
		category: "home",
		inStock: true,
		metadata: {},
	},
];

describe("QdrantCatalogEngine (Module 6)", () => {
	let engine: QdrantCatalogEngine;

	beforeEach(() => {
		// No client injected and no QDRANT_URL -> deterministic offline mode.
		engine = new QdrantCatalogEngine({ client: null });
		engine.setFallbackCatalog(seedProducts);
	});

	test("returns offline fallback candidates with default limit", async () => {
		const results = await engine.searchCandidates({ limit: 5 });

		expect(results).toHaveLength(3);
		expect(results[0]?.id).toBe("prod_1");
		expect(engine.isFallback()).toBe(true);
	});

	test("applies category and maxPrice filters to the fallback catalog", async () => {
		const results = await engine.searchCandidates({
			category: "electronics",
			maxPrice: 100,
			limit: 5,
		});

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("prod_2");
	});

	test("honors the limit bound when slicing fallback results", async () => {
		const results = await engine.searchCandidates({ limit: 2 });
		expect(results).toHaveLength(2);
	});

	test("rejects invalid query options via Zod (Audit L2)", async () => {
		await expect(engine.searchCandidates({ limit: -5 })).rejects.toThrow();
		await expect(engine.searchCandidates({ limit: 999 })).rejects.toThrow();
		await expect(engine.searchCandidates({ maxPrice: -1 })).rejects.toThrow();
		await expect(engine.searchCandidates({ minScore: 2 })).rejects.toThrow();
	});

	test("queries Qdrant and maps validated payloads when a client is present", async () => {
		const calls: Array<{
			collection: string;
			limit: number;
			filter?: unknown;
		}> = [];
		const fakeClient: QdrantCatalogClient = {
			async query(collectionName, request) {
				calls.push({
					collection: collectionName,
					limit: request.limit,
					filter: request.filter,
				});
				return {
					points: [
						{
							id: "prod_qdrant_1",
							score: 0.92,
							payload: {
								merchantId: "merch_z",
								title: "Vector Indexed Camera",
								description: "Mirrorless camera body",
								price: 1499.5,
								category: "electronics",
							},
						},
					],
				};
			},
		};
		const online = new QdrantCatalogEngine({
			client: fakeClient,
			collectionName: "merchant_products",
		});

		const results = await online.searchCandidates({
			vector: [0.1, 0.2, 0.3],
			category: "electronics",
			maxPrice: 2000,
			limit: 3,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.collection).toBe("merchant_products");
		expect(calls[0]?.limit).toBe(3);
		expect(calls[0]?.filter).toEqual({
			must: [
				{ key: "category", match: { value: "electronics" } },
				{ key: "price", range: { lte: 2000 } },
			],
		});
		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("prod_qdrant_1");
		expect(results[0]?.score).toBe(0.92);
		expect(online.isFallback()).toBe(false);
	});

	test("falls back deterministically when Qdrant throws or returns bad payloads", async () => {
		const throwingClient: QdrantCatalogClient = {
			async query() {
				throw new Error("connection refused");
			},
		};
		const offline = new QdrantCatalogEngine({ client: throwingClient });
		offline.setFallbackCatalog(seedProducts);

		const results = await offline.searchCandidates({
			vector: [1, 2, 3],
			limit: 5,
		});

		expect(results).toHaveLength(3);
		expect(offline.isFallback()).toBe(true);

		const badPayloadClient: QdrantCatalogClient = {
			async query() {
				return { points: [{ id: "bad", score: 0.9, payload: { price: -5 } }] };
			},
		};
		const poisoned = new QdrantCatalogEngine({ client: badPayloadClient });
		poisoned.setFallbackCatalog(seedProducts);

		const fallbackResults = await poisoned.searchCandidates({
			vector: [1, 2, 3],
			limit: 5,
		});
		expect(fallbackResults).toHaveLength(3);
		expect(poisoned.isFallback()).toBe(true);
	});

	test("validates fallback catalog entries on registration", () => {
		const invalid = new QdrantCatalogEngine({ client: null });
		expect(() =>
			invalid.setFallbackCatalog([
				{ ...seedProducts[0], price: -1 } as MerchantProduct,
			]),
		).toThrow();
	});

	test("MerchantProductSchema defaults currency, inStock and metadata", () => {
		const parsed = MerchantProductSchema.parse({
			id: "prod_x",
			merchantId: "merch_x",
			title: "Generic Widget",
			description: "",
			price: 9.99,
			category: "misc",
		});

		expect(parsed.currency).toBe("USD");
		expect(parsed.inStock).toBe(true);
		expect(parsed.metadata).toEqual({});
	});
});
