import { describe, expect, test } from "bun:test";
import {
	Account,
	Asset,
	Keypair,
	Networks,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { errorCodes } from "../src/domain/error-codes.js";
import { paymentIntentSchema } from "../src/domain/payments.js";
import { StellarPaymentGateway } from "../src/integrations/stellar/stellar-payment-gateway.js";

function signedPayment(signer = payer, networkPassphrase = Networks.TESTNET) {
	const tx = new TransactionBuilder(new Account(payer.publicKey(), "1"), {
		fee: "100",
		networkPassphrase,
	})
		.addOperation(
			Operation.payment({
				destination: merchant.publicKey(),
				amount: "1.25",
				asset: new Asset("USDC", issuer.publicKey()),
			}),
		)
		.setTimeout(300)
		.build();
	tx.sign(signer);
	return tx;
}

const payer = Keypair.random();
const merchant = Keypair.random();
const issuer = Keypair.random();
const transaction = signedPayment();
const intent = paymentIntentSchema.parse({
	intentId: "00000000-0000-4000-8000-000000000001",
	quoteId: "quote-1",
	orderId: "order-1",
	quoteHash: "22".repeat(32),
	principalId: "user-1",
	idempotencyKey: "payment-key-0001",
	requestFingerprint: "00".repeat(32),
	status: "awaiting_signature",
	networkPassphrase: Networks.TESTNET,
	payerAddress: payer.publicKey(),
	assetCode: "USDC",
	assetIssuer: issuer.publicKey(),
	assetDecimals: 7,
	totalAmountAtomic: "12500000",
	paymentLegs: [
		{
			purpose: "merchant",
			payTo: merchant.publicKey(),
			amountAtomic: "12500000",
		},
	],
	unsignedXdr: transaction.toXdr(),
	transactionHash: Buffer.from(transaction.hash()).toString("hex"),
	ledger: null,
	expiresAt: new Date(Date.now() + 300_000).toISOString(),
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});
const gateway = new StellarPaymentGateway(
	"https://horizon-testnet.stellar.org",
	issuer.publicKey(),
);

describe("Stellar payment transaction verification", () => {
	test("accepts a payer-signed XDR matching the exact approved transaction hash", () => {
		expect(gateway.verifySignedTransaction(transaction.toXdr(), intent)).toBe(
			Buffer.from(transaction.hash()).toString("hex"),
		);
	});

	test("rejects a signed XDR whose operation differs from the approved XDR", () => {
		const changed = new TransactionBuilder(
			new Account(payer.publicKey(), "1"),
			{
				fee: "100",
				networkPassphrase: Networks.TESTNET,
			},
		)
			.addOperation(
				Operation.payment({
					destination: merchant.publicKey(),
					amount: "1.26",
					asset: new Asset("USDC", issuer.publicKey()),
				}),
			)
			.setTimeout(300)
			.build();
		changed.sign(payer);

		expect(() =>
			gateway.verifySignedTransaction(changed.toXdr(), intent),
		).toThrow();
	});

	test("rejects a valid XDR signed by a key other than the payer", () => {
		const signedByOther = signedPayment(Keypair.random());
		let error: unknown;
		try {
			gateway.verifySignedTransaction(signedByOther.toXdr(), intent);
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			errorCode: { code: errorCodes.PAYMENT_TRANSACTION_MISMATCH.code },
		});
	});

	test("rejects a payer signature made for another Stellar network", () => {
		const signedOnMainnet = signedPayment(payer, Networks.PUBLIC);
		expect(() =>
			gateway.verifySignedTransaction(signedOnMainnet.toXdr(), intent),
		).toThrow();
	});
});
