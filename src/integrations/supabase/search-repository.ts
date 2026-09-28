import type { ProductOffer } from "../../domain/ranking/types.js";
import type { SearchRepository } from "../../services/agents/ports/search-repository.js";

/**
 * Minimal structural view of the Supabase PostgREST client so the adapter
 * depends on behaviour, not on the concrete `@supabase/supabase-js` type.
 */
export type SupabaseClientLike = {
	from(table: string): SupabaseTableLike;
};

export type SupabaseTableLike = {
	insert(values: Record<string, unknown> | Record<string, unknown>[]): {
		select(columns?: string): PromiseLike<{
			data: unknown;
			error: { message: string } | null;
		}>;
	} & PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const DEFAULT_TTL_SECONDS = 900;

/**
 * Supabase-backed handoff adapter (Module 7, Task 3).
 *
 * It persists the ranking outcome into the production schema defined by
 * `20260928120000_agent_commerce_schema.sql`:
 *
 * - `search_sessions(session_id, principal_id, query, filters, status)`
 * - `search_results(search_result_id, session_id, product_ranked_id,
 *   price_snapshot, currency, ttl_seconds, expires_at)`
 *
 * Note: `search_results.product_ranked_id` is `NOT NULL` and references
 * `products_ranked`, so each offer must be backed by an already-persisted ranked
 * product row. Offers declare it through `metadata.productRankedId`; when it is
 * missing the adapter fails loudly instead of writing an orphan row.
 */
export class SupabaseSearchRepository implements SearchRepository {
	constructor(
		private readonly client: SupabaseClientLike,
		private readonly principalId: string,
		private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
	) {}

	async saveSearchSession(
		sessionId: string,
		query: string,
		metadata: Record<string, unknown> = {},
	): Promise<void> {
		const { error } = await this.client
			.from("search_sessions")
			.insert({
				session_id: sessionId,
				principal_id: this.principalId,
				query,
				filters: metadata,
			})
			.select("session_id");
		if (error) {
			throw new Error(`search_sessions insert failed: ${error.message}`);
		}
	}

	async saveSearchResults(
		sessionId: string,
		offers: ProductOffer[],
	): Promise<void> {
		if (offers.length === 0) {
			return;
		}

		const rows = offers.map((offer) => ({
			session_id: sessionId,
			product_ranked_id: this.requireRankedId(offer),
			price_snapshot: this.snapshotFor(offer),
			currency: offer.normalizedCurrency,
			ttl_seconds: this.ttlSeconds,
		}));

		const { error } = await this.client
			.from("search_results")
			.insert(rows)
			.select("search_result_id");
		if (error) {
			throw new Error(`search_results insert failed: ${error.message}`);
		}
	}

	private requireRankedId(offer: ProductOffer): string {
		const rankedId = offer.metadata?.productRankedId;
		if (typeof rankedId !== "string" || rankedId.length === 0) {
			throw new Error(
				`offer ${offer.id} cannot be handed off: search_results.product_ranked_id requires a persisted products_ranked row (offer.metadata.productRankedId)`,
			);
		}
		return rankedId;
	}

	/** Immutable price snapshot stored inside `search_results.price_snapshot`. */
	private snapshotFor(offer: ProductOffer): Record<string, unknown> {
		return {
			offerId: offer.id,
			merchantId: offer.merchantId,
			title: offer.title,
			url: offer.url,
			originalPrice: offer.originalPrice,
			originalCurrency: offer.originalCurrency,
			normalizedPriceMinor: offer.normalizedPriceMinor,
			compositeScore: offer.compositeScore,
			inStock: offer.inStock,
		};
	}
}
