import {
	type SignedTransaction,
	type SignTransactionRequest,
	type WalletId,
	type WalletNetwork,
	walletNetworkPassphrases,
} from "../../domain/wallets/contracts.js";
import type { WalletConnector } from "../../services/wallets/ports/wallet-connector.js";
import type {
	WalletKitLoader,
	WalletKitSdk,
} from "../../services/wallets/ports/wallet-kit-loader.js";

export interface StellarWalletKitConnectorOptions {
	readonly walletId: WalletId;
	readonly loader: WalletKitLoader;
}

/**
 * Adapter that implements {@link WalletConnector} on top of
 * `@creit.tech/stellar-wallets-kit`. The SDK is materialized lazily through the
 * injected loader, so this class can be constructed in Bun without touching
 * `window`, Preact or `localStorage`.
 */
export class StellarWalletKitConnector implements WalletConnector {
	readonly walletId: WalletId;
	#sdk: WalletKitSdk | null = null;
	#network: WalletNetwork | null = null;

	constructor(private readonly options: StellarWalletKitConnectorOptions) {
		this.walletId = options.walletId;
	}

	/** True once the browser SDK has been loaded successfully. */
	get ready(): boolean {
		return this.#sdk !== null;
	}

	isAvailable(): boolean {
		return typeof globalThis.window !== "undefined";
	}

	async connect(network: WalletNetwork): Promise<string> {
		const sdk = await this.#acquire(network);
		sdk.setWallet(this.walletId);
		sdk.setNetwork(walletNetworkPassphrases[network]);
		const { address } = await sdk.getAddress();
		return address;
	}

	async getAddress(): Promise<string | null> {
		if (this.#sdk === null) {
			return null;
		}
		const { address } = await this.#sdk.getAddress();
		return address;
	}

	async disconnect(): Promise<void> {
		await this.#sdk?.disconnect();
		this.#sdk = null;
		this.#network = null;
	}

	async signTransaction(
		request: SignTransactionRequest,
	): Promise<SignedTransaction> {
		const sdk = this.#sdk;
		if (sdk === null) {
			throw new Error("Wallet connector is not connected.");
		}
		const result = await sdk.signTransaction(request.xdr, {
			networkPassphrase: walletNetworkPassphrases[request.network],
			...(request.address !== undefined ? { address: request.address } : {}),
		});
		return {
			signedTxXdr: result.signedTxXdr,
			signerAddress: result.signerAddress ?? request.address,
		};
	}

	/** Loads the SDK once and caches it for the lifetime of the connection. */
	async #acquire(network: WalletNetwork): Promise<WalletKitSdk> {
		if (this.#sdk !== null && this.#network === network) {
			return this.#sdk;
		}
		const { sdk } = await this.options.loader(network);
		this.#sdk = sdk;
		this.#network = network;
		return sdk;
	}
}
