# ADR 0004: Arquitectura propuesta para comercio asistido por agentes

## Status

Proposed

## Context

El repositorio ya tiene dependencias para LangGraph, Qdrant, PostgreSQL,
Stripe y x402. No implementa todavía compra, catálogo, checkout ni fulfillment;
la primera etapa de pagos USDC en Stellar Testnet está descrita en ADR 0005.
El equipo acordó MongoDB para el estado del agente y los registros de negocio
de esta feature; las dependencias PostgreSQL existentes no representan una
integración activa.

Un flujo de compra requiere más que pagar una solicitud HTTP: necesita encontrar
productos, cotizar precio y envío, validar stock, obtener aprobación delegada,
crear una orden y conciliar pago y fulfillment. La búsqueda basada en LLM o
vectores no puede ser autoridad de precio ni autorización financiera.

## Decision propuesta

- Separar el **Shopping Agent** conversacional (LangGraph durable) del **Search
  Agent** que agrega fuentes, normaliza ofertas y aplica filtros deterministas.
- Usar Shopify Global Catalog MCP/UCP para descubrimiento inicial multi-merchant,
  junto con un catálogo canónico MongoDB, APIs oficiales/MCP adicionales y
  scraping asíncrono sujeto a permisos y controles SSRF. Qdrant es un índice de
  candidatos opcional, nunca fuente de precio/stock final.
- Usar MongoDB con colecciones de negocio separadas. El backend inicial de
  pagos crea índices de cotizaciones e intents idempotentes; el checkpointer
  `@langchain/langgraph-checkpoint-mongodb` para estado del agente sigue
  pendiente. Validar compatibilidad Bun, concurrencia y retención antes de
  incorporarlo.
- Separar checkout comercial de cobro por recurso: UCP gobierna el intercambio
  de catálogo/checkout/orden; x402 queda como opción de pago por recurso digital
  HTTP. Proveedores de pago se conectan tras un puerto de capacidades, sin
  acoplar el dominio a Stripe o Stellar.
- Para un comercio piloto que acepte USDC en Stellar Testnet, seguir
  `docs/stellar-payments-plan.md`: aprobación exacta, firma humana,
  conciliación de la operación y registro idempotente en MongoDB. Los límites
  on-chain requieren un hito adicional de smart account Soroban.
- El MVP inicia en sandbox, merchant único, aprobación humana explícita,
  quote inmutable, revalidación de precio/stock, idempotencia y fulfillment
  simulado. No habilitar autopurchase, fondos reales o mainnet en este ADR.
- Mantener LLM en interpretación/explicación; reglas, dinero, permisos, estados,
  pagos y fulfillment son deterministas. Las compras autónomas posteriores
  requieren política de gasto revocable y otra decisión aceptada.

## Consecuencias

- Los cambios futuros al API siguen SDD: declarar primero rutas/DTOs en
  `specs/openapi.json`, luego implementación y pruebas. Los endpoints internos
  del primer intent están detallados en ADR 0005.
- La etapa de pago Testnet no conecta todavía un checkout ni un productor de
  cotizaciones; `PAYMENTS_ENABLED` permanece apagado por defecto.
- El catálogo/inventario real, merchant of record, moneda/settlement,
  impuestos, logística, devoluciones y retención de estado siguen abiertos.
- Las dependencias existentes no cuentan como implementación ni demuestran
  cobertura de protocolo.
- Para pasar a Accepted hace falta completar las decisiones abiertas de
  `docs/agentic-commerce-design.md`, hacer un prototipo sandbox end-to-end y
  validar persistencia/reanudación, idempotencia y el contrato del proveedor de
  pago elegido.

## Referencias

- `docs/agentic-commerce-design.md`.
- `docs/stellar-payments-plan.md`.
- [UCP Checkout](https://ucp.dev/specification/shopping/checkout/).
- [Shopify Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog).
- [x402 v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
- [MongoDB checkpoint para LangGraph.js](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/).
