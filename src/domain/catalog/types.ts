import { z } from "zod";

/**
 * Typed merchant product extracted from the vector catalog. Payloads indexed in
 * Qdrant are validated against this schema so an incompatible document fails
 * closed instead of feeding partial data into the discovery pipeline.
 */
export const MerchantProductSchema = z.object({
	id: z.string().min(1),
	merchantId: z.string().min(1),
	title: z.string().min(1),
	description: z.string(),
	price: z.number().positive(),
	currency: z.string().default("USD"),
	category: z.string(),
	inStock: z.boolean().default(true),
	/** Canonical listing URL when the merchant feed provides one. */
	url: z.string().url().optional(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	score: z.number().min(0).max(1).optional(),
});

export type MerchantProduct = z.infer<typeof MerchantProductSchema>;

/**
 * Sanitized vector query request (Audit L2). Every field that reaches the vector
 * engine or the fallback evaluator must traverse this schema first, which bounds
 * `limit` to `[1, 50]`, clamps the similarity threshold to `[0, 1]` and rejects
 * non-positive prices.
 */
export const CatalogQueryOptionsSchema = z.object({
	vector: z.array(z.number()).optional(),
	queryText: z.string().max(256).optional(),
	category: z.string().optional(),
	maxPrice: z.number().positive().optional(),
	minScore: z.number().min(0).max(1).default(0.6),
	limit: z.number().int().positive().max(50).default(10),
});

export type CatalogQueryOptions = z.infer<typeof CatalogQueryOptionsSchema>;

/**
 * Caller-supplied shape of a catalog query, before Zod applies defaults. Consumers
 * (services, adapters) accept this input type so `limit` and `minScore` may be
 * omitted; the schema fills defaults and enforces bounds at parse time.
 */
export type CatalogQueryInput = z.input<typeof CatalogQueryOptionsSchema>;
