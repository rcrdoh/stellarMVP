import { randomUUID } from "node:crypto";
import { z } from "zod";

export const createItemSchema = z.object({
	name: z.string().min(1).max(120),
	metadata: z.record(z.string(), z.unknown()).default({}),
});

export const itemSchema = createItemSchema.extend({
	id: z.string().uuid(),
	created_at: z.string().datetime(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type Item = z.infer<typeof itemSchema>;

export function createItem(input: CreateItemInput): Item {
	return {
		id: randomUUID(),
		name: input.name,
		metadata: input.metadata,
		created_at: new Date().toISOString(),
	};
}
