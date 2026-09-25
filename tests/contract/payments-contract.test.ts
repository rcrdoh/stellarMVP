import { describe, expect, test } from "bun:test";
import { loadSpec } from "../../scripts/validate-openapi.js";
import { env } from "../../src/config/env.js";
import { errorCodes } from "../../src/domain/error-codes.js";
import { paymentIntentSchema } from "../../src/domain/payments.js";
import { buildServer } from "../../src/http/server.js";
import type { PaymentService } from "../../src/services/payment-service.js";

const paymentIntent = paymentIntentSchema.parse({
	intentId: "00000000-0000-4000-8000-000000000001",
	quoteId: "quote-1",
	orderId: "order-1",
	quoteHash: "11".repeat(32),
	principalId: "user-1",
	idempotencyKey: "payment-key-0001",
	requestFingerprint: "00".repeat(32),
	status: "awaiting_signature",
	networkPassphrase: "Test SDF Network ; September 2015",
	payerAddress: `G${"A".repeat(55)}`,
	assetCode: "USDC",
	assetIssuer: `G${"B".repeat(55)}`,
	assetDecimals: 7,
	totalAmountAtomic: "10000000",
	paymentLegs: [
		{
			purpose: "merchant",
			payTo: `G${"C".repeat(55)}`,
			amountAtomic: "10000000",
		},
	],
	unsignedXdr: "unsigned-xdr",
	transactionHash: "ab".repeat(32),
	ledger: null,
	expiresAt: "2026-09-24T12:05:00.000Z",
	createdAt: "2026-09-24T12:00:00.000Z",
	updatedAt: "2026-09-24T12:00:00.000Z",
});

function createApp(submissionStatus: "submitted" | "failed" = "submitted") {
	let createCount = 0;
	const service = {
		createIntent: async () => ({
			intent: paymentIntent,
			replayed: createCount++ > 0,
		}),
		getIntent: async () => paymentIntent,
		submitSignedTransaction: async () => ({
			...paymentIntent,
			status: submissionStatus,
		}),
	} as unknown as PaymentService;
	return buildServer({
		env: {
			...env,
			LOG_LEVEL: "fatal",
			PAYMENTS_ENABLED: true,
			SERVICE_TOKEN: "service-secret",
			STELLAR_NETWORK: "testnet",
			MONGODB_URI: "mongodb://injected-test",
		},
		payments: { service, isReady: async () => true },
	});
}

const internalHeaders = {
	authorization: "Bearer service-secret",
	"x-principal-id": "user-1",
};

describe("payment routes", () => {
	test("payment operations are present in the OpenAPI contract and protected", async () => {
		const spec = await loadSpec();
		const create = spec.paths?.["/v1/payment-intents"]?.post;
		const read = spec.paths?.["/v1/payment-intents/{intentId}"]?.get;
		const submit =
			spec.paths?.["/v1/payment-intents/{intentId}/submission"]?.post;

		expect(create?.operationId).toBe("createPaymentIntent");
		expect(create?.security).toEqual([{ serviceToken: [] }]);
		expect(create?.responses?.["200"]).toBeDefined();
		expect(create?.responses?.["201"]).toBeDefined();
		expect(read?.operationId).toBe("getPaymentIntent");
		expect(submit?.operationId).toBe("submitPaymentIntentTransaction");
		expect(submit?.security).toEqual([{ serviceToken: [] }]);
	});

	test("rejects calls without a configured service token", async () => {
		const app = await createApp();
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: {
				"x-principal-id": "user-1",
				"idempotency-key": "payment-key-0001",
			},
		});

		expect(response.statusCode).toBe(401);
		expect(response.headers["x-error-code"]).toBe(
			errorCodes.CREDENTIALS_MISSING.code,
		);
	});

	test("requires trusted principal and idempotency key, then replays the saved intent", async () => {
		const app = await createApp();
		const noPrincipal = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: {
				authorization: internalHeaders.authorization,
				"idempotency-key": "payment-key-0001",
			},
		});
		expect(noPrincipal.statusCode).toBe(401);

		const noIdempotency = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: internalHeaders,
		});
		expect(noIdempotency.statusCode).toBe(400);
		expect(noIdempotency.headers["x-error-code"]).toBe(
			errorCodes.IDEMPOTENCY_KEY_REQUIRED.code,
		);

		const headers = {
			...internalHeaders,
			"idempotency-key": "payment-key-0001",
		};
		const created = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers,
		});
		const replay = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers,
		});

		expect(created.statusCode).toBe(201);
		expect(created.json().unsignedXdr).toBe("unsigned-xdr");
		expect(created.json().principalId).toBeUndefined();
		expect(created.json().requestFingerprint).toBeUndefined();
		expect(created.json().idempotencyKey).toBeUndefined();
		expect(replay.statusCode).toBe(200);
		expect(replay.headers["x-idempotent-replay"]).toBe("true");
	});

	test("accepts a signed XDR only through the configured BFF and returns pending state", async () => {
		const app = await createApp();
		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${paymentIntent.intentId}/submission`,
			payload: { signedXdr: "signed-xdr" },
			headers: internalHeaders,
		});

		expect(response.statusCode).toBe(202);
		expect(response.json()).toMatchObject({
			intentId: paymentIntent.intentId,
			status: "submitted",
		});
	});

	test("returns terminal failed transactions as a completed status response", async () => {
		const app = await createApp("failed");
		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${paymentIntent.intentId}/submission`,
			payload: { signedXdr: "signed-xdr" },
			headers: internalHeaders,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().status).toBe("failed");
	});

	test("returns an owned intent without exposing internal idempotency data", async () => {
		const app = await createApp();
		const response = await app.inject({
			method: "GET",
			url: `/v1/payment-intents/${paymentIntent.intentId}`,
			headers: internalHeaders,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().intentId).toBe(paymentIntent.intentId);
		expect(response.json().principalId).toBeUndefined();
		expect(response.json().idempotencyKey).toBeUndefined();
	});

	test("fails closed while the payment feature is disabled", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
		});

		expect(response.statusCode).toBe(503);
		expect(response.headers["x-error-code"]).toBe(
			errorCodes.SERVICE_UNAVAILABLE.code,
		);
	});
});
