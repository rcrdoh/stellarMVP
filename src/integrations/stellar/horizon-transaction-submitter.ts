import { Buffer } from "node:buffer";
import {
	FeeBumpTransaction,
	Horizon,
	Networks,
	Transaction,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { TransactionSubmitter } from "../../services/wallets/ports/transaction-submitter.js";

/**
 * Broadcasts a wallet-signed envelope to Horizon. This adapter lives on the
 * client side of the payment flow: the wallet kit signs locally and only the
 * resulting XDR reaches this class, so the payer's secret key is never handled
 * here (Audit H3 — never let a third party touch signing keys).
 */
export class HorizonTransactionSubmitter implements TransactionSubmitter {
	private readonly server: Horizon.Server;

	constructor(
		horizonUrl: string,
		private readonly networkPassphrase: string = Networks.TESTNET,
	) {
		this.server = new Horizon.Server(horizonUrl);
	}

	async submit(signedTxXdr: string): Promise<{ transactionHash: string }> {
		const transaction = TransactionBuilder.fromXDR(
			signedTxXdr,
			this.networkPassphrase,
		);
		if (
			transaction instanceof FeeBumpTransaction ||
			!(transaction instanceof Transaction)
		) {
			throw new Error("Unsupported transaction envelope.");
		}
		if (transaction.signatures.length === 0) {
			throw new Error("Signed envelope carries no signature.");
		}
		const response = await this.server.submitTransaction(transaction);
		return {
			transactionHash:
				response.hash ?? Buffer.from(transaction.hash()).toString("hex"),
		};
	}
}
