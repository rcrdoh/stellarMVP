# docs

Documentacion de arquitectura, decisiones y flujo de trabajo.

- `adr/`: indice completo de decisiones de arquitectura (0001–0005); ver la
  tabla de abajo.

## ADR

| ADR | Title | Status |
| --- | --- | --- |
| [0001](adr/0001-bun-fastify-framework.md) | Bun, TypeScript y Fastify como framework base | Accepted |
| [0002](adr/0002-error-taxonomy.md) | Error Taxonomy as Public Error Contract | Accepted |
| [0003](adr/0003-service-token-for-protected-routes.md) | Service Token for Protected Routes | Accepted |
| [0004](adr/0004-agentic-commerce.md) | Arquitectura para comercio asistido por agentes (ACP x402) | Proposed |
| [0005](adr/0005-stellar-testnet-payment-intents.md) | Reconciliación de intents de pago Stellar Testnet | Accepted |

- `Taxonomia_Errores_v1.md`: contrato normativo de errores.
- `docker.md`: manual de build y ejecucion con Docker.
- `agent-retriever-stack.md`: arquitectura propuesta, dependencias y pendientes
  del agente recuperador, scraping, RAG y pagos x402.
- `agentic-commerce-design.md`: diseño de las capas Shopping Agent y Search
  Agent, cotización y compras asistidas; sigue `pautas de diseño.md`.
- `errors.md`: reglas practicas para implementar codigos de error.
- `sdd.md`: flujo Spec Driven Development.
- `solid.md`: criterios SOLID aplicados a la base.
- `../DESIGN.md` (raiz): diseno del frontend (`src/ui/`) y su estado actual.
