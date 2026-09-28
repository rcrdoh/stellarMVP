import type { ProductOffer } from "../../../domain/ranking/types.js";

/**
 * Persistence port for the ranking handoff (Module 7, Task 3). Kept in the
 * services layer so the HTTP/use-case code depends on the interface, not on the
 * Supabase adapter, and tests can inject a deterministic in-memory store.
 */
export interface SearchRepository {
	saveSearchSession(
		sessionId: string,
		query: string,
		metadata?: Record<string, unknown>,
	): Promise<void>;
	saveSearchResults(sessionId: string, offers: ProductOffer[]): Promise<void>;
}
