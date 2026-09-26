import { describe, expect, test } from "bun:test";
import {
	BazaarCatalogClient,
	normalizeBazaarResource,
} from "../src/integrations/bazaar-catalog.js";

const resource = {
	name: "render-pro",
	method: "POST",
	url: "https://app.heinrichstech.com/v1/cdp/render-pro",
	network: "eip155:8453",
	asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	assetSymbol: "USDC",
	payTo: "0xDa2F35d283c42dd60B965322394bc658a5c1769F",
	priceAtomic: "10000",
	priceUsdc: 0.01,
	summary: "Render a public page and report bounded changes.",
	accepts: [
		{
			scheme: "exact",
			network: "stellar:pubnet",
			amount: "100000",
			payTo: "GCB5WZT5VCBBATGMQMTB6TLUXD6KQC6N5ITRWK3CCP4J3YOCE45FA2GO",
			asset: "USDC",
			extra: {
				issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
			},
		},
	],
};

describe("Bazaar catalog integration", () => {
	test("normalizes x402 resources and preserves payment rails", () => {
		const offer = normalizeBazaarResource(resource, {
			merchantId: "heinrichstech",
			merchantUrl: "https://app.heinrichstech.com",
		});

		expect(offer).toMatchObject({
			offerId: "heinrichstech:render-pro",
			merchantId: "heinrichstech",
			priceMinor: 1,
			currency: "USD",
			source: "catalog",
		});
		expect(offer.paymentTerms?.[0]).toMatchObject({
			network: "stellar:pubnet",
			amount: "100000",
		});
	});

	test("searches the merchant bazaar document", async () => {
		const client = new BazaarCatalogClient({
			merchantUrl: "https://app.heinrichstech.com",
			merchantId: "heinrichstech",
			fetcher: async () =>
				new Response(JSON.stringify({ resources: [resource] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});

		const result = await client.search({
			query: "page",
			limit: 5,
			filters: { inStock: true },
		});
		expect(result.offers).toHaveLength(1);
	});
});
