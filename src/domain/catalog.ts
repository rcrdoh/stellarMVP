import { z } from "zod";

const ucpDescriptionSchema = z.union([
	z.string(),
	z.object({ plain: z.string().optional() }).passthrough(),
]);

const ucpPriceSchema = z
	.object({
		amount: z.number().int().nonnegative(),
		currency: z.string().min(3).max(8),
	})
	.passthrough();

export const ucpVariantSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().optional(),
		description: ucpDescriptionSchema.optional(),
		price: ucpPriceSchema.optional(),
		availability: z.unknown().optional(),
		sku: z.string().optional(),
	})
	.passthrough();

export const ucpProductSchema = z
	.object({
		id: z.string().min(1),
		handle: z.string().optional(),
		title: z.string().min(1),
		description: ucpDescriptionSchema.optional(),
		url: z.string().url().optional(),
		price_range: z
			.object({ min: ucpPriceSchema, max: ucpPriceSchema.optional() })
			.passthrough()
			.optional(),
		variants: z.array(ucpVariantSchema).default([]),
		categories: z.array(z.unknown()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export const ucpCatalogResponseSchema = z
	.object({
		ucp: z.record(z.string(), z.unknown()),
		products: z.array(ucpProductSchema),
		pagination: z
			.object({
				next: z.string().nullable().optional(),
				next_cursor: z.string().nullable().optional(),
				cursor: z.string().nullable().optional(),
				has_next_page: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
		messages: z.array(z.unknown()).optional(),
	})
	.passthrough();

const ucpServiceSchema = z
	.object({
		version: z.string().min(1),
		transport: z.string().min(1),
		endpoint: z.string().url(),
	})
	.passthrough();

export const ucpProfileSchema = z
	.object({
		ucp: z
			.object({
				version: z.string().min(1),
				services: z.record(z.string(), z.array(ucpServiceSchema)),
				capabilities: z.record(
					z.string(),
					z.array(z.record(z.string(), z.unknown())),
				),
				payment_handlers: z.record(z.string(), z.unknown()),
			})
			.passthrough(),
	})
	.passthrough();

export type UcpCatalogResponse = z.infer<typeof ucpCatalogResponseSchema>;
export type UcpProduct = z.infer<typeof ucpProductSchema>;
export type UcpProfile = z.infer<typeof ucpProfileSchema>;

export const bazaarAcceptSchema = z
	.object({
		scheme: z.string().min(1),
		network: z.string().min(1),
		amount: z.string().min(1),
		payTo: z.string().min(1),
		asset: z.string().min(1).optional(),
		maxTimeoutSeconds: z.number().int().positive().optional(),
		extra: z.record(z.string(), z.unknown()).optional(),
		resource: z.string().url().optional(),
	})
	.passthrough();

export const bazaarResourceSchema = z
	.object({
		name: z.string().min(1),
		method: z.string().min(1),
		url: z.string().url(),
		network: z.string().min(1),
		asset: z.string().min(1),
		assetSymbol: z.string().min(1),
		payTo: z.string().min(1),
		priceAtomic: z.string().min(1),
		priceUsdc: z.number().nonnegative().optional(),
		category: z.string().nullable().optional(),
		tags: z.array(z.string()).nullable().optional(),
		summary: z.string().optional(),
		accepts: z.array(bazaarAcceptSchema).optional(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
	})
	.passthrough();

export const bazaarCatalogSchema = z
	.object({
		generatedAt: z.string().optional(),
		resources: z.array(bazaarResourceSchema),
	})
	.passthrough();

export type BazaarCatalog = z.infer<typeof bazaarCatalogSchema>;
export type BazaarResource = z.infer<typeof bazaarResourceSchema>;

export type CatalogIngestionResult = Readonly<{
	jobId: string;
	status: "completed";
	merchantId: string;
	collection: string;
	products: number;
	points: number;
	completedAt: string;
}>;
