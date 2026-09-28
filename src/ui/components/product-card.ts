import { requireElement } from "../dom.js";
import type { CartStore, ProductOffer } from "../stores/cart-store.js";

/**
 * Candidate product card. Renders untrusted catalog text via `textContent`
 * (never `innerHTML`) to avoid injecting merchant-controlled markup, and emits
 * the offer into the cart store when the shopper accepts it.
 */
export function createProductCard(
	product: ProductOffer,
	cartStore: CartStore,
): HTMLElement {
	const card = document.createElement("article");
	card.className =
		"bg-gray-800/60 border border-gray-700/80 hover:border-emerald-500/50 rounded-xl p-4 flex flex-col justify-between transition shadow-sm";
	card.dataset.productId = product.id;

	const matchPercent = Math.round(product.score * 100);

	card.innerHTML = `
		<div>
			<div class="flex justify-between items-start gap-2 mb-2">
				<h3 class="product-title font-semibold text-gray-100 text-base leading-snug"></h3>
				<span class="match-badge text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded shrink-0">
					${matchPercent}% match
				</span>
			</div>
			<p class="text-xs text-gray-400 mb-4">
				Merchant: <span class="merchant-name text-gray-300"></span>
			</p>
		</div>
		<div class="flex items-center justify-between mt-2 pt-3 border-t border-gray-700/50">
			<span class="product-price text-lg font-bold text-emerald-400">${product.price} ${product.currency}</span>
			<button type="button" class="add-to-cart px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-xs transition">
				Add to Cart
			</button>
		</div>
	`;

	requireElement(card, ".product-title").textContent = product.title;
	requireElement(card, ".merchant-name").textContent = product.merchant;
	requireElement(card, ".add-to-cart").addEventListener("click", () =>
		cartStore.add(product),
	);

	return card;
}
