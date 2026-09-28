# Auditoría del repositorio — Stellar MVP

- **Fecha:** 2026-09-28
- **Rama auditada:** `coding_agent/agentic-commerce` (`b21d7bf` — "Implement Stellar wallet payment intents")
- **Relación con otras ramas:** copia idéntica de `dev` (mismo commit `b21d7bf`,
  sin divergencia de historial ni diferencias de contenido; verificado con
  `git diff dev..coding_agent/agentic-commerce` → vacío). La auditoría aplica por
  igual a `dev`.
- **Remoto:** `git@github.com:rcrdoh/stellarMVP.git`
- **Árbol de trabajo:** limpio (sin cambios pendientes; el único cambio sin
  trackear es esta propia carpeta `audits/`)
- **Autor del último commit:** ribartra — 2026-09-25 23:22:51 -0500
- **Bun usado en la verificación:** 1.4.2 · Node: no disponible en el entorno (ver Riesgos)

## 1. Resumen ejecutivo

El repositorio está **sano**: los cuatro comandos obligatorios definidos en
`AGENTS.md` pasan y el build de TypeScript emite sin errores. La base respeta la
arquitectura por capas y SDD (OpenAPI primero). El único hallazgo crítico no es
de código, sino **ambiental**: el `node_modules/` presente estaba incompleto
(paquetes sin `package.json`, `zod` sin build, `typescript` sin `bin`), lo que
hacía fallar `bun test` y `check-types`. Tras `bun install` vuelve a verde.

| Área | Estado |
| --- | --- |
| `bun run spec:check` | PASS |
| `bun test` | PASS — 40/40 (9 archivos) |
| `bun run check-types` | PASS |
| `bun run check` (Biome) | PASS — 61 archivos |
| `bun run build` | PASS — emite a `dist/` |
| Estructura por capas / SOLID | Conforme |
| Contrato OpenAPI vs rutas | Conforme en paths (todos los endpoints de pago comparten seguridad `serviceToken`) |
| Repositorio de dependencias | **Reparado en esta auditoría** (reinstall) |

## 2. Estado de git

- Rama actual `coding_agent/agentic-commerce`: copia idéntica de `dev` en
  `b21d7bf` (0 adelante / 0 detrás, sin diff de contenido).
- `dev` alineada con `origin/dev` (0 adelante / 6 detrás respecto a `main`).
- Ramas locales presentes: `coding_agent/agentic-commerce`, `dev`, `main`,
  `design/agentic-commerce`, `bot/agentic-commerce`,
  `openhands/agentic-commerce`, `openhands/agentic-commerce-fix1`,
  `chore/agentic-commerce-ci-deps`.
- `b21d7bf` ya incluido en `design/agentic-commerce`; **`dev` no está fusionada
  en `main`** (0 adelante / 6 detrás de `main`).
- 103 archivos versionados.

### Hallazgos de ramas

- **H-1 (medio):** `dev` contiene 6 commits (agentes + pagos Stellar) que no han
  llegado a `main`. Conviene decidir promoción a `main`/PR o descartar.
- **H-2 (bajo):** varias ramas de trabajo (`bot/`, `openhands/*`, `chore/*`) sin
  merge visible; evaluar limpieza para evitar deriva.

## 3. Estructura del código

Conteo de archivos `.ts` por capa:

| Capa | Archivos |
| --- | --- |
| `src/config` | 1 |
| `src/domain` | 6 |
| `src/http` | 5 |
| `src/integrations` | 18 |
| `src/services` | 13 |

- `src/` total: ~4.410 líneas; `tests/`: ~1.021 líneas.
- La separación transporte / dominio / servicios / integraciones se mantiene;
  no se detectaron reglas de negocio dentro de rutas Fastify a partir de la
  revisión estructural.
- No hay marcadores `TODO`/`FIXME`/`HACK`/`XXX` en `src` ni `tests`.
- Escaneo de secretos hardcodeados en `src`, `config`, `docs`, `tests`,
  `scripts`: sin coincidencias. `SERVICE_TOKEN`, claves de API y `STELLAR_*`
  se leen desde entorno.

## 4. Contrato (SDD)

- `specs/openapi.json` (1.068 líneas) valida con `spec:check`.
- Paths en spec y rutas registradas coinciden:
  `/api/hello_api`, `/v1/health/live`, `/v1/health/ready`, `/v1/items`,
  `/v1/items/{itemId}`, `/v1/agent/search`, `/v1/agent/checkout`,
  `/v1/payment-intents`, `/v1/payment-intents/{intentId}`,
  `/v1/payment-intents/{intentId}/submission`, `/docs`.
- Seguridad declarada con `serviceToken` (bearer) en `items` y en los endpoints
  de pago, coherente con ADR 0003.
