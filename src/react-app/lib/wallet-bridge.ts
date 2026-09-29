/** Browser wallet bridge for the React app.
 *
 * Reuses the existing framework-agnostic `WalletController` (which already
 * wraps `@creit.tech/stellar-wallets-kit` lazily) and exposes it through a small
 * interface so tests can inject a `FakeWalletController` (SDD §8.2). */

import type { SignedTransaction } from "../../domain/wallets/contracts.js";
import {
	WalletController as BrowserWalletController,
	type WalletController,
} from "../../ui/wallet-controller.js";

export type WalletConnectionState = {
	address: string | null;
	connected: boolean;
	connecting: boolean;
};

/** Minimal surface the checkout depends on. */
export type WalletBridge = {
	connect(): Promise<WalletConnectionState>;
	disconnect(): Promise<void>;
	/** Signs an unsigned envelope XDR; returns the signed XDR. */
	signTransaction(xdr: string): Promise<string>;
	current(): WalletConnectionState;
};

export type FakeWalletControllerOptions = {
	address?: string;
	signedXdr?: string;
	failSign?: boolean;
};

/** Deterministic in-memory wallet for tests and the mock checkout path. */
export class FakeWalletController implements WalletBridge {
	readonly #address: string;
	readonly #signedXdr: string;
	readonly #failSign: boolean;
	#connected: boolean;

	constructor(options: FakeWalletControllerOptions = {}) {
		this.#address =
			options.address ??
			"GA7FYRB5VREZKOBIIKHG5AVTPFGWUBPOBTW6M7PG7NQFXBMCEIYF5XAY";
		this.#signedXdr = options.signedXdr ?? "AAAA_FAKE_SIGNED_XDR";
		this.#failSign = options.failSign ?? false;
		this.#connected = false;
	}

	current(): WalletConnectionState {
		return {
			address: this.#connected ? this.#address : null,
			connected: this.#connected,
			connecting: false,
		};
	}

	async connect(): Promise<WalletConnectionState> {
		this.#connected = true;
		return this.current();
	}

	async disconnect(): Promise<void> {
		this.#connected = false;
	}

	async signTransaction(): Promise<string> {
		if (this.#failSign) {
			throw new Error("Wallet rejected the signature request");
		}
		if (!this.#connected) {
			throw new Error("Wallet is not connected");
		}
		return this.#signedXdr;
	}
}

/** Adapts the DOM-event `WalletController` to the `WalletBridge` interface. */
export class ControllerWalletBridge implements WalletBridge {
	readonly #controller: WalletController;

	constructor(controller: WalletController = new BrowserWalletController()) {
		this.#controller = controller;
	}

	current(): WalletConnectionState {
		const session = this.#controller.currentSession;
		return {
			address: session?.address ?? null,
			connected: session !== null,
			connecting: this.#controller.connecting,
		};
	}

	async connect(): Promise<WalletConnectionState> {
		const session = await this.#controller.connect();
		if (session === null) {
			throw new Error(this.#controller.lastError ?? "Could not connect wallet");
		}
		return { address: session.address, connected: true, connecting: false };
	}

	async disconnect(): Promise<void> {
		await this.#controller.disconnect();
	}

	async signTransaction(xdr: string): Promise<string> {
		const signed: SignedTransaction | null = await this.#controller.sign(xdr);
		if (signed === null) {
			throw new Error(this.#controller.lastError ?? "Signing failed");
		}
		return signed.signedTxXdr;
	}
}
