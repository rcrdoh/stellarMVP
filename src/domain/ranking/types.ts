import { z } from "zod";

/**
 * Normalized, ranked product offer presented to the UI layer (Module 7). It is
 * the handoff contract between the ranking engine and the persistence/UI
 * adapters: prices are carried both as the original value and converted to the
 * base-currency minor units (integer cents) so downstream consumers never do
 * floating-point math on money.
 */
export const ProductOfferSchema = z.object({
	id: z.string().min(1),
	sessionId: z.string().uuid(),
	title: z.string().min(1),
	merchantId: z.string().min(1),
	originalPrice: z.number().positive(),
	originalCurrency: z.string().length(3),
	/** Price in the base currency expressed as integer minor units (cents). */
	normalizedPriceMinor: z.number().int().nonnegative(),
	normalizedCurrency: z.string().length(3).default("USD"),
	compositeScore: z.number().min(0).max(1),
	url: z.string().url(),
	inStock: z.boolean().default(true),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProductOffer = z.infer<typeof ProductOfferSchema>;

/**
 * Currency conversion configuration. `exchangeRates` maps an ISO-4217 code to
 * its multiplier into `baseCurrency` (e.g. `PEN: 0.27` reads "1 PEN = 0.27
 * USD"). A code missing from the table (including the base currency itself) is
 * treated as a 1:1 rate by the normalization service.
 */
export const NormalizationConfigSchema = z.object({
	baseCurrency: z.string().length(3).default("USD"),
	exchangeRates: z
		.record(z.string(), z.number().positive())
		.default({ USD: 1.0, PEN: 0.27, EUR: 1.08 }),
});

export type NormalizationConfig = z.infer<typeof NormalizationConfigSchema>;
