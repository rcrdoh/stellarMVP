import { z } from "zod";

/**
 * Narrow schema for the free-text shopping intent extracted by the Discovery
 * Agent (`POST /v1/agent/chat`). It is intentionally distinct from the
 * structured `shoppingIntentSchema` used by the Shopping Agent graph: here the
 * model fills best-effort criteria from an unstructured user message.
 */
export const ShoppingIntentSchema = z.object({
	rawQuery: z.string().min(1, "Query cannot be empty"),
	category: z.string().optional(),
	keywords: z.array(z.string()).default([]),
	maxPrice: z.number().positive().optional(),
	currency: z.string().default("USD"),
	specifications: z.record(z.string(), z.string()).default({}),
	preferredBrands: z.array(z.string()).default([]),
	isReadyToPurchase: z.boolean().default(false),
});

export type ShoppingIntent = z.infer<typeof ShoppingIntentSchema>;

export const AgentChatRequestSchema = z.object({
	sessionId: z.string().uuid(),
	message: z.string().min(1, "Message is required"),
});

export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>;
