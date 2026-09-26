import { Buffer } from "node:buffer";
import {
	Asset,
	FeeBumpTransaction,
	Horizon,
	Keypair,
	Networks,
	Operation,
	Transaction,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { errorCodes } from "../../domain/error-codes.js";
import { AppError } from "../../domain/errors.js";
import {
	type ApprovedPaymentQuote,
	amountAtomicToStellar,
	type PaymentIntent,
	stellarAmountToAtomic,
} from "../../domain/payments.js";
import type {
	BuiltPaymentTransaction,
	PaymentLookup,
	StellarIntentGateway as StellarIntentGatewayPort,
} from "../../services/payment-intent-service.js";

const maximumTransactionTtlSeconds = 300;

type PaymentOperationView = Readonly<{
	type: string;
	from?: string;
	to?: string;
	asset_type?: string;
	asset_code?: string;
	asset_issuer?: string;
	amount?: string;
}>;

export class StellarIntentGateway implements StellarIntentGatewayPort {
	private readonly server: Horizon.Server;

	constructor(
		horizonUrl: string,
		private readonly usdcIssuer: string,
		private readonly networkPassphrase: string = Networks.TESTNET,
		private readonly maximumFeePerOperation = 100_000,
	) {
		if (networkPassphrase !== Networks.TESTNET) {
			throw new Error("Wallet payments support Stellar Testnet only.");
		}
		new Asset("USDC", usdcIssuer);
		this.server = new Horizon.Server(horizonUrl);
	}

	async buildUnsignedTransaction(
		quote: ApprovedPaymentQuote,
	): Promise<BuiltPaymentTransaction> {
		this.assertQuote(quote);
		try {
			const source = await this.server.loadAccount(quote.payerAddress);
			const baseFee = await this.server.fetchBaseFee();
			const buildTime = new Date(Math.floor(Date.now() / 1000) * 1000);
			const remaining = Math.floor(
				(Date.parse(quote.expiresAt) - buildTime.getTime()) / 1000,
			);
			const ttl = Math.min(maximumTransactionTtlSeconds, remaining);
			if (ttl < 1) throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
			const transaction = new TransactionBuilder(source, {
				fee: String(
					Math.min(Math.max(baseFee, 100), this.maximumFeePerOperation),
				),
				networkPassphrase: this.networkPassphrase,
			})
				.addOperation(
					Operation.payment({
						destination: quote.paymentLeg.payTo,
						amount: amountAtomicToStellar(quote.paymentLeg.amountAtomic),
						asset: new Asset("USDC", quote.assetIssuer),
					}),
				)
				.setTimebounds(buildTime, new Date(buildTime.getTime() + ttl * 1000))
				.build();
			return {
				unsignedXdr: transaction.toXdr(),
				transactionHash: Buffer.from(transaction.hash()).toString("hex"),
				expiresAt: new Date(buildTime.getTime() + ttl * 1000).toISOString(),
			};
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
		}
	}

	verifySignedTransaction(signedXdr: string, intent: PaymentIntent): string {
		try {
			const transaction = TransactionBuilder.fromXDR(
				signedXdr,
				this.networkPassphrase,
			);
			if (
				transaction instanceof FeeBumpTransaction ||
				!(transaction instanceof Transaction)
			) {
				throw new Error("Unsupported transaction envelope.");
			}
			const hash = Buffer.from(transaction.hash()).toString("hex");
			if (
				transaction.networkPassphrase !== intent.networkPassphrase ||
				transaction.source !== intent.payerAddress ||
				hash !== intent.transactionHash ||
				transaction.signatures.length === 0
			) {
				throw new Error("Transaction does not match intent.");
			}
			const payer = Keypair.fromPublicKey(intent.payerAddress);
			if (
				!transaction.signatures.some((signature) =>
					payer.verify(transaction.hash(), signature.signature),
				)
			) {
				throw new Error("Payer signature is missing.");
			}
			return hash;
		} catch {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
	}

	async submitSignedTransaction(
		signedXdr: string,
		intent: PaymentIntent,
	): Promise<void> {
		this.verifySignedTransaction(signedXdr, intent);
		const transaction = TransactionBuilder.fromXDR(
			signedXdr,
			this.networkPassphrase,
		);
		if (!(transaction instanceof Transaction)) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
		await this.server.submitTransaction(transaction);
	}

	async lookupTransaction(intent: PaymentIntent): Promise<PaymentLookup> {
		if (!intent.transactionHash) return { status: "not_found" };
		const record = await this.server
			.transactions()
			.transaction(intent.transactionHash)
			.call()
			.catch((error: unknown) => {
				if (isNotFound(error)) return undefined;
				throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
			});
		if (!record) return { status: "not_found" };
		if (!record.successful) return { status: "failed" };
		if (record.source_account !== intent.payerAddress) {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
		const operations = await this.server
			.operations()
			.forTransaction(intent.transactionHash)
			.call()
			.catch(() => {
				throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
			});
		const records = operations.records as unknown as PaymentOperationView[];
		const operation = records.length === 1 ? records[0] : undefined;
		if (
			operation?.type !== "payment" ||
			operation.from !== intent.payerAddress ||
			operation.to !== intent.paymentLeg.payTo ||
			operation.asset_type !== "credit_alphanum4" ||
			operation.asset_code !== intent.assetCode ||
			operation.asset_issuer !== intent.assetIssuer ||
			operation.amount === undefined ||
			stellarAmountToAtomic(operation.amount) !== intent.paymentLeg.amountAtomic
		) {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
		return { status: "confirmed", ledger: record.ledger_attr };
	}

	private assertQuote(quote: ApprovedPaymentQuote): void {
		if (
			quote.networkPassphrase !== this.networkPassphrase ||
			quote.assetCode !== "USDC" ||
			quote.assetIssuer !== this.usdcIssuer
		) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
	}
}

function isNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("response" in error)) {
		return false;
	}
	const response = (error as { response?: { status?: number } }).response;
	return response?.status === 404;
}
