import type { ApprovedPaymentQuote } from "../domain/payments.js";
import type { PaymentIntentService } from "./payment-intent-service.js";

/** Runtime boundary exposed by the composition root to the HTTP transport. */
export type PaymentRuntime = Readonly<{
	service: PaymentIntentService;
	createQuote(input: {
		principalId: string;
		payerAddress: string;
	}): Promise<ApprovedPaymentQuote>;
	isReady(): Promise<boolean>;
	close?(): Promise<void>;
}>;
