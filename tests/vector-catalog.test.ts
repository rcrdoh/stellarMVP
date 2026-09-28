import { describe, expect, test } from "bun:test";
import type { MerchantOffer } from "../src/domain/agents/contracts.js";
import { VectorMerchantCatalog } from "../src/integrations/agents/vector-merchant-catalog.js";
import type { EmbeddingsLike } from "../src/integrations/openai.js";
import type {
	VectorSearchClient,
	VectorSearchHit,
	VectorSearchRequest,
} from "../src/integrations/qdrant.js";

function offerPayload(overrides: Partial<MerchantOffer> = {}): MerchantOffer {
	return {
		offerId: "offer-1",
		productId: "product-1",
		merchantId: "merchant-1",
		title: "Cafetera de acero",
		priceMinor: 2599,
		currency: "USD",
		availability: "in_stock",
		totalCostMinor: 2899,
		url: "https://merchant.example/offers/offer-1",
		fetchedAt: "2026-09-28T00:00:00.000Z",
		source: "catalog",
		...overrides,
	};
}

function embeddingStub(): { embeddings: EmbeddingsLike; queries: string[] } {
	const queries: string[] = [];
	return {
		queries,
		embeddings: {
			embedQuery: async (text: string) => {
				queries.push(text);
				return [0.1, 0.2, 0.3];
			},
		},
	};
}

function vectorStub(hits: VectorSearchHit[]): {
	vectors: VectorSearchClient;
	requests: VectorSearchRequest[];
} {
	const requests: VectorSearchRequest[] = [];
	return {
		requests,
		vectors: {
			search: async (request: VectorSearchRequest) => {
				requests.push(request);
				return hits;
			},
		},
	};
}

describe("VectorMerchantCatalog", () => {
	test("embeds the query and transforms qdrant hits into MerchantOffer candidates", async () => {
		const { embeddings, queries } = embeddingStub();
		const { vectors, requests } = vectorStub([
			{ id: "point-1", score: 0.98, payload: offerPayload() },
			{
				id: "point-2",
				score: 0.91,
				payload: offerPayload({
					offerId: "offer-2",
					productId: "product-2",
					merchantId: "merchant-2",
					title: "Molinillo de cafe",
					priceMinor: 1299,
					totalCostMinor: 1499,
					url: "https://merchant.example/offers/offer-2",
				}),
			},
		]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		const offers = await catalog.findOffers({
			query: "cafetera",
			filters: { inStock: true },
			limit: 5,
		});

		expect(queries).toEqual(["cafetera"]);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toEqual({
			collection: "merchant-offers",
			vector: [0.1, 0.2, 0.3],
			limit: 5,
			filters: { availability: "in_stock" },
		});
		expect(offers).toHaveLength(2);
		expect(offers[0]).toEqual(offerPayload());
		expect(offers[1]?.offerId).toBe("offer-2");
	});

	test("translates currency and inStock filters into qdrant payload filters", async () => {
		const { embeddings } = embeddingStub();
		const { vectors, requests } = vectorStub([]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		await catalog.findOffers({
			query: "cafetera",
			filters: { currency: "EUR", inStock: true },
			limit: 3,
		});

		expect(requests[0]?.filters).toEqual({
			currency: "EUR",
			availability: "in_stock",
		});
	});

	test("omits filters entirely when neither currency nor inStock is requested", async () => {
		const { embeddings } = embeddingStub();
		const { vectors, requests } = vectorStub([]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		await catalog.findOffers({
			query: "cafetera",
			filters: { inStock: false },
			limit: 3,
		});

		expect(requests[0]?.filters).toBeUndefined();
	});

	test("fails closed by dropping hits whose payload is not a valid MerchantOffer", async () => {
		const { embeddings } = embeddingStub();
		const { vectors } = vectorStub([
			{ id: "point-1", score: 0.99, payload: offerPayload() },
			{
				id: "point-2",
				score: 0.95,
				payload: { offerId: "offer-2", currency: "usd" },
			},
			{
				id: "point-3",
				score: 0.9,
				payload: offerPayload({ priceMinor: -1 }),
			},
		]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		const offers = await catalog.findOffers({
			query: "cafetera",
			filters: { inStock: true },
			limit: 5,
		});

		expect(offers.map((offer) => offer.offerId)).toEqual(["offer-1"]);
	});

	test("findOfferById returns the parsed offer for the top hit", async () => {
		const { embeddings, queries } = embeddingStub();
		const { vectors, requests } = vectorStub([
			{ id: "point-1", score: 0.97, payload: offerPayload() },
		]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		const offer = await catalog.findOfferById("offer-1");

		expect(offer).toEqual(offerPayload());
		expect(queries).toEqual(["offer-1"]);
		expect(requests[0]).toEqual({
			collection: "merchant-offers",
			vector: [0.1, 0.2, 0.3],
			limit: 1,
			filters: { offerId: "offer-1" },
		});
	});

	test("findOfferById returns null when the vector store has no hit", async () => {
		const { embeddings } = embeddingStub();
		const { vectors } = vectorStub([]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		await expect(catalog.findOfferById("missing")).resolves.toBeNull();
	});

	test("findOfferById returns null when the matched payload is incompatible", async () => {
		const { embeddings } = embeddingStub();
		const { vectors } = vectorStub([
			{ id: "point-1", score: 0.5, payload: { offerId: "offer-1" } },
		]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "merchant-offers",
		});

		await expect(catalog.findOfferById("offer-1")).resolves.toBeNull();
	});

	test("uses the configured collection on every search", async () => {
		const { embeddings } = embeddingStub();
		const { vectors, requests } = vectorStub([]);
		const catalog = new VectorMerchantCatalog(embeddings, vectors, {
			collection: "custom-collection",
		});

		await catalog.findOffers({
			query: "cafetera",
			filters: { inStock: true },
			limit: 1,
		});
		await catalog.findOfferById("offer-1");

		expect(requests.every((r) => r.collection === "custom-collection")).toBe(
			true,
		);
	});
});
