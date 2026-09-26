import { describe, expect, test } from "bun:test";
import {
	type ApprovedPaymentQuote,
	amountAtomicToStellar,
	type PaymentIntent,
	stellarAmountToAtomic,
} from "../src/domain/payments.js";
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
	quote: ApprovedPaymentQuote | null = quote;
	intents = new Map<string, PaymentIntent>();
	orders = new Map<string, string>();

	findApprovedQuote(): Promise<ApprovedPaymentQuote | null> {
		return Promise.resolve(this.quote);
	}

	findByIdempotencyKey(
		principalId: string,
		idempotencyKey: string,
	): Promise<PaymentIntent | null> {
		return Promise.resolve(
			[...this.intents.values()].find(
				(intent) =>
					intent.principalId === principalId &&
					intent.idempotencyKey === idempotencyKey,
			) ?? null,
		);
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
		if (!current || current.status !== expectedStatus)
			return Promise.resolve(false);
		this.intents.set(intent.intentId, intent);
		return Promise.resolve(true);
	}

	settleConfirmed(
		intent: PaymentIntent,
		_expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		this.intents.set(intent.intentId, intent);
		this.orders.set(intent.orderId, "paid");
		return Promise.resolve(true);
	}

	settleFailed(
		intent: PaymentIntent,
		_expectedStatus: PaymentIntent["status"],
	): Promise<boolean> {
		this.intents.set(intent.intentId, intent);
		this.orders.set(intent.orderId, "payment_failed");
		return Promise.resolve(true);
	}
}

class FakeGateway implements StellarIntentGateway {
	confirmed = false;

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

	lookupTransaction(): Promise<
		{ status: "confirmed"; ledger: number } | { status: "pending" }
	> {
		return Promise.resolve(
			this.confirmed
				? { status: "confirmed", ledger: 42 }
				: { status: "pending" },
		);
	}
}

function setup() {
	const repository = new MemoryPaymentRepository();
	const gateway = new FakeGateway();
	const service = new PaymentIntentService({
		quotes: repository,
		intents: repository,
		stellar: gateway,
		networkPassphrase: quote.networkPassphrase,
		usdcIssuer: issuer,
	});
	return { repository, gateway, service };
}

describe("wallet payment intents", () => {
	test("uses atomic amounts without floating point conversion", () => {
		expect(amountAtomicToStellar("12500000")).toBe("1.25");
		expect(stellarAmountToAtomic("1.25")).toBe("12500000");
		expect(stellarAmountToAtomic("1.25000001")).toBeUndefined();
	});

	test("creates and replays an intent idempotently", async () => {
		const { service } = setup();
		const first = await service.createIntent({
			quoteId: "quote-1",
			principalId: "principal-1",
			idempotencyKey: "payment-key-1",
		});
		const replay = await service.createIntent({
			quoteId: "quote-1",
			principalId: "principal-1",
			idempotencyKey: "payment-key-1",
		});
		expect(first.replayed).toBe(false);
		expect(replay.replayed).toBe(true);
		expect(replay.intent.intentId).toBe(first.intent.intentId);
	});

	test("submits and reconciles a confirmed transaction", async () => {
		const { service, gateway, repository } = setup();
		const { intent } = await service.createIntent({
			quoteId: "quote-1",
			principalId: "principal-1",
			idempotencyKey: "payment-key-2",
		});
		gateway.confirmed = true;
		const confirmed = await service.submitSignedTransaction({
			intentId: intent.intentId,
			principalId: "principal-1",
			signedXdr: "signed-xdr",
		});
		expect(confirmed.status).toBe("confirmed");
		expect(confirmed.ledger).toBe(42);
		expect(repository.orders.get("order-1")).toBe("paid");
	});
});
