import type { WalletSession } from "../../../domain/wallets/contracts.js";

/**
 * Persistence port for the active wallet session. The service depends on this
 * abstraction so it can run against an in-memory store in Bun tests and against
 * `localStorage` (or any other durable medium) in the browser.
 */
export interface WalletSessionStore {
	load(): Promise<WalletSession | null>;
	save(session: WalletSession): Promise<void>;
	clear(): Promise<void>;
}
