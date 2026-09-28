import {
	type PaymentIntent,
	paymentIntentSchema,
} from "../../domain/payments.js";
import {
	isIndeterminateStatus,
	type ReconciliationOutcome,
	type ReconciliationRun,
	reconciliationRunSchema,
} from "../../domain/reconciliation.js";
import type {
	PaymentIntentRepository,
	StellarIntentGateway,
} from "../payment-intent-service.js";
import type { PaymentReconciliationRepository } from "./ports/payment-reconciliation-repository.js";

/** Clock port kept injectable so age-based selection is deterministic. */
export type Clock = () => Date;

export interface SettlementReconciliationOptions {
	readonly persistence: PaymentIntentRepository &
		PaymentReconciliationRepository;
	readonly stellar: StellarIntentGateway;
	readonly now?: Clock;
	/**
	 * Minimum age (seconds) an indeterminate intent must reach before it is
	 * re-checked. Prevents the worker from querying Horizon for an intent whose
	 * submission response is still in flight.
	 */
	readonly minAgeSeconds?: number;
}

/**
 * Sweeps payment intents stuck in `submitting`/`submitted` and resolves them
 * against Horizon, addressing Audit H1 (indeterminate outcomes must reach a
 * terminal state). Resolution is idempotent: each transition uses the existing
 * compare-and-set settlement methods, so a concurrent request that already
 * settled the intent wins harmlessly and the worker reports `unresolved`.
 *
 * The worker never throws on a single intent; a Horizon failure is recorded as
 * `unresolved` so one bad lookup cannot abort the whole sweep.
 */
export class SettlementReconciliationService {
	#now: Clock;
	#minAgeSeconds: number;

	constructor(private readonly options: SettlementReconciliationOptions) {
		this.#now = options.now ?? (() => new Date());
		this.#minAgeSeconds = options.minAgeSeconds ?? 30;
	}

	/** Reconciles a single intent by id; used by the manual confirm route. */
	async reconcileIntent(intentId: string): Promise<ReconciliationOutcome> {
		const intent = await this.options.persistence.findIntentById(intentId);
		if (intent === null) {
			return {
				intentId,
				previousStatus: "submitted",
				status: "submitted",
				resolved: false,
				ledger: null,
			};
		}
		return this.#resolve(intent);
	}

	/**
	 * Reconciles up to `limit` indeterminate intents older than `minAgeSeconds`
	 * and folds the outcomes into a run report.
	 */
	async reconcileBatch(limit = 25): Promise<ReconciliationRun> {
		const cutoff = new Date(
			this.#now().getTime() - this.#minAgeSeconds * 1000,
		).toISOString();
		const candidates = await this.options.persistence.findIndeterminate(
			cutoff,
			limit,
		);
		const outcomes: ReconciliationOutcome[] = [];
		for (const candidate of candidates) {
			outcomes.push(await this.#resolve(candidate));
		}
		return reconciliationRunSchema.parse({
			scanned: candidates.length,
			confirmed: outcomes.filter((outcome) => outcome.status === "confirmed")
				.length,
			failed: outcomes.filter((outcome) => outcome.status === "failed").length,
			unresolved: outcomes.filter((outcome) => !outcome.resolved).length,
			outcomes,
		});
	}

	async #resolve(intent: PaymentIntent): Promise<ReconciliationOutcome> {
		if (
			!isIndeterminateStatus(intent.status) ||
			intent.transactionHash === null
		) {
			return {
				intentId: intent.intentId,
				previousStatus: intent.status,
				status: intent.status,
				resolved: false,
				ledger: intent.ledger,
			};
		}

		let lookup: Awaited<ReturnType<StellarIntentGateway["lookupTransaction"]>>;
		try {
			lookup = await this.options.stellar.lookupTransaction(intent);
		} catch {
			return {
				intentId: intent.intentId,
				previousStatus: intent.status,
				status: intent.status,
				resolved: false,
				ledger: null,
			};
		}

		if (lookup.status === "pending" || lookup.status === "not_found") {
			return {
				intentId: intent.intentId,
				previousStatus: intent.status,
				status: intent.status,
				resolved: false,
				ledger: null,
			};
		}

		const next = paymentIntentSchema.parse({
			...intent,
			status: lookup.status === "confirmed" ? "confirmed" : "failed",
			ledger: lookup.status === "confirmed" ? lookup.ledger : null,
			updatedAt: this.#now().toISOString(),
		});
		const updated =
			next.status === "confirmed"
				? await this.options.persistence.settleConfirmed(next, intent.status)
				: await this.options.persistence.settleFailed(next, intent.status);

		if (!updated) {
			const current = await this.options.persistence.findIntentById(
				intent.intentId,
			);
			const resolved =
				current !== null &&
				(current.status === "confirmed" || current.status === "failed");
			return {
				intentId: intent.intentId,
				previousStatus: intent.status,
				status: current?.status ?? intent.status,
				resolved,
				ledger: current?.ledger ?? null,
			};
		}

		return {
			intentId: intent.intentId,
			previousStatus: intent.status,
			status: next.status,
			resolved: true,
			ledger: next.ledger,
		};
	}
}
