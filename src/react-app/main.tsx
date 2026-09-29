import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import type { ClientBundle } from "./context/client-context.js";
import { createHttpClients } from "./lib/api.js";
import {
	createMockCatalogClient,
	createMockPaymentClient,
} from "./lib/mock-clients.js";
import {
	ControllerWalletBridge,
	FakeWalletController,
} from "./lib/wallet-bridge.js";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import "./styles/index.css";

/** Mock mode is on by default (the backend has no quote endpoint, see blocker
 * B1) unless `REACT_MOCK_MODE=0` was set at build time. */
const mockFlag = process.env.REACT_MOCK_MODE ?? "";
const mockMode = mockFlag !== "0";

function buildClients(): ClientBundle {
	if (mockMode) {
		return {
			catalog: createMockCatalogClient(),
			payments: createMockPaymentClient(),
			wallet: new FakeWalletController(),
			mockMode: true,
		};
	}
	const { catalog, payments } = createHttpClients({
		agentToken: process.env.REACT_AGENT_TOKEN,
		serviceToken: process.env.REACT_SERVICE_TOKEN,
		principalId: process.env.REACT_PRINCIPAL_ID,
	});
	return {
		catalog,
		payments,
		wallet: new ControllerWalletBridge(),
		mockMode: false,
	};
}

const container = document.getElementById("app");
if (container === null) {
	throw new Error("Mount point #app not found in document");
}

createRoot(container).render(
	<StrictMode>
		<App clients={buildClients()} />
	</StrictMode>,
);
