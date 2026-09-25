import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { SearchState } from "../../domain/agents/contracts.js";
import { Agent, type CompiledAgentGraph } from "./agent.js";

const SearchStateSchema = Annotation.Root({
	query: Annotation<string>,
	status: Annotation<SearchState["status"]>,
	candidateOfferIds: Annotation<string[]>,
});

export class SearchAgent extends Agent<SearchState> {
	constructor() {
		const graph = new StateGraph(SearchStateSchema)
			.addNode("initialize", () => ({}))
			.addEdge(START, "initialize")
			.addEdge("initialize", END)
			.compile({ name: "search-agent" });
		super(graph as unknown as CompiledAgentGraph<SearchState>);
	}
}
