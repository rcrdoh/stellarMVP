import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import type {
	ApprovedPaymentQuote,
	PaymentIntent,
} from "../src/domain/payments.js";
import { paymentIntentSchema } from "../src/domain/payments.js";
import { buildServer } from "../src/http/server.js";
import type { PaymentReconciliationRepository } from "../src/services/payment/ports/payment-reconciliation-repository.js";
import { SettlementReconciliationService } from "../src/services/payment/settlement-reconciliation-service.js";
import {
	type PaymentIntentRepository,
	PaymentIntentService,
	type PaymentLookup,
	type PaymentQuoteRepository,
	type StellarIntentGateway,
} from "../src/services/payment-intent-service.js";

const payerAddress = `G${"A".repeat(55)}`;
const merchantAddress = `G${"B".repeat(55)}`;
const issuer = `G${"C".repeat(55)}`;
const transactionHash = "cd".repeat(32);

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
	implements
		PaymentQuoteRepository,
		PaymentIntentRepository,
		PaymentReconciliationRepository
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
		expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		const current = this.intents.get(intent.intentId);
		if (!current || current.status !== expectedStatus) {
			return Promise.resolve(false);
		}
		this.intents.set(intent.intentId, intent);
		return Promise.resolve(true);
	}

	settleFailed(
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

	findIndeterminate(
		olderThan: string,
		limit: number,
	): Promise<PaymentIntent[]> {
		const candidates = [...this.intents.values()]
			.filter(
				(intent) =>
					(intent.status === "submitting" || intent.status === "submitted") &&
					Date.parse(intent.updatedAt) <= Date.parse(olderThan),
			)
			.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
		return Promise.resolve(candidates.slice(0, limit));
	}
}

class FakeGateway implements StellarIntentGateway {
	lookup: PaymentLookup = { status: "pending" };

	buildUnsignedTransaction(): Promise<{
		unsignedXdr: string;
		transactionHash: string;
		expiresAt: string;
	}> {
		return Promise.resolve({
			unsignedXdr: "unsigned-xdr",
			transactionHash,
			expiresAt: "2030-01-01T00:04:00.000Z",
		});
	}

	verifySignedTransaction(): string {
		return transactionHash;
	}

	submitSignedTransaction(): Promise<void> {
		return Promise.resolve();
	}

	lookupTransaction(): Promise<PaymentLookup> {
		return Promise.resolve(this.lookup);
	}
}

function submittedIntent(
	overrides: Partial<PaymentIntent> = {},
): PaymentIntent {
	return paymentIntentSchema.parse({
		intentId: crypto.randomUUID(),
		quoteId: quote.quoteId,
		orderId: quote.orderId,
		principalId: "principal-1",
		quoteHash: quote.quoteHash,
		idempotencyKey: "payment-key-reconcile",
		requestFingerprint: "ef".repeat(32),
		status: "submitted",
		networkPassphrase: quote.networkPassphrase,
		payerAddress,
		assetCode: quote.assetCode,
		assetIssuer: issuer,
		assetDecimals: 7,
		totalAmountAtomic: "12500000",
		paymentLeg: quote.paymentLeg,
		unsignedXdr: "unsigned-xdr",
		transactionHash,
		ledger: null,
		expiresAt: "2030-01-01T00:04:00.000Z",
		createdAt: "2029-01-01T00:00:00.000Z",
		updatedAt: "2029-01-01T00:00:00.000Z",
		...overrides,
	});
}

function makeRuntime() {
	const repository = new MemoryPaymentRepository();
	const gateway = new FakeGateway();
	const service = new PaymentIntentService({
		quotes: repository,
		intents: repository,
		stellar: gateway,
		networkPassphrase: quote.networkPassphrase,
		usdcIssuer: issuer,
	});
	const reconciliation = new SettlementReconciliationService({
		persistence: repository,
		stellar: gateway,
		now: () => new Date("2030-01-01T00:00:00.000Z"),
		minAgeSeconds: 30,
	});
	return {
		repository,
		gateway,
		runtime: {
			service,
			reconciliation,
			isReady: async () => true,
		},
	};
}

const authEnv = {
	...env,
	PAYMENTS_ENABLED: true,
	SERVICE_TOKEN: "service-secret",
};

const ownerHeaders = {
	authorization: "Bearer service-secret",
	"x-principal-id": "principal-1",
};

