import { describe, expect, test } from "bun:test";
import {
	WalletConnectionRejectedError,
	WalletNotAvailableError,
	WalletNotConnectedError,
	WalletProviderUnavailableError,
} from "../src/domain/errors.js";
import type {
	SignedTransaction,
	SignTransactionRequest,
	WalletNetwork,
	WalletSession,
} from "../src/domain/wallets/contracts.js";
import { truncateAddress } from "../src/domain/wallets/contracts.js";
import { InMemoryWalletSessionStore } from "../src/integrations/wallets/in-memory-wallet-session-store.js";
import { StellarWalletKitConnector } from "../src/integrations/wallets/stellar-wallets-kit-connector.js";
import type { WalletConnector } from "../src/services/wallets/ports/wallet-connector.js";
import type {
	WalletKitLoader,
	WalletKitSdk,
} from "../src/services/wallets/ports/wallet-kit-loader.js";
import { WalletSessionService } from "../src/services/wallets/wallet-session-service.js";

const ADDRESS = `G${"A".repeat(55)}`;
const XDR = "AAAAAgAAAABtest-envelope";
const NETWORK: WalletNetwork = "TESTNET";
const FIXED_NOW = new Date("2026-09-28T00:00:00.000Z");

/** Deterministic connector double; each hook can be overridden per test. */
class FakeConnector implements WalletConnector {
	readonly walletId = "freighter";
	#address: string | null = ADDRESS;
	available = true;
	connectImpl: (network: WalletNetwork) => Promise<string> = async () =>
		ADDRESS;
	getAddressImpl: () => Promise<string | null> = async () => this.#address;
	disconnectImpl: () => Promise<void> = async () => {
		this.#address = null;
	};
	signImpl: (request: SignTransactionRequest) => Promise<SignedTransaction> =
		async (request) => ({
			signedTxXdr: `signed:${request.xdr}`,
			signerAddress: request.address,
		});

	isAvailable(): boolean {
		return this.available;
	}
	connect(network: WalletNetwork): Promise<string> {
		return this.connectImpl(network);
	}
	getAddress(): Promise<string | null> {
		return this.getAddressImpl();
	}
	disconnect(): Promise<void> {
		return this.disconnectImpl();
	}
	signTransaction(request: SignTransactionRequest): Promise<SignedTransaction> {
		return this.signImpl(request);
	}
}

function makeService(
	connector: WalletConnector,
	initial: WalletSession | null = null,
) {
	return new WalletSessionService(
		connector,
		new InMemoryWalletSessionStore(initial),
		() => FIXED_NOW,
		NETWORK,
	);
}

describe("wallet domain contracts", () => {
	test("truncateAddress compacts long keys and leaves short ones intact", () => {
		expect(truncateAddress(ADDRESS)).toBe(`GAAA...AAAA`);
		expect(truncateAddress("GABC", 4)).toBe("GABC");
	});
});

