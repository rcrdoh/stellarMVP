import { truncateAddress } from "../../domain/wallets/contracts.js";
import { requireElement } from "../dom.js";
import type { CartStore } from "../stores/cart-store.js";
import type { WalletController } from "../wallet-controller.js";

export interface HeaderOptions {
	readonly walletController: WalletController;
	readonly cartStore: CartStore;
	readonly brand?: string;
}

/**
 * Global sticky header: brand, reactive cart badge and wallet controls. It
 * re-renders the wallet slot on every `wallet-*` event so connection errors and
 * the connecting state are always reflected.
 */
export function createHeader(options: HeaderOptions): HTMLElement {
	const { walletController, cartStore, brand = "ChapaTuOferta" } = options;

	const header = document.createElement("header");
	header.className =
		"w-full border-b border-gray-800 bg-gray-900/90 backdrop-blur px-6 py-3.5 flex justify-between items-center sticky top-0 z-40";

	header.innerHTML = `
		<div class="flex items-center gap-3">
			<span class="brand text-lg font-bold tracking-tight text-emerald-400"></span>
			<span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
				Agentic Commerce
			</span>
		</div>
		<div class="flex items-center gap-3">
			<button type="button" data-role="cart-toggle" class="relative px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs font-medium border border-gray-700 transition flex items-center gap-1.5">
				<span>Cart</span>
				<span data-role="cart-badge" class="bg-emerald-500 text-gray-950 font-bold rounded-full px-1.5 text-[10px]">0</span>
			</button>
			<div data-role="wallet-slot"></div>
		</div>
	`;

	requireElement(header, ".brand").textContent = brand;
	const badge = requireElement<HTMLElement>(header, '[data-role="cart-badge"]');
	const cartToggle = requireElement(header, '[data-role="cart-toggle"]');
	const walletSlot = requireElement<HTMLElement>(
		header,
		'[data-role="wallet-slot"]',
	);

	const syncBadge = (): void => {
		badge.textContent = String(cartStore.size);
	};
	cartToggle.addEventListener("click", () => cartStore.toggle());
	cartStore.addEventListener("cart-updated", syncBadge);
	syncBadge();

	const renderWallet = (): void => {
		walletSlot.replaceChildren();
		const session = walletController.currentSession;

		if (session !== null) {
			const wrapper = document.createElement("div");
			wrapper.className = "flex items-center gap-2";

			const label = document.createElement("span");
			label.className =
				"text-xs bg-emerald-950 text-emerald-300 border border-emerald-800 px-3 py-1.5 rounded-lg font-mono";
			label.textContent = `${truncateAddress(session.address)} (${session.walletId})`;

			const disconnect = document.createElement("button");
			disconnect.type = "button";
			disconnect.className =
				"text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition";
			disconnect.textContent = "Disconnect";
			disconnect.addEventListener("click", () => {
				void walletController.disconnect();
			});

			wrapper.append(label, disconnect);
			walletSlot.append(wrapper);
			return;
		}

		const wrapper = document.createElement("div");
		wrapper.className = "flex flex-col items-end gap-1";

		const connect = document.createElement("button");
		connect.type = "button";
		connect.disabled = walletController.connecting;
		connect.className =
			"px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white font-medium text-xs rounded-lg transition shadow-sm";
		connect.textContent = walletController.connecting
			? "Connecting..."
			: "Connect Freighter";
		connect.addEventListener("click", () => {
			void walletController.connect();
		});
		wrapper.append(connect);

		const error = walletController.lastError;
		if (error !== null) {
			const errorEl = document.createElement("span");
			errorEl.className = "text-[10px] text-red-400";
			errorEl.textContent = error;
			wrapper.append(errorEl);
		}

		walletSlot.append(wrapper);
	};

	walletController.addEventListener("wallet-changed", renderWallet);
	walletController.addEventListener("wallet-connecting", renderWallet);
	walletController.addEventListener("wallet-error", renderWallet);
	renderWallet();

	return header;
}
