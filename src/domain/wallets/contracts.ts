import { z } from "zod";

/**
 * Stellar networks supported by the wallet integration. Values mirror the
 * `Networks` enum exposed by `@creit.tech/stellar-wallets-kit` so the domain
 * stays independent from the SDK while remaining interoperable with it.
 */
export const walletNetworkSchema = z.enum([
	"PUBLIC",
	"TESTNET",
	"FUTURENET",
	"SANDBOX",
	"STANDALONE",
]);
export type WalletNetwork = z.infer<typeof walletNetworkSchema>;

/**
 * Deterministic mapping from the domain network name to the SDK passphrase.
 * Wallet signing requires the passphrase, never the short label.
 */
export const walletNetworkPassphrases: Record<WalletNetwork, string> = {
	PUBLIC: "Public Global Stellar Network ; September 2015",
	TESTNET: "Test SDF Network ; September 2015",
	FUTURENET: "Test SDF Future Network ; October 2022",
	SANDBOX: "Local Sandbox Stellar Network ; September 2022",
	STANDALONE: "Standalone Network ; February 2017",
};

/** Stellar ed25519 public key (`G...`) used as the wallet account address. */
export const stellarAddressSchema = z.string().regex(/^G[A-Z2-7]{55}$/);

export const walletIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9_-]+$/i);
export type WalletId = z.infer<typeof walletIdSchema>;

/** A materialized wallet session owned by the connected kit. */
export const walletSessionSchema = z
	.object({
		walletId: walletIdSchema,
		address: stellarAddressSchema,
		network: walletNetworkSchema,
		connectedAt: z.string().datetime(),
	})
	.strict();
export type WalletSession = z.infer<typeof walletSessionSchema>;

/** Request handed to the connector to sign a transaction envelope. */
export const signTransactionRequestSchema = z
	.object({
		xdr: z.string().min(1),
		network: walletNetworkSchema,
		address: stellarAddressSchema.optional(),
	})
	.strict();
export type SignTransactionRequest = z.infer<
	typeof signTransactionRequestSchema
>;

/** Result of a wallet signature; the connector never submits to the network. */
export const signedTransactionSchema = z
	.object({
		signedTxXdr: z.string().min(1),
		signerAddress: stellarAddressSchema.optional(),
	})
	.strict();
export type SignedTransaction = z.infer<typeof signedTransactionSchema>;

/**
 * Truncates a Stellar address for logs and UI labels: `GABC...WXYZ`.
 * Short inputs pass through unchanged so the helper never fabricates a slice.
 */
export function truncateAddress(address: string, visible = 4): string {
	const safeVisible = Math.max(1, Math.floor(visible));
	if (address.length <= safeVisible * 2) {
		return address;
	}
	return `${address.slice(0, safeVisible)}...${address.slice(-safeVisible)}`;
}
