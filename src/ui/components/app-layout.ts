import type { CartStore } from "../stores/cart-store.js";
import type { WalletController } from "../wallet-controller.js";
import { createHeader } from "./header.js";
import { createShoppingCartDrawer } from "./shopping-cart-drawer.js";

export interface AppLayoutOptions {
	readonly walletController: WalletController;
	readonly cartStore: CartStore;
	/** Main content node (search + product stream) mounted under the header. */
	readonly main: HTMLElement;
	readonly brand?: string;
	readonly onCheckout?: (subtotal: number) => void;
}

export interface AppLayout {
	readonly element: HTMLElement;
	readonly header: HTMLElement;
	readonly cartDrawer: HTMLElement;
}

/**
 * Application shell. Composes the header and cart drawer around a caller-owned
 * `main` node so pages can swap their content without rebuilding the chrome.
 */
export function createAppLayout(options: AppLayoutOptions): AppLayout {
	const shell = document.createElement("div");
	shell.className = "min-h-screen bg-gray-950 text-gray-100 flex flex-col";

	const header = createHeader({
		walletController: options.walletController,
		cartStore: options.cartStore,
		...(options.brand === undefined ? {} : { brand: options.brand }),
	});

	const main = document.createElement("main");
	main.className = "flex-1 w-full max-w-6xl mx-auto px-6 py-6";
	main.append(options.main);

	const drawer = createShoppingCartDrawer({
		cartStore: options.cartStore,
		...(options.onCheckout === undefined
			? {}
			: { onCheckout: options.onCheckout }),
	});

	shell.append(header, main, drawer.element);

	return { element: shell, header, cartDrawer: drawer.element };
}
