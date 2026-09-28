import type {
	ServiceTokenMetadata,
	ServiceTokenScope,
} from "../../../domain/checkout/types.js";

/**
 * Authorization port for service tokens (Module 8, Audit H2). The HTTP firewall
 * and the payment agent depend on this interface, never on a concrete store, so
 * the Redis/Postgres adapters can be swapped for the in-memory implementation in
 * tests without weakening the checked invariants.
 */
export interface ServiceTokenStore {
	findByToken(token: string): Promise<ServiceTokenMetadata | null>;
	/**
	 * Atomically reserve `amountAtomic` against the token's lifetime spend cap.
	 * Implementations must reject when the reservation would exceed
	 * `maxSpendAtomic` (throwing `SpendCapExceededError`) and must not mutate the
	 * ledger when they reject.
	 */
	reserveSpend(
		token: string,
		amountAtomic: number,
	): Promise<ServiceTokenMetadata>;
}

/** Convenience guard used by callers that only need the scope check. */
export function tokenHasScope(
	metadata: ServiceTokenMetadata,
	scope: ServiceTokenScope,
): boolean {
	return metadata.scopes.includes(scope);
}
