import { describe, expect, test } from "bun:test";
import {
	normalizeUcpProduct,
	UcpCatalogClient,
} from "../src/integrations/ucp-catalog.js";
import { CatalogIngestionService } from "../src/services/catalog-ingestion.js";

const profile = {
	ucp: {
		version: "2026-08-25",
		services: {
			"dev.ucp.shopping": [
				{
					version: "2026-08-25",
					transport: "rest",
					endpoint: "https://merchant.example/ucp",
				},
			],
		},
		capabilities: {
			"dev.ucp.shopping.catalog.search": [{ version: "2026-08-25" }],
			"dev.ucp.shopping.catalog.lookup": [{ version: "2026-08-25" }],
		},
		payment_handlers: {},
	},
};

const product = {
	id: "dermi-skincare-ingredient-check",
	title: "Skincare ingredient analysis",
	description: { plain: "Check ingredients before buying skincare." },
	url: "https://merchant.example/products/dermi-check",
	price_range: { min: { amount: 1, currency: "USD" } },
	variants: [
		{
			id: "dermi-check-001",
			title: "One analysis",
			price: { amount: 1, currency: "USD" },
			availability: { available: true },
		},
	],
};

describe("UCP catalog integration", () => {
	test("discovers a REST service and normalizes a product offer", async () => {
		const calls: Request[] = [];
		const client = new UcpCatalogClient({
			merchantUrl: "https://merchant.example",
			merchantId: "dermi",
			agentProfileUrl: "https://agent.example/.well-known/ucp",
			fetcher: async (input, init) => {
				calls.push(new Request(input, init));
				const url = String(input);
				return new Response(
					JSON.stringify(
						url.endsWith("/.well-known/ucp")
							? profile
							: { ucp: profile.ucp, products: [product] },
					),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});

		const result = await client.search({
			query: "skincare",
			limit: 5,
			filters: { inStock: true },
		});

		expect(result.offers).toHaveLength(1);
		expect(result.offers[0]).toMatchObject({
			offerId: "dermi:dermi-skincare-ingredient-check:dermi-check-001",
			merchantId: "dermi",
			priceMinor: 1,
			currency: "USD",
			availability: "in_stock",
			source: "ucp",
		});
		expect(calls[1]?.headers.get("UCP-Agent")).toBe(
			'profile="https://agent.example/.well-known/ucp"',
		);
	});

	test("rejects a merchant without advertised catalog capabilities", async () => {
		const client = new UcpCatalogClient({
			merchantUrl: "https://merchant.example",
			merchantId: "dermi",
			agentProfileUrl: "https://agent.example/.well-known/ucp",
			fetcher: async () =>
				new Response(
					JSON.stringify({
						ucp: {
							version: "2026-08-25",
							services: {
								"dev.ucp.shopping": [
									{
										version: "2026-08-25",
										transport: "rest",
										endpoint: "https://merchant.example/ucp",
									},
								],
							},
							capabilities: {},
							payment_handlers: {},
						},
					}),
				),
		});

		await expect(
			client.search({
				query: "skincare",
				limit: 1,
				filters: { inStock: true },
			}),
		).rejects.toThrow("catalog search");
	});

	test("ingests offers idempotently through the vector index port", async () => {
		const ensured: Array<{ collection: string; size: number }> = [];
		const upserts: unknown[] = [];
		const ingestion = new CatalogIngestionService(
			{
				search: async () => ({
					offers: [
						normalizeUcpProduct(product, {
							merchantId: "dermi",
							sourceUrl: "https://merchant.example",
						}),
					],
				}),
			},
			{
				embedDocuments: async () => [[0.1, 0.2, 0.3]],
			},
			{
				ensureCollection: async (collection, size) => {
					ensured.push({ collection, size });
				},
				upsert: async (_collection, points) => {
					upserts.push(points);
				},
			},
			{
				merchantId: "dermi",
				collection: "skincare",
				query: "skincare",
				limit: 5,
			},
		);

		const result = await ingestion.run("job-1");
		expect(result).toMatchObject({ jobId: "job-1", products: 1, points: 1 });
		expect(ensured).toEqual([{ collection: "skincare", size: 3 }]);
		expect(upserts).toHaveLength(1);
	});
});
