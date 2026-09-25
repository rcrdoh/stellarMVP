import { z } from "zod";

export const agentStatusSchema = z.enum([
	"understanding",
	"searching",
	"awaiting_selection",
	"quoting",
	"awaiting_approval",
	"authorized",
	"completed",
	"failed",
	"cancelled",
]);

export const shoppingIntentSchema = z
	.object({
		query: z.string().trim().min(1).max(500),
		filters: z
			.object({
				brands: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
				maxPriceMinor: z.number().int().positive().optional(),
				currency: z
					.string()
					.regex(/^[A-Z]{3}$/)
					.optional(),
				destinationCountry: z.string().length(2).optional(),
				inStock: z.boolean().default(true),
			})
			.strict()
			.default({ inStock: true }),
		limit: z.number().int().min(1).max(10).default(5),
	})
	.strict();
export type ShoppingIntent = z.infer<typeof shoppingIntentSchema>;

export const merchantOfferSchema = z
	.object({
		offerId: z.string().min(1),
		productId: z.string().min(1),
		merchantId: z.string().min(1),
		title: z.string().min(1).max(500),
		description: z.string().max(4000).optional(),
		brand: z.string().max(200).optional(),
		model: z.string().max(200).optional(),
		priceMinor: z.number().int().nonnegative(),
		currency: z.string().regex(/^[A-Z]{3}$/),
		availability: z.enum(["in_stock", "out_of_stock", "limited", "unknown"]),
		totalCostMinor: z.number().int().nonnegative(),
		url: z.string().url(),
		fetchedAt: z.string().datetime(),
		source: z.enum(["ucp", "catalog", "api", "scraper"]),
	})
	.strict();
export type MerchantOffer = z.infer<typeof merchantOfferSchema>;

export const merchantSearchResultSchema = z
	.object({ offers: z.array(merchantOfferSchema).max(10) })
	.strict();
export type MerchantSearchResult = z.infer<typeof merchantSearchResultSchema>;

export const quoteSnapshotSchema = z
	.object({
		quoteId: z.string().min(1),
		offer: merchantOfferSchema,
		quantity: z.number().int().positive().max(20),
		totalAmountMinor: z.number().int().nonnegative(),
		currency: z.string().regex(/^[A-Z]{3}$/),
		expiresAt: z.string().datetime(),
	})
	.strict();
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;

export const shoppingDecisionSignalSchema = z
	.object({
		provider: z.string().min(1),
		domain: z.enum(["in_domain", "out_of_domain", "ambiguous"]),
		routeHint: z.enum(["llm", "rag", "clarify", "reject"]),
		allowedRoutes: z.array(z.enum(["llm", "rag", "clarify", "reject"])).min(1),
		domainConfidence: z.number().min(0).max(1),
		routeConfidence: z.number().min(0).max(1),
		riskLevel: z.enum(["low", "medium", "high", "critical"]),
		evidenceSufficient: z.boolean(),
		requiresEscalation: z.boolean(),
		modelVersion: z.string().min(1),
	})
	.strict();
export type ShoppingDecisionSignal = z.infer<
	typeof shoppingDecisionSignalSchema
>;

export const shoppingStateSchema = z.object({
	sessionId: z.string().min(1),
	status: agentStatusSchema,
	intent: shoppingIntentSchema.nullable(),
	candidates: z.array(merchantOfferSchema),
	selectedOfferId: z.string().nullable(),
	quote: quoteSnapshotSchema.nullable(),
	quoteHash: z.string().nullable(),
	decisionSignal: shoppingDecisionSignalSchema.nullable(),
	lastAssistantMessage: z.string().nullable(),
	lastError: z.string().nullable(),
});
export type ShoppingState = z.infer<typeof shoppingStateSchema>;

export const shoppingStartInputSchema = z
	.object({
		sessionId: z.string().min(1),
		message: z.string().min(1).max(16_000),
	})
	.strict();
export type ShoppingStartInput = z.infer<typeof shoppingStartInputSchema>;

export const shoppingResumeEventSchema = z.discriminatedUnion("type", [
	z
		.object({ type: z.literal("select_offer"), offerId: z.string().min(1) })
		.strict(),
	z
		.object({
			type: z.literal("approve_quote"),
			quoteId: z.string().min(1),
			quoteHash: z.string().min(1),
			approved: z.boolean(),
		})
		.strict(),
]);
export type ShoppingResumeEvent = z.infer<typeof shoppingResumeEventSchema>;

export const productSearchRequestSchema = shoppingIntentSchema;
export type ProductSearchRequest = ShoppingIntent;

export const searchStateSchema = z.object({
	query: z.string().min(1),
	status: z.enum(["pending", "searching", "completed", "failed"]),
	candidateOfferIds: z.array(z.string()),
});
export type SearchState = z.infer<typeof searchStateSchema>;

export const quoteApprovalSchema = z.object({
	approvalId: z.string().min(1),
	quoteId: z.string().min(1),
	quoteHash: z.string().min(1),
	userId: z.string().min(1),
	expiresAt: z.string().datetime(),
	consumedAt: z.string().datetime().nullable(),
	decision: z.enum(["pending", "approved", "rejected"]),
});
export type QuoteApproval = z.infer<typeof quoteApprovalSchema>;

export type AgentBudget = Readonly<{
	maxSteps: number;
	maxToolCalls: number;
	maxLlmCalls: number;
	maxRetriesPerNode: number;
	maxWallTimeMs: number;
	maxRetrievedChunks: number;
	maxInputTokens: number;
	maxOutputTokens: number;
}>;
