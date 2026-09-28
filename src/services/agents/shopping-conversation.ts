import {
	type ShoppingConversationTurn,
	type ShoppingState,
	shoppingStateSchema,
} from "../../domain/agents/contracts.js";
import type { ShoppingAgent } from "./shopping-agent.js";

/**
 * Thin use-case around the composed {@link ShoppingAgent}. It owns the
 * turn-to-graph translation and re-validates the graph output with the public
 * `shoppingStateSchema` so no internal state leaks past the HTTP boundary.
 *
 * Deliberately depends on the `ShoppingAgent` port, not on any transport or
 * provider SDK, mirroring the other agent services.
 */
export class AgentShoppingConversationService {
	constructor(private readonly agent: ShoppingAgent) {}

	async advance(turn: ShoppingConversationTurn): Promise<ShoppingState> {
		const state =
			turn.type === "start"
				? await this.agent.start(turn.input, { threadId: turn.threadId })
				: await this.agent.resume(turn.event, { threadId: turn.threadId });
		return shoppingStateSchema.parse(state);
	}
}
