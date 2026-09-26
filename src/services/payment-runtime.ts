import type { PaymentIntentService } from "./payment-intent-service.js";

/** Runtime boundary exposed by the composition root to the HTTP transport. */
export type PaymentRuntime = Readonly<{
	service: PaymentIntentService;
	isReady(): Promise<boolean>;
	close?(): Promise<void>;
}>;
