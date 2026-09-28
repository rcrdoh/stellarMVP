import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type {
	SignedTransaction,
	SignTransactionRequest,
	WalletId,
	WalletNetwork,
} from "../src/domain/wallets/contracts.js";
import { InMemoryWalletSessionStore } from "../src/integrations/wallets/in-memory-wallet-session-store.js";
import type { WalletConnector } from "../src/services/wallets/ports/wallet-connector.js";
import { createAppLayout } from "../src/ui/components/app-layout.js";
import { createProductCard } from "../src/ui/components/product-card.js";
import { createProductStream } from "../src/ui/components/product-stream.js";
import { createShoppingCartDrawer } from "../src/ui/components/shopping-cart-drawer.js";
import {
	createProductCardSkeleton,
	createProductGridSkeleton,
} from "../src/ui/components/skeleton.js";
import {
	createTransactionProgress,
	toPurchaseIntentStatus,
} from "../src/ui/components/transaction-progress.js";
import { CartStore } from "../src/ui/stores/cart-store.js";
import { WalletController } from "../src/ui/wallet-controller.js";

const ADDRESS = "GA7FYRB5VREZKOBIIKHG5AVTPFGWUBPOBTW6M7PG7NQFXBMCEIYF5XAY";

/**
 * Installs a happy-dom `document`/`window` for the current test file. The
 * native `EventTarget`/`CustomEvent` are intentionally left untouched so the
 * `EventTarget`-based stores can dispatch events the runtime understands; the
 * returned window lets tests build happy-dom events for DOM nodes.
 */
function installDom(): Window {
	const window = new Window({ url: "https://localhost/" });
	const global = globalThis as unknown as {
		window: unknown;
		document: unknown;
		HTMLElement: unknown;
	};
	global.window = window;
	global.document = window.document;
	global.HTMLElement = window.HTMLElement;
	return window;
}

/** Deterministic wallet connector so the controller never touches the SDK. */
class FakeConnector implements WalletConnector {
	readonly walletId: WalletId = "freighter";
	#available: boolean;
	#address: string | null;
	#connectError: Error | null;

	constructor(
		options: {
			available?: boolean;
			address?: string | null;
			connectError?: Error;
		} = {},
	) {
		this.#available = options.available ?? true;
		this.#address = options.address ?? ADDRESS;
		this.#connectError = options.connectError ?? null;
	}

	isAvailable(): boolean {
		return this.#available;
	}

	async connect(_network: WalletNetwork): Promise<string> {
		if (this.#connectError !== null) {
			throw this.#connectError;
		}
		if (this.#address === null) {
			throw new Error("no address");
		}
		return this.#address;
	}

	async disconnect(): Promise<void> {}

	async getAddress(): Promise<string | null> {
		return this.#address;
	}

	async signTransaction(
		_request: SignTransactionRequest,
	): Promise<SignedTransaction> {
		return { signedTxXdr: "signed-xdr" };
	}
}

function offer(id: string, price = 10) {
	return {
		id,
		title: `Product ${id}`,
		price,
		currency: "USDC",
		merchant: "merchant.example",
		score: 0.9,
	};
}

let dom: Window;

beforeEach(() => {
	dom = installDom();
});

describe("CartStore", () => {
	test("adds copies, freezes them and emits snapshots", () => {
		const store = new CartStore();
		const events: string[] = [];
		store.addEventListener("cart-updated", () => events.push("updated"));

		const source = { ...offer("a", 12) };
		store.add(source);
		// Mutating the source must not affect the frozen stored copy.
		(source as { price: number }).price = 999;

		expect(store.size).toBe(1);
		expect(store.subtotal).toBe(12);
		expect(store.items[0]?.price).toBe(12);
		expect(Object.isFrozen(store.items[0])).toBe(true);
		expect(store.isOpen).toBe(true);
		expect(events.length).toBe(1);
	});

	test("removes, clears, opens/closes and toggles", () => {
		const store = new CartStore();
		store.add(offer("a"));
		store.add(offer("b", 5));
		store.remove("a");
		expect(store.size).toBe(1);

		store.close();
		expect(store.isOpen).toBe(false);
		store.close(); // no-op, must not notify
		store.toggle();
		expect(store.isOpen).toBe(true);
		store.open();
		expect(store.isOpen).toBe(true);

		store.clear();
		expect(store.size).toBe(0);
		expect(store.subtotal).toBe(0);
	});
});

describe("product card & skeleton", () => {
	test("renders untrusted text via textContent and adds to cart on click", () => {
		const store = new CartStore();
		const product = { ...offer("x"), title: "<img src=x onerror=1>" };
		const card = createProductCard(product, store);

		expect(card.dataset.productId).toBe("x");
		expect(card.querySelector(".product-title")?.textContent).toBe(
			"<img src=x onerror=1>",
		);
		expect(
			card.querySelector(".product-title")?.querySelector("img"),
		).toBeNull();
		expect(card.querySelector(".merchant-name")?.textContent).toBe(
			"merchant.example",
		);
		expect(card.querySelector(".match-badge")?.textContent).toContain("90%");

		card.querySelector<HTMLButtonElement>(".add-to-cart")?.click();
		expect(store.size).toBe(1);
	});

	test("grid skeleton clamps count to a non-negative integer", () => {
		expect(createProductGridSkeleton(-3).children.length).toBe(0);
		expect(createProductGridSkeleton(2.9).children.length).toBe(2);
		expect(createProductCardSkeleton().getAttribute("role")).toBe("status");
	});
});

