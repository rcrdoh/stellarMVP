import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { CatalogClient, PaymentClient } from "../lib/api.js";
import type {
	WalletBridge,
	WalletConnectionState,
} from "../lib/wallet-bridge.js";

export type ClientBundle = {
	catalog: CatalogClient;
	payments: PaymentClient;
	wallet: WalletBridge;
	/** True when the mock clients are in use (no backend runtime wired). */
	mockMode: boolean;
};

const ClientContext = createContext<ClientBundle | null>(null);

export function ClientProvider({
	value,
	children,
}: {
	value: ClientBundle;
	children: ReactNode;
}) {
	return (
		<ClientContext.Provider value={value}>{children}</ClientContext.Provider>
	);
}

export function useClients(): ClientBundle {
	const bundle = useContext(ClientContext);
	if (bundle === null) {
		throw new Error("useClients must be used inside <ClientProvider>");
	}
	return bundle;
}

const EMPTY_STATE: WalletConnectionState = {
	address: null,
	connected: false,
	connecting: false,
};

export type WalletState = WalletConnectionState & {
	error: string | null;
	connect(): Promise<void>;
	disconnect(): Promise<void>;
};

/** Hook wrapping the injected {@link WalletBridge} with React state. */
export function useWalletState(wallet: WalletBridge): WalletState {
	const [state, setState] = useState<WalletConnectionState>(EMPTY_STATE);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setState(wallet.current());
	}, [wallet]);

	const connect = useCallback(async () => {
		setError(null);
		setState((previous) => ({ ...previous, connecting: true }));
		try {
			setState(await wallet.connect());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Connect failed");
			setState(EMPTY_STATE);
		}
	}, [wallet]);

	const disconnect = useCallback(async () => {
		setError(null);
		try {
			await wallet.disconnect();
		} finally {
			setState(EMPTY_STATE);
		}
	}, [wallet]);

	return useMemo(
		() => ({ ...state, error, connect, disconnect }),
		[state, error, connect, disconnect],
	);
}
