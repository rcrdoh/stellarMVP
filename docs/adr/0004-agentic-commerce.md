# ADR 0004: Arquitectura propuesta para comercio asistido por agentes

## Status

Proposed (protocol surface ACP x402 parcialmente implementado; ver seccion
"Protocolo ACP x402 implementado"). Sigue pendiente para `Accepted` un prototipo
sandbox end-to-end con persistencia/reanudacion e idempotencia validadas, las
decisiones abiertas de `docs/agentic-commerce-design.md` y la politica de
retencion de estado. Las compras autonomas con fondos reales no estan
habilitadas.

## Context

El repositorio ya tiene dependencias para LangGraph, UCP-related discovery,
Qdrant, PostgreSQL, Stripe y x402, pero no implementa compra, catálogo,
checkout, pagos ni fulfillment. `pautas de diseño.md` define las capas
obligatorias para habilitar esta solución y prevalece ante divergencias.

Un flujo de compra requiere más que pagar una solicitud HTTP: necesita encontrar
productos, cotizar precio y envío, validar stock, obtener aprobación delegada,
crear una orden y conciliar pago y fulfillment. La búsqueda basada en LLM o
vectores no puede ser autoridad de precio ni autorización financiera.

## Decision propuesta

- Separar el **Shopping Agent** conversacional (LangGraph durable) del **Search
  Agent** que agrega fuentes, normaliza ofertas y aplica filtros deterministas.
- Usar Shopify Global Catalog MCP/UCP para descubrimiento inicial multi-merchant,
  junto con un catálogo canónico PostgreSQL, APIs oficiales/MCP adicionales y
  scraping asíncrono sujeto a permisos y controles SSRF. Qdrant es un índice de
  candidatos opcional, nunca fuente de precio/stock final.
- Usar MongoDB y el checkpointer oficial `@langchain/langgraph-checkpoint-mongodb`
  para checkpoint/estado del agente; PostgreSQL para catálogo y estado
  transaccional de quotes, checkouts, orders y payment attempts. El driver y
  checkpointer están instalados; compatibilidad operativa con Bun/Render,
  conexión de runtime y política de retención siguen pendientes de validar.
- Separar checkout comercial de cobro por recurso: UCP gobierna el intercambio
  de catálogo/checkout/orden; x402 queda como opción de pago por recurso digital
  HTTP. Proveedores de pago se conectan tras un puerto de capacidades, sin
  acoplar el dominio a Stripe o Stellar.
- El MVP inicia en sandbox, merchant único, aprobación humana explícita,
  quote inmutable, revalidación de precio/stock, idempotencia y fulfillment
  simulado. No habilitar autopurchase, fondos reales o mainnet en este ADR.
- Mantener LLM en interpretación/explicación; reglas, dinero, permisos, estados,
  pagos y fulfillment son deterministas. Las compras autónomas posteriores
  requieren política de gasto revocable y otra decisión aceptada.

El flujo inicial de Shopping Agent implementa el gate Jev, la búsqueda allowlisted,
la persistencia/reanudación de selección y la aprobación humana de una quote.
Esa aprobación no crea checkout ni ejecuta pago; Search Agent y los proveedores
de búsqueda/cotización reales continúan pendientes.

### Protocolo ACP x402 implementado (2026-09)

Esta fase materializa la superficie HTTP de agent commerce definida en
`specs/openapi.json` sin cambiar las decisiones de almacenamiento de este ADR:

- `POST /v1/agent/search`: busqueda vectorial con validacion Zod estricta del
  body; errores de validacion responden RFC 9457
  `SVC-CORE-1002 schema_validation_failed` (HTTP `422`).
- `POST /v1/agent/checkout`: exige `X-402-Payment-Token`. Si falta o es invalido
  responde `SVC-PAYMENT-4020` (HTTP `402`) con header `X-402-Challenge` para
  auto-negociacion. La orden solo se crea y el item solo pasa a `purchased`
  despues de que la liquidacion on-chain en Horizon resuelve con
  `successful === true`; un fallo o timeout arroja `SVC-PAYMENT-4022`.
- Ordenes y ledger se persisten en PostgreSQL (`orders`), no en memoria.
- Scopes de agente y control de velocidad de gasto se evaluan con el adaptador
  Redis (`agent:token:<hash>`, `agent:spend:<hash>:<YYYY-MM-DD>`), emitiendo
  `SVC-CORE-4001` (scope insuficiente) o `SVC-CORE-5003` (rate limited).
- El rate limiting de `@fastify/rate-limit` sobre `/v1/agent/*` y los circuit
  breakers de llamadas LLM/vector responden con RFC 9457.

La persistencia de checkpoint del agente **permanece en MongoDB**
(`@langchain/langgraph-checkpoint-mongodb`) segun la decision de este ADR.
Sustituirla por `@langchain/langgraph-checkpoint-postgres` seria un cambio de
arquitectura y requiere un ADR aceptado; propuestas externas que lo pidan deben
tratarse como cambio de diseno, no como correccion mecanica.

## Consecuencias

- No añadir endpoints al API actual hasta que los DTOs y operaciones estén
  definidos en `specs/openapi.json` y revisados según SDD.
- El catálogo/inventario real, merchant of record, moneda/settlement,
  impuestos, logística, devoluciones y retención de estado siguen abiertos.
- Las dependencias existentes no cuentan como implementación ni demuestran
  cobertura de protocolo.
- Para pasar a Accepted hace falta completar las decisiones abiertas de
  `docs/agentic-commerce-design.md`, hacer un prototipo sandbox end-to-end y
  validar persistencia/reanudación, idempotencia y el contrato del proveedor de
  pago elegido.

## Referencias

- `pautas de diseño.md`.
- `docs/agentic-commerce-design.md`.
- [UCP Checkout](https://ucp.dev/specification/shopping/checkout/).
- [Shopify Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog).
- [x402 v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
- [MongoDB checkpoint para LangGraph.js](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/).
