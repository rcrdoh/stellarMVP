import { describe, expect, test } from "bun:test";
import { errorCodes } from "../src/domain/error-codes.js";
import {
	type ApprovedPaymentQuote,
	amountAtomicToStellar,
	type PaymentIntent,
	type PaymentIntentStatus,
	stellarAmountToAtomic,
} from "../src/domain/payments.js";
import {
	PaymentIntentConflictError,
	type PaymentIntentRepository,
	type PaymentQuoteReader,
	PaymentService,
	type StellarPaymentGateway,
} from "../src/services/payment-service.js";

const fixedNow = new Date("2026-09-24T12:00:00.000Z");
const payerAddress = `G${"A".repeat(55)}`;
const merchantAddress = `G${"B".repeat(55)}`;
const platformAddress = `G${"C".repeat(55)}`;
const issuerAddress = `G${"D".repeat(55)}`;
const transactionHash = "ab".repeat(32);

function makeQuote(
	overrides: Partial<ApprovedPaymentQuote> = {},
): ApprovedPaymentQuote {
	return {
		quoteId: "quote-1",
		orderId: "order-1",
		quoteHash: "11".repeat(32),
		principalId: "user-1",
		status: "approved",
		networkPassphrase: "Test SDF Network ; September 2015",
		payerAddress,
		assetCode: "USDC",
		assetIssuer: issuerAddress,
		assetDecimals: 7,
		paymentLegs: [
			{ purpose: "merchant", payTo: merchantAddress, amountAtomic: "12500000" },
		],
		expiresAt: "2026-09-24T13:00:00.000Z",
		...overrides,
	};
}

class MemoryPaymentStore
	implements PaymentQuoteReader, PaymentIntentRepository
{
	readonly quotes = new Map<string, unknown>();
	readonly intents = new Map<string, PaymentIntent>();

	async findQuoteById(quoteId: string) {
		return this.quotes.get(quoteId);
	}

	async findByIdempotencyKey(principalId: string, idempotencyKey: string) {
		return [...this.intents.values()].find(
			(intent) =>
				intent.principalId === principalId &&
				intent.idempotencyKey === idempotencyKey,
		);
	}

	async findIntentById(intentId: string) {
		return this.intents.get(intentId);
	}

	async insert(intent: PaymentIntent) {
		if (
			[...this.intents.values()].some(
				(saved) =>
					saved.payerAddress === intent.payerAddress &&
					["awaiting_signature", "submitting", "submitted"].includes(
						saved.status,
					),
			)
		) {
			throw new PaymentIntentConflictError();
		}
		this.intents.set(intent.intentId, intent);
	}

	async expireUnsignedForPayer(payerAddress: string, asOf: string) {
		for (const [intentId, intent] of this.intents) {
			if (
				intent.payerAddress === payerAddress &&
				intent.status === "awaiting_signature" &&
				Date.parse(intent.expiresAt) <= Date.parse(asOf)
			) {
				this.intents.set(intentId, {
					...intent,
					status: "expired",
					updatedAt: asOf,
				});
			}
		}
	}

	async compareAndSet(
		intent: PaymentIntent,
		expectedStatus: PaymentIntentStatus,
	) {
		const existing = this.intents.get(intent.intentId);
		if (!existing || existing.status !== expectedStatus) {
			return false;
		}
		this.intents.set(intent.intentId, intent);
		return true;
	}
}

class FakeStellarGateway implements StellarPaymentGateway {
	lookupStatus: "pending" | "not_found" | "confirmed" | "failed" = "pending";
	submissions = 0;
	builds = 0;

	async buildUnsignedTransaction(quote: ApprovedPaymentQuote) {
		this.builds += 1;
		return {
			unsignedXdr: "unsigned-xdr",
			transactionHash,
			expiresAt: new Date(Date.parse(quote.expiresAt) - 1_000).toISOString(),
		};
	}

	verifySignedTransaction(signedXdr: string) {
		if (signedXdr !== "signed-xdr") {
			throw new Error("transaction mismatch");
		}
		return transactionHash;
	}

	async submitSignedTransaction() {
		this.submissions += 1;
	}

	async lookupTransaction() {
		if (this.lookupStatus === "confirmed") {
			return { status: "confirmed" as const, ledger: 123 };
		}
		return { status: this.lookupStatus };
	}
}

function setup(quote = makeQuote(), now = fixedNow) {
	const store = new MemoryPaymentStore();
	store.quotes.set(quote.quoteId, quote);
	const stellar = new FakeStellarGateway();
	const service = new PaymentService({
		quotes: store,
		intents: store,
		stellar,
		networkPassphrase: "Test SDF Network ; September 2015",
		usdcIssuer: issuerAddress,
		now: () => new Date(now),
	});
	return { service, store, stellar };
}

async function createIntent(
	service: PaymentService,
	idempotencyKey = "pay-key-0001",
) {
	return service.createIntent({
		quoteId: "quote-1",
		principalId: "user-1",
		idempotencyKey,
	});
}

