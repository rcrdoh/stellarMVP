import {
	CHECKOUT_STEPS,
	type CheckoutState,
	stepIndex,
} from "../context/checkout-machine.js";
import { stroopsToUsdc } from "../lib/format.js";

/** Five-stage checkout stepper mirroring the backend payment lifecycle
 * (quote → intent → sign → submit → paid). */
export function CheckoutProgress({ state }: { state: CheckoutState }) {
	const active = stepIndex(state.phase);
	const intent = state.intent;

	return (
		<section
			data-role="checkout-progress"
			data-phase={state.phase}
			className="mt-8 rounded-xl border border-stroke bg-panel p-5"
		>
			<h2 className="text-sm font-bold text-ink">Checkout</h2>

			<ol className="mt-4 flex flex-wrap gap-2">
				{CHECKOUT_STEPS.map((step, index) => {
					const done = active > index || state.phase === "paid";
					const current = active === index && state.phase !== "paid";
					return (
						<li
							key={step.phase}
							data-role="checkout-step"
							data-state={done ? "done" : current ? "active" : "pending"}
							className={`rounded-full border px-3 py-1 font-mono text-xs ${
								done
									? "border-emerald-stroke bg-emerald-container text-emerald-text"
									: current
										? "border-amber bg-amber-container text-amber"
										: "border-stroke text-muted"
							}`}
						>
							{index + 1}. {step.label}
						</li>
					);
				})}
			</ol>

			{intent !== null && (
				<dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
					<div>
						<dt className="text-muted">Amount</dt>
						<dd className="font-mono text-ink">
							{stroopsToUsdc(intent.totalAmountAtomic).toFixed(2)}{" "}
							{intent.assetCode}
						</dd>
					</div>
					<div>
						<dt className="text-muted">Intent</dt>
						<dd className="truncate font-mono text-ink">{intent.intentId}</dd>
					</div>
					<div>
						<dt className="text-muted">Status</dt>
						<dd className="font-mono text-ink">{intent.status}</dd>
					</div>
				</dl>
			)}

			{state.receipt !== null && (
				<div className="mt-5 rounded-lg border border-emerald-stroke bg-emerald-container p-4">
					<p className="text-sm font-semibold text-emerald-text">
						Paid · {state.receipt.status}
					</p>
					{state.receipt.transactionHash !== undefined && (
						<p className="mt-1 truncate font-mono text-xs text-muted">
							tx {state.receipt.transactionHash}
						</p>
					)}
					{state.receipt.stellarExpertUrl !== undefined && (
						<a
							href={state.receipt.stellarExpertUrl}
							target="_blank"
							rel="noreferrer"
							className="mt-2 inline-block font-mono text-xs text-cyan-text hover:underline"
						>
							View on stellar.expert ↗
						</a>
					)}
				</div>
			)}

			{state.phase === "failed" && state.error !== null && (
				<p data-role="checkout-error" className="mt-4 text-sm text-red-text">
					{state.error}
				</p>
			)}
		</section>
	);
}
