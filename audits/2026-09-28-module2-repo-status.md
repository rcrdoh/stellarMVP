# Auditoría de estado del repositorio — Módulo 2 (eSDD)

- **Fecha:** 2026-09-28
- **Rama:** `coding_agent/agentic-commerce`
- **HEAD:** `b21d7bf`
- **Runtime:** Bun `1.4.2` / TypeScript estricto ESM / Biome
- **Alcance:** implementación del Módulo 2 — capa de datos Postgres/Supabase,
  aislamiento de agentes por RLS y checkpointer durable.

## Resumen ejecutivo

Estado **verde**. La suite completa pasa, el build compila, Biome y `tsc` no
reportan hallazgos y el contrato OpenAPI sigue válido. El Módulo 2 añade esquema
SQL idempotente, políticas RLS con roles disjuntos y un checkpointer Postgres
conectado al composition root, sin mocks de servicios en las pruebas.

## Verificación ejecutada

| Comando | Resultado |
| --- | --- |
| `bun install --frozen-lockfile` | OK — 230 installs, sin cambios |
| `bun run spec:check` | OK — `specs/openapi.json` válido |
| `bun test` | OK — **51 pass / 0 fail** (256 aserciones, 10 archivos) |
| `bun run check-types` | OK — sin errores `tsc` |
| `bun run check` | OK — Biome sin hallazgos |
| `bun run build` | OK — emite `dist/` vía `tsconfig.build.json` |

Línea base previa: 45 tests. Se añadieron **6 tests** de migraciones y
checkpointer (`tests/supabase-migrations.test.ts`), sin regresiones.

## Cambios del Módulo 2

### 1. Esquema Postgres/Supabase — `supabase/migrations/`

`20260928120000_agent_commerce_schema.sql` (idempotente, 8 tablas):

- `sources`, `products_raw`, `products_ranked`: procedencia y proyección
  rankeada, separadas para no mutar datos de origen al re-rankear.
- `search_sessions`, `search_results`: resultados con **TTL** (`ttl_seconds`,
  `expires_at`) e índice de barrido para invalidar precios.
- `wallets`: registro Stellar, sensible a pagos.
- `purchase_intents`: handoff determinista con CHECK de snapshot y **trigger de
  inmutabilidad** sobre `product_snapshot`, `amount`, `destination`, `currency`;
  `unique (principal_id, idempotency_key)` garantiza idempotencia.
- `purchase_records`: liquidación inmutable con `transaction_hash` único.

### 2. Aislamiento de agentes por RLS — `20260928120100_agent_isolation_rls.sql`

- Roles grupales `discovery_agent` y `payment_agent` (`nologin`).
- RLS **habilitado y forzado** en las 8 tablas.
- `discovery_agent`: solo catálogo/búsqueda; `revoke` explícito sobre
  `wallets`/`purchase_records`.
- `payment_agent`: solo intents `pending` y liquidación; `revoke` explícito
  sobre catálogo/búsqueda; `update` limitado a columnas de estado.

### 3. Checkpointer Postgres durable

- `src/integrations/agents/postgres-checkpointer.ts`:
  `createPostgresAgentCheckpointer` sobre `PostgresSaver` + `pg.Pool`, con
  `setup()` idempotente y cierre explícito del pool; rechaza connection string
  vacío antes de abrir conexión.
- `src/integrations/agent-runtime.ts`: construye el checkpointer desde
  `SUPABASE_DB_URL` (fallback `DATABASE_URL`) y lo expone como
  `AgentIntegrations.checkpointer`; `close()` libera el pool.
- `src/http/server.ts`: tipo `AgentIntegrations` extendido con `checkpointer?`.
- `src/config/env.ts` y `.env.example`: nueva variable `SUPABASE_DB_URL`.

### 4. Documentación

- `docs/agentic-commerce-design.md`: sección "Implementado en el Módulo 2".
- `src/integrations/README.md`: adaptadores de checkpointer (Mongo + Postgres).
- `README.md`: carpeta `supabase/` en el árbol de estructura.

## Hallazgos y riesgos residuales

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| M2-1 | Media | Las migraciones no se ejecutan contra una base viva en CI; los tests validan la forma del DDL y el contrato del factory, no una conexión real. | Abierto (documentado) |
| M2-2 | Media | `agent-runtime.ts` instancia el checkpointer de forma eager aunque no exista consumidor en el servidor HTTP todavía. | Aceptado (preparación M3+) |
| M2-3 | Baja | Falta política de retención/borrado para checkpoints y `search_results` vencidos. | Abierto |
| M2-4 | Baja | El `update` de `payment_agent` sobre `purchase_intents` no restringe transiciones válidas de estado (solo columnas). | Abierto |

## Notas de proceso

- No se usaron mocks de servicios: las pruebas ejecutan el código real del
  factory y leen el DDL desde disco.
- No quedaron servidores, contenedores ni procesos en ejecución.
- No se almacenaron secretos en TOML, `.env.example`, docs ni tests.

## Próximos pasos sugeridos

1. Smoke test de migraciones contra Postgres efímero en CI (cierra M2-1).
2. Composición del Shopping Agent en el composition root usando el checkpointer
   inyectado (avanza M2-2 / integración M3).
3. Job de limpieza con `expires_at` para `search_results` y política de
   retención de checkpoints (M2-3).
4. Validación de transiciones de estado en `purchase_intents` (M2-4).
