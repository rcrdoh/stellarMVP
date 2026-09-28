/**
 * Port for broadcasting a signed Stellar transaction. Signing happens inside
 * the wallet provider; only the resulting signed envelope XDR crosses this
 * boundary, so no private key ever reaches application code.
 */
export interface TransactionSubmitter {
	/**
	 * Submits a base64-encoded signed envelope to the network and resolves with
	 * the transaction hash reported by Horizon. Implementations must throw on a
	 * rejected submission so the caller can surface an indeterminate outcome
	 * instead of assuming success.
	 */
	submit(signedTxXdr: string): Promise<{ transactionHash: string }>;
}
