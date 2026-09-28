import type { MerchantProduct } from "../../domain/catalog/types.js";
import type { ProductOffer } from "../../domain/ranking/types.js";
import type { SearchRepository } from "./ports/search-repository.js";
import type { ProductRankingEngine } from "./ranking-engine.js";

export type RankAndPersistInput = {
	sessionId: string;
	query: string;
	topK: number;
	products: MerchantProduct[];
};

export type RankAndPersistResult = {
	sessionId: string;
	normalizedCurrency: string;
	results: ProductOffer[];
	persisted: boolean;
};

/**
 * Use case that ranks normalized candidates and hands the result off to the
 * persistence port (Module 7, Tasks 2-3). The repository is optional: when no
 * Supabase integration is configured the ranking is still returned and
 * `persisted` is reported as `false`, keeping the endpoint usable offline.
 */
export class ProductHandoffService {
	constructor(
		private readonly engine: ProductRankingEngine,
		private readonly repository: SearchRepository | null = null,
	) {}

	public get normalizedCurrency(): string {
		return this.engine.normalizedCurrency;
	}

	async rankAndPersist(
		input: RankAndPersistInput,
	): Promise<RankAndPersistResult> {
		const results = this.engine.rankCandidates(input.products, {
			sessionId: input.sessionId,
			topK: input.topK,
		});

		let persisted = false;
		if (this.repository !== null) {
			await this.repository.saveSearchSession(input.sessionId, input.query, {});
			await this.repository.saveSearchResults(input.sessionId, results);
			persisted = true;
		}

		return {
			sessionId: input.sessionId,
			normalizedCurrency: this.engine.normalizedCurrency,
			results,
			persisted,
		};
	}
}
