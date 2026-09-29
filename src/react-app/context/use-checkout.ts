/** React hook orchestrating the checkout against the injected clients.
 *
 * Blocker B1: the SDD assumes the backend can mint a `quoteId` for a cart, but
 * the OpenAPI contract has no such endpoint. In mock mode we synthesize a quote
 * locally; against a real backend the caller must pass an approved `quoteId`. */

import { useCallback, useReducer } from "react";
import {
	type CheckoutState,
	checkoutReducer,
	initialCheckoutState,
} from "./checkout-machine.js";
import type { ClientBundle } from "./client-context.js";

export type CheckoutController = CheckoutState & {
	start(quoteId: string): Promise<void>;
	reset(): void;
};

function messageOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : "Checkout failed";
}

export function useCheckoutController(
	clients: ClientBundle,
): CheckoutController {
	const [state, dispatch] = useReducer(checkoutReducer, initialCheckoutState);

	const start = useCallback(
		async (incomingQuoteId: string) => {
			let quoteId = incomingQuoteId;
			try {
				if (clients.mockMode) {
					dispatch({ type: "phase", phase: "quoting" });
					quoteId = incomingQuoteId.trim() || `quote-${crypto.randomUUID()}`;
				}

				dispatch({ type: "phase", phase: "intent" });
				const intent = await clients.payments.createIntent(quoteId);
				dispatch({ type: "intent", intent });

				dispatch({ type: "phase", phase: "signing" });
				const signedXdr = await clients.wallet.signTransaction(
					intent.unsignedXdr,
				);

				dispatch({ type: "phase", phase: "submitting" });
				await clients.payments.submitIntent(intent.intentId, signedXdr);

				dispatch({ type: "phase", phase: "reconciling" });
				const receipt = await clients.payments.reconcile(intent.intentId);
				dispatch({ type: "receipt", receipt });
			} catch (cause) {
				dispatch({ type: "fail", error: messageOf(cause) });
			}
		},
		[clients],
	);

	const reset = useCallback(() => dispatch({ type: "reset" }), []);

	return { ...state, start, reset };
}
