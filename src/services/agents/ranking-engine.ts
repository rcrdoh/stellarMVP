import type { MerchantProduct } from "../../domain/catalog/types.js";
import {
	type NormalizationConfig,
	type ProductOffer,
	ProductOfferSchema,
} from "../../domain/ranking/types.js";
import { ProductNormalizationService } from "./normalization.js";

/** Relative weights of the three composite-score components. They need not sum to 1. */
export type RankingWeights = {
	relevance: number;
	price: number;
	stock: number;
};

export type RankingOptions = {
	sessionId: string;
	/** Requested result count; clamped to `[1, 10]`, defaults to 5. */
	topK?: number;
	weights?: RankingWeights;
};

const DEFAULT_WEIGHTS: RankingWeights = {
	relevance: 0.6,
	price: 0.3,
	stock: 0.1,
};

const MAX_TOP_K = 10;

export type ProductRankingEngineOptions = {
	/** Overrides the default `crypto.randomUUID` id source (deterministic tests). */
	idFactory?: () => string;
};

/**
 * Composite ranking engine (Module 7, Task 2).
 *
 * Given the raw `MerchantProduct[]` retrieved by the vector catalog it
 * deduplicates/normalizes candidates and assigns each a composite quality score:
 *
 *   S = w_rel * VectorScore + w_price * (MinPrice / Price) + w_stock * StockBonus
 *
 * where `VectorScore` is the Qdrant similarity (defaults to 0.5 when absent),
 * `MinPrice / Price` rewards cheaper offers relative to the cheapest candidate
 * and `StockBonus` is 1 for in-stock listings. Results are clamped to the unit
 * interval, sorted by descending score and truncated to `topK` (1..10).
 */
export class ProductRankingEngine {
	private readonly normalizer: ProductNormalizationService;
	private readonly idFactory: () => string;

	constructor(
		config: NormalizationConfig,
		options: ProductRankingEngineOptions = {},
	) {
		this.normalizer = new ProductNormalizationService(config);
		this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
	}

	public get normalizedCurrency(): string {
		return this.normalizer.normalizedCurrency;
	}

	public rankCandidates(
		products: MerchantProduct[],
		options: RankingOptions,
	): ProductOffer[] {
		const topK = Math.min(Math.max(options.topK ?? 5, 1), MAX_TOP_K);
		const weights = options.weights ?? DEFAULT_WEIGHTS;

		const deduplicated = this.normalizer.normalizeAndDeduplicate(products);
		if (deduplicated.length === 0) {
			return [];
		}

		const minPrice = Math.min(...deduplicated.map((product) => product.price));
		const currency = this.normalizer.normalizedCurrency;

		const scored = deduplicated.map((product) =>
			this.scoreProduct(
				product,
				options.sessionId,
				weights,
				minPrice,
				currency,
			),
		);

		return scored
			.sort((a, b) => b.compositeScore - a.compositeScore)
			.slice(0, topK);
	}

	private scoreProduct(
		product: MerchantProduct,
		sessionId: string,
		weights: RankingWeights,
		minPrice: number,
		currency: string,
	): ProductOffer {
		const relevanceScore = product.score ?? 0.5;
		const priceScore = product.price > 0 ? minPrice / product.price : 0;
		const stockBonus = product.inStock !== false ? 1.0 : 0.0;

		const compositeScore = Math.min(
			1.0,
			weights.relevance * relevanceScore +
				weights.price * priceScore +
				weights.stock * stockBonus,
		);

		return ProductOfferSchema.parse({
			id: this.idFactory(),
			sessionId,
			title: product.title,
			merchantId: product.merchantId,
			originalPrice: product.price,
			originalCurrency: product.currency,
			normalizedPriceMinor: this.normalizer.convertToMinorUnits(
				product.price,
				product.currency,
			),
			normalizedCurrency: currency,
			compositeScore: Number(compositeScore.toFixed(4)),
			url: product.url ?? this.fallbackUrl(product),
			inStock: product.inStock ?? true,
			metadata: product.metadata,
		});
	}

	/**
	 * Synthesizes a stable placeholder URL for merchants that did not publish one
	 * so `ProductOffer.url` (required, RFC 3986) always validates.
	 */
	private fallbackUrl(product: MerchantProduct): string {
		const slug = product.id.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase();
		return `https://catalog.stellar.local/offers/${slug || "unknown"}`;
	}
}
