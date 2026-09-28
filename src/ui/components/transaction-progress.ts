import type { PaymentIntentStatus } from "../../domain/payments.js";
import { requireElement } from "../dom.js";

/**
 * UI-facing projection of a purchase-intent lifecycle. It condenses the DB
 * `PaymentIntentStatus` values into the coarse steps a shopper actually sees.
 */
export type PurchaseIntentStatus =
	| "draft"
	| "pending_confirmation"
	| "confirmed"
	| "submitted"
	| "paid"
	| "failed"
	| "unknown";

/**
 * Maps the persisted `PaymentIntentStatus` (see `src/domain/payments.ts`) to the
 * presentation status. `expired` degrades to `failed` because, from the
 * shopper's perspective, an expired intent is a terminal non-payment.
 */
export function toPurchaseIntentStatus(
	status: PaymentIntentStatus,
): PurchaseIntentStatus {
	switch (status) {
		case "awaiting_signature":
			return "pending_confirmation";
		case "submitting":
			return "confirmed";
		case "submitted":
			return "submitted";
		case "confirmed":
			return "paid";
		case "failed":
		case "expired":
			return "failed";
		default:
			return "unknown";
	}
}

interface Step {
	readonly key: PurchaseIntentStatus;
	readonly label: string;
}

const STEPS: readonly Step[] = [
	{ key: "draft", label: "Draft" },
	{ key: "pending_confirmation", label: "Lock Price" },
	{ key: "confirmed", label: "Verification" },
	{ key: "submitted", label: "On-Chain" },
	{ key: "paid", label: "Settled" },
];

/**
 * Renders the transaction lifecycle as a stepper. `failed` and `unknown` keep
 * the reached steps visible and surface an error/details panel instead of
 * pretending progress continued.
 */
export function createTransactionProgress(
	status: PurchaseIntentStatus,
	errorMessage?: string,
): HTMLElement {
	const container = document.createElement("div");
	container.className =
		"bg-gray-800/80 p-5 rounded-xl border border-gray-700 w-full max-w-xl mx-auto my-4";
	container.dataset.status = status;
	container.setAttribute("role", "group");
	container.setAttribute("aria-label", "Transaction status");

	const activeIndex = STEPS.findIndex((step) => step.key === status);
	const isTerminalSuccess = status === "paid";
	const isTerminalFailure = status === "failed" || status === "unknown";

	const stepsHtml = STEPS.map((step, index) => {
		const isDone =
			isTerminalSuccess || (activeIndex >= 0 && index < activeIndex);
		const isCurrent =
			!isTerminalSuccess && !isTerminalFailure && activeIndex === index;

		const circleClass = isDone
			? "bg-emerald-500 text-gray-950"
			: isCurrent
				? "bg-emerald-950 text-emerald-400 border-2 border-emerald-500 animate-pulse"
				: "bg-gray-700 text-gray-400";
		const labelClass = isCurrent ? "text-emerald-400" : "text-gray-400";

		return `
			<div class="flex flex-col items-center flex-1 z-10">
				<div class="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition ${circleClass}">
					${index + 1}
				</div>
				<span class="text-[11px] mt-2 font-medium ${labelClass}">${step.label}</span>
			</div>
		`;
	}).join("");

	const errorHtml = isTerminalFailure
		? `<div class="mt-4 p-3 bg-red-950/70 border border-red-800/80 rounded-lg text-red-300 text-xs">
				<strong>${status === "failed" ? "Transaction Failed:" : "Status Unknown:"}</strong>
				<span class="progress-error-message"></span>
			</div>`
		: "";

	container.innerHTML = `
		<h4 class="text-sm font-semibold text-gray-200 mb-4 uppercase tracking-wider">Transaction Status</h4>
		<div class="flex items-center justify-between relative">
			${stepsHtml}
		</div>
		${errorHtml}
	`;

	if (isTerminalFailure) {
		requireElement(container, ".progress-error-message").textContent =
			errorMessage ??
			(status === "failed"
				? "An error occurred during execution."
				: "The current status could not be determined.");
	}

	return container;
}
