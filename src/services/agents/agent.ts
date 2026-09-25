import type { RunnableConfig } from "@langchain/core/runnables";

export type AgentGraphState = Record<string, unknown>;

export interface CompiledAgentGraph<TState extends AgentGraphState> {
	invoke(input: TState, config?: RunnableConfig): Promise<TState>;
}

export type AgentRunOptions = {
	threadId: string;
	config?: RunnableConfig;
};

export abstract class Agent<TState extends AgentGraphState> {
	protected constructor(protected readonly graph: CompiledAgentGraph<TState>) {}

	invoke(input: TState, options: AgentRunOptions): Promise<TState> {
		return this.graph.invoke(input, {
			...options.config,
			configurable: {
				...options.config?.configurable,
				thread_id: options.threadId,
			},
		});
	}
}