describe("POST /v1/payment-intents/:intentId/reconcile (Module 9)", () => {
	test("promotes a submitted intent to paid and returns a receipt", async () => {
		const { repository, gateway, runtime } = makeRuntime();
		const intent = submittedIntent();
		repository.intents.set(intent.intentId, intent);
		gateway.lookup = { status: "confirmed", ledger: 4242 };
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${intent.intentId}/reconcile`,
			headers: ownerHeaders,
		});

		expect(response.statusCode).toBe(200);
		const receipt = response.json();
		expect(receipt.status).toBe("paid");
		expect(receipt.ledger).toBe(4242);
		expect(receipt.stellarExpertUrl).toContain(transactionHash);
		expect(receipt.confirmedAt).toBeDefined();
		await app.close();
	});

	test("marks an intent failed when Horizon reports the transaction failed", async () => {
		const { repository, gateway, runtime } = makeRuntime();
		const intent = submittedIntent();
		repository.intents.set(intent.intentId, intent);
		gateway.lookup = { status: "failed" };
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${intent.intentId}/reconcile`,
			headers: ownerHeaders,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().status).toBe("failed");
		await app.close();
	});

	test("keeps the intent indeterminate while Horizon is still pending", async () => {
		const { repository, runtime } = makeRuntime();
		const intent = submittedIntent();
		repository.intents.set(intent.intentId, intent);
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${intent.intentId}/reconcile`,
			headers: ownerHeaders,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().status).toBe("submitted");
		await app.close();
	});

	test("rejects an invalid transactionHash body via Zod (Audit L2)", async () => {
		const { runtime } = makeRuntime();
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${crypto.randomUUID()}/reconcile`,
			headers: ownerHeaders,
			payload: { transactionHash: "not-a-hash" },
		});

		expect(response.statusCode).toBeGreaterThanOrEqual(400);
		expect(response.statusCode).toBeLessThan(500);
		await app.close();
	});

	test("returns 403 when another principal tries to reconcile the intent", async () => {
		const { repository, runtime } = makeRuntime();
		const intent = submittedIntent();
		repository.intents.set(intent.intentId, intent);
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${intent.intentId}/reconcile`,
			headers: {
				authorization: "Bearer service-secret",
				"x-principal-id": "principal-2",
			},
		});

		expect(response.statusCode).toBe(403);
		await app.close();
	});

	test("fails closed when the reconciliation worker is absent", async () => {
		const { repository, runtime } = makeRuntime();
		const intent = submittedIntent();
		repository.intents.set(intent.intentId, intent);
		const app = await buildServer({
			env: authEnv,
			payments: { service: runtime.service, isReady: async () => true },
		});

		const response = await app.inject({
			method: "POST",
			url: `/v1/payment-intents/${intent.intentId}/reconcile`,
			headers: ownerHeaders,
		});

		expect(response.statusCode).toBe(503);
		await app.close();
	});
});

describe("POST /v1/payment-intents/reconcile batch sweep (Module 9)", () => {
	test("reconciles indeterminate intents older than the min age", async () => {
		const { repository, gateway, runtime } = makeRuntime();
		const stale = submittedIntent({ updatedAt: "2028-01-01T00:00:00.000Z" });
		repository.intents.set(stale.intentId, stale);
		gateway.lookup = { status: "confirmed", ledger: 77 };
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents/reconcile",
			headers: ownerHeaders,
			payload: { limit: 10 },
		});

		expect(response.statusCode).toBe(200);
		const report = response.json();
		expect(report.scanned).toBe(1);
		expect(report.confirmed).toBe(1);
		expect(report.outcomes[0].intentId).toBe(stale.intentId);
		await app.close();
	});

	test("rejects a non-positive limit via Zod (Audit L2)", async () => {
		const { runtime } = makeRuntime();
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents/reconcile",
			headers: ownerHeaders,
			payload: { limit: -1 },
		});

		expect(response.statusCode).toBeGreaterThanOrEqual(400);
		expect(response.statusCode).toBeLessThan(500);
		await app.close();
	});

	test("defaults to a bounded limit when no body is sent", async () => {
		const { runtime } = makeRuntime();
		const app = await buildServer({ env: authEnv, payments: runtime });

		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents/reconcile",
			headers: ownerHeaders,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().scanned).toBe(0);
		await app.close();
	});
});
