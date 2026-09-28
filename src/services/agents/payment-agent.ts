import type { ServiceTokenScope } from "../../domain/checkout/types.js";
import {
	InsufficientScopeError,
	PaymentRequiredError,
} from "../../domain/errors.js";
import { encodeX402Challenge } from "../../http/errors/x402.js";
import type { ServiceTokenStore } from "./ports/service-token-store.js";

/**
 * Narrow contract the HTTP checkout route depends on (Module 8). Keeping the
 * transport bound to this interface rather than the concrete service preserves
 * the layered design: routes orchestrate, the payment agent enforces.
 */
export interface PaymentFirewall {
	authorize(input: { token: string; amountAtomic: number }): Promise<void>;
}

export type PaymentAgentDependencies = Readonly<{
	tokens: ServiceTokenStore;
	/** Scope a service token must hold to settle. Defaults to `checkout:execute`. */
	requiredScope?: ServiceTokenScope;
}>;

/**
 * Payment Agent (Module 8) — the x402 checkout firewall. It sits in front of the
 * existing `AgentCheckoutService` settlement path and enforces two invariants
 * the audit (H2) requires before any money moves:
 *
 *  1. the service token carries the checkout scope (403 `SVC-CORE-2003`), and
 *  2. the amount reserves cleanly against the token's lifetime spend cap
 *     (403 `SVC-CORE-2005`, thrown by the store).
 *
 * An unknown token is treated as an unauthenticated payer: rather than a plain
 * 401 the firewall returns a 402 carrying a base64 `X-402-Challenge`, giving an
 * autonomous agent enough information to negotiate a token and retry.
 */
export class PaymentAgentService implements PaymentFirewall {
	constructor(private readonly deps: PaymentAgentDependencies) {}

	async authorize(input: {
		token: string;
		amountAtomic: number;
	}): Promise<void> {
		const requiredScope = this.deps.requiredScope ?? "checkout:execute";
		const metadata = await this.deps.tokens.findByToken(input.token);

		if (metadata === null) {
			throw new PaymentRequiredError(
				encodeX402Challenge({
					scheme: "exact",
					network: "testnet",
					asset: "USDC",
					amount: (input.amountAtomic / 100).toFixed(2),
					destination: "unknown",
					reason: "service_token_unknown",
				}),
				"Unknown service token.",
			);
		}

		if (!metadata.scopes.includes(requiredScope)) {
			throw new InsufficientScopeError(requiredScope);
		}

		// The store is the single authority on the cap; it throws
		// SpendCapExceededError (403 SVC-CORE-2005) when the reservation would
		// overflow, and never mutates the ledger on rejection.
		await this.deps.tokens.reserveSpend(input.token, input.amountAtomic);
	}
}
