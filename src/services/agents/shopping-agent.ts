import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
	Annotation,
	type BaseCheckpointSaver,
	Command,
	END,
	interrupt,
	MessagesAnnotation,
	START,
	StateGraph,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import {
	type MerchantOffer,
	merchantSearchResultSchema,
	quoteSnapshotSchema,
	type ShoppingDecisionSignal,
	type ShoppingIntent,
	type ShoppingResumeEvent,
	type ShoppingState,
	shoppingDecisionSignalSchema,
	shoppingIntentSchema,
	shoppingResumeEventSchema,
	shoppingStartInputSchema,
} from "../../domain/agents/contracts.js";
import { Agent, type CompiledAgentGraph } from "./agent.js";
import type {
	MerchantSearchAgent,
	ShoppingDecisionProvider,
	ShoppingQuoteProvider,
} from "./ports/shopping-agent.js";
import { stableHash } from "./stable-hash.js";

const State = Annotation.Root({
	...MessagesAnnotation.spec,
	sessionId: Annotation<string>,
	status: Annotation<ShoppingState["status"]>,
	intent: Annotation<ShoppingIntent | null>,
	candidates: Annotation<MerchantOffer[]>,
	selectedOfferId: Annotation<string | null>,
	quote: Annotation<ShoppingState["quote"]>,
	quoteHash: Annotation<string | null>,
	decisionSignal: Annotation<ShoppingDecisionSignal | null>,
	lastAssistantMessage: Annotation<string | null>,
	lastError: Annotation<string | null>,
});
type ToolCallingModel = BaseChatModel & {
	bindTools: (
		tools: readonly unknown[],
		options?: Record<string, unknown>,
	) => { invoke: (messages: unknown[]) => Promise<AIMessage> };
};

export type ShoppingAgentDependencies = {
	decisionProvider: ShoppingDecisionProvider;
	merchantSearchAgent: MerchantSearchAgent;
	quoteProvider: ShoppingQuoteProvider;
	model: BaseChatModel;
	thresholds?: { domainConfidence: number; routeConfidence: number };
	maxIterations?: number;
};

const systemPrompt =
	"Eres un asistente de compras. Usa search_merchants para conocer ofertas actuales. No inventes precios, disponibilidad ni condiciones; no afirmes que compraste ni ejecutes transacciones. Resume solo resultados de la herramienta.";
