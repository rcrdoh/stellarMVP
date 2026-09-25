import { Buffer } from "node:buffer";
import {
	Asset,
	FeeBumpTransaction,
	Horizon,
	Keypair,
	Memo,
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
	StellarPaymentGateway as StellarPaymentGatewayPort,
} from "../../services/payment-service.js";

const maximumTransactionTtlSeconds = 300;
export class StellarPaymentGateway implements StellarPaymentGatewayPort {
	private readonly server: Horizon.Server;

	constructor(
		horizonUrl: string,
		private readonly usdcIssuer: string,
		private readonly networkPassphrase: string = Networks.TESTNET,
		private readonly maximumFeePerOperation = 100_000,
	) {
		if (networkPassphrase !== Networks.TESTNET) {
			throw new Error("The payment pilot supports Stellar Testnet only.");
		}
		new Asset("USDC", usdcIssuer);
		this.server = new Horizon.Server(horizonUrl);
	}

	async buildUnsignedTransaction(
		quote: ApprovedPaymentQuote,
	): Promise<BuiltPaymentTransaction> {
		this.assertTestnetQuote(quote);

		try {
			const sourceAccount = await this.server.loadAccount(quote.payerAddress);
			const currentBaseFee = await this.server.fetchBaseFee();
			const buildTime = new Date(Math.floor(Date.now() / 1000) * 1000);
			const remainingQuoteTtl = Math.floor(
				(Date.parse(quote.expiresAt) - buildTime.getTime()) / 1000,
			);
			const ttl = Math.min(maximumTransactionTtlSeconds, remainingQuoteTtl);
			if (ttl < 1) {
				throw new AppError(errorCodes.PAYMENT_QUOTE_EXPIRED);
			}
			const feePerOperation = Math.min(
				Math.max(currentBaseFee, 100),
				this.maximumFeePerOperation,
			);
			const transaction = new TransactionBuilder(sourceAccount, {
				fee: String(feePerOperation),
				networkPassphrase: this.networkPassphrase,
			});

			if (quote.memo !== undefined) {
				transaction.addMemo(Memo.text(quote.memo));
			}
			const asset = new Asset(quote.assetCode, quote.assetIssuer);
			for (const leg of quote.paymentLegs) {
				transaction.addOperation(
					Operation.payment({
						destination: leg.payTo,
						amount: amountAtomicToStellar(leg.amountAtomic),
						asset,
					}),
				);
			}

			const transactionExpiresAt = new Date(buildTime.getTime() + ttl * 1000);
			const builtTransaction = transaction
				.setTimebounds(buildTime, transactionExpiresAt)
				.build();
			return {
				unsignedXdr: builtTransaction.toXdr(),
				transactionHash: Buffer.from(builtTransaction.hash()).toString("hex"),
				expiresAt: transactionExpiresAt.toISOString(),
			};
		} catch (error) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
		}
	}

	verifySignedTransaction(signedXdr: string, intent: PaymentIntent): string {
		try {
			const transaction = TransactionBuilder.fromXDR(
				signedXdr,
				this.networkPassphrase,
			);
			if (transaction instanceof FeeBumpTransaction) {
				throw new Error(
					"Fee-bump envelopes are not accepted by this payment flow.",
				);
			}
			if (!(transaction instanceof Transaction)) {
				throw new Error("Unsupported Stellar transaction envelope.");
			}
			const transactionHash = Buffer.from(transaction.hash()).toString("hex");
			if (
				transaction.networkPassphrase !== intent.networkPassphrase ||
				transaction.source !== intent.payerAddress ||
				transactionHash !== intent.transactionHash ||
				transaction.signatures.length === 0
			) {
				throw new Error(
					"Signed transaction does not match the approved intent.",
				);
			}

			const payer = Keypair.fromPublicKey(intent.payerAddress);
			const hasPayerSignature = transaction.signatures.some((signature) =>
				payer.verify(transaction.hash(), signature.signature),
			);
			if (!hasPayerSignature) {
				throw new Error("The payer did not sign this transaction.");
			}
			return transactionHash;
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
		if (intent.transactionHash === null) {
			return { status: "not_found" };
		}
		const transactionRecord = await this.server
			.transactions()
			.transaction(intent.transactionHash)
			.call()
			.catch((error: unknown) => {
				if (isNotFound(error)) {
					return undefined;
				}
				throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
			});
		if (transactionRecord === undefined) {
			return { status: "not_found" };
		}
		const record = transactionRecord;
		if (!record.successful) {
			return { status: "failed" };
		}
		if (
			record.source_account !== intent.payerAddress ||
			(intent.memo !== undefined &&
				(record.memo_type !== "text" || record.memo !== intent.memo))
		) {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}

		const operationPage = await this.server
			.operations()
			.forTransaction(intent.transactionHash)
			.call()
			.catch(() => {
				throw new AppError(errorCodes.DEPENDENCY_UNAVAILABLE);
			});
		const records = operationPage.records as unknown as PaymentOperationView[];
		if (!records || !paymentOperationsMatch(records, intent)) {
			throw new AppError(errorCodes.OUTCOME_INDETERMINATE);
		}
		return { status: "confirmed", ledger: record.ledger_attr };
	}

	private assertTestnetQuote(quote: ApprovedPaymentQuote): void {
		if (
			quote.networkPassphrase !== this.networkPassphrase ||
			quote.assetCode !== "USDC" ||
			quote.assetIssuer !== this.usdcIssuer
		) {
			throw new AppError(errorCodes.PAYMENT_TRANSACTION_MISMATCH);
		}
	}
}

type PaymentOperationView = Readonly<{
	type: string;
	from?: string;
	to?: string;
	asset_type?: string;
	asset_code?: string;
	asset_issuer?: string;
	amount?: string;
}>;

function paymentOperationsMatch(
	operations: readonly PaymentOperationView[],
	intent: PaymentIntent,
): boolean {
	if (operations.length !== intent.paymentLegs.length) {
		return false;
	}
	return intent.paymentLegs.every((leg, index) => {
		const operation = operations[index];
		if (
			operation?.type !== "payment" ||
			operation.from !== intent.payerAddress ||
			operation.to !== leg.payTo ||
			operation.asset_type === "native" ||
			operation.asset_code !== intent.assetCode ||
			operation.asset_issuer !== intent.assetIssuer
		) {
			return false;
		}
		return (
			operation.amount !== undefined &&
			stellarAmountToAtomic(operation.amount) === leg.amountAtomic
		);
	});
}

function isNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null || !("response" in error)) {
		return false;
	}
	const response = (error as { response?: { status?: number } }).response;
	return response?.status === 404;
}