describe("WalletSessionService lifecycle", () => {
	test("connect persists a validated session", async () => {
		const connector = new FakeConnector();
		const store = new InMemoryWalletSessionStore();
		const service = new WalletSessionService(
			connector,
			store,
			() => FIXED_NOW,
			NETWORK,
		);

		const session = await service.connect();

		expect(session).toEqual({
			walletId: "freighter",
			address: ADDRESS,
			network: NETWORK,
			connectedAt: FIXED_NOW.toISOString(),
		});
		expect(await store.load()).toEqual(session);
		expect(service.current).toEqual(session);
	});

	test("connect fails closed when the provider is unavailable", async () => {
		const connector = new FakeConnector();
		connector.available = false;
		const service = makeService(connector);

		await expect(service.connect()).rejects.toBeInstanceOf(
			WalletNotAvailableError,
		);
	});

	test("restore clears a session whose live address changed", async () => {
		const connector = new FakeConnector();
		connector.getAddressImpl = async () => null;
		const store = new InMemoryWalletSessionStore({
			walletId: "freighter",
			address: ADDRESS,
			network: NETWORK,
			connectedAt: FIXED_NOW.toISOString(),
		});
		const service = new WalletSessionService(
			connector,
			store,
			() => FIXED_NOW,
			NETWORK,
		);

		expect(await service.restore()).toBeNull();
		expect(await store.load()).toBeNull();
		expect(service.current).toBeNull();
	});

	test("restore returns the stored session when the address matches", async () => {
		const stored = {
			walletId: "freighter" as const,
			address: ADDRESS,
			network: NETWORK,
			connectedAt: FIXED_NOW.toISOString(),
		};
		const service = makeService(new FakeConnector(), stored);

		expect(await service.restore()).toEqual(stored);
		expect(service.current).toEqual(stored);
	});

	test("disconnect clears storage even if the provider throws", async () => {
		const connector = new FakeConnector();
		connector.disconnectImpl = async () => {
			throw new Error("boom");
		};
		const store = new InMemoryWalletSessionStore({
			walletId: "freighter",
			address: ADDRESS,
			network: NETWORK,
			connectedAt: FIXED_NOW.toISOString(),
		});
		const service = new WalletSessionService(
			connector,
			store,
			() => FIXED_NOW,
			NETWORK,
		);

		await expect(service.disconnect()).rejects.toBeInstanceOf(
			WalletProviderUnavailableError,
		);
		expect(await store.load()).toBeNull();
		expect(service.current).toBeNull();
	});

	test("signTransaction signs with the connected account", async () => {
		const service = makeService(new FakeConnector());
		await service.connect();

		const signed = await service.signTransaction({ xdr: XDR });

		expect(signed.signedTxXdr).toBe(`signed:${XDR}`);
		expect(signed.signerAddress).toBe(ADDRESS);
	});

	test("signTransaction refuses to run without a session", async () => {
		const service = makeService(new FakeConnector());

		await expect(service.signTransaction({ xdr: XDR })).rejects.toBeInstanceOf(
			WalletNotConnectedError,
		);
	});

	test("user rejection maps to SVC-WALLET-3003", async () => {
		const connector = new FakeConnector();
		connector.connectImpl = async () => {
			throw new Error("User rejected the request");
		};
		const service = makeService(connector);

		await expect(service.connect()).rejects.toBeInstanceOf(
			WalletConnectionRejectedError,
		);
	});

	test("unknown provider failure maps to SVC-WALLET-5001", async () => {
		const connector = new FakeConnector();
		connector.connectImpl = async () => {
			throw new Error("socket hang up");
		};
		const service = makeService(connector);

		await expect(service.connect()).rejects.toBeInstanceOf(
			WalletProviderUnavailableError,
		);
	});
});

describe("StellarWalletKitConnector adapter", () => {
	test("connects through a lazily loaded SDK and maps the passphrase", async () => {
		const calls: string[] = [];
		const loadState: { network: WalletNetwork | null } = { network: null };
		const sdk: WalletKitSdk = {
			init: () => {
				calls.push("init");
			},
			setWallet: (id) => {
				calls.push(`setWallet:${id}`);
			},
			setNetwork: (passphrase) => {
				calls.push(`setNetwork:${passphrase}`);
			},
			getAddress: async () => ({ address: ADDRESS }),
			fetchAddress: async () => ({ address: ADDRESS }),
			signTransaction: async (xdr) => ({ signedTxXdr: `sdk:${xdr}` }),
			disconnect: async () => {
				calls.push("disconnect");
			},
		};
		const loader: WalletKitLoader = async (network: WalletNetwork) => {
			loadState.network = network;
			return {
				sdk,
				module: { moduleType: "HOT_WALLET", productId: "freighter" },
			};
		};
		const connector = new StellarWalletKitConnector({
			walletId: "freighter",
			loader,
		});

		expect(connector.ready).toBe(false);
		expect(await connector.connect(NETWORK)).toBe(ADDRESS);
		expect(connector.ready).toBe(true);
		expect(loadState.network).toBe(NETWORK);
		expect(calls).toEqual([
			"setWallet:freighter",
			"setNetwork:Test SDF Network ; September 2015",
		]);

		const signed = await connector.signTransaction({
			xdr: XDR,
			network: NETWORK,
			address: ADDRESS,
		});
		expect(signed.signedTxXdr).toBe(`sdk:${XDR}`);
		expect(signed.signerAddress).toBe(ADDRESS);

		await connector.disconnect();
		expect(connector.ready).toBe(false);
		expect(calls).toContain("disconnect");
	});

	test("getAddress is null before the SDK is loaded", async () => {
		const connector = new StellarWalletKitConnector({
			walletId: "albedo",
			loader: (async () => {
				throw new Error("should not load");
			}) as WalletKitLoader,
		});

		expect(await connector.getAddress()).toBeNull();
	});

	test("signTransaction before connect throws without loading the SDK", async () => {
		const connector = new StellarWalletKitConnector({
			walletId: "freighter",
			loader: (async () => {
				throw new Error("should not load");
			}) as WalletKitLoader,
		});

		await expect(
			connector.signTransaction({ xdr: XDR, network: NETWORK }),
		).rejects.toThrow("not connected");
	});
});
