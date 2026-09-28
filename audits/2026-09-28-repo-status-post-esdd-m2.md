# Auditoría de estado del repositorio — Stellar MVP (post eSDD M2)

- **Fecha:** 2026-09-28
- **Rama:** `coding_agent/agentic-commerce`
- **HEAD:** `b21d7bf` — "Implement Stellar wallet payment intents"
- **Base de comparación:** `dev` (commit `b21d7bf`)
- **Runtime:** Bun `1.4.2` (engines `>=1.4.0`), TypeScript strict ESM, Biome
- **Alcance:** estado del árbol de trabajo tras completar el eSDD
  "Module 2 Final Integration & Verification"
- **Auditor:** agente de IA (OpenHands) bajo reglas `AGENTS.md`

> Nota: este informe refleja el **estado actual verificable**. Las auditorías
> previas (`2026-09-28-repo-audit.md`, `2026-09-28-esdd-m2-remediation.md`,
> `2026-09-28-esdd-m2-residual-remediation.md`) describen hallazgos y
> remediaciones anteriores.

---

## 1. Resumen ejecutivo

El repositorio está **sano y verde** tras cerrar el eSDD de integración del
Módulo 2: contrato OpenAPI válido, `tsc` sin errores, Biome sin hallazgos, build
OK y **83 pruebas / 0 fallos** sobre código real (13 archivos, incluyendo el
Módulo 3 de wallet Web3). Se añadieron el adaptador de catálogo vectorial, la
suite de pruebas de integración del mismo, y se endureció la inicialización del
checkpointer Postgres.

El árbol de trabajo contiene **39 archivos M2 en staging** (+3.582 / −94 líneas)
más los archivos del Módulo 3 **aún sin trackear** (`src/domain/wallets/`,
`src/services/wallets/`, `src/integrations/wallets/`, `tests/wallets.test.ts` y
docs asociados). La rama sigue **alineada con `dev`** (`0 0`), sin commits
nuevos respecto a HEAD. Ver `2026-09-28-module3-wallet-status.md`.

Estado global: **APTO para commit/PR**, con los pendientes administrativos en §8.

---

## 2. Identidad y control de versiones

| Dato | Valor |
| --- | --- |
| Rama actual | `coding_agent/agentic-commerce` |
| HEAD | `b21d7bf` — Implement Stellar wallet payment intents |
| `dev...HEAD` (izq/der) | `0 0` → sin divergencia (antes de commit local) |
| Staging acumulado | 39 archivos, +3.582 / −94 líneas |

Observación: los cambios del eSDD están **staged pero no commiteados**. Ver §8.

---

## 3. Cambios en staging (working tree)

`git status --short` (todos `A`/`M`, ninguno sin trackear tras el `git add`):

```
M  .env.example
M  .github/workflows/deploy.yml
M  README.md
A  audits/README.md + 5 informes
M  docs/README.md
M  docs/agentic-commerce-design.md
M  package.json
M  scripts/README.md
A  scripts/migrate-smoke.ts
M  specs/openapi.json
M  src/config/env.ts
M  src/domain/agents/contracts.ts
M  src/http/routes.ts
M  src/http/server.ts
M  src/index.ts
M  src/integrations/README.md
M  src/integrations/agent-runtime.ts
A  src/integrations/agents/catalog-merchant-search-agent.ts
A  src/integrations/agents/catalog-quote-provider.ts
A  src/integrations/agents/postgres-checkpointer.ts
A  src/integrations/agents/vector-merchant-catalog.ts
M  src/services/agent-auth.ts
A  src/services/agents/ports/merchant-catalog.ts
A  src/services/agents/shopping-conversation.ts
A  supabase/migrations/20260928120000_agent_commerce_schema.sql
A  supabase/migrations/20260928120100_agent_isolation_rls.sql
A  supabase/migrations/20260928120200_purchase_intents_state_transitions.sql
A  supabase/migrations/20260928120300_ttl_cleanup_procedure.sql
M  tests/README.md
M  tests/contract/openapi-contract.test.ts
M  tests/payment-routes.test.ts
A  tests/shopping-route.test.ts
A  tests/supabase-migrations.test.ts
A  tests/vector-catalog.test.ts
```

