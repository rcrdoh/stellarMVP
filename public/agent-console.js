const output = document.querySelector("#output");
const connectionState = document.querySelector("#connection-state");
const walletState = document.querySelector("#wallet-state");
const intentId = document.querySelector("#intent-id");
const unsignedXdr = document.querySelector("#unsigned-xdr");
let currentIntentId = "";

function elementValue(selector) {
	const element = document.querySelector(selector);
	return element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement
		? element.value.trim()
		: "";
}

function apiBase() {
	return elementValue("#api-base").replace(/\/$/, "");
}

function setOutput(value) {
	if (output)
		output.textContent =
			typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setConnectionState(state, label) {
	if (!(connectionState instanceof HTMLElement)) return;
	connectionState.textContent = label;
	connectionState.className = `status-pill ${state}`;
}

function setWalletState(state, label) {
	if (!(walletState instanceof HTMLElement)) return;
	walletState.textContent = label;
	walletState.className = `status-pill ${state}`;
}

function authHeaders() {
	const token = elementValue("#service-token");
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
	if (!apiBase()) throw new Error("Indica una API base antes de continuar.");
	const headers = new Headers(options.headers);
	if (options.body !== undefined)
		headers.set("Content-Type", "application/json");
	const response = await fetch(`${apiBase()}${path}`, { ...options, headers });
	const text = await response.text();
	let data = text;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		/* Mantiene texto no JSON. */
	}
	if (!response.ok) {
		const detail =
			typeof data === "object" && data !== null && "detail" in data
				? data.detail
				: text;
		throw new Error(`${response.status} ${detail || response.statusText}`);
	}
	return { data, status: response.status };
}

function randomKey(prefix) {
	const id =
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return `${prefix}-${id}`.slice(0, 128);
}

function decodePaymentRequired(value) {
	try {
		const decoded = atob(value);
		return JSON.parse(decoded);
	} catch {
		return value;
	}
}

async function run(label, operation) {
	setOutput(`${label}\n\nEjecutando...`);
	try {
		const result = await operation();
		setOutput({ label, ...result });
		return result;
	} catch (error) {
		setOutput(
			`${label}\n\n${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}

document.querySelector("#api-base").value = window.location.origin;
document.querySelector("#idempotency-key").value = randomKey("payment-demo");

document
	.querySelector("#connect-wallet-button")
	.addEventListener("click", async () => {
		try {
			const freighter = globalThis.freighterApi;
			if (!freighter) {
				throw new Error("Freighter no está instalado en este navegador.");
			}
			const connection = await freighter.isConnected();
			const isConnected =
				typeof connection === "boolean" ? connection : connection.isConnected;
			if (!isConnected) {
				throw new Error(
					"Instala o habilita la extensión Freighter para continuar.",
				);
			}
			const access = await freighter.requestAccess();
			if (access.error) {
				const message =
					typeof access.error === "string"
						? access.error
						: access.error.message;
				throw new Error(message || "Freighter rechazó el acceso.");
			}
			const address = access.address?.trim();
			if (!address)
				throw new Error("Freighter no devolvió una dirección pública.");
			document.querySelector("#payer-address").value = address;
			const principal = document.querySelector("#principal-id");
			if (principal.value === "agent-console" || principal.value.length === 0) {
				principal.value = address;
			}
			setWalletState("ok", `${address.slice(0, 5)}…${address.slice(-4)}`);
			setOutput({ label: "Wallet connected", payerAddress: address });
		} catch (error) {
			setWalletState("error", "conexión fallida");
			setOutput(
				`Wallet connection\n\n${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});

document
	.querySelector("#probe-x402-button")
	.addEventListener("click", async () => {
		const resourceUrl = elementValue("#resource-url");
		let body;
		try {
			body = JSON.parse(elementValue("#resource-body"));
		} catch {
			setOutput("X402 discovery\n\nEl body no es JSON válido.");
			return;
		}
		await run("X402 discovery", async () => {
			if (!resourceUrl) throw new Error("Indica la URL del recurso pagado.");
			const response = await fetch(resourceUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const text = await response.text();
			let responseBody = text;
			try {
				responseBody = text ? JSON.parse(text) : null;
			} catch {
				/* Mantiene texto no JSON. */
			}
			const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
			return {
				status: response.status,
				paymentRequired: paymentRequired
					? decodePaymentRequired(paymentRequired)
					: null,
				body: responseBody,
				note:
					response.status === 402
						? "Desafío recibido. Falta implementar la firma y el reintento PAYMENT-SIGNATURE en el cliente."
						: "El recurso no respondió 402; revisa la URL y su configuración x402.",
			};
		});
	});

document
	.querySelector("#prepare-payment-button")
	.addEventListener("click", async () => {
		const result = await run("Prepare micropayment", () =>
			request("/v1/payment-quotes", {
				method: "POST",
				headers: {
					...authHeaders(),
					"x-principal-id": elementValue("#principal-id"),
				},
				body: JSON.stringify({ payerAddress: elementValue("#payer-address") }),
			}),
		);
		document.querySelector("#quote-id").value = result.data.quoteId;
		setOutput({
			label: "Prepare micropayment",
			quote: result.data,
			next: "Pulsa Crear intent para recibir el XDR sin firmar.",
		});
	});

document.querySelector("#health-button").addEventListener("click", async () => {
	try {
		const result = await run("Health", async () => {
			const [live, ready] = await Promise.all([
				request("/v1/health/live"),
				request("/v1/health/ready"),
			]);
			return { live: live.data, ready: ready.data };
		});
		setConnectionState(
			result.data.ready.status === "ok" ? "ok" : "error",
			result.data.ready.status,
		);
	} catch {
		setConnectionState("error", "error");
	}
});

document.querySelector("#search-button").addEventListener("click", async () => {
	const filters = elementValue("#search-merchant")
		? { merchant: elementValue("#search-merchant") }
		: undefined;
	await run("Agent search", () =>
		request("/v1/agent/search", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				query: elementValue("#search-query"),
				limit: Number(elementValue("#search-limit")) || 5,
				...(filters ? { filters } : {}),
			}),
		}),
	);
});