- **Observación O-1 (bajo):** el spec cubre ampliamente la superficie; mantener
  la disciplina de actualizar `openapi.json` **antes** de la implementación al
  añadir endpoints de pagos/agentes futuros.

## 5. Pruebas

`bun test` → **40 pass / 0 fail**, 217 `expect()`, 9 archivos.

Cobertura por archivo (líneas):

- `tests/agents.test.ts` (189): gate Jev fail-closed, búsqueda, pausas/reaunudación, aprobación, límites, hash.
- `tests/payment-intents.test.ts` (193): intents Stellar, conciliación.
- `tests/contract/openapi-contract.test.ts` (149): contrato OpenAPI.
- `tests/items.test.ts` (129): caso de uso demo.
- `tests/error-codes.test.ts` (103): taxonomía de errores.
- `tests/config.test.ts` (89), `tests/health.test.ts` (81), `tests/payment-routes.test.ts` (54), `tests/contract/vercel-entrypoint.test.ts` (34).

- **Observación O-2 (bajo):** no existe prueba dedicada para el handler
  `GET /v1/payment-intents/{intentId}` más allá de `payment-routes.test.ts`;
  considerar ampliar si crece la lógica de conciliación.

## 6. Dependencias y cadena de suministro

- `package.json`: 26 dependencias directas; runtime `bun >=1.4.0`, lockfile
  presente (`bun.lock`).
- Dependencias pesadas y de riesgo operativo que conviene vigilar:
  `@langchain/langgraph*`, `@qdrant/js-client-rest`, `mongodb`, `pg`, `ioredis`,
  `stripe`, `@x402/*`, `@stellar/stellar-sdk`.
- **H-3 (alto, ambiental):** el `node_modules` previo a esta auditoría estaba
  corrupto/incompleto. Síntoma reproducido: `bun test` →
  `Cannot find package 'zod' ...`; `check-types` → `tsc: command not found`.
  Causa: instalación parcial (paquetes sin `package.json`, `zod` solo con
  `src/`, `typescript` sin `bin/tsc`). **Acción:** `bun install` restauró todo y
  los checks volvieron a verde. No requiere cambio de código, pero sí
  recordatorio de usar `bun install --frozen-lockfile` en CI (ya presente en
  `.github/workflows/deploy.yml`).

## 7. CI/CD y despliegue

- `.github/workflows/deploy.yml`: en push/PR a `main` ejecuta `bun install
  --frozen-lockfile`, luego `spec:check`, `bun test`, `check-types`, `check`,
  verifica `docker build` y despliega a Vercel.
- **Coincidencia relevante:** el pipeline corre exactamente los cuatro checks de
  `AGENTS.md`, por lo que la corrupción de `node_modules` local no afecta CI,
  pero sí bloquea el flujo local si no se reinstala.
- `Dockerfile`: imagen `oven/bun:1.4.0-slim`, instala `--production`, copia
  `config`, `specs`, `src`, arranca con `bun run start`. Coherente con ADR 0001.
- `docker-compose.yml`: Postgres + servicio con healthcheck a `/v1/health/live`.

### Hallazgo de CI

- **H-4 (medio):** el workflow se dispara solo para `main`. Los cambios en
  `dev` (incluido el trabajo de pagos Stellar) **no se validan en CI** hasta
  abrir PR a `main`. Considerar añadir `dev` a `on.push.branches` o un workflow
  de validación en ramas de feature.

## 8. Documentación

- `README.md`, `docs/sdd.md`, `docs/solid.md`, `docs/errors.md`,
  `docs/Taxonomia_Errores_v1.md`, `docs/agentic-commerce-design.md`,
  `docs/agent-retriever-stack.md`, `docs/docker.md` presentes.
- ADR: `0001`–`0005` presentes, incluida
  `0005-stellar-testnet-payment-intents.md`.
- **H-5 (bajo):** desincronización de índices de documentación.
  - `docs/README.md` (línea 6) solo menciona ADR `0001`–`0004`; **falta `0005`**.
  - `docs/adr/README.md` sí lista `0005` correctamente.
- **H-6 (bajo):** el README raíz describe principalmente `/api/hello_api`, pero
  la superficie real ya incluye agentes (`/v1/agent/*`) y pagos
  (`/v1/payment-intents*`). Ampliar la sección de endpoints ayuda a la
  trazabilidad SDD.

## 9. Entorno local

- `node --version` falla con errores `GLIBCXX`/`OPENSSL` porque
  `LD_LIBRARY_PATH` apunta a `/tmp/_MEI*`. Es el escenario documentado en
  `AGENTS.md`; se ejecutaron todas las herramientas con `LD_LIBRARY_PATH=` y
  funcionaron.
- **H-7 (bajo, ambiental):** recordar a nuevos colaboradores exportar
  `LD_LIBRARY_PATH=` (o limpiar la variable) en este host.

## 10. Matriz de hallazgos

