import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { Env } from "../../config/env.js";
import type {
	MerchantSearchAgent,
	PaymentQuoteApprovalStore,
	ShoppingQuoteProvider,
} from "../../services/agents/ports/shopping-agent.js";
import { ShoppingAgent } from "../../services/agents/shopping-agent.js";
import { createGroqChatModel } from "./groq-chat-model.js";
import { TypesafeJevDecisionProvider } from "./typesafe-jev-decision-provider.js";

export function createShoppingAgent(options: {
	env: Env;
	checkpointer: BaseCheckpointSaver;
	merchantSearchAgent: MerchantSearchAgent;
	quoteProvider: ShoppingQuoteProvider;
	paymentQuoteApprovalStore?: PaymentQuoteApprovalStore;
}): ShoppingAgent {
	return new ShoppingAgent(options.checkpointer, {
		decisionProvider: new TypesafeJevDecisionProvider({
			apiKey: options.env.JEV_API_KEY,
			baseUrl: options.env.JEV_BASE_URL,
			model: options.env.JEV_MODEL,
		}),
		merchantSearchAgent: options.merchantSearchAgent,
		quoteProvider: options.quoteProvider,
		...(options.paymentQuoteApprovalStore === undefined
			? {}
			: { paymentQuoteApprovalStore: options.paymentQuoteApprovalStore }),
		model: createGroqChatModel({
			apiKey: options.env.GROQ_API_KEY,
			model: options.env.GROQ_MODEL,
		}),
		thresholds: {
			domainConfidence: options.env.SHOPPING_DOMAIN_CONFIDENCE_THRESHOLD,
			routeConfidence: options.env.SHOPPING_ROUTE_CONFIDENCE_THRESHOLD,
		},
	});
}
