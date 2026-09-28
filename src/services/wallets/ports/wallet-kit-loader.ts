import type { WalletNetwork } from "../../../domain/wallets/contracts.js";

/**
 * Structural subset of the static API exposed by
 * `@creit.tech/stellar-wallets-kit` (`StellarWalletsKit`). Only the methods the
 * adapter uses are declared, so a Bun test can supply a tiny deterministic fake
 * without importing the Preact-based SDK.
 */
export interface WalletKitSdk {
	init(params: {
		modules: unknown[];
		selectedWalletId?: string;
		network?: string;
	}): void;
	setWallet(id: string): void;
	setNetwork(network: string): void;
	getAddress(): Promise<{ address: string }>;
	fetchAddress(): Promise<{ address: string }>;
	signTransaction(
		xdr: string,
		opts?: { networkPassphrase?: string; address?: string; path?: string },
	): Promise<{ signedTxXdr: string; signerAddress?: string }>;
	disconnect(): Promise<void>;
}

/** A wallet module allowed in kit initialization. */
export interface WalletKitModule {
	readonly moduleType: unknown;
	readonly productId: string;
}

/**
 * Factory that lazily materializes the SDK. The browser implementation imports
 * `@creit.tech/stellar-wallets-kit` and its modules on demand; tests inject a
 * fake. Keeping this a function avoids evaluating the Preact `window`-dependent
 * SDK at module load in Bun.
 */
export type WalletKitLoader = (network: WalletNetwork) => Promise<{
	sdk: WalletKitSdk;
	module: WalletKitModule;
}>;
