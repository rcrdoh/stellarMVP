import {
	type WalletNetwork,
	walletNetworkPassphrases,
} from "../../domain/wallets/contracts.js";
import type {
	WalletKitLoader,
	WalletKitModule,
	WalletKitSdk,
} from "../../services/wallets/ports/wallet-kit-loader.js";

/** Supported wallet product ids, matching the kit's module `productId`. */
export const SUPPORTED_WALLET_IDS = ["freighter", "albedo"] as const;
export type SupportedWalletId = (typeof SUPPORTED_WALLET_IDS)[number];

/**
 * Loads `@creit.tech/stellar-wallets-kit` on demand. The package pulls in
 * Preact signals and `@reown/appkit`, which reference `window` at import time,
 * so this loader is only ever invoked from a browser runtime. It refuses to run
 * outside a DOM environment instead of crashing on a bare `window` access.
 */
export const browserWalletKitLoader: WalletKitLoader = async (
	network: WalletNetwork,
) => {
	if (typeof globalThis.window === "undefined") {
		throw new Error(
			"StellarWalletsKit requires a browser runtime (window is undefined).",
		);
	}
	const [kitModule, freighterModule, albedoModule] = await Promise.all([
		import("@creit.tech/stellar-wallets-kit"),
		import("@creit.tech/stellar-wallets-kit/modules/freighter"),
		import("@creit.tech/stellar-wallets-kit/modules/albedo"),
	]);
	const modules: WalletKitModule[] = [
		new freighterModule.FreighterModule(),
		new albedoModule.AlbedoModule(),
	];
	const sdk = kitModule.StellarWalletsKit as unknown as WalletKitSdk;
	sdk.init({
		modules,
		selectedWalletId: freighterModule.FREIGHTER_ID,
		network: walletNetworkPassphrases[network],
	});
	return { sdk, module: modules[0] as WalletKitModule };
};