describe("shopping cart drawer", () => {
	test("reflects store snapshot, removes items and invokes checkout", () => {
		const store = new CartStore();
		const checkouts: number[] = [];
		const drawer = createShoppingCartDrawer({
			cartStore: store,
			onCheckout: (subtotal) => checkouts.push(subtotal),
		});

		const backdrop = drawer.element;
		const items = backdrop.querySelector('[data-role="cart-items"]');
		const checkout = backdrop.querySelector<HTMLButtonElement>(
			'[data-role="cart-checkout"]',
		);

		expect(backdrop.classList.contains("hidden")).toBe(true);
		expect(checkout?.disabled).toBe(true);

		store.add(offer("a", 4));
		store.add(offer("b", 6));

		expect(backdrop.classList.contains("hidden")).toBe(false);
		expect(items?.children.length).toBe(2);
		expect(
			backdrop.querySelector('[data-role="cart-subtotal"]')?.textContent,
		).toBe("10");

		checkout?.click();
		expect(checkouts).toEqual([10]);

		// Remove the first line item via its button.
		items?.querySelector<HTMLButtonElement>("li button")?.click();
		expect(store.size).toBe(1);

		store.clear();
		expect(checkout?.disabled).toBe(true);

		// Close via the header button.
		store.add(offer("c"));
		backdrop
			.querySelector<HTMLButtonElement>('[data-role="cart-close"]')
			?.click();
		expect(store.isOpen).toBe(false);
	});
});

describe("product stream", () => {
	test("streams batches into cards and renders empty state", async () => {
		const store = new CartStore();
		const stream = createProductStream({
			cartStore: store,
			client: {
				async *search() {
					yield [offer("a"), offer("b")];
				},
			},
		});

		await stream.search("coffee");
		expect(stream.element.querySelectorAll("article").length).toBe(2);

		const empty = createProductStream({
			cartStore: store,
			client: {
				async *search() {
					// no batches
				},
			},
		});
		await empty.search("nothing");
		expect(empty.element.querySelector('[data-role="empty"]')).not.toBeNull();
	});

	test("renders RFC 9457 problem details on failure via toProblem", async () => {
		const store = new CartStore();
		// The failure surfaces while the stream consumes the iterable, which is
		// the real code path (the `for await` throws on the first `next()`).
		const failingClient = {
			search(): AsyncIterable<readonly never[]> {
				return {
					[Symbol.asyncIterator]() {
						return {
							next(): Promise<IteratorResult<readonly never[]>> {
								return Promise.reject(new Error("boom"));
							},
						};
					},
				};
			},
		};
		const stream = createProductStream({
			cartStore: store,
			client: failingClient,
			toProblem: () => ({
				status: 503,
				title: "service_unavailable",
				code: "SVC-CORE-5000",
				detail: "upstream offline",
			}),
		});

		await stream.search("coffee");
		const problem = stream.element.querySelector('[data-role="problem"]');
		expect(problem?.textContent).toContain("503 · service_unavailable");
		expect(problem?.textContent).toContain("upstream offline (SVC-CORE-5000)");
	});

	test("ignores blank queries and resets state", async () => {
		const store = new CartStore();
		let called = 0;
		const stream = createProductStream({
			cartStore: store,
			client: {
				async *search() {
					called += 1;
					yield [offer("a")];
				},
			},
		});

		await stream.search("   ");
		expect(called).toBe(0);

		await stream.search("coffee");
		expect(stream.element.querySelectorAll("article").length).toBe(1);
		stream.reset();
		expect(stream.element.querySelectorAll("article").length).toBe(0);
	});

	test("submits the form with the current input value", async () => {
		const store = new CartStore();
		const queries: string[] = [];
		const stream = createProductStream({
			cartStore: store,
			client: {
				async *search(query) {
					queries.push(query);
					yield [offer("a")];
				},
			},
		});

		const form = stream.element.querySelector("form");
		const input = stream.element.querySelector<HTMLInputElement>("input");
		if (input !== null) {
			input.value = "green tea";
		}
		form?.dispatchEvent(
			new dom.Event("submit", {
				bubbles: true,
				cancelable: true,
			}) as unknown as Event,
		);
		// Allow the async search to settle.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(queries).toEqual(["green tea"]);
	});
});

