import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import type { AgentBudget } from "../src/domain/agents/contracts.js";
import {
	BudgetExceededError,
	BudgetTracker,
} from "../src/services/agents/budget-tracker.js";
import { SearchAgent } from "../src/services/agents/search-agent.js";
import { ShoppingAgent } from "../src/services/agents/shopping-agent.js";
import { stableHash } from "../src/services/agents/stable-hash.js";

const budget: AgentBudget = {
	maxSteps: 2,
	maxToolCalls: 1,
	maxLlmCalls: 1,
	maxRetriesPerNode: 1,
	maxWallTimeMs: 1_000,
	maxRetrievedChunks: 2,
	maxInputTokens: 100,
	maxOutputTokens: 100,
};

describe("commerce agents foundations", () => {
	test("shopping agent fails closed when Jev confidence is below its threshold", async () => {
		let searches = 0;
		const agent = new ShoppingAgent(new MemorySaver(), {
			decisionProvider: {
				assess: async () => ({
					provider: "test",
					domain: "in_domain",
					routeHint: "rag",
					allowedRoutes: ["rag"],
					domainConfidence: 0.7,
					routeConfidence: 0.99,
					riskLevel: "low",
					evidenceSufficient: true,
					requiresEscalation: false,
					modelVersion: "test",
				}),
			},
			merchantSearchAgent: {
				search: async () => {
					searches++;
					return { offers: [] };
				},
			},
			quoteProvider: {
				createQuote: async () => {
					throw new Error("not expected");
				},
			},
			model: {} as never,
		});

		const result = await agent.start(
			{ sessionId: "session-1", message: "busco una cafetera" },
			{ threadId: "thread-1" },
		);
		expect(result.lastAssistantMessage).toContain("¿Qué producto buscas");
		expect(searches).toBe(0);
	});

	test("shopping agent persists selection and quote approval pauses on the same thread", async () => {
		const offer = {
			offerId: "offer-1",
			productId: "product-1",
			merchantId: "merchant-1",
			title: "Cafetera",
			priceMinor: 12500,
			currency: "PEN",
			availability: "in_stock" as const,
			totalCostMinor: 12500,
			url: "https://merchant.example/product-1",
			fetchedAt: new Date().toISOString(),
			source: "api" as const,
		};
		let searched = 0;
		const fakeModel = {
			bindTools: () => ({
				invoke: async (_messages: unknown[]) => {
					if (searched === 0) {
						searched++;
						return new AIMessage({
							content: "",
							tool_calls: [
								{
									name: "search_merchants",
									args: {
										query: "cafetera",
										filters: { inStock: true },
										limit: 5,
									},
									id: "search-1",
								},
							],
						});
					}
					return new AIMessage("Encontré una cafetera disponible.");
				},
			}),
		} as never;
		const agent = new ShoppingAgent(new MemorySaver(), {
			decisionProvider: {
				assess: async () => ({
					provider: "test",
					domain: "in_domain",
					routeHint: "rag",
					allowedRoutes: ["rag"],
					domainConfidence: 0.99,
					routeConfidence: 0.99,
					riskLevel: "low",
					evidenceSufficient: true,
					requiresEscalation: false,
					modelVersion: "test",
				}),
			},
			merchantSearchAgent: { search: async () => ({ offers: [offer] }) },
			quoteProvider: {
				createQuote: async () => ({
					quoteId: "quote-1",
					offer,
					quantity: 1,
					totalAmountMinor: 12500,
					currency: "PEN",
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				}),
			},
			model: fakeModel,
		});
		const thread = { threadId: "purchase-thread" };
		const found = await agent.start(
			{ sessionId: "session-2", message: "busco una cafetera" },
			thread,
		);
		expect(found.status).toBe("awaiting_selection");
		expect(found.candidates).toHaveLength(1);
		const quoted = await agent.resume(
			{ type: "select_offer", offerId: "offer-1" },
			thread,
		);
		expect(quoted.status).toBe("awaiting_approval");
		expect(quoted.quoteHash).toBeTruthy();
		const quoteHash = quoted.quoteHash;
		if (!quoteHash) throw new Error("Expected a quote hash");
		const approved = await agent.resume(
			{ type: "approve_quote", quoteId: "quote-1", quoteHash, approved: true },
			thread,
		);
		expect(approved.status).toBe("authorized");
		expect(approved.lastAssistantMessage).toContain(
			"No se ha ejecutado ningún pago",
		);
	});

	test("search agent runs without requiring a persistent saver", async () => {
		const agent = new SearchAgent();
		const input = {
			query: "cafe peruano",
			status: "pending" as const,
			candidateOfferIds: [],
		};

		await expect(
			agent.invoke(input, { threadId: "search-1" }),
		).resolves.toMatchObject(input);
	});

	test("budget tracker rejects usage beyond a configured limit", () => {
		const tracker = new BudgetTracker(budget);
		tracker.consume("toolCalls");
		expect(() => tracker.consume("toolCalls")).toThrow(BudgetExceededError);
	});

	test("stable hash does not depend on object key order", () => {
		expect(stableHash({ quoteId: "q-1", amount: 1250 })).toBe(
			stableHash({ amount: 1250, quoteId: "q-1" }),
		);
	});

	test("domain contracts stay independent from orchestration and adapters", () => {
		const domain = readFileSync("src/domain/agents/contracts.ts", "utf8");
		expect(domain).not.toMatch(
			/from ["'](?:\.\.\/)+(?:services|integrations|http)\//,
		);
		expect(domain).not.toContain("@langchain/");
	});
});