describe("Stellar payment domain", () => {
	test("converts atomic amounts without floating point rounding", () => {
		expect(amountAtomicToStellar("123000001")).toBe("12.3000001");
		expect(stellarAmountToAtomic("12.3000001")).toBe("123000001");
		expect(stellarAmountToAtomic("12.00000001")).toBeUndefined();
	});

	test("creates an intent only from approved quote legs and replays idempotently", async () => {
		const quote = makeQuote({
			paymentLegs: [
				{
					purpose: "merchant",
					payTo: merchantAddress,
					amountAtomic: "12500000",
				},
				{ purpose: "platform", payTo: platformAddress, amountAtomic: "250000" },
			],
		});
		const { service, stellar } = setup(quote);

		const first = await createIntent(service);
		const replay = await createIntent(service);

		expect(first.replayed).toBe(false);
		expect(replay.replayed).toBe(true);
		expect(replay.intent.intentId).toBe(first.intent.intentId);
		expect(first.intent.totalAmountAtomic).toBe("12750000");
		expect(first.intent.paymentLegs).toEqual(quote.paymentLegs);
		expect(stellar.builds).toBe(1);
	});

	test("rejects reusing an idempotency key for another quote", async () => {
		const { service, store } = setup();
		await createIntent(service);
		store.quotes.set("quote-2", makeQuote({ quoteId: "quote-2" }));

		await expect(
			service.createIntent({
				quoteId: "quote-2",
				principalId: "user-1",
				idempotencyKey: "pay-key-0001",
			}),
		).rejects.toMatchObject({
			errorCode: {
				code: errorCodes.IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD.code,
			},
		});
	});

	test("allows only one active transaction sequence per payer", async () => {
		const { service, store } = setup();
		await createIntent(service);
		store.quotes.set("quote-2", makeQuote({ quoteId: "quote-2" }));

		await expect(
			service.createIntent({
				quoteId: "quote-2",
				principalId: "user-1",
				idempotencyKey: "pay-key-0002",
			}),
		).rejects.toMatchObject({
			errorCode: { code: errorCodes.RESOURCE_STATE_CONFLICT.code },
		});
	});

	test("rejects an expired quote and a quote owned by another principal", async () => {
		const expired = setup(makeQuote({ expiresAt: "2026-09-24T11:59:59.000Z" }));
		await expect(createIntent(expired.service)).rejects.toMatchObject({
			errorCode: { code: errorCodes.PAYMENT_QUOTE_EXPIRED.code },
		});

		const unauthorized = setup(makeQuote({ principalId: "someone-else" }));
		await expect(createIntent(unauthorized.service)).rejects.toMatchObject({
			errorCode: { code: errorCodes.PAYMENT_PRINCIPAL_NOT_AUTHORIZED.code },
		});
	});

	test("accepts only the configured Testnet USDC issuer", async () => {
		const wrongIssuer = setup(makeQuote({ assetIssuer: merchantAddress }));
		await expect(createIntent(wrongIssuer.service)).rejects.toMatchObject({
			errorCode: { code: errorCodes.PAYMENT_TRANSACTION_MISMATCH.code },
		});
		expect(wrongIssuer.stellar.builds).toBe(0);
	});

	test("submits once and confirms only after ledger reconciliation", async () => {
		const { service, stellar } = setup();
		const { intent } = await createIntent(service);

		const pending = await service.submitSignedTransaction(
			intent.intentId,
			"user-1",
			"signed-xdr",
		);
		expect(pending.status).toBe("submitted");
		expect(stellar.submissions).toBe(1);

		stellar.lookupStatus = "confirmed";
		const confirmed = await service.getIntent(intent.intentId, "user-1");
		expect(confirmed.status).toBe("confirmed");
		expect(confirmed.ledger).toBe(123);
	});

	test("keeps an uncertain Stellar response in a reconcilable state", async () => {
		const { service, store, stellar } = setup();
		const { intent } = await createIntent(service);
		stellar.submitSignedTransaction = async () => {
			throw new Error("response lost after submission");
		};

		await expect(
			service.submitSignedTransaction(intent.intentId, "user-1", "signed-xdr"),
		).rejects.toMatchObject({
			errorCode: { code: errorCodes.OUTCOME_INDETERMINATE.code },
		});
		expect((await store.findIntentById(intent.intentId))?.status).toBe(
			"submitting",
		);
	});

	test("expires an unsigned intent when it is queried after its signing window", async () => {
		const { service, store } = setup(
			makeQuote({ expiresAt: "2026-09-24T12:05:00.000Z" }),
		);
		const { intent } = await createIntent(service);
		const later = new PaymentService({
			quotes: store,
			intents: store,
			stellar: new FakeStellarGateway(),
			networkPassphrase: "Test SDF Network ; September 2015",
			usdcIssuer: issuerAddress,
			now: () => new Date("2026-09-24T12:06:00.000Z"),
		});
		const expired = await later.getIntent(intent.intentId, "user-1");
		expect(expired.status).toBe("expired");
	});

	test("releases an expired unsigned intent before creating the next quote", async () => {
		const { service, store } = setup(
			makeQuote({ expiresAt: "2026-09-24T12:05:00.000Z" }),
		);
		const { intent: first } = await createIntent(service);
		store.quotes.set("quote-2", makeQuote({ quoteId: "quote-2" }));
		const later = new PaymentService({
			quotes: store,
			intents: store,
			stellar: new FakeStellarGateway(),
			networkPassphrase: "Test SDF Network ; September 2015",
			usdcIssuer: issuerAddress,
			now: () => new Date("2026-09-24T12:06:00.000Z"),
		});

		const next = await later.createIntent({
			quoteId: "quote-2",
			principalId: "user-1",
			idempotencyKey: "pay-key-0002",
		});
		expect((await store.findIntentById(first.intentId))?.status).toBe(
			"expired",
		);
		expect(next.intent.status).toBe("awaiting_signature");
	});
});
