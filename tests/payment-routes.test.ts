import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import type {
	ApprovedPaymentQuote,
	PaymentIntent,
} from "../src/domain/payments.js";
import { buildServer } from "../src/http/server.js";
import {
	type PaymentIntentRepository,
	PaymentIntentService,
	type PaymentQuoteRepository,
	type StellarIntentGateway,
} from "../src/services/payment-intent-service.js";

const payerAddress = `G${"A".repeat(55)}`;
const merchantAddress = `G${"B".repeat(55)}`;
const issuer = `G${"C".repeat(55)}`;

const quote: ApprovedPaymentQuote = {
	quoteId: "quote-1",
	orderId: "order-1",
	sessionId: "session-1",
	principalId: "principal-1",
	quoteHash: "ab".repeat(32),
	status: "approved",
	networkPassphrase: "Test SDF Network ; September 2015",
	payerAddress,
	assetCode: "USDC",
	assetIssuer: issuer,
	assetDecimals: 7,
	paymentLeg: {
		purpose: "merchant",
		payTo: merchantAddress,
		amountAtomic: "12500000",
	},
	expiresAt: "2030-01-01T00:05:00.000Z",
};

class MemoryPaymentRepository
	implements PaymentQuoteRepository, PaymentIntentRepository
{
	intents = new Map<string, PaymentIntent>();

	findApprovedQuote(): Promise<ApprovedPaymentQuote | null> {
		return Promise.resolve(quote);
	}

	findByIdempotencyKey(): Promise<PaymentIntent | null> {
		return Promise.resolve(null);
	}

	findIntentById(intentId: string): Promise<PaymentIntent | null> {
		return Promise.resolve(this.intents.get(intentId) ?? null);
	}

	insertIntent(intent: PaymentIntent): Promise<void> {
		this.intents.set(intent.intentId, intent);
		return Promise.resolve();
	}

	expireUnsignedForPayer(): Promise<void> {
		return Promise.resolve();
	}

	compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		const current = this.intents.get(intent.intentId);
		if (!current || current.status !== expectedStatus) {
			return Promise.resolve(false);
		}
		this.intents.set(intent.intentId, intent);
		return Promise.resolve(true);
	}

	settleConfirmed(
		intent: PaymentIntent,
		_expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		this.intents.set(intent.intentId, intent);
		return Promise.resolve(true);
	}

	settleFailed(
		intent: PaymentIntent,
		_expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		this.intents.set(intent.intentId, intent);
		return Promise.resolve(true);
	}
}

class FakeGateway implements StellarIntentGateway {
	buildUnsignedTransaction(): Promise<{
		unsignedXdr: string;
		transactionHash: string;
		expiresAt: string;
	}> {
		return Promise.resolve({
			unsignedXdr: "unsigned-xdr",
			transactionHash: "cd".repeat(32),
			expiresAt: "2030-01-01T00:04:00.000Z",
		});
	}

	verifySignedTransaction(): string {
		return "cd".repeat(32);
	}

	submitSignedTransaction(): Promise<void> {
		return Promise.resolve();
	}

	lookupTransaction(): Promise<{ status: "pending" }> {
		return Promise.resolve({ status: "pending" });
	}
}

function runtime() {
	const repository = new MemoryPaymentRepository();
	const service = new PaymentIntentService({
		quotes: repository,
		intents: repository,
		stellar: new FakeGateway(),
		networkPassphrase: quote.networkPassphrase,
		usdcIssuer: issuer,
	});
	return {
		repository,
		runtime: { service, isReady: async () => true },
	};
}

const authEnv = {
	...env,
	PAYMENTS_ENABLED: true,
	SERVICE_TOKEN: "service-secret",
};

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
			env: authEnv,
			payments: runtime().runtime,
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: { authorization: "Bearer service-secret" },
		});
		expect(response.statusCode).toBe(401);
	});
});

describe("GET /v1/payment-intents/:intentId", () => {
	test("returns 401 when the service token is missing", async () => {
		const app = await buildServer({
			env: authEnv,
			payments: runtime().runtime,
		});
		const response = await app.inject({
			method: "GET",
			url: "/v1/payment-intents/pi_123456789",
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	test("returns 401 when the principal header is missing", async () => {
		const app = await buildServer({
			env: authEnv,
			payments: runtime().runtime,
		});
		const response = await app.inject({
			method: "GET",
			url: "/v1/payment-intents/pi_123456789",
			headers: { authorization: "Bearer service-secret" },
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	test("returns 404 for a non-existent payment intent id", async () => {
		const app = await buildServer({
			env: authEnv,
			payments: runtime().runtime,
		});
		const response = await app.inject({
			method: "GET",
			url: `/v1/payment-intents/${crypto.randomUUID()}`,
			headers: {
				authorization: "Bearer service-secret",
				"x-principal-id": "principal-1",
			},
		});
		expect(response.statusCode).toBe(404);
		await app.close();
	});

	test("returns the stored intent for its owner", async () => {
		const { repository, runtime: paymentRuntime } = runtime();
		const { intent } = await paymentRuntime.service.createIntent({
			quoteId: "quote-1",
			principalId: "principal-1",
			idempotencyKey: "payment-key-get",
		});
		const app = await buildServer({
			env: authEnv,
			payments: paymentRuntime,
		});
		const response = await app.inject({
			method: "GET",
			url: `/v1/payment-intents/${intent.intentId}`,
			headers: {
				authorization: "Bearer service-secret",
				"x-principal-id": "principal-1",
			},
		});
		expect(response.statusCode).toBe(200);
		expect(response.json().intentId).toBe(intent.intentId);
		expect(repository.intents.get(intent.intentId)).toBeDefined();
		await app.close();
	});

	test("returns 403 when a different principal requests the intent", async () => {
		const { runtime: paymentRuntime } = runtime();
		const { intent } = await paymentRuntime.service.createIntent({
			quoteId: "quote-1",
			principalId: "principal-1",
			idempotencyKey: "payment-key-owner",
		});
		const app = await buildServer({
			env: authEnv,
			payments: paymentRuntime,
		});
		const response = await app.inject({
			method: "GET",
			url: `/v1/payment-intents/${intent.intentId}`,
			headers: {
				authorization: "Bearer service-secret",
				"x-principal-id": "principal-2",
			},
		});
		expect(response.statusCode).toBe(403);
		await app.close();
	});
});
