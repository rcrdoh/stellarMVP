import { createAppLayout } from "../components/app-layout.js";
import {
	createProductStream,
	type ProductSearchClient,
} from "../components/product-stream.js";
import { CartStore } from "../stores/cart-store.js";
import { WalletController } from "../wallet-controller.js";
import { createDemoSearchClient, toProblem } from "./demo-search-client.js";

export interface MountAppOptions {
	/** DOM node the shell is rendered into. Defaults to `#app`. */
	readonly container: HTMLElement;
	/** Search backend; defaults to the in-memory demo catalog. */
	readonly searchClient?: ProductSearchClient;
	readonly brand?: string;
}

export interface AppHandle {
	readonly walletController: WalletController;
	readonly cartStore: CartStore;
	readonly element: HTMLElement;
}

/**
 * Browser composition root for the Module 4 UI shell. Wires the vanilla
 * components (header, cart drawer, product stream, wallet controller) into a
 * single mounted tree. All dependencies are injected so the same function runs
 * in the browser entry below and in tests.
 */
export function mountApp(options: MountAppOptions): AppHandle {
	const cartStore = new CartStore();
	const walletController = new WalletController({ network: "TESTNET" });

	const stream = createProductStream({
		client: options.searchClient ?? createDemoSearchClient(),
		cartStore,
		toProblem,
	});

	const layout = createAppLayout({
		walletController,
		cartStore,
		main: stream.element,
		...(options.brand === undefined ? {} : { brand: options.brand }),
	});

	options.container.replaceChildren(layout.element);
	// Restore a persisted wallet session without blocking the first paint.
	void walletController.restore();

	return { walletController, cartStore, element: layout.element };
}

/** Resolves the mount node from the document, or throws if it is missing. */
export function resolveContainer(document_: Document): HTMLElement {
	const container = document_.querySelector<HTMLElement>("#app");
	if (container === null) {
		throw new Error("Mount point #app not found in document");
	}
	return container;
}

function boot(): void {
	mountApp({ container: resolveContainer(document), brand: "ChapaTuOferta" });
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
}
