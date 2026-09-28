import { z } from "zod";
import { MerchantProductSchema } from "../domain/catalog/types.js";
import { ProductOfferSchema } from "../domain/ranking/types.js";

/**
 * HTTP request body for `POST /v1/agent/products/rank` (Module 7). The engine
 * de-duplicates, normalizes and ranks the caller-supplied candidates, so the
 * request carries the raw `MerchantProduct[]` plus ranking parameters. `topK`
 * is bounded to `[1, 10]` and `sessionId` must be a UUID so the persistence
 * handoff can key on `search_sessions.session_id`.
 */
export const ProductRankingRequestSchema = z.object({
	sessionId: z.string().uuid(),
	products: z.array(MerchantProductSchema).min(1).max(100),
	query: z.string().max(256).default(""),
	topK: z.number().int().min(1).max(10).default(5),
	baseCurrency: z.string().length(3).default("USD"),
});

export type ProductRankingRequest = z.infer<typeof ProductRankingRequestSchema>;

export const ProductRankingResponseSchema = z.object({
	sessionId: z.string().uuid(),
	normalizedCurrency: z.string().length(3),
	results: z.array(ProductOfferSchema),
	count: z.number().int().min(0),
	persisted: z.boolean(),
});

export type ProductRankingResponse = z.infer<
	typeof ProductRankingResponseSchema
>;
