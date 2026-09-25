import { z } from "zod";

export const agentSearchQuerySchema = z
	.object({
		query: z.string().min(1).max(500),
		limit: z.number().int().min(1).max(50).default(10),
		filters: z.record(z.string(), z.string()).optional(),
	})
	.strict();

export const agentSearchResultSchema = z.object({
	id: z.string(),
	score: z.number(),
	payload: z.record(z.string(), z.unknown()),
});

export const agentSearchResponseSchema = z.object({
	results: z.array(agentSearchResultSchema),
	count: z.number().int().min(0),
});

export const agentCheckoutRequestSchema = z
	.object({
		itemId: z.string().uuid(),
		amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
		currency: z.string().min(1).max(12),
		destination: z.string().min(1).max(128),
		idempotencyKey: z.string().min(1).max(128).optional(),
	})
	.strict();

export const orderStatusSchema = z.enum([
	"pending_payment",
	"paid",
	"failed",
	"fulfilled",
]);

export const orderSchema = z.object({
	id: z.string().uuid(),
	itemId: z.string().uuid(),
	amount: z.string(),
	currency: z.string(),
	status: orderStatusSchema,
	transactionHash: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export type AgentSearchQuery = z.infer<typeof agentSearchQuerySchema>;
export type AgentSearchResult = z.infer<typeof agentSearchResultSchema>;
export type AgentSearchResponse = z.infer<typeof agentSearchResponseSchema>;
export type AgentCheckoutRequest = z.infer<typeof agentCheckoutRequestSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type Order = z.infer<typeof orderSchema>;

export function toOrder(input: {
	id: string;
	itemId: string;
	amount: string;
	currency: string;
	status: OrderStatus;
	transactionHash: string | null;
	createdAt: string;
}): Order {
	return {
		id: input.id,
		itemId: input.itemId,
		amount: input.amount,
		currency: input.currency,
		status: input.status,
		transactionHash: input.transactionHash,
		createdAt: input.createdAt,
	};
}
