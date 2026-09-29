/** Checkout cockpit state machine (pure, framework-free).
 *
 * Phases follow the backend status machine: creating the intent, signing with
 * the wallet, submitting the signed envelope, reconciling the receipt. */

import type { PaymentIntent, PaymentReceipt } from "../types/payment.js";

export type CheckoutPhase =
	| "idle"
	| "quoting"
	| "intent"
	| "signing"
	| "submitting"
	| "reconciling"
	| "paid"
	| "failed";

export type CheckoutState = {
	phase: CheckoutPhase;
	intent: PaymentIntent | null;
	receipt: PaymentReceipt | null;
	error: string | null;
};

export const initialCheckoutState: CheckoutState = {
	phase: "idle",
	intent: null,
	receipt: null,
	error: null,
};

export type CheckoutAction =
	| { type: "reset" }
	| { type: "phase"; phase: CheckoutPhase }
	| { type: "intent"; intent: PaymentIntent }
	| { type: "receipt"; receipt: PaymentReceipt }
	| { type: "fail"; error: string };

export function checkoutReducer(
	state: CheckoutState,
	action: CheckoutAction,
): CheckoutState {
	switch (action.type) {
		case "reset":
			return initialCheckoutState;
		case "phase":
			return { ...state, phase: action.phase, error: null };
		case "intent":
			return { ...state, intent: action.intent, phase: "intent", error: null };
		case "receipt":
			return {
				...state,
				receipt: action.receipt,
				phase: action.receipt.status === "paid" ? "paid" : "reconciling",
				error: null,
			};
		case "fail":
			return { ...state, phase: "failed", error: action.error };
	}
}

/** Ordered steps used by the progress stepper. */
export const CHECKOUT_STEPS: readonly {
	phase: CheckoutPhase;
	label: string;
}[] = [
	{ phase: "quoting", label: "Quote" },
	{ phase: "intent", label: "Intent" },
	{ phase: "signing", label: "Sign" },
	{ phase: "submitting", label: "Submit" },
	{ phase: "paid", label: "Paid" },
];

export function stepIndex(phase: CheckoutPhase): number {
	switch (phase) {
		case "idle":
			return -1;
		case "quoting":
			return 0;
		case "intent":
			return 1;
		case "signing":
			return 2;
		case "submitting":
		case "reconciling":
			return 3;
		case "paid":
			return 4;
		case "failed":
			return -1;
	}
}
