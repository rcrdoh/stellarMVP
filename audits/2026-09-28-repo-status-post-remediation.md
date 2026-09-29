# Auditoría de estado actual del repositorio — Stellar MVP

- **Fecha:** 2026-09-28
- **Rama:** `coding_agent/agentic-commerce`
- **HEAD:** `b21d7bf` — "Implement Stellar wallet payment intents"
- **Base de comparación:** `dev` / `main` (commit `b21d7bf`)
- **Runtime:** Bun `1.4.2` (engines `>=1.4.0`)
- **Alcance:** estado del árbol de trabajo tras aplicar el plan de remediación eSDD
- **Auditor:** agente de IA (OpenHands) bajo reglas `AGENTS.md`

> Nota: existe una auditoría previa (`2026-09-28-repo-audit.md`) que describe los
> hallazgos originales y su remediación. Este documento refleja el **estado
> actual** verificable del repositorio.

---

## 1. Resumen ejecutivo

El repositorio está **sano y verde**: contrato OpenAPI válido, `tsc` sin errores,
Biome sin hallazgos, build OK y **45 pruebas / 0 fallos** sobre código real (sin
mocks del sistema bajo prueba). El árbol de trabajo contiene 4 archivos
modificados y 1 carpeta nueva (`audits/`), pendientes de commit. La rama está
**6 commits por delante de `main`** y **sin divergencia respecto a `dev`** salvo
los cambios locales de remediación.

Estado global: **APTO para commit/PR**, con los pendientes administrativos
listados en §7.

---

## 2. Identidad y control de versiones

| Dato | Valor |
| --- | --- |
| Rama actual | `coding_agent/agentic-commerce` |
| HEAD | `b21d7bf` — Implement Stellar wallet payment intents |
| `main...HEAD` (izq/der) | `0 6` → 0 detrás, 6 adelante de `main` |
| Diff vs `dev` | 4 archivos, +319 / −38 líneas |

Ramas locales: `bot/agentic-commerce`, `chore/agentic-commerce-ci-deps`,
`coding_agent/agentic-commerce` (actual), `design/agentic-commerce`, `dev`,
`main`, `openhands/agentic-commerce`, `openhands/agentic-commerce-fix1`.
Remotas (`origin`): `main` (HEAD), `dev`, `design/agentic-commerce`,
`design/stellar-payments`, `openhands/agentic-commerce`,
`openhands/agentic-commerce-fix1`.

Observación: existe proliferación de ramas de trabajo por agente
(`bot/`, `coding_agent/`, `openhands/`, `design/`). Ver pendientes §7.

---

## 3. Cambios sin commitear (working tree)

`git status --short`:

```
 M .github/workflows/deploy.yml
 M README.md
 M docs/README.md
 M tests/payment-routes.test.ts
?? audits/
```

Diff acumulado contra `dev`:

```
 .github/workflows/deploy.yml |  44 +++++---
 README.md                    |  47 ++++++++
 docs/README.md               |  15 +-
 tests/payment-routes.test.ts | 251 ++++++++++++++++++++++++++++----
 4 files changed, 319 insertions(+), 38 deletions(-)
```

### 3.1 `.github/workflows/deploy.yml`

- Triggers: `push` y `pull_request` sobre `[main, dev]`.
- Jobs separados: `validate` (siempre corre, incluye PRs de forks) y `deploy`
  (`needs: validate`).
- Guardas de seguridad: `deploy production` solo con
  `github.event_name == 'push' && github.ref == 'refs/heads/main'`; el resto va a
  `preview`. YAML validado (`jobs: validate, deploy`).

### 3.2 `README.md`

- Nueva sección "API Endpoints" con rutas reales de sistema/salud, items,
  agentes (ACP x402) y payment intents; flujo de lista numerada corregido.

### 3.3 `docs/README.md`

- Tabla ADR con 0001–0005 y estado real (`0004` **Proposed**, `0005` **Accepted**).

### 3.4 `tests/payment-routes.test.ts`

