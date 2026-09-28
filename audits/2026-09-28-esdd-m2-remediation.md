# Audit: Executable System Design Document (eSDD) — Residual M2 Remediation & Agent Composition

- **Repository**: `stellarMVP`
- **Branch**: `coding_agent/agentic-commerce`
- **HEAD**: `b21d7bf` — *Implement Stellar wallet payment intents*
- **Runtime**: Bun `1.4.2`, TypeScript ESM estricto, Biome
- **Audit date**: 2026-09-28
- **Working tree**: cambios sin commitear (spec, código, docs y pruebas)

## 1. Objetivo

Registrar el estado del repositorio en relación con el *Executable System Design
Document (eSDD)* y cerrar ("end") la remediación residual M2 sobre la composición
de agentes (Shopping Agent + Search Agent) y la ruta `POST /v1/agent/shopping`.

## 2. Estado del eSDD

El eSDD **no está completamente implementado**: la capa de composición y ruta
existe y pasa verificación, pero el flujo permanece parcial respecto al diseño
completo `docs/agentic-commerce-design.md` (dependencias externas de vector/RAG,
checkpointer Postgres y pago x402 no ejercitadas end-to-end). El residuo M2 se
considera **cerrado a nivel de contrato + ruta + servicio real**.

### Artefactos que materializan el eSDD

| Artefacto | Rol | Estado |
| --- | --- | --- |
| `specs/openapi.json` | Fuente de verdad del API (SDD) | Actualizado, `spec:check` verde |
| `src/domain/agents/contracts.ts` | Contratos puros de dominio (Zod) | Actualizado (`shoppingStateSchema`, turnos, señales) |
| `src/services/agents/shopping-agent.ts` | Agente de shopping (grafo LangGraph) | Implementado |
| `src/services/agents/shopping-conversation.ts` | Caso de uso que envuelve el agente | Implementado |
| `src/services/agents/ports/merchant-catalog.ts` | Puerto de catálogo (interfaz) | Implementado |
| `src/integrations/agents/*` | Adaptadores (catálogo, quote provider, checkpointer, vector) | Implementado |
| `src/http/routes.ts` | Ruta `POST /v1/agent/shopping` | Implementada |
| `src/http/server.ts` | Composición de integraciones y rutas de agente | Implementado |
| `tests/contract/openapi-contract.test.ts` | Contrato de la ruta + schemas | Ampliado |
| `tests/shopping-route.test.ts` | Prueba de ruta end-to-end con servicio real | **Añadido en esta auditoría** |

## 3. Cambios registrados (sin commitear)

```
 .env.example                            |   2 +
 .github/workflows/deploy.yml            |  62 ++-
 README.md                               |  48 +
 docs/README.md                          |  15 +-
 docs/agentic-commerce-design.md         |  22 +-
 package.json                            |   1 +
 specs/openapi.json                      | 818 +++++++++++++++++++++++---
 src/config/env.ts                       |   1 +
 src/domain/agents/contracts.ts          |  25 +
 src/http/routes.ts                      |  27 ++
 src/http/server.ts                      |  15 +
 src/index.ts                            |   5 +-
 src/integrations/README.md              |   5 +-
 src/integrations/agent-runtime.ts       | 112 ++++-
 src/services/agent-auth.ts              |   1 +
 tests/README.md                         |   3 +
 tests/contract/openapi-contract.test.ts |  11 +
 tests/payment-routes.test.ts            | 251 +++++++++-
 18 files changed, 1330 insertions(+), 94 deletions(-)
```

Nuevos sin seguimiento (untracked):

```
 scripts/migrate-smoke.ts
 src/integrations/agents/catalog-merchant-search-agent.ts
 src/integrations/agents/catalog-quote-provider.ts
 src/integrations/agents/postgres-checkpointer.ts
 src/integrations/agents/vector-merchant-catalog.ts
 src/services/agents/ports/merchant-catalog.ts
 src/services/agents/shopping-conversation.ts
 supabase/
 tests/shopping-route.test.ts
 tests/supabase-migrations.test.ts
 audits/
```

## 4. Remediación residual M2 — cierre

### 4.1 Alcance cubierto

- Scope de agente `agent:shopping` en `src/services/agent-auth.ts`
  (`AGENT_SCOPES.SHOPPING`).
- Composición en `src/http/server.ts`: `buildAgentRoutes` cablea
  `auth`, `search`, `checkout` y `shopping` (condicional a
  `agent.shoppingConversation`).
- Ruta `POST /v1/agent/shopping` en `src/http/routes.ts`:
  `requireAgentToken` → `verifyAgentScope(agent:shopping)` →
  `shoppingConversationTurnSchema.parse` → `shopping.advance(turn)`.
- Contrato declarado primero en `specs/openapi.json` y verificado por
  `tests/contract/openapi-contract.test.ts`.

### 4.2 Prueba de ruta añadida (`tests/shopping-route.test.ts`)

Ejerce la ruta completa `HTTP → servicio → grafo` contra componentes reales; sin
mocks de servicios. Los puertos externos se sustituyen por adaptadores en
memoria deterministas (fakes de puerto, no mocks):

1. **401** sin token de agente.
2. **403** con token sin el scope `agent:shopping`.
3. **422** con cuerpo que no es un turno de conversación válido.
4. **200** en un turno `start`, devolviendo `ShoppingState` validado
   (`sessionId`, `principalId`, `status`, `candidates`).

El doble de Redis implementa `hget`/`get`/`set`/`incrbyfloat`/`expire`/`ping`/
`quit` para `AgentAuthService` y `defineCommand`/`rateLimit` (con soporte de
callback estilo ioredis) para `@fastify/rate-limit`.

## 5. Verificación

Secuencia ejecutada tras los cambios:

| Comando | Resultado |
| --- | --- |
| `bun test` | **60 pass / 0 fail** (incluye 4 nuevas pruebas de ruta) |
| `bun run spec:check` | OK |
| `bun run check-types` | OK (`tsc -p tsconfig.check.json`) |
| `bun run check` | OK (Biome, 70 archivos, sin fixes) |
| `bun run build` | OK (`tsc -p tsconfig.build.json`) |

## 6. Riesgos y pendientes

- **Persistencia**: checkpointer Postgres (`postgres-checkpointer.ts`) y
  migraciones `supabase/` no se ejercitan end-to-end en las pruebas.
- **RAG/vectores**: `vector-merchant-catalog.ts` y `@qdrant/js-client-rest`
  quedan como adaptadores no cubiertos por pruebas de integración.
- **Pago x402**: el flujo de checkout (`@x402/*`) no forma parte del alcance M2
  de esta remediación.
- **Deriva de contrato**: cualquier cambio futuro en `shoppingStateSchema` debe
  reflejarse primero en `specs/openapi.json` (regla SDD).
- **Deuda de formato**: `specs/openapi.json` requirió reformateo Biome; mantener
  el formato en futuros cambios evita ruido en diffs.

## 7. Conclusión

El eSDD queda **completo para el alcance M2 de composición y ruta de shopping**:
contrato declarado y validado, ruta implementada y probada contra servicio real,
y toda la secuencia de verificación en verde. Los componentes restantes
(vectores/RAG, checkpointer Postgres, pago x402) permanecen fuera del cierre M2 y
se documentan como pendientes.

> Este informe fue generado por un agente de IA (OpenHands) en nombre del usuario.