### 3.1 `.env.example`

- Añade `DATABASE_URL=` y `SUPABASE_DB_URL=` (vacíos), alineado con el esquema
  Zod de `src/config/env.ts` (ambos por defecto `""`). Sin secretos.

### 3.2 `specs/openapi.json`

- Contrato extendido con `POST /v1/agent/shopping` (además de `/v1/agent/search`
  y `/v1/agent/checkout`), sincronizado con `shoppingStateSchema` /
  `shoppingConversationTurnSchema` / `merchantOfferSchema` en
  `src/domain/agents/contracts.ts`.

### 3.3 Migraciones Supabase (`supabase/migrations/`)

- `20260928120000_agent_commerce_schema.sql`: esquema base de agentes/pagos.
- `20260928120100_agent_isolation_rls.sql`: políticas RLS de aislamiento por
  agente.
- `20260928120200_purchase_intents_state_transitions.sql`: transiciones de
  estado de purchase intents.
- `20260928120300_ttl_cleanup_procedure.sql`: procedimiento de limpieza TTL.

### 3.4 Adaptadores de agentes (`src/integrations/agents/`)

- `vector-merchant-catalog.ts`: `MerchantCatalog` sobre embeddings + vector
  store; parsea cada payload con `merchantOfferSchema` (fail-closed).
- `postgres-checkpointer.ts`: checkpointer durable con **seam de inyección**
  (`PoolLike` + `poolFactory`); rechaza cadenas de conexión vacías **antes** de
  construir el pool.
- `catalog-merchant-search-agent.ts` / `catalog-quote-provider.ts`: adaptadores
  de búsqueda y cotización sobre el catálogo.

### 3.5 Pruebas nuevas

- `tests/vector-catalog.test.ts`: transformación Qdrant → `MerchantOffer`,
  traducción de filtros, fail-closed ante documentos incompatibles.
- `tests/supabase-migrations.test.ts`: DDL de migraciones + invariante "sin
  socket" del checkpointer con fábrica inyectada.
- `tests/shopping-route.test.ts`: `POST /v1/agent/shopping` con 401 / 403 / 422 /
  200.

---

## 4. Verificación automatizada

| Comando | Resultado |
| --- | --- |
| `bun run spec:check` | ✅ OpenAPI OK (`specs/openapi.json`) |
| `bun test` | ✅ **83 pass / 0 fail** (13 archivos, 341 `expect()`) |
| `bun run check-types` | ✅ `tsc -p tsconfig.check.json` sin errores |
| `bun run check` | ✅ Biome OK (81 archivos, 0 correcciones) |
| `bun run build` | ✅ `tsc -p tsconfig.build.json` → ESM válido en `dist/` |

> Todos los comandos ejecutados con `LD_LIBRARY_PATH=` para evitar el fallo de
> enlazado dinámico descrito en `AGENTS.md`.

### 4.1 Inventario de pruebas por archivo

```
tests/agents.test.ts
tests/config.test.ts
tests/error-codes.test.ts
tests/health.test.ts
tests/items.test.ts
tests/payment-intents.test.ts
tests/payment-routes.test.ts
tests/shopping-route.test.ts          (nuevo — ruta de shopping)
tests/supabase-migrations.test.ts     (nuevo — migraciones + checkpointer)
tests/vector-catalog.test.ts          (nuevo — adaptador de catálogo vectorial)
tests/wallets.test.ts                 (nuevo M3 — wallet Web3, 13 tests)
tests/contract/openapi-contract.test.ts
tests/contract/vercel-entrypoint.test.ts
```

---

## 5. Estructura y capas (AGENTS.md)

Estructura por capas respetada:

