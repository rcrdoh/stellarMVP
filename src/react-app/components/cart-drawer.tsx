import { useCart } from "../context/cart-context.js";
import { formatUsd } from "../lib/format.js";

/** Slide-over cart drawer. Preserves `data-role`: `cart-backdrop`, `cart-items`,
 * `cart-subtotal`, `cart-close`, `cart-checkout`. */
export function CartDrawer({
	onCheckout,
	checkoutBusy,
}: {
	onCheckout(): void;
	checkoutBusy: boolean;
}) {
	const cart = useCart();
	if (!cart.state.isOpen) {
		return null;
	}

	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes the drawer on click */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the aside panel */}
			<div
				data-role="cart-backdrop"
				onClick={() => cart.dispatch({ type: "close" })}
				className="fixed inset-0 z-30 bg-black/60"
			/>
			<aside
				data-role="cart-panel"
				aria-label="Shopping cart"
				className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-stroke bg-panel"
			>
				<div className="flex items-center justify-between border-b border-stroke px-5 py-4">
					<h2 className="text-sm font-bold text-ink">Your cart</h2>
					<button
						type="button"
						data-role="cart-close"
						onClick={() => cart.dispatch({ type: "close" })}
						className="rounded-lg border border-stroke px-3 py-1.5 text-xs text-muted hover:text-ink"
					>
						Close
					</button>
				</div>

				<div
					data-role="cart-items"
					className="flex-1 overflow-y-auto px-5 py-4"
				>
					{cart.items.length === 0 ? (
						<p data-role="empty" className="text-sm text-muted">
							Your cart is empty.
						</p>
					) : (
						<ul className="flex flex-col gap-4">
							{cart.items.map((item) => (
								<li
									key={item.offer.id}
									className="flex items-start justify-between gap-3"
								>
									<div>
										<p className="text-sm text-ink">{item.offer.title}</p>
										<p className="font-mono text-xs text-muted">
											{item.offer.merchant} · qty {item.line.quantity}
										</p>
									</div>
									<div className="text-right">
										<p className="font-mono text-sm text-ink">
											{formatUsd(item.offer.price * item.line.quantity)}
										</p>
										<button
											type="button"
											onClick={() =>
												cart.dispatch({
													type: "remove",
													offerId: item.offer.id,
												})
											}
											className="mt-1 font-mono text-xs text-red-text hover:underline"
										>
											Remove
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				<div className="border-t border-stroke px-5 py-4">
					<div className="flex items-center justify-between">
						<span className="text-sm text-muted">Subtotal (USDC)</span>
						<span
							data-role="cart-subtotal"
							className="font-mono text-lg text-ink"
						>
							{formatUsd(cart.subtotalUsd)}
						</span>
					</div>
					<button
						type="button"
						data-role="cart-checkout"
						disabled={cart.items.length === 0 || checkoutBusy}
						onClick={onCheckout}
						className="mt-4 w-full rounded-lg bg-emerald px-4 py-3 text-sm font-semibold text-[color:var(--btn-primary-fg)] transition-colors hover:bg-emerald-hover disabled:cursor-not-allowed disabled:opacity-50"
					>
						{checkoutBusy ? "Processing…" : "Confirm & Pay"}
					</button>
				</div>
			</aside>
		</>
	);
}
