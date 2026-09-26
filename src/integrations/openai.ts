import type CircuitBreaker from "opossum";
import type { CircuitBreakerOptions } from "./circuit-breaker.js";
import { withCircuitBreaker } from "./circuit-breaker.js";

export interface ChatModelLike {
	invoke(input: string): Promise<{ content: unknown }>;
}

export interface EmbeddingsLike {
	embedQuery(text: string): Promise<number[]>;
}

export interface DocumentEmbeddingsLike {
	embedDocuments(texts: string[]): Promise<number[][]>;
}

export type OpenAITimeouts = CircuitBreakerOptions;

export class OpenAIAdapter {
	private readonly chatBreaker: CircuitBreaker<[string], { content: unknown }>;
	private readonly embeddingBreaker: CircuitBreaker<[string], number[]>;

	constructor(
		private readonly chatModel: ChatModelLike,
		private readonly embeddings: EmbeddingsLike,
		timeouts: OpenAITimeouts = {},
	) {
		const options: CircuitBreakerOptions = {
			timeout: timeouts.timeout ?? 10_000,
			errorThresholdPercentage: timeouts.errorThresholdPercentage ?? 50,
			resetTimeout: timeouts.resetTimeout ?? 30_000,
		};
		this.chatBreaker = withCircuitBreaker(
			(input: string) => this.chatModel.invoke(input),
			options,
		);
		this.embeddingBreaker = withCircuitBreaker(
			(text: string) => this.embeddings.embedQuery(text),
			options,
		);
	}

	invokeChat(input: string): Promise<{ content: unknown }> {
		return this.chatBreaker.fire(input);
	}

	embedQuery(text: string): Promise<number[]> {
		return this.embeddingBreaker.fire(text);
	}

	embedDocuments(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((text) => this.embedQuery(text)));
	}
}
