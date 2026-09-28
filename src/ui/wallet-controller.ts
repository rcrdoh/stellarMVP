import type {
	WalletNetwork,
	WalletSession,
} from "../domain/wallets/contracts.js";
import { InMemoryWalletSessionStore } from "../integrations/wallets/in-memory-wallet-session-store.js";
import { LocalStorageWalletSessionStore } from "../integrations/wallets/local-storage-wallet-session-store.js";
import { StellarWalletKitConnector } from "../integrations/wallets/stellar-wallets-kit-connector.js";
import { browserWalletKitLoader } from "../integrations/wallets/stellar-wallets-kit-loader.js";
import type { WalletConnector } from "../services/wallets/ports/wallet-connector.js";
import type { WalletSessionStore } from "../services/wallets/ports/wallet-session-store.js";
import { WalletSessionService } from "../services/wallets/wallet-session-service.js";

export const WALLET_CHANGED_EVENT = "wallet-changed";
export const WALLET_CONNECTING_EVENT = "wallet-connecting";
export const WALLET_ERROR_EVENT = "wallet-error";

export interface WalletControllerOptions {
	readonly walletId?: string;
	readonly network?: WalletNetwork;
	/** Test seam: overrides the browser connector. */
	readonly connector?: WalletConnector;
	/** Test seam: overrides `localStorage` persistence. */
	readonly store?: WalletSessionStore;
}

/**
 * Browser composition root for the Module 3 wallet ports. Wires the concrete
 * `StellarWalletKitConnector` and `LocalStorageWalletSessionStore` into
 * `WalletSessionService` and exposes the lifecycle as DOM `CustomEvent`s so a
 * vanilla UI can react without a framework store.
 *
 * Construction stays side-effect free in a non-DOM runtime: when `localStorage`
 * is unavailable it degrades to the in-memory store, and the SDK itself is only
 * imported lazily by `browserWalletKitLoader` on first `connect`.
 */
export class WalletController extends EventTarget {
	readonly #service: WalletSessionService;
	#session: WalletSession | null = null;
	#isConnecting = false;
	#error: string | null = null;

	constructor(options: WalletControllerOptions = {}) {
		super();
		const network = options.network ?? "TESTNET";
		const connector =
			options.connector ??
			new StellarWalletKitConnector({
				walletId: options.walletId ?? "freighter",
				loader: browserWalletKitLoader,
			});
		const store = options.store ?? createDefaultSessionStore();
		this.#service = new WalletSessionService(
			connector,
			store,
			() => new Date(),
			network,
		);
	}

	get currentSession(): WalletSession | null {
		return this.#session;
	}

	get connecting(): boolean {
		return this.#isConnecting;
	}

	get lastError(): string | null {
		return this.#error;
	}

	/** True when the underlying provider can run in the current runtime. */
	get available(): boolean {
		return this.#service.available;
	}

	/** Restores a persisted session, ignoring failures when none is stored. */
	async restore(): Promise<WalletSession | null> {
		try {
			this.#session = await this.#service.restore();
		} catch (error) {
			this.#session = null;
			this.#setError(error);
		}
		this.#dispatch(WALLET_CHANGED_EVENT, this.#session);
		return this.#session;
	}

	/** Opens the wallet provider and publishes the resulting session. */
	async connect(): Promise<WalletSession | null> {
		this.#isConnecting = true;
		this.#error = null;
		this.#dispatch(WALLET_CONNECTING_EVENT, null);
		try {
			this.#session = await this.#service.connect();
			this.#dispatch(WALLET_CHANGED_EVENT, this.#session);
			return this.#session;
		} catch (error) {
			this.#session = null;
			this.#setError(error);
			return null;
		} finally {
			this.#isConnecting = false;
		}
	}

	/** Clears the local session and best-effort disconnects the provider. */
	async disconnect(): Promise<void> {
		await this.#service.disconnect();
		this.#session = null;
		this.#error = null;
		this.#dispatch(WALLET_CHANGED_EVENT, null);
	}

	#setError(error: unknown): void {
		this.#error =
			error instanceof Error ? error.message : "Wallet operation failed";
		this.#dispatch(WALLET_ERROR_EVENT, this.#error);
	}

	#dispatch(type: string, detail: unknown): void {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}
}

/**
 * Picks the browser store when `localStorage` exists, otherwise a deterministic
 * in-memory store. This keeps the controller constructible during Bun tests and
 * server-side rendering without throwing on a missing storage API.
 */
function createDefaultSessionStore(): WalletSessionStore {
	if (typeof globalThis.localStorage !== "undefined") {
		return new LocalStorageWalletSessionStore();
	}
	return new InMemoryWalletSessionStore();
}
