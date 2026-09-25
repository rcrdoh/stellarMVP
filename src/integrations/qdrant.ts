import type CircuitBreaker from "opossum";
import type { CircuitBreakerOptions } from "./circuit-breaker.js";
import { withCircuitBreaker } from "./circuit-breaker.js";

export type VectorSearchRequest = Readonly<{
	collection: string;
	vector: number[];
	limit: number;
	filters?: Record<string, string>;
}>;

export type VectorSearchHit = Readonly<{
	id: string;
	score: number;
	payload: Record<string, unknown>;
}>;

export interface VectorSearchClient {
	search(request: VectorSearchRequest): Promise<VectorSearchHit[]>;
}

export class QdrantAdapter {
	private readonly breaker: CircuitBreaker<
		[VectorSearchRequest],
		VectorSearchHit[]
	>;

	constructor(
		private readonly client: VectorSearchClient,
		timeouts: CircuitBreakerOptions = {},
	) {
		this.breaker = withCircuitBreaker(
			(request: VectorSearchRequest) => this.client.search(request),
			{
				timeout: timeouts.timeout ?? 10_000,
				errorThresholdPercentage: timeouts.errorThresholdPercentage ?? 50,
				resetTimeout: timeouts.resetTimeout ?? 30_000,
			},
		);
	}

	search(request: VectorSearchRequest): Promise<VectorSearchHit[]> {
		return this.breaker.fire(request);
	}
}
