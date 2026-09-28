import type { FastifyRequest } from "fastify";
import type { ServiceTokenScope } from "../../domain/checkout/types.js";
import { errorCodes } from "../../domain/error-codes.js";
import { AppError, InsufficientScopeError } from "../../domain/errors.js";
import type { ServiceTokenStore } from "../../services/agents/ports/service-token-store.js";

/** Extract the bearer token from the `Authorization` header, if present. */
export function bearerToken(request: FastifyRequest): string | undefined {
	const header = request.headers.authorization;
	if (header === undefined || !header.startsWith("Bearer ")) {
		return undefined;
	}
	const token = header.slice("Bearer ".length);
	return token.length > 0 ? token : undefined;
}

/**
 * Enforce that a service token is present and carries `requiredScope`. Missing
 * credentials map to 401 (`SVC-CORE-2001`) while a valid-but-under-scoped token
 * maps to 403 (`SVC-CORE-2003`), keeping the distinction the audit (H2) expects.
 */
export async function requireScopedServiceToken(
	request: FastifyRequest,
	store: ServiceTokenStore,
	requiredScope: ServiceTokenScope,
) {
	const token = bearerToken(request);
	if (token === undefined) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	const metadata = await store.findByToken(token);
	if (metadata === null) {
		throw new AppError(errorCodes.CREDENTIALS_INVALID_OR_EXPIRED);
	}
	if (!metadata.scopes.includes(requiredScope)) {
		throw new InsufficientScopeError(requiredScope);
	}
	return { token, metadata };
}

/**
 * Spend firewall (Audit H2). Delegates the atomic reservation to the store so a
 * concurrent burst cannot race past the cap; the store throws
 * `SpendCapExceededError` (403) when the reservation would overflow.
 */
export async function enforceSpendCap(
	request: FastifyRequest,
	store: ServiceTokenStore,
	amountAtomic: number,
) {
	const token = bearerToken(request);
	if (token === undefined) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	return store.reserveSpend(token, amountAtomic);
}
