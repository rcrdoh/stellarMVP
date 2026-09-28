import { z } from "zod";
import {
	CatalogQueryOptionsSchema,
	MerchantProductSchema,
} from "../domain/catalog/types.js";

/**
 * HTTP request body for `POST /v1/agent/catalog/search`. It reuses the domain
 * `CatalogQueryOptionsSchema` so the same strict bounds (limit, minScore, price)
 * apply to both the transport and the vector engine (Audit L2). At least one
 * retrieval key — `queryText` or `vector` — must be provided.
 */
export const CatalogSearchRequestSchema = CatalogQueryOptionsSchema.refine(
	(value) => Boolean(value.queryText) || Boolean(value.vector?.length),
	{ message: "queryText or vector is required" },
);

export type CatalogSearchRequest = z.infer<typeof CatalogSearchRequestSchema>;

/** Sanitized merchant product returned by the catalog search endpoint. */
export const CatalogSearchResultSchema = MerchantProductSchema;

export type CatalogSearchResult = z.infer<typeof CatalogSearchResultSchema>;

export const CatalogSearchResponseSchema = z.object({
	results: z.array(CatalogSearchResultSchema),
	count: z.number().int().min(0),
	fallback: z.boolean().default(false),
});

export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;
