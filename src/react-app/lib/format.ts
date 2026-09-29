/** Pure formatting helpers (no DOM, no React). All amounts are USDC with 7
 * decimals; atomic strings are stroops. */

export function stroopsToUsdc(amountAtomic: string): number {
	const parsed = Number.parseInt(amountAtomic, 10);
	if (Number.isNaN(parsed)) {
		return 0;
	}
	return parsed / 10_000_000;
}

export function usdcToStroops(amount: number): string {
	return Math.round(amount * 10_000_000).toString();
}

export function formatUsd(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

export function formatMatchScore(score: number): string {
	return `${Math.round(score * 100)}%`;
}

export function truncateAddress(address: string, size = 4): string {
	if (address.length <= size * 2 + 1) {
		return address;
	}
	return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function explorerUrl(
	network: "testnet" | "mainnet",
	hash: string,
): string {
	return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}