const searchArgsSchema = z
	.object({
		query: z.string().trim().min(1).max(500),
		filters: z
			.object({
				brands: z.array(z.string().trim().min(1)).max(20).optional(),
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

export class ShoppingAgent extends Agent<ShoppingState> {
	constructor(
		checkpointer: BaseCheckpointSaver,
		deps: ShoppingAgentDependencies,
	) {
		const searchTool = tool(
			async (input) => {
				const request = shoppingIntentSchema.parse(input);
				return JSON.stringify(
					merchantSearchResultSchema.parse(
						await deps.merchantSearchAgent.search(request),
					),
				);
			},
			{
				name: "search_merchants",
				description:
					"Busca ofertas actuales de comercios para la consulta y filtros del usuario.",
				schema: searchArgsSchema,
			},
		);
		const tools = [searchTool];
		const react = new StateGraph(MessagesAnnotation)
			.addNode("agent", async (state) => {
				const model = deps.model as ToolCallingModel;
				const alreadySearched = state.messages.some(
					(message) => message instanceof ToolMessage,
				);
				const bound = model.bindTools(tools, {
					parallel_tool_calls: false,
					tool_choice: alreadySearched
						? "auto"
						: { type: "function", function: { name: "search_merchants" } },
				});
				return {
					messages: [
						await bound.invoke([
							new SystemMessage(systemPrompt),
							...state.messages,
						]),
					],
				};
			})
			.addNode("tools", new ToolNode(tools))
			.addEdge(START, "agent")
			.addConditionalEdges("agent", toolsCondition, ["tools", END])
			.addEdge("tools", "agent")
			.compile({ name: "shopping-react" });

		const graph = new StateGraph(State)
			.addNode("gate", async (state) => {
				const message = String(state.messages.at(-1)?.content ?? "")
					.normalize("NFKC")
					.split("")
					.filter((character) => {
						const code = character.codePointAt(0) ?? 0;
						return code >= 0x20 && code !== 0x7f;
					})
					.join("")
					.trim()
					.slice(0, 16_000);
				if (!message)
					return {
						status: "understanding" as const,
						lastAssistantMessage: "¿Qué producto buscas?",
					};
				const intent: ShoppingIntent = shoppingIntentSchema.parse({
					query: message,
					filters: { inStock: true },
					limit: 5,
				});
				let signal: ShoppingDecisionSignal;
				try {
					signal = shoppingDecisionSignalSchema.parse(
						await deps.decisionProvider.assess({ message }),
					);
				} catch (error) {
					return {
						intent,
						status: "understanding" as const,
						lastError:
							error instanceof Error
								? error.message
								: "decision-provider-error",
						lastAssistantMessage:
							"No pude validar tu solicitud con seguridad. ¿Puedes aclarar qué producto buscas y tus requisitos principales?",
					};
				}
				const threshold = deps.thresholds ?? {
					domainConfidence: 0.85,
					routeConfidence: 0.85,
				};
				if (
					signal.domain === "out_of_domain" &&
					signal.domainConfidence >= threshold.domainConfidence
				)
					return {
						intent,
						decisionSignal: signal,
						status: "completed" as const,
						lastAssistantMessage:
							"Puedo ayudarte a encontrar productos y comparar ofertas.",
					};
				const confident =
					signal.domain === "in_domain" &&
					signal.domainConfidence >= threshold.domainConfidence &&
					signal.routeConfidence >= threshold.routeConfidence &&
					signal.evidenceSufficient &&
					!signal.requiresEscalation &&
					signal.allowedRoutes.includes(signal.routeHint);
				if (
					!confident ||
					signal.routeHint === "clarify" ||
					signal.routeHint === "reject"
				)
					return {
						intent,
						decisionSignal: signal,
						status: "understanding" as const,
						lastAssistantMessage:
							signal.routeHint === "reject"
								? "No puedo ayudar con esa solicitud."
								: "¿Qué producto buscas y qué presupuesto, marca o requisitos debo considerar?",
					};
				return {
					intent,
					decisionSignal: signal,
					status:
						signal.routeHint === "rag"
							? ("searching" as const)
							: ("completed" as const),
				};
			})
			.addNode("answer", async (state) => {
				if (
					state.status === "completed" &&
					state.decisionSignal?.routeHint === "llm"
				) {
					try {
						const response = await deps.model.invoke([
							new SystemMessage(
								"Responde en español sobre compras. No afirmes datos actuales de comercios ni ejecutes compras.",
							),
							...state.messages,
						]);
						return {
							messages: [response],
							lastAssistantMessage: String(response.content),
							status: "completed" as const,
						};
					} catch {
						return {
							lastAssistantMessage:
								"No pude responder ahora. Inténtalo de nuevo.",
							status: "failed" as const,
						};
					}
				}
				return {
					messages: [
						new AIMessage(
							state.lastAssistantMessage ?? "¿Puedes aclarar tu solicitud?",
						),
					],
				};
			})
			.addNode("react", async (state) => {
				try {
					const result = await react.invoke(
						{ messages: state.messages },
						{ recursionLimit: deps.maxIterations ?? 8 },
					);
					const toolResult = [...result.messages]
						.reverse()
						.find((message) => message instanceof ToolMessage);
					const offers = toolResult
						? merchantSearchResultSchema.parse(
								JSON.parse(String(toolResult.content)),
							).offers
						: [];
					const finalMessage = [...result.messages]
						.reverse()
						.find(
							(message) =>
								message instanceof AIMessage && !message.tool_calls?.length,
						);
					return {
						messages: result.messages.slice(state.messages.length),
						candidates: offers,
						status: offers.length
							? ("awaiting_selection" as const)
							: ("completed" as const),
						lastAssistantMessage: offers.length
							? "Encontré opciones. Selecciona una oferta para solicitar la cotización."
							: String(
									finalMessage?.content ??
										"No encontré ofertas para esos criterios.",
								),
					};
				} catch (error) {
					return {
						status: "failed" as const,
						lastError: error instanceof Error ? error.message : "search-error",
						lastAssistantMessage:
							"No pude completar la búsqueda. Puedes intentarlo de nuevo.",
					};
				}
			})
			.addNode("selection", async (state) => {
				const event = shoppingResumeEventSchema.parse(
					interrupt({ type: "select_offer", offers: state.candidates }),
				);
				if (event.type !== "select_offer")
					throw new Error("Expected an offer selection");
				if (!state.intent) throw new Error("Shopping intent is missing");
				const selectedOffer = state.candidates.find(
					(offer) => offer.offerId === event.offerId,
				);
				if (!selectedOffer)
					throw new Error(
						"Selected offer is not available in this shopping session",
					);
				const quote = await deps.quoteProvider.createQuote({
					sessionId: state.sessionId,
					intent: state.intent,
					offerId: event.offerId,
					quantity: 1,
				});
				const validatedQuote = quoteSnapshotSchema.parse(quote);
				if (
					validatedQuote.offer.offerId !== selectedOffer.offerId ||
					validatedQuote.offer.merchantId !== selectedOffer.merchantId ||
					validatedQuote.currency !== selectedOffer.currency ||
					validatedQuote.totalAmountMinor <
						validatedQuote.offer.totalCostMinor ||
					Date.parse(validatedQuote.expiresAt) <= Date.now()
				)
					throw new Error(
						"Quote does not match the selected offer or is expired",
					);
				return {
					selectedOfferId: event.offerId,
					quote: validatedQuote,
					quoteHash: stableHash(validatedQuote),
					status: "awaiting_approval" as const,
				};
			})
			.addNode("approval", async (state) => {
				const event = shoppingResumeEventSchema.parse(
					interrupt({
						type: "approve_quote",
						quote: state.quote,
						quoteHash: state.quoteHash,
					}),
				);
				if (
					event.type !== "approve_quote" ||
					event.quoteId !== state.quote?.quoteId ||
					event.quoteHash !== state.quoteHash
				)
					throw new Error("Approval does not match the current quote");
				return {
					status: event.approved
						? ("authorized" as const)
						: ("cancelled" as const),
					lastAssistantMessage: event.approved
						? "Cotización aprobada. No se ha ejecutado ningún pago."
						: "Cotización rechazada.",
				};
			})
			.addConditionalEdges(
				"gate",
				(state) => (state.status === "searching" ? "react" : "answer"),
				["react", "answer"],
			)
			.addConditionalEdges(
				"react",
				(state) =>
					state.status === "awaiting_selection" ? "selection" : "answer",
				["selection", "answer"],
			)
			.addEdge("selection", "approval")
			.addEdge("approval", END)
			.addEdge("answer", END)
			.addEdge(START, "gate")
			.compile({ name: "shopping-agent", checkpointer });
		super(graph as unknown as CompiledAgentGraph<ShoppingState>);
	}

	async start(
		input: { sessionId: string; message: string },
		options: { threadId: string },
	): Promise<ShoppingState> {
		const parsed = shoppingStartInputSchema.parse(input);
		const initial = {
			sessionId: parsed.sessionId,
			status: "understanding" as const,
			intent: null,
			candidates: [],
			selectedOfferId: null,
			quote: null,
			quoteHash: null,
			decisionSignal: null,
			lastAssistantMessage: null,
			lastError: null,
			messages: [new HumanMessage(parsed.message)],
		};
		return this.graph.invoke(initial as unknown as ShoppingState, {
			configurable: { thread_id: options.threadId },
		});
	}

	async resume(
		event: ShoppingResumeEvent,
		options: { threadId: string },
	): Promise<ShoppingState> {
		shoppingResumeEventSchema.parse(event);
		return this.graph.invoke(
			new Command({ resume: event }) as unknown as ShoppingState,
			{ configurable: { thread_id: options.threadId } },
		);
	}
}
