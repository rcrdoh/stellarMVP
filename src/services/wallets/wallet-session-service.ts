import {
	WalletConnectionRejectedError,
	WalletNotAvailableError,
	WalletNotConnectedError,
	WalletProviderUnavailableError,
} from "../../domain/errors.js";
import type {
	SignedTransaction,
	SignTransactionRequest,
	WalletNetwork,
	WalletSession,
} from "../../domain/wallets/contracts.js";
import {
	signedTransactionSchema,
	walletSessionSchema,
} from "../../domain/wallets/contracts.js";
import type { WalletConnector } from "./ports/wallet-connector.js";
import type { WalletSessionStore } from "./ports/wallet-session-store.js";

/** Clock port kept injectable so `connectedAt` stays deterministic in tests. */
export type Clock = () => Date;

/**
 * Orchestrates the wallet lifecycle over the injected `WalletConnector` and
 * `WalletSessionStore` ports. It contains no DOM, `window` or SDK reference, so
 * it runs unchanged in Bun tests and in the browser.
 */
export class WalletSessionService {
	#session: WalletSession | null = null;

	constructor(
		private readonly connector: WalletConnector,
		private readonly store: WalletSessionStore,
		private readonly clock: Clock = () => new Date(),
		private readonly network: WalletNetwork,
	) {}

	/** Currently active session, or `null` when no wallet is connected. */
	get current(): WalletSession | null {
		return this.#session;
	}

	/** True when the underlying provider can run in the current runtime. */
	get available(): boolean {
		return this.connector.isAvailable();
	}

	/**
	 * Connects the wallet, validates the returned account and persists the
	 * session. A provider that is missing maps to `SVC-WALLET-3002`; a rejection
	 * by the user maps to `SVC-WALLET-3003`.
	 */
	async connect(): Promise<WalletSession> {
		if (!this.connector.isAvailable()) {
			throw new WalletNotAvailableError();
		}
		const address = await this.#guardProviderCall(() =>
			this.connector.connect(this.network),
		);
		const session = walletSessionSchema.parse({
			walletId: this.connector.walletId,
			address,
			network: this.network,
			connectedAt: this.clock().toISOString(),
		});
		await this.store.save(session);
		this.#session = session;
		return session;
	}

	/**
	 * Restores a persisted session by re-checking the live provider address.
	 * A stale or mismatched session is cleared instead of trusted blindly.
	 */
	async restore(): Promise<WalletSession | null> {
		const stored = await this.store.load();
		if (stored === null) {
			return null;
		}
		const address = await this.#guardProviderCall(() =>
			this.connector.getAddress(),
		);
		if (address === null || address !== stored.address) {
			await this.store.clear();
			this.#session = null;
			return null;
		}
		this.#session = stored;
		return stored;
	}

	/** Clears the local session and best-effort disconnects the provider. */
	async disconnect(): Promise<void> {
		await this.store.clear();
		this.#session = null;
		await this.#guardProviderCall(() => this.connector.disconnect());
	}

	/**
	 * Signs an envelope with the connected account. Requires an active session,
	 * so an unsigned request never reaches the provider without a wallet.
	 */
	async signTransaction(
		request: Omit<SignTransactionRequest, "network" | "address">,
	): Promise<SignedTransaction> {
		const session = this.#session;
		if (session === null) {
			throw new WalletNotConnectedError();
		}
		const result = await this.#guardProviderCall(() =>
			this.connector.signTransaction({
				xdr: request.xdr,
				network: this.network,
				address: session.address,
			}),
		);
		return signedTransactionSchema.parse(result);
	}

	/**
	 * Normalizes provider failures into the wallet error taxonomy. A rejected
	 * prompt (user cancelled) becomes `SVC-WALLET-3003`; any other runtime error
	 * becomes `SVC-WALLET-5001`.
	 */
	async #guardProviderCall<T>(call: () => Promise<T>): Promise<T> {
		try {
			return await call();
		} catch (error) {
			if (error instanceof WalletConnectionRejectedError) {
				throw error;
			}
			if (isUserRejection(error)) {
				throw new WalletConnectionRejectedError();
			}
			throw new WalletProviderUnavailableError();
		}
	}
}

/** Heuristic: wallet kits signal user cancellation through message text. */
function isUserRejection(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message.toLowerCase()
			: String(error).toLowerCase();
	return (
		message.includes("reject") ||
		message.includes("cancel") ||
		message.includes("denied") ||
		message.includes("closed")
	);
}
