# ADR

Architecture Decision Records aceptadas o propuestas para cambios de contrato y
arquitectura.

## Formato

- `Status`: `Proposed`, `Accepted`, `Deprecated` o `Superseded`.
- `Context`: problema y restricciones.
- `Decision`: cambio concreto elegido.
- `Consequences`: efectos esperados y tradeoffs.

## Registros

- `0001-bun-fastify-framework.md`: Bun, TypeScript, Fastify y las restricciones
  del despliegue Docker en Render (con soporte Vercel heredado).
- `0002-error-taxonomy.md`: contrato publico de errores RFC 9457.
- `0003-service-token-for-protected-routes.md`: token de servicio opcional para rutas protegidas.
- `0004-agentic-commerce.md`: propuesta para habilitar comercio asistido por
  agentes; la superficie HTTP ACP x402 (search, checkout 402, ordenes Postgres,
  scopes Redis, rate limiting y circuit breakers) ya esta implementada, pero la
  decision sigue `Proposed` hasta validar el prototipo sandbox end-to-end y las
  decisiones abiertas de producto. Checkpoint del agente permanece en MongoDB.
- `0005-stellar-testnet-payment-intents.md`: intents de pago Stellar Testnet
  implementados por capas, conservando el agente y el checkout ACP x402.
