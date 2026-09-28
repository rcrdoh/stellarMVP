import type {
	SignedTransaction,
	SignTransactionRequest,
	WalletId,
	WalletNetwork,
} from "../../../domain/wallets/contracts.js";

/**
 * Port for a browser wallet provider (Freighter, Albedo, xBull, ...). The
 * service layer only depends on this contract, so the concrete adapter can wrap
 * `@creit.tech/stellar-wallets-kit` without leaking DOM, Preact or `window`
 * references into domain or service code.
 *
 * Implementations must be injectable and side-effect free on construction: no
 * network socket or browser API is touched until `connect`/`signTransaction`.
 */
export interface WalletConnector {
	/** Wallet module selected by the user, e.g. `freighter` or `albedo`. */
	readonly walletId: WalletId;
	/** True when the underlying provider can run in the current runtime. */
	isAvailable(): boolean;
	/** Opens the wallet provider and returns the active account address. */
	connect(network: WalletNetwork): Promise<string>;
	/** Releases the provider session; safe to call when already disconnected. */
	disconnect(): Promise<void>;
	/** Returns the current address or `null` when no account is authorized. */
	getAddress(): Promise<string | null>;
	/** Signs an envelope XDR for the given network; never submits it. */
	signTransaction(request: SignTransactionRequest): Promise<SignedTransaction>;
}
