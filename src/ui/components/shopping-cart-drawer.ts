import { requireElement } from "../dom.js";
import type { CartStore } from "../stores/cart-store.js";

export interface ShoppingCartDrawerOptions {
	readonly cartStore: CartStore;
	/** Invoked when the shopper confirms the locked cart. */
	readonly onCheckout?: (subtotal: number) => void;
}

export interface ShoppingCartDrawer {
	readonly element: HTMLElement;
	/** Syncs visibility + line items with the current store snapshot. */
	render(): void;
}

/**
 * Slide-over cart drawer. Subscribes to `cart-updated` so it stays in sync with
 * the store regardless of which component mutated it, and renders a locked
 * subtotal the checkout flow must honor.
 */
export function createShoppingCartDrawer(
	options: ShoppingCartDrawerOptions,
): ShoppingCartDrawer {
	const { cartStore } = options;

	const backdrop = document.createElement("div");
	backdrop.className = "fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden";
	backdrop.dataset.role = "cart-backdrop";

	const drawer = document.createElement("aside");
	drawer.className =
		"fixed right-0 top-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col translate-x-full transition-transform duration-200";
	drawer.setAttribute("role", "dialog");
	drawer.setAttribute("aria-label", "Shopping cart");

	drawer.innerHTML = `
		<header class="flex items-center justify-between px-5 py-4 border-b border-gray-800">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-gray-200">Your Cart</h2>
			<button type="button" data-role="cart-close" class="text-gray-400 hover:text-gray-200 text-sm">Close</button>
		</header>
		<ul data-role="cart-items" class="flex-1 overflow-y-auto divide-y divide-gray-800"></ul>
		<footer class="px-5 py-4 border-t border-gray-800 space-y-3">
			<div class="flex justify-between text-sm text-gray-300">
				<span>Subtotal (locked)</span>
				<span data-role="cart-subtotal" class="font-bold text-emerald-400">0</span>
			</div>
			<button type="button" data-role="cart-checkout" class="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-lg text-sm font-medium transition">
				Checkout
			</button>
		</footer>
	`;

	backdrop.append(drawer);

	const itemsList = requireElement<HTMLUListElement>(
		drawer,
		'[data-role="cart-items"]',
	);
	const subtotalEl = requireElement<HTMLElement>(
		drawer,
		'[data-role="cart-subtotal"]',
	);
	const checkoutBtn = requireElement<HTMLButtonElement>(
		drawer,
		'[data-role="cart-checkout"]',
	);

	const render = (): void => {
		const snapshot = cartStore.snapshot();
		backdrop.classList.toggle("hidden", !snapshot.isOpen);
		drawer.classList.toggle("translate-x-full", !snapshot.isOpen);
		subtotalEl.textContent = String(snapshot.subtotal);
		checkoutBtn.disabled = snapshot.items.length === 0;

		const rows = snapshot.items.map((item) => {
			const row = document.createElement("li");
			row.className = "px-5 py-3 flex items-start justify-between gap-3";
			row.dataset.productId = item.id;

			const info = document.createElement("div");
			const title = document.createElement("p");
			title.className = "text-sm text-gray-100";
			title.textContent = item.title;
			const merchant = document.createElement("p");
			merchant.className = "text-xs text-gray-400 mt-0.5";
			merchant.textContent = item.merchant;
			info.append(title, merchant);

			const right = document.createElement("div");
			right.className = "flex items-center gap-3 shrink-0";
			const price = document.createElement("span");
			price.className = "text-sm font-semibold text-emerald-400";
			price.textContent = `${item.price} ${item.currency}`;
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "text-xs text-gray-400 hover:text-red-400";
			remove.textContent = "Remove";
			remove.addEventListener("click", () => cartStore.remove(item.id));
			right.append(price, remove);

			row.append(info, right);
			return row;
		});

		itemsList.replaceChildren(...rows);
	};

	drawer
		.querySelector('[data-role="cart-close"]')
		?.addEventListener("click", () => cartStore.close());
	backdrop.addEventListener("click", (event) => {
		if (event.target === backdrop) {
			cartStore.close();
		}
	});
	checkoutBtn.addEventListener("click", () => {
		if (cartStore.size > 0) {
			options.onCheckout?.(cartStore.subtotal);
		}
	});

	cartStore.addEventListener("cart-updated", render);
	render();

	return { element: backdrop, render };
}