- Nuevas pruebas HTTP de `GET /v1/payment-intents/:intentId` contra
  `PaymentIntentService` real + repositorio en memoria via `buildServer`/`app.inject`:
  401 sin token, 401 sin principal, 404 intent desconocido (UUID válido no usado),
  200 owner, 403 principal ajeno.

### 3.5 `audits/`

- Carpeta nueva (sin trackear) con esta auditoría y la previa de remediación.

---

## 4. Verificación automatizada

| Comando | Resultado |
| --- | --- |
| `bun run spec:check` | ✅ OpenAPI OK (`specs/openapi.json`) |
| `bun test` | ✅ **45 pass / 0 fail** (9 archivos) |
| `bun run check-types` | ✅ `tsc -p tsconfig.check.json` sin errores |
| `bun run check` | ✅ Biome OK (61 archivos, 0 correcciones) |
| `bun run build` | ✅ `tsc -p tsconfig.build.json` OK |

### 4.1 Inventario de pruebas por archivo

```
tests/agents.test.ts
tests/config.test.ts
tests/error-codes.test.ts
tests/health.test.ts
tests/items.test.ts
tests/payment-intents.test.ts
tests/payment-routes.test.ts        (nuevo, cobertura GET intent)
tests/contract/openapi-contract.test.ts
```

---

## 5. Estructura y capas (AGENTS.md)

Estructura por capas respetada:

```
src/config        Variables de entorno tipadas (env.ts)
src/domain        Dominio puro: agent.ts, items.ts, payments.ts, errors.ts, error-codes.ts, agents/
src/http          Transporte: server.ts, routes.ts, payment-routes.ts, payment-auth.ts, error-handler.ts
src/services      Casos de uso: item-service, payment-intent-service, agents/, agent-auth, agent-checkout
src/integrations  Adaptadores: stellar/, agents/, postgres, redis, qdrant, bucket, cache, circuit-breaker…
specs/            openapi.json + reglas de contrato
scripts/          validate-openapi.ts
tests/            pruebas de servicio + tests/contract/
```

Superficie HTTP detectada:

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
POST (rutas protegidas de agentes/pagos adicionales)
```

No se observan reglas de negocio incrustadas en rutas Fastify; los servicios
dependen de puertos/adaptadores.

---

## 6. Seguridad

- **Escaneo de secretos** (patrones `sk-*`, `AKIA*`, `ghp_*`, claves privadas
  PEM) sobre `*.ts`, `*.json`, `*.toml`, `*.md`, `*.yml` excluyendo
  `node_modules`: **sin hallazgos**.
- Tokens de servicio se consumen vía variables de entorno, no hardcodeados.
- Guarda de despliegue: el despliegue a producción queda limitado a la rama
  principal; el destino activo es Render.

---

## 7. Pendientes / recomendaciones

1. **Commit y PR:** registrar los 4 archivos modificados + `audits/` y abrir PR
   `coding_agent/agentic-commerce` → `dev` (o → `main` según política).
2. **Higiene de ramas:** consolidar/eliminar ramas de agente redundantes
   (`bot/`, `openhands/agentic-commerce`, `openhands/agentic-commerce-fix1`,
   `chore/agentic-commerce-ci-deps`) tras confirmar que su contenido está
   integrado.
3. **Documentar caveat de entorno:** el fallo de `GLIBCXX`/`OPENSSL` por un
   `LD_LIBRARY_PATH` espurio (apuntando a `/tmp/_MEI*`) merece nota en README o
   `docs/`.
4. **ADR 0004** sigue en estado **Proposed**; decidir su aceptación o
   postergación explícita.
5. **`specs/openapi.json`:** verificar que la nueva cobertura de pruebas GET
   refleja exactamente los esquemas publicados (sin divergencia de contrato).

---

*Auditoría generada por un agente de IA (OpenHands) el 2026-09-28 contra el
árbol de trabajo de la rama `coding_agent/agentic-commerce` (HEAD `b21d7bf`).
Los comandos se ejecutaron localmente; no se modificó código de producción
durante la auditoría.*