document
	.querySelector("#create-intent-button")
	.addEventListener("click", async () => {
		const key = elementValue("#idempotency-key") || randomKey("payment-demo");
		document.querySelector("#idempotency-key").value = key;
		const result = await run("Create payment intent", () =>
			request("/v1/payment-intents", {
				method: "POST",
				headers: {
					...authHeaders(),
					"x-principal-id": elementValue("#principal-id"),
					"Idempotency-Key": key,
				},
				body: JSON.stringify({ quoteId: elementValue("#quote-id") }),
			}),
		);
		currentIntentId = result.data.intentId;
		intentId.textContent = currentIntentId;
		unsignedXdr.value = result.data.unsignedXdr ?? "";
	});

document
	.querySelector("#refresh-intent-button")
	.addEventListener("click", async () => {
		const id = currentIntentId || elementValue("#intent-id");
		if (!id || id === "—") throw new Error("Crea un intent primero.");
		await run("Payment intent status", () =>
			request(`/v1/payment-intents/${id}`, {
				headers: {
					...authHeaders(),
					"x-principal-id": elementValue("#principal-id"),
				},
			}),
		);
	});

document
	.querySelector("#submit-intent-button")
	.addEventListener("click", async () => {
		const id = currentIntentId || elementValue("#intent-id");
		if (!id || id === "—") throw new Error("Crea un intent primero.");
		await run("Submit signed transaction", () =>
			request(`/v1/payment-intents/${id}/submission`, {
				method: "POST",
				headers: {
					...authHeaders(),
					"x-principal-id": elementValue("#principal-id"),
				},
				body: JSON.stringify({ signedXdr: elementValue("#signed-xdr") }),
			}),
		);
	});

document
	.querySelector("#checkout-button")
	.addEventListener("click", async () => {
		await run("ACP checkout", () =>
			request("/v1/agent/checkout", {
				method: "POST",
				headers: {
					...authHeaders(),
					"X-402-Payment-Token": elementValue("#checkout-payment-token"),
				},
				body: JSON.stringify({
					itemId: elementValue("#checkout-item-id"),
					amount: elementValue("#checkout-amount"),
					currency: "USDC",
					destination: elementValue("#checkout-destination"),
					idempotencyKey: randomKey("checkout"),
				}),
			}),
		);
	});

document
	.querySelector("#clear-output-button")
	.addEventListener("click", () => setOutput("Listo."));
