import type { PaymentIntent } from "../../../domain/payments.js";
import type { PaymentIntentRepository } from "../../payment-intent-service.js";

/**
 * Read model the reconciliation worker needs to find intents whose on-chain
 * outcome is still unknown. It is split from {@link PaymentIntentRepository} so
 * existing in-memory repositories used by the HTTP and intent tests keep
 * compiling without implementing a worker-only method.
 */
export interface PaymentReconciliationRepository {
	/**
	 * Returns intents in `submitting`/`submitted` state whose `updated_at` is at
	 * or before `olderThan`, oldest first, capped at `limit`. Bounding by age
	 * avoids racing a submission that is still in flight in another request.
	 */
	findIndeterminate(olderThan: string, limit: number): Promise<PaymentIntent[]>;
}

/** Persistence surface the reconciliation worker depends on. */
export type ReconciliationPersistence = PaymentIntentRepository &
	PaymentReconciliationRepository;
