import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import type { ApprovedPaymentQuote } from "../src/domain/payments.js";
import { buildServer } from "../src/http/server.js";
import type { PaymentIntentService } from "../src/services/payment-intent-service.js";
import type { PaymentRuntime } from "../src/services/payment-runtime.js";

function runtime(): PaymentRuntime {
	return {
		service: {
			createIntent: async () => {
				throw new Error("not used");
			},
			getIntent: async () => {
				throw new Error("not used");
			},
			submitSignedTransaction: async () => {
				throw new Error("not used");
			},
		} as unknown as PaymentIntentService,
		createQuote: async () => {
			throw new Error("not used");
		},
		isReady: async () => true,
	};
}

describe("wallet payment routes", () => {
	test("fail closed when payments are disabled", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
		});
		expect(response.statusCode).toBe(503);
	});

	test("require service token and trusted principal", async () => {
		const app = await buildServer({
			env: {
				...env,
				PAYMENTS_ENABLED: true,
				SERVICE_TOKEN: "service-secret",
			},
			payments: runtime(),
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: { authorization: "Bearer service-secret" },
		});
		expect(response.statusCode).toBe(401);
	});

	test("creates a quote from the wallet public address", async () => {
		const payerAddress = `G${"A".repeat(55)}`;
		const quote: ApprovedPaymentQuote = {
			quoteId: "quote-demo",
			orderId: "order-demo",
			sessionId: "session-demo",
			principalId: "agent-console",
			quoteHash: "ab".repeat(32),
			status: "approved",
			networkPassphrase: "Test SDF Network ; September 2015",
			payerAddress,
			assetCode: "USDC",
			assetIssuer: `G${"B".repeat(55)}`,
			assetDecimals: 7,
			paymentLeg: {
				purpose: "merchant",
				payTo: `G${"C".repeat(55)}`,
				amountAtomic: "100000",
			},
			expiresAt: "2030-01-01T00:05:00.000Z",
		};
		const app = await buildServer({
			env: {
				...env,
				PAYMENTS_ENABLED: true,
				SERVICE_TOKEN: "service-secret",
			},
			payments: {
				...runtime(),
				createQuote: async ({ payerAddress: actualPayer }) => ({
					...quote,
					payerAddress: actualPayer,
				}),
			},
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-quotes",
			payload: { payerAddress },
			headers: {
				authorization: "Bearer service-secret",
				"x-principal-id": "agent-console",
			},
		});
		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			payerAddress,
			quoteId: "quote-demo",
		});
	});
});
