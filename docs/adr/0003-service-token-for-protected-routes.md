# ADR 0003: Service Token for Protected Routes

## Status

Accepted

## Context

The service shell exposes public health checks and a canonical OpenAPI document,
but business routes may need simple service-to-service authentication when the
base is copied into an internal system.

The base must keep local development friction low while giving production
deployments a consistent way to reject unauthenticated callers.

## Decision

Use an optional `SERVICE_TOKEN` environment variable for protected HTTP routes.

- Empty or unset `SERVICE_TOKEN` disables authentication.
- Configured `SERVICE_TOKEN` requires `Authorization: Bearer <token>`.
- `POST /v1/items` and `GET /v1/items/{itemId}` are protected.
- `/v1/health/live`, `/v1/health/ready` and `/openapi.json` stay public.
- Missing credentials emit `SVC-CORE-2001`.
- Invalid credentials emit `SVC-CORE-2002`.
- OpenAPI declares `components.securitySchemes.serviceToken` and applies it only
  to protected routes.

## Consequences

- Development and tests can run without secrets by leaving `SERVICE_TOKEN`
  empty.
- Production environments must inject the token through environment variables or
  a secret manager, never through versioned TOML or docs.
- Clients generated from OpenAPI can detect protected operations.
- Changes to route protection or auth scheme require a new ADR.
