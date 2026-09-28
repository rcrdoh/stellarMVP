import type { WalletSession } from "../../domain/wallets/contracts.js";
import type { WalletSessionStore } from "../../services/wallets/ports/wallet-session-store.js";

/**
 * Deterministic in-memory {@link WalletSessionStore}. Used as the safe fallback
 * when no browser storage is available and as the test double, keeping Bun runs
 * free of `localStorage`/`window` dependencies.
 */
export class InMemoryWalletSessionStore implements WalletSessionStore {
	#session: WalletSession | null;

	constructor(initial: WalletSession | null = null) {
		this.#session = initial;
	}

	async load(): Promise<WalletSession | null> {
		return this.#session;
	}

	async save(session: WalletSession): Promise<void> {
		this.#session = session;
	}

	async clear(): Promise<void> {
		this.#session = null;
	}
}
