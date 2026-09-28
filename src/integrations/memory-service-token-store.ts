import { createHash } from "node:crypto";
import {
	type ServiceTokenMetadata,
	ServiceTokenMetadataSchema,
} from "../domain/checkout/types.js";
import { SpendCapExceededError } from "../domain/errors.js";
import type { ServiceTokenStore } from "../services/agents/ports/service-token-store.js";

/**
 * Deterministic in-memory service-token registry. It is the default adapter for
 * tests and offline runs; the ledger mutation is synchronous within the event
 * loop turn, so `reserveSpend` behaves atomically for a single process, which is
 * the anomaly the checkout firewall (Audit H2) must prevent in unit tests.
 */
export class MemoryServiceTokenStore implements ServiceTokenStore {
	readonly #tokens = new Map<string, ServiceTokenMetadata>();

	register(token: string, metadata: Partial<ServiceTokenMetadata>): void {
		const parsed = ServiceTokenMetadataSchema.parse({
			tokenHash: createHash("sha256").update(token).digest("hex"),
			scopes: [],
			...metadata,
		});
		this.#tokens.set(parsed.tokenHash, parsed);
	}

	async findByToken(token: string): Promise<ServiceTokenMetadata | null> {
		return this.#tokens.get(hash(token)) ?? null;
	}

	async reserveSpend(
		token: string,
		amountAtomic: number,
	): Promise<ServiceTokenMetadata> {
		const key = hash(token);
		const current = this.#tokens.get(key);
		if (current === null || current === undefined) {
			throw new SpendCapExceededError(0, amountAtomic);
		}
		const nextSpend = current.spentAtomic + amountAtomic;
		if (current.maxSpendAtomic !== null && nextSpend > current.maxSpendAtomic) {
			throw new SpendCapExceededError(current.maxSpendAtomic, nextSpend);
		}
		const next: ServiceTokenMetadata = { ...current, spentAtomic: nextSpend };
		this.#tokens.set(key, next);
		return next;
	}
}

function hash(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}
