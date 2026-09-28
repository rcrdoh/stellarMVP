import { z } from "zod";

/**
 * Scopes a service token may carry. `checkout:execute` is the only scope that
 * authorizes the agentic checkout firewall; `catalog:read` covers discovery.
 * Kept as a const tuple so it is both a runtime list and a Zod enum source.
 */
export const SERVICE_TOKEN_SCOPES = [
	"catalog:read",
	"checkout:execute",
] as const;

export const ServiceTokenScopeSchema = z.enum(SERVICE_TOKEN_SCOPES);

export type ServiceTokenScope = z.infer<typeof ServiceTokenScopeSchema>;

/**
 * Persisted authorization record for a single service token. `maxSpendAtomic`
 * is the absolute cap (in atomic units of the checkout currency) that the token
 * may spend across its lifetime; `null` disables the spend firewall, which is
 * only acceptable for read-only scopes.
 */
export const ServiceTokenMetadataSchema = z.object({
	tokenHash: z.string().min(1),
	scopes: z.array(ServiceTokenScopeSchema).min(1),
	maxSpendAtomic: z.number().int().nonnegative().nullable().default(null),
	/** Running total already spent by this token, in atomic units. */
	spentAtomic: z.number().int().nonnegative().default(0),
});

export type ServiceTokenMetadata = z.infer<typeof ServiceTokenMetadataSchema>;

/**
 * RFC-style x402 challenge negotiated when a payment token is missing, expired
 * or under-scoped. Serialized as base64 JSON and sent on the `X-402-Challenge`
 * header so an autonomous agent can auto-negotiate settlement.
 */
export const X402ChallengePayloadSchema = z.object({
	scheme: z.literal("exact"),
	network: z.string().min(1),
	asset: z.string().min(1),
	amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
	destination: z.string().min(1),
	reason: z.string().min(1),
});

export type X402ChallengePayload = z.infer<typeof X402ChallengePayloadSchema>;
