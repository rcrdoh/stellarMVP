import { walletSessionSchema } from "../../domain/wallets/contracts.js";
import type { WalletSessionStore } from "../../services/wallets/ports/wallet-session-store.js";

/** Default `localStorage` key for the active wallet session. */
export const WALLET_SESSION_STORAGE_KEY = "stellarmvp.wallet.session";

/**
 * Browser {@link WalletSessionStore} backed by `localStorage`. Reads are
 * validated against {@link walletSessionSchema} so corrupted or tampered values
 * degrade to "no session" instead of surfacing a malformed object to services.
 */
export class LocalStorageWalletSessionStore implements WalletSessionStore {
	constructor(
		private readonly key: string = WALLET_SESSION_STORAGE_KEY,
		private readonly storage: Storage = globalThis.localStorage,
	) {}

	async load(): Promise<ReturnType<typeof walletSessionSchema.parse> | null> {
		const raw = this.storage.getItem(this.key);
		if (raw === null) {
			return null;
		}
		const parsed = walletSessionSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) {
			this.storage.removeItem(this.key);
			return null;
		}
		return parsed.data;
	}

	async save(
		session: Parameters<WalletSessionStore["save"]>[0],
	): Promise<void> {
		this.storage.setItem(this.key, JSON.stringify(session));
	}

	async clear(): Promise<void> {
		this.storage.removeItem(this.key);
	}
}
