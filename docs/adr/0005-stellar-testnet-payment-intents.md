# ADR 0005: Reconciliación de intents de pago Stellar Testnet

## Status

Proposed

## Context

`design/agentic-commerce` ya contiene el Shopping Agent, el Search Agent y la
superficie ACP x402 de búsqueda y checkout. La rama `design/stellar-payments`
añade intents de pago Stellar Testnet, pero también reemplaza archivos
compartidos y elimina la implementación actual de agentes. Un merge completo
perdería capas ya aceptadas por ADR 0004.

La rama de pagos puede aportar el gateway Stellar, los esquemas de importes,
la persistencia de intents y la conciliación con Horizon. Esas capacidades
deben quedar separadas del grafo LangGraph y del transporte Fastify, siguiendo
`pautas de diseño.md`.

## Decision propuesta

- Integrar pagos Stellar por puertos de dominio y adaptadores, no mediante un
  merge completo de `design/stellar-payments`.
- Mantener la implementación actual del Shopping Agent, Search Agent,
  checkpointer MongoDB y checkout ACP x402. El pago Stellar será una capacidad
  adicional del checkout, no un reemplazo del flujo de agentes.
- Portar primero los esquemas de payment intent, los códigos de error, el
  gateway Horizon y el store de intents. El servicio de pagos recibirá una
  cotización aprobada e inmutable y no calculará precios ni decidirá compras.
- Componer las rutas de pago con las rutas actuales solo después de actualizar
  `specs/openapi.json`; conservar autenticación, idempotencia, expiración,
  verificación de firma y conciliación ante respuestas inciertas.
- Mantener la feature deshabilitada por defecto. El piloto queda limitado a
  Stellar Testnet y no habilita fondos reales, mainnet ni compra autónoma.

## Mapa de reconciliación

| Capacidad de `design/stellar-payments` | Destino en esta rama |
| --- | --- |
| `src/domain/payments.ts` | Dominio de intents, quote aprobada y legs Stellar |
| `src/integrations/stellar/` | Adaptador `StellarPaymentGateway` detrás de un puerto |
| `src/integrations/mongodb/` | Store de intents y quotes aprobadas, separado del checkpointer |
| `src/services/payment-service.ts` | Caso de uso determinista invocado por checkout |
| `src/http/payment-routes.ts` | Rutas nuevas después del contrato OpenAPI |
| configuración Stellar/Mongo | Extensión aditiva de `src/config/env.ts`, sin retirar variables del agente |

## Conflictos conocidos

La rama de pagos modifica simultáneamente `.env.example`, `bun.lock`,
`package.json`, `src/config/env.ts`, `src/http/routes.ts`,
`src/http/server.ts`, `specs/openapi.json` y documentación compartida. Además,
elimina `src/services/agents`, `src/integrations/agents` y los contratos del
Shopping Agent. Esas eliminaciones deben rechazarse al reconciliarla.

La implementación existente usa PostgreSQL/Redis/Stellar para ACP x402 y
MongoDB para checkpoints. Los intents de pago deben evitar duplicar órdenes,
redefinir estados de compra o mover el checkpoint del agente a PostgreSQL.

## Consequences

- La integración futura será un cambio por capas y requerirá revisión del
  contrato, pruebas de pago y pruebas de reanudación del agente.
- La cotización aprobada será la autoridad de importe, activo, red,
  destinatarios y expiración; el LLM no podrá alterar esos valores.
- Una respuesta incierta de Horizon requerirá consultar y conciliar el estado
  antes de reintentar o marcar el intent como fallido.
- Hasta completar esa integración, el checkout ACP x402 existente permanece
  como la única superficie de pago habilitada por el runtime del agente.

## Referencias

- `pautas de diseño.md`.
- `docs/adr/0004-agentic-commerce.md`.
- `docs/agentic-commerce-design.md`.
- Rama `origin/design/stellar-payments`, commit `5f28a6b`.
