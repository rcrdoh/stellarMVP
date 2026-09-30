import type { WalletState } from "../context/client-context.js";
import { truncateAddress } from "../lib/format.js";

/** App header: brand, wallet slot, cart toggle + badge.
 * Preserves the legacy `data-role` contract: `wallet-slot`, `cart-toggle`,
 * `cart-badge`. */
export function Header({
	wallet,
	itemCount,
	onToggleCart,
	mockMode,
}: {
	wallet: WalletState;
	itemCount: number;
	onToggleCart(): void;
	mockMode: boolean;
}) {
	return (
		<header className="sticky top-0 z-20 border-b border-stroke bg-navy/90 backdrop-blur">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
				<div className="flex items-center gap-3">
					<span className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-stroke bg-emerald-container font-mono text-sm font-bold text-emerald-text">
						CTO
					</span>
					<div>
						<p className="text-sm font-bold tracking-tight text-ink">
							ChapaTuOferta
						</p>
						<p className="font-mono text-[10px] uppercase tracking-widest text-muted">
							MVP
						</p>
					</div>
					{false && (
						<span
							data-role="mock-badge"
							className="ml-2 rounded-full border border-amber bg-amber-container px-2 py-0.5 font-mono text-[10px] text-amber"
						></span>
					)}
				</div>

				<div className="flex items-center gap-3">
					<div data-role="wallet-slot" className="flex items-center gap-2">
						{wallet.connected && wallet.address !== null ? (
							<>
								<span className="hidden font-mono text-xs text-emerald-text sm:inline">
									{truncateAddress(wallet.address)}
								</span>
								<button
									type="button"
									onClick={() => void wallet.disconnect()}
									className="rounded-lg border border-stroke px-3 py-1.5 text-xs text-muted hover:text-ink"
								>
									Disconnect
								</button>
							</>
						) : (
							<button
								type="button"
								disabled={wallet.connecting}
								onClick={() => void wallet.connect()}
								className="rounded-lg border border-emerald-stroke bg-emerald-container px-3 py-1.5 text-xs font-semibold text-emerald-text hover:border-emerald"
							>
								{wallet.connecting ? "Connecting…" : "Connect wallet"}
							</button>
						)}
					</div>

					<button
						type="button"
						data-role="cart-toggle"
						aria-label={`Open cart (${itemCount} items)`}
						onClick={onToggleCart}
						className="relative rounded-lg border border-stroke bg-elevated px-3 py-1.5 text-sm text-ink hover:border-emerald"
					>
						<span aria-hidden>🛒</span>
						<span
							data-role="cart-badge"
							className="ml-2 font-mono text-xs text-emerald-text"
						>
							{itemCount}
						</span>
					</button>
				</div>
			</div>
		</header>
	);
}