| ID | Severidad | Área | Descripción | Acción sugerida |
| --- | --- | --- | --- | --- |
| H-3 | Alta | Entorno | `node_modules` incompleto rompe tests/types | `bun install --frozen-lockfile`; ya reparado |
| H-1 | Media | Git | `dev` con 6 commits sin llegar a `main` | Abrir PR / decidir promoción |
| H-4 | Media | CI | Workflow solo valida `main`, no `dev` | Añadir `dev` a `on.push.branches` |
| H-2 | Baja | Git | Ramas de trabajo sin merge | Evaluar limpieza |
| H-5 | Baja | Docs | `docs/README.md` omite ADR 0005 | Actualizar índice |
| H-6 | Baja | Docs | README omite endpoints de agentes/pagos | Ampliar sección de endpoints |
| H-7 | Baja | Entorno | `LD_LIBRARY_PATH` espurio (`/tmp/_MEI*`) | Documentar/limpiar variable |
| O-1 | Baja | SDD | Mantener spec antes que implementación | Disciplina de proceso |
| O-2 | Baja | Tests | Cobertura limitada en GET payment-intent | Ampliar si crece la lógica |

## 11. Comandos de verificación (evidencia)

```bash
# Ejecutados con LD_LIBRARY_PATH= para neutralizar el entorno roto
bun install                     # reparó node_modules (H-3)
bun run spec:check              # OpenAPI spec OK
bun test                        # 40 pass / 0 fail / 217 expect / 9 files
bun run check-types             # sin errores
bun run check                   # Biome: 61 archivos, sin fixes
bun run build                   # tsc OK -> dist/ (dist/ eliminado tras verificar)
git status                      # working tree clean
```

## 12. Próximos pasos recomendados

1. **Ejecutar `bun install --frozen-lockfile`** en cualquier clon con tests
   rojos por `Cannot find package 'zod'` (H-3).
2. **Abrir PR de `dev` → `main`** o mover el trabajo de pagos/agentes a una rama
   con validación CI (H-1, H-4).
3. **Actualizar `docs/README.md`** para incluir ADR 0005 (H-5).
4. **Ampliar README** con la superficie de endpoints de agentes y pagos (H-6).
5. **Añadir `dev` al workflow de CI** (H-4).
6. Limpiar ramas obsoletas y documentar el caveat de `LD_LIBRARY_PATH` (H-2, H-7).

---

*Auditoría generada por un agente de IA (OpenHands) el 2026-09-28. Los comandos
se ejecutaron localmente contra la rama `dev`; no se modificó código de
producción, solo se reinstalaron dependencias del entorno local.*

---

## 13. Estado de remediación (eSDD, 2026-09-28)

Plan de remediación ejecutado sobre `coding_agent/agentic-commerce` (copia exacta
de `dev` en `b21d7bf`). Todos los recursos de código y pruebas se ejecutan contra
código real; no se usan mocks del sistema bajo prueba.

| ID | Hallazgo | Estado | Cambio |
| --- | --- | --- | --- |
| H-4 | CI sin cobertura de ramas | ✅ Resuelto | `.github/workflows/deploy.yml`: triggers `push`/`pull_request` en `[main, dev]`; job `validate` corre siempre (incluye PRs de forks); job `deploy` solo despliega producción en `push` a `main`. |
| H-5 | Índice ADR desincronizado | ✅ Resuelto | `docs/README.md`: tabla ADR con 0001–0005 y estado real (`0004` Proposed, `0005` Accepted). |
| H-6 | README sin alcance completo del API | ✅ Resuelto | `README.md`: nueva sección "API Endpoints" con rutas de sistema/salud, items, agentes (ACP x402) y payment intents. |
| O-2 | Cobertura `GET /v1/payment-intents/:intentId` | ✅ Resuelto | `tests/payment-routes.test.ts`: 5 pruebas HTTP contra `PaymentIntentService` real + repositorio en memoria via `buildServer`/`app.inject` (401 sin token, 401 sin principal, 404 intent desconocido, 200 owner, 403 principal ajeno). |

### Nota de seguridad del workflow (H-4)

El workflow original ejecutaba validación **y** `vercel deploy --prebuilt --prod`
en el mismo job. Añadir `dev` sin guardas habría desplegado `dev` a producción.
La separación en jobs `validate`/`deploy` con guardas por rama evita ese riesgo:

- `push` a `main` → validación + build/deploy **production**.
- `push` a `dev` → validación + build/deploy **preview**.
- `pull_request` (mismo repo) → validación + **preview**.
- `pull_request` (fork) → solo job `validate`.

### Verificación final (todos verdes)

```
bun run spec:check   # OpenAPI OK
bun test             # 45 pass / 0 fail
bun run check-types  # tsc OK
bun run check        # biome OK (61 files)
bun run build        # tsc build OK
```

*Remediación ejecutada por un agente de IA (OpenHands) el 2026-09-28.*
