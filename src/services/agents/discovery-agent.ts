import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
	AgentChatRequestSchema,
	type ShoppingIntent,
	ShoppingIntentSchema,
} from "../../schemas/intent.schema.js";
import {
	createLLMCircuitBreaker,
	type LLMCircuitBreaker,
} from "../../utils/circuit-breaker.js";

/**
 * Port for the unstructured-message -> structured-intent step. Keeping this as
 * an interface lets the route depend on the use case rather than on a concrete
 * LLM provider, and lets tests substitute a deterministic adapter.
 */
export interface DiscoveryIntentExtractor {
	extract(message: string): Promise<unknown>;
}

const DiscoveryState = Annotation.Root({
	message: Annotation<string>,
	intent: Annotation<ShoppingIntent | undefined>,
});

type DiscoveryStateType = typeof DiscoveryState.State;

/**
 * LangGraph-backed Discovery Agent. The graph is a single deterministic node
 * (free text in, structured intent out) wrapped by an Opossum circuit breaker
 * so a flapping upstream LLM degrades to a typed failure instead of hanging the
 * request path.
 */
export class DiscoveryAgentService {
	private readonly graph;
	private readonly breaker: LLMCircuitBreaker<ShoppingIntent>;

	constructor(options: { extractor?: DiscoveryIntentExtractor } = {}) {
		const extractor = options.extractor ?? createDefaultExtractor();
		this.breaker = createLLMCircuitBreaker(async (message: string) => {
			const raw = await extractor.extract(message);
			return ShoppingIntentSchema.parse(raw);
		});
		this.graph = this.buildGraph(this.breaker);
	}

	async invoke(
		input: { message: string },
		options: { sessionId: string },
	): Promise<ShoppingIntent> {
		// Validate the transport contract at the use-case boundary so the graph is
		// only reachable with a well-formed request.
		AgentChatRequestSchema.parse({
			sessionId: options.sessionId,
			message: input.message,
		});
		const state = await this.graph.invoke({ message: input.message });
		if (state.intent === undefined) {
			throw new Error("Discovery Agent produced no shopping intent.");
		}
		return state.intent;
	}

	private buildGraph(breaker: LLMCircuitBreaker<ShoppingIntent>) {
		return new StateGraph(DiscoveryState)
			.addNode("extractIntent", async (state: DiscoveryStateType) => {
				const intent = await breaker.fire(state.message);
				return { intent };
			})
			.addEdge(START, "extractIntent")
			.addEdge("extractIntent", END)
			.compile();
	}
}

/**
 * Default extractor. It is only used when no extractor is injected, so the
 * ChatOpenAI client (and its credential resolution) is built lazily on first
 * call rather than during construction.
 */
function createDefaultExtractor(): DiscoveryIntentExtractor {
	return {
		async extract(message: string): Promise<unknown> {
			const { ChatOpenAI } = await import("@langchain/openai");
			const model = new ChatOpenAI({
				apiKey: process.env.OPENAI_API_KEY ?? "",
				model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
				temperature: 0,
			});
			const structured = model.withStructuredOutput(ShoppingIntentSchema);
			return structured.invoke([
				{
					role: "system",
					content:
						"You are a shopping discovery assistant. Extract the user's shopping intent into the provided schema. " +
						"Set isReadyToPurchase to true only when the user clearly wants to buy now.",
				},
				{ role: "user", content: message },
			]);
		},
	};
}
