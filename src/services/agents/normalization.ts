import type { MerchantProduct } from "../../domain/catalog/types.js";
import {
	type NormalizationConfig,
	NormalizationConfigSchema,
} from "../../domain/ranking/types.js";

/**
 * Price normalization and source-based deduplication (Module 7, Task 1).
 *
 * The vector catalog (Module 6) may return the same physical listing from
 * several Qdrant documents and prices in heterogeneous currencies. This service
 * collapses duplicate listings and converts every price into the base-currency
 * minor units so the ranking engine compares offers on a single scale.
 */
export class ProductNormalizationService {
	private readonly baseCurrency: string;
	private readonly exchangeRates: Record<string, number>;

	constructor(config: NormalizationConfig) {
		const parsed = NormalizationConfigSchema.parse(config);
		this.baseCurrency = parsed.baseCurrency.toUpperCase();
		this.exchangeRates = Object.fromEntries(
			Object.entries(parsed.exchangeRates).map(([code, rate]) => [
				code.toUpperCase(),
				rate,
			]),
		);
	}

	public get normalizedCurrency(): string {
		return this.baseCurrency;
	}

	/**
	 * Removes duplicate listings, keying on the canonical URL when present and on
	 * `merchantId:title` otherwise. The first occurrence wins so the input order
	 * (and therefore vector relevance order) is preserved.
	 */
	public normalizeAndDeduplicate(
		products: MerchantProduct[],
	): MerchantProduct[] {
		const seen = new Set<string>();
		const deduplicated: MerchantProduct[] = [];

		for (const product of products) {
			const key = this.deduplicationKey(product);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			deduplicated.push(product);
		}

		return deduplicated;
	}

	/**
	 * Converts a price in `currency` to base-currency minor units (cents). Unknown
	 * currencies fall back to a 1:1 rate so an unconfigured code never silently
	 * zeroes a price.
	 */
	public convertToMinorUnits(price: number, currency: string): number {
		const rate = this.exchangeRates[currency.toUpperCase()] ?? 1.0;
		const priceInBase = price * rate;
		return Math.round(priceInBase * 100);
	}

	private deduplicationKey(product: MerchantProduct): string {
		const url = product.url?.trim().toLowerCase();
		if (url !== undefined && url.length > 0) {
			return url;
		}
		return `${product.merchantId}:${product.title.trim().toLowerCase()}`;
	}
}
