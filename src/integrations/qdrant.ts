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

export type VectorPoint = Readonly<{
	id: string;
	vector: number[];
	payload: Record<string, unknown>;
}>;

export interface VectorSearchClient {
	search(request: VectorSearchRequest): Promise<VectorSearchHit[]>;
}

export interface VectorIndexClient {
	ensureCollection(collection: string, vectorSize: number): Promise<void>;
	upsert(collection: string, points: VectorPoint[]): Promise<void>;
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

export class QdrantIndexAdapter implements VectorIndexClient {
	constructor(
		private readonly client: {
			getCollection(collection: string): Promise<unknown>;
			createCollection(
				collection: string,
				options: { vectors: { size: number; distance: "Cosine" } },
			): Promise<boolean>;
			upsert(
				collection: string,
				request: {
					wait: boolean;
					points: VectorPoint[];
				},
			): Promise<unknown>;
		},
	) {}

	async ensureCollection(
		collection: string,
		vectorSize: number,
	): Promise<void> {
		try {
			const details = await this.client.getCollection(collection);
			const existingSize = this.vectorSize(details);
			if (existingSize !== undefined && existingSize !== vectorSize) {
				throw new Error(
					`Qdrant collection ${collection} expects vectors of size ${existingSize}, received ${vectorSize}`,
				);
			}
			return;
		} catch (error) {
			if (!this.isNotFound(error)) throw error;
		}
		try {
			await this.client.createCollection(collection, {
				vectors: { size: vectorSize, distance: "Cosine" },
			});
		} catch (error) {
			if (!this.isConflict(error)) throw error;
		}
	}

	async upsert(collection: string, points: VectorPoint[]): Promise<void> {
		if (points.length === 0) return;
		await this.client.upsert(collection, { wait: true, points });
	}

	private isNotFound(error: unknown): boolean {
		if (typeof error !== "object" || error === null) return false;
		const candidate = error as { status?: number; code?: number };
		return candidate.status === 404 || candidate.code === 404;
	}

	private isConflict(error: unknown): boolean {
		if (typeof error !== "object" || error === null) return false;
		const candidate = error as { status?: number; code?: number };
		return candidate.status === 409 || candidate.code === 409;
	}

	private vectorSize(value: unknown): number | undefined {
		if (typeof value !== "object" || value === null) return undefined;
		const config = (value as { config?: unknown }).config;
		if (typeof config !== "object" || config === null) return undefined;
		const params = (config as { params?: unknown }).params;
		if (typeof params !== "object" || params === null) return undefined;
		const vectors = (params as { vectors?: unknown }).vectors;
		if (typeof vectors !== "object" || vectors === null) return undefined;
		const size = (vectors as { size?: unknown }).size;
		return typeof size === "number" ? size : undefined;
	}
}