describe("transaction progress", () => {
	test("maps DB payment statuses to the UI projection", () => {
		expect(toPurchaseIntentStatus("awaiting_signature")).toBe(
			"pending_confirmation",
		);
		expect(toPurchaseIntentStatus("submitting")).toBe("confirmed");
		expect(toPurchaseIntentStatus("submitted")).toBe("submitted");
		expect(toPurchaseIntentStatus("confirmed")).toBe("paid");
		expect(toPurchaseIntentStatus("failed")).toBe("failed");
		expect(toPurchaseIntentStatus("expired")).toBe("failed");
	});

	test("renders steps and an error panel with the supplied message", () => {
		const ok = createTransactionProgress("submitted");
		expect(ok.dataset.status).toBe("submitted");
		expect(ok.querySelector(".progress-error-message")).toBeNull();

		const failed = createTransactionProgress("failed", "declined on-chain");
		expect(failed.querySelector(".progress-error-message")?.textContent).toBe(
			"declined on-chain",
		);

		const unknown = createTransactionProgress("unknown");
		expect(
			unknown.querySelector(".progress-error-message")?.textContent,
		).toContain("could not be determined");
	});
});

describe("WalletController", () => {
	test("connects, exposes session, persists and disconnects", async () => {
		const store = new InMemoryWalletSessionStore();
		const controller = new WalletController({
			connector: new FakeConnector(),
			store,
			network: "TESTNET",
		});

		const events: string[] = [];
		controller.addEventListener("wallet-changed", () => events.push("changed"));
		controller.addEventListener("wallet-connecting", () =>
			events.push("connecting"),
		);

		expect(controller.available).toBe(true);
		expect(controller.currentSession).toBeNull();

		const session = await controller.connect();
		expect(session?.address).toBe(ADDRESS);
		expect(controller.currentSession?.walletId).toBe("freighter");
		expect(await store.load()).not.toBeNull();
		expect(events).toEqual(["connecting", "changed"]);

		await controller.disconnect();
		expect(controller.currentSession).toBeNull();
		expect(await store.load()).toBeNull();
	});

	test("publishes an error and stays disconnected when connect fails", async () => {
		const controller = new WalletController({
			connector: new FakeConnector({ connectError: new Error("network down") }),
			store: new InMemoryWalletSessionStore(),
			network: "TESTNET",
		});

		const errors: string[] = [];
		controller.addEventListener("wallet-error", (event) => {
			errors.push((event as CustomEvent<string>).detail);
		});

		const session = await controller.connect();
		expect(session).toBeNull();
		expect(controller.currentSession).toBeNull();
		expect(controller.lastError).toBe("wallet_provider_unavailable");
		expect(errors).toEqual(["wallet_provider_unavailable"]);
	});

	test("maps a user rejection to the wallet rejection code", async () => {
		const controller = new WalletController({
			connector: new FakeConnector({
				connectError: new Error("user rejected"),
			}),
			store: new InMemoryWalletSessionStore(),
			network: "TESTNET",
		});

		await controller.connect();
		expect(controller.lastError).toBe("wallet_connection_rejected");
	});

	test("restores a persisted session by re-checking the provider", async () => {
		const store = new InMemoryWalletSessionStore();
		const connector = new FakeConnector();
		const controller = new WalletController({
			connector,
			store,
			network: "TESTNET",
		});
		await controller.connect();

		const restored = new WalletController({
			connector,
			store,
			network: "TESTNET",
		});
		const session = await restored.restore();
		expect(session?.address).toBe(ADDRESS);
	});
});

describe("header & app layout", () => {
	function buildController(): WalletController {
		return new WalletController({
			connector: new FakeConnector(),
			store: new InMemoryWalletSessionStore(),
			network: "TESTNET",
		});
	}

	test("shows connect button, updates cart badge and renders brand", () => {
		const cartStore = new CartStore();
		const layout = createAppLayout({
			walletController: buildController(),
			cartStore,
			brand: "Stellar Shop",
			main: document.createElement("div"),
		});

		expect(layout.header.querySelector(".brand")?.textContent).toBe(
			"Stellar Shop",
		);
		const badge = layout.header.querySelector('[data-role="cart-badge"]');
		expect(badge?.textContent).toBe("0");

		cartStore.add(offer("a"));
		expect(badge?.textContent).toBe("1");

		// The header cart toggle drives the reactive drawer via the store.
		expect(cartStore.isOpen).toBe(true); // add() opened it
		layout.header
			.querySelector<HTMLButtonElement>('[data-role="cart-toggle"]')
			?.click();
		expect(cartStore.isOpen).toBe(false);
	});

	test("reflects wallet connection state in the header after connect", async () => {
		const controller = buildController();
		const layout = createAppLayout({
			walletController: controller,
			cartStore: new CartStore(),
			main: document.createElement("div"),
		});

		expect(layout.header.textContent).toContain("Connect Freighter");
		await controller.connect();
		expect(layout.header.textContent).toContain("GA7F...5XAY");
		expect(layout.header.textContent).toContain("freighter");
		expect(layout.header.textContent).toContain("Disconnect");
	});

	test("surfaces the wallet error next to the connect button", async () => {
		const controller = new WalletController({
			connector: new FakeConnector({ connectError: new Error("timeout") }),
			store: new InMemoryWalletSessionStore(),
			network: "TESTNET",
		});
		const layout = createAppLayout({
			walletController: controller,
			cartStore: new CartStore(),
			main: document.createElement("div"),
		});

		await controller.connect();
		expect(layout.header.textContent).toContain("wallet_provider_unavailable");
	});
});