```
src/config        Variables de entorno tipadas (env.ts)
src/domain        Dominio puro: agents/contracts.ts, errors.ts, error-codes.ts…
src/http          Transporte: server.ts, routes.ts, payment-routes.ts, …
src/services      Casos de uso: agents/ (shopping-agent, shopping-conversation,
                  ports/merchant-catalog), agent-auth, …
src/integrations  Adaptadores: agents/ (vector-merchant-catalog,
                  postgres-checkpointer, catalog-*), qdrant, openai, …
specs/            openapi.json + reglas de contrato
scripts/          validate-openapi.ts, migrate-smoke.ts
tests/            pruebas de servicio + tests/contract/
supabase/         migrations/ (DDL versionado)
```

Superficie HTTP detectada en `src/http/routes.ts` y `payment-routes.ts`:

```
GET  /                          → redirect a /docs
GET  /openapi.json
GET  /v1/health/live
GET  /api/hello_api
GET  /v1/health/ready
POST /v1/items
GET  /v1/items/:itemId
POST /v1/payment-intents
GET  /v1/payment-intents/:intentId
POST /v1/agent/search
POST /v1/agent/checkout
POST /v1/agent/shopping         (nuevo — scope agent:shopping)
```

Puertos y adaptadores: `ShoppingAgent` depende de `MerchantCatalog` /
`MerchantSearchAgent` / `QuoteProvider` / `AgentCheckpointer`, no de
adaptadores concretos. No se observan reglas de negocio en rutas Fastify.

---

## 6. Contrato y scopes

- `POST /v1/agent/shopping` exige token de agente y scope
  `AGENT_SCOPES.SHOPPING` (`agent:shopping`); verificado en
  `src/services/agent-auth.ts` y en los tests de ruta.
- Códigos cubiertos por `tests/shopping-route.test.ts`: **401** (sin token),
  **403** (scope insuficiente), **422** (turno inválido), **200** (turno válido).
- `bun run spec:check` valida `specs/openapi.json` sin deriva de esquema.

---

## 7. Seguridad

- **Escaneo de secretos** (patrones `sk-*`, `AKIA*`, `ghp_*`, claves privadas
  PEM, cadenas con credenciales `postgres://user:pass@`) sobre `src/`, `tests/`,
  `scripts/`, `specs/`, `docs/` y `*.md`: **sin hallazgos**. Las únicas
  coincidencias son marcadores/fixtures documentales (p. ej. `postgres://...` en
  docstring de `migrate-smoke.ts`, direcciones G-addresss de prueba).
- `.env` y `.env.*` están en `.gitignore` (con excepción de `.env.example`); se
  verificó que **ningún `.env` quedó staged**.
- Guarda de despliegue en `.github/workflows/deploy.yml`: producción limitada a
  `push` en `main`.

---

## 8. Pendientes / recomendaciones

1. **Commit y PR:** registrar los 39 archivos M2 en staging más los archivos del
   Módulo 3 (wallet Web3) y abrir PR `coding_agent/agentic-commerce` → `dev` (o
   `main` según política). No se commitearon cambios durante esta auditoría. Ver
   el checklist DoD en `2026-09-28-module3-wallet-status.md`.
2. **Verificación de integración real:** las pruebas de `postgres-checkpointer`
   usan la fábrica inyectada (sin socket). Falta ejecutar `bun run db:smoke`
   contra un Postgres/Supabase real para validar las 4 migraciones en vivo.
3. **Higiene de ramas:** consolidar/eliminar ramas de agente redundantes
   (`bot/`, `openhands/agentic-commerce`, `openhands/agentic-commerce-fix1`)
   tras confirmar su integración.
4. **Documentar caveat de entorno** (`LD_LIBRARY_PATH=`) si no está ya reflejado
   en README/`docs/`.
5. **ADR 0004** sigue en estado **Proposed**; decidir su aceptación o
   postergación explícita.

---

*Auditoría generada por un agente de IA (OpenHands) el 2026-09-28 contra el
árbol de trabajo de la rama `coding_agent/agentic-commerce` (HEAD `b21d7bf`).
Los comandos se ejecutaron localmente con `LD_LIBRARY_PATH=`; no se modificó
código de producción durante la auditoría.*
