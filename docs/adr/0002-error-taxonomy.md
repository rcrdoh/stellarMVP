# ADR 0002: Error Taxonomy as Public Error Contract

## Status

Accepted

## Context

The service shell originally exposed errors as a legacy `ErrorEnvelope` with
`error.code`, `error.message`, `details`, `target` and `innererror`. The
public error contract now requires RFC 9457 `application/problem+json`
extended with declarative behavior fields.

Clients must distinguish failed, retryable, pending and indeterminate
outcomes without parsing free-form text.

## Decision

All HTTP error responses use the problem contract:

- Media type: `application/problem+json`.
- Body fields: `type`, `title`, `status`, `code`, `category`, `detail_key`,
  `behavior`, `correlation.trace_id` and `occurred_at`.
- Public codes use `SVC-<DOMINIO>-<NNNN>`.
- This base implements emittable `CORE` codes. Additional domains may be
  registered later with `defineErrorCode`.
- The `PAYMENT` domain is registered for Agentic Commerce Protocol (ACP) x402
  flows:
  - `SVC-PAYMENT-4020` (`payment_required`) maps to HTTP `402 Payment Required`.
    Emitted when an agentic route requires an `X-402-Payment-Token` challenge
    that is missing or invalid. The handler also sets the `X-402-Challenge`
    header so external agents can auto-negotiate payment.
  - `SVC-PAYMENT-4022` (`payment_failed`) maps to HTTP `402` when the on-chain
    settlement is rejected or times out.
- `x-error-code` remains as an HTTP header and must match the body `code`.
- `correlation.trace_id` uses incoming `x-trace-id` when present, otherwise the
  Fastify request id.

## Consequences

- The legacy `ErrorEnvelope` response shape is not part of the public contract.
- Clients must consume declarative `behavior` instead of parsing titles or
  messages.
- Changes to existing code behavior require a new ADR because they can alter
  client and workflow decisions.
- The OpenAPI validator rejects 4xx/5xx responses that do not use
  `Problem` as `application/problem+json`.
