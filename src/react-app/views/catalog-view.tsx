import { useState } from "react";
import { ProblemBanner } from "../components/problem-banner.js";
import { ProductCard } from "../components/product-card.js";
import { SearchForm } from "../components/search-form.js";
import { ProductGridSkeleton } from "../components/skeleton.js";
import { useCart } from "../context/cart-context.js";
import { useClients } from "../context/client-context.js";
import { ApiError } from "../lib/api.js";
import type { Offer } from "../types/domain.js";
import type { ProblemDetails } from "../types/problem.js";

function toProblem(cause: unknown): ProblemDetails {
	if (cause instanceof ApiError) {
		return cause.problem;
	}
	return {
		type: "about:blank",
		title: cause instanceof Error ? cause.message : "Search failed",
		status: 500,
		code: "SVC-CORE-5000",
		category: "INTERNAL",
	};
}

/** Marketplace view: search the agent catalog and add offers to the cart. */
export function CatalogView() {
	const { catalog } = useClients();
	const cart = useCart();
	const [offers, setOffers] = useState<Offer[]>([]);
	const [problem, setProblem] = useState<ProblemDetails | null>(null);
	const [busy, setBusy] = useState(false);
	const [searched, setSearched] = useState(false);

	async function runSearch(query: string) {
		setBusy(true);
		setProblem(null);
		try {
			const results = await catalog.search(
				query.length > 0 ? { queryText: query } : {},
			);
			setOffers(results);
		} catch (cause) {
			setOffers([]);
			setProblem(toProblem(cause));
		} finally {
			setBusy(false);
			setSearched(true);
		}
	}

	return (
		<section className="mx-auto w-full max-w-6xl px-4 py-8">
			<div className="mb-6">
				<h1 className="text-2xl font-bold tracking-tight text-ink">
					Agentic marketplace
				</h1>
				<p className="mt-1 text-sm text-muted">
					Search offers across merchants, then settle the cart in USDC on
					Stellar.
				</p>
			</div>

			<SearchForm onSearch={runSearch} busy={busy} />

			<div className="mt-6">
				{busy && <ProductGridSkeleton />}

				{!busy && problem !== null && <ProblemBanner problem={problem} />}

				{!busy && problem === null && offers.length === 0 && searched && (
					<p data-role="empty" className="text-sm text-muted">
						No offers matched. Try a broader query.
					</p>
				)}

				{!busy && offers.length > 0 && (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
						{offers.map((offer) => (
							<ProductCard
								key={offer.id}
								offer={offer}
								onAdd={(next) => cart.dispatch({ type: "add", offer: next })}
							/>
						))}
					</div>
				)}

				{!busy && !searched && (
					<p className="text-sm text-muted">
						Run a search to load offers from the agent catalog.
					</p>
				)}
			</div>
		</section>
	);
}
