import type { SettlementReconciliationService } from "./payment/settlement-reconciliation-service.js";
import type { PaymentIntentService } from "./payment-intent-service.js";

/** Runtime boundary exposed by the composition root to the HTTP transport. */
export type PaymentRuntime = Readonly<{
	service: PaymentIntentService;
	/**
	 * On-chain reconciliation engine (Module 9). Present when the runtime can
	 * compose the worker; the reconcile routes stay unregistered otherwise.
	 */
	reconciliation?: SettlementReconciliationService;
	isReady(): Promise<boolean>;
	close?(): Promise<void>;
}>;
