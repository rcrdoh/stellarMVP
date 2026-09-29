import { formatMatchScore, formatUsd } from "../lib/format.js";
import type { Offer } from "../types/domain.js";

/** Offer card. React escapes text nodes automatically, so untrusted catalog
 * content can never inject markup (no `dangerouslySetInnerHTML`). */
export function ProductCard({
	offer,
	onAdd,
}: {
	offer: Offer;
	onAdd(offer: Offer): void;
}) {
	return (
		<article
			data-role="product-card"
			data-offer-id={offer.id}
			className="flex flex-col rounded-xl border border-stroke bg-panel p-5 transition-colors hover:border-emerald-stroke"
		>
			<div className="flex items-start justify-between gap-3">
				<h3 className="text-base font-semibold text-ink">{offer.title}</h3>
				<span className="shrink-0 rounded-full border border-emerald-stroke bg-emerald-container px-2 py-0.5 font-mono text-xs text-emerald-text">
					{formatMatchScore(offer.matchScore)}
				</span>
			</div>
			<p className="mt-2 line-clamp-2 text-sm text-muted">
				{offer.description}
			</p>
			<p className="mt-3 font-mono text-xs text-muted">
				{offer.merchant} · {offer.category}
			</p>
			<div className="mt-5 flex items-center justify-between gap-3">
				<span className="font-mono text-lg text-ink">
					{formatUsd(offer.price)}
				</span>
				<button
					type="button"
					data-role="add-to-cart"
					disabled={!offer.inStock}
					onClick={() => onAdd(offer)}
					className="rounded-lg bg-emerald px-4 py-2 text-sm font-semibold text-[color:var(--btn-primary-fg)] transition-colors hover:bg-emerald-hover disabled:cursor-not-allowed disabled:opacity-40"
				>
					{offer.inStock ? "Add to cart" : "Out of stock"}
				</button>
			</div>
		</article>
	);
}
