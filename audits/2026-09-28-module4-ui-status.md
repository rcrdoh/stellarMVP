# Auditoría de estado — Módulo 4: UI Shell, carrito y layout de flujo

- **Fecha:** 2026-09-28
- **Rama:** `agent`
- **HEAD:** `2021100` — "M4 implementation"
- **Base de comparación:** `dev` (`b21d7bf`) / `main` (`a7c3f4a`)
- **Runtime:** Bun `1.4.2` (engines `>=1.4.0`), TypeScript strict ESM, Biome
- **Alcance:** capa de presentación framework-agnostic (sin React ni DOM en el
  dominio), `CartStore`, `WalletController`, componentes de shell y búsqueda, y
  suite `tests/ui.test.ts`
- **Auditor:** agente de IA (OpenHands) bajo reglas `AGENTS.md`

> Nota: este informe refleja el **estado actual verificable**. Las auditorías
> previas (`2026-09-28-repo-audit.md`, `2026-09-28-esdd-m2-remediation.md`,
> `2026-09-28-esdd-m2-residual-remediation.md`, `2026-09-28-repo-status-post-esdd-m2.md`,
> `2026-09-28-module3-wallet-status.md`) describen hallazgos y remediaciones
> anteriores.

---

## 1. Resumen ejecutivo

El Módulo 4 está **completo, commiteado y verde**. La capa `src/ui/` se apoya
solo en `document`, `EventTarget` y `CustomEvent`, sin React y sin importar el
SDK de wallet, `window` ni `localStorage` desde el dominio ni desde los puertos.
Las dependencias externas (`WalletController`, `CartStore`, cliente de búsqueda y
`toProblem`) se reciben por inyección, de modo que el mismo código corre en
navegador y en `happy-dom` en pruebas.

La cadena de verificación completa (SPEC/TEST/TYPES/CHECK/BUILD) devuelve `0`,
con **101 pruebas / 0 fallos** sobre 14 archivos (incluida `tests/ui.test.ts` con
18 casos) y **92 archivos** limpios en Biome. El árbol de trabajo está **limpio**
(sin cambios pendientes). Estado global: **APTO**, con los pendientes
administrativos de §7.

---

## 2. Identidad y control de versiones

| Dato | Valor |
| --- | --- |
| Rama actual | `agent` |
| HEAD | `2021100` — M4 implementation |
| `main...HEAD` (izq/der) | `0 8` → 0 detrás, 8 adelante de `main` |
| `dev...HEAD` (izq/der) | `0 2` → 0 detrás, 2 adelante de `dev` |
| Working tree | limpio (`git status --porcelain` sin salida) |

Historial relevante:

```
2021100 M4 implementation            (rama actual `agent`)
b1e67a7 M3 implementation            (Módulo 3 + auditorías + migraciones)
b21d7bf Implement Stellar wallet payment intents   (base `dev`/`design`)
```

Ramas locales con seguimiento: `agent` (actual, sin upstream),
`coding_agent/agentic-commerce` → `origin/coding_agent/agentic-commerce`,
`design/agentic-commerce` → `origin/design/agentic-commerce`, `dev` → `origin/dev`,
`main` → `origin/main`, `openhands/agentic-commerce` → `origin/openhands/agentic-commerce`,
`openhands/agentic-commerce-fix1` → `origin/openhands/agentic-commerce-fix1`,
`bot/agentic-commerce` y `chore/agentic-commerce-ci-deps` (sin upstream).

Observación: persiste la proliferación de ramas de agente; la rama de trabajo
actual es `agent`, que nace de `coding_agent/agentic-commerce` (mismo commit
`2021100`). Ver pendientes §7.

---

## 3. Cambios del Módulo 4 (commit `2021100`)

`git show --stat 2021100` — 17 archivos, +1511 / −3:

```
 AGENTS.md                                 |  39 +++
 README.md                                 |   1 +
 bun.lock                                  |  19 +-
 docs/agentic-commerce-design.md           |  28 ++
 package.json                              |   1 +
 src/ui/components/app-layout.ts           |  49 +++
 src/ui/components/header.ts               | 115 +++++++
 src/ui/components/product-card.ts         |  47 +++
 src/ui/components/product-stream.ts       | 164 ++++++++++
 src/ui/components/shopping-cart-drawer.ts | 126 ++++++++
 src/ui/components/skeleton.ts             |  32 ++
 src/ui/components/transaction-progress.ts | 122 ++++++++
 src/ui/dom.ts                             |  16 +
 src/ui/stores/cart-store.ts               |  98 ++++++
 src/ui/wallet-controller.ts               | 136 ++++++++
 tests/README.md                           |   8 +
 tests/ui.test.ts                          | 513 ++++++++++++++++++++++++++++++
```

### 3.1 `src/ui/` (capa de presentación)

- `dom.ts` — helper `requireElement` que valida el contenedor raíz.
- `stores/cart-store.ts` — `CartStore extends EventTarget` con `ProductOffer` /
  `CartSnapshot`; clona y congela copias, emite snapshots inmutables y expone
  `add`/`remove`/`clear`/`open`/`close`/`toggle`.
- `wallet-controller.ts` — `WalletController extends EventTarget` envuelve el
  `WalletSessionService` en eventos de UI (`wallet-changed`, `wallet-connecting`,
  `wallet-error`); el mensaje de error es el código de taxonomía.
- `components/` — `createHeader` / `createAppLayout`, `createProductCard`
  (texto vía `textContent`, evita XSS), `skeleton.ts`, `product-stream.ts`
  (submit de form, estado vacío y errores RFC 9457 vía `toProblem` inyectado),
  `shopping-cart-drawer.ts` y `transaction-progress.ts` (mapea
  `PaymentIntentStatus` del dominio a pasos de UI).

### 3.2 Documentación

- `docs/agentic-commerce-design.md` — nueva subsección "UI Shell (Module 4)".
- `README.md` — `ui/` añadido al árbol de `src/`.
- `tests/README.md` — documenta `tests/ui.test.ts`.
- `AGENTS.md` — convención de rama de feature (`agent/task-<ts>-<feature>`).

### 3.3 Dependencias

- `package.json`: `happy-dom` como `devDependency` (solo pruebas). Sin
  dependencias de runtime nuevas.

---

## 4. Verificación automatizada

| Comando | Resultado |
| --- | --- |
| `bun run spec:check` | ✅ OpenAPI OK (`specs/openapi.json`) |
| `bun test` | ✅ **101 pass / 0 fail** (14 archivos) |
| `bun run check-types` | ✅ `tsc -p tsconfig.check.json` sin errores |
| `bun run check` | ✅ Biome OK (92 archivos, 0 correcciones) |
| `bun run build` | ✅ `tsc -p tsconfig.build.json` OK → `dist/` (incluye `dist/ui/`) |

### 4.1 Inventario de pruebas (14 archivos)

```
tests/agents.test.ts
tests/config.test.ts
tests/error-codes.test.ts
tests/health.test.ts
tests/items.test.ts
tests/payment-intents.test.ts
tests/payment-routes.test.ts
tests/shopping-route.test.ts
tests/supabase-migrations.test.ts
tests/ui.test.ts                     (Módulo 4, 18 casos)
tests/vector-catalog.test.ts
tests/wallets.test.ts
tests/contract/openapi-contract.test.ts
tests/contract/vercel-entrypoint.test.ts
```

### 4.2 DoD de la ruta de shopping (`POST /v1/agent/shopping`)

| Caso | Código esperado | Estado |
| --- | --- | --- |
| Sin token | 401 | ✅ cubierto |
| Token sin scope `agent:shopping` | 403 | ✅ cubierto |
| Body de turno inválido | 422 | ✅ cubierto |
| Turno válido | 200 + estado validado | ✅ cubierto |

---

## 5. Estructura y capas (AGENTS.md)

Estructura por capas respetada; el Módulo 4 añade `src/ui/` como capa de
presentación sin reglas de negocio ni infraestructura acoplada:

```
src/config        Variables de entorno tipadas
src/domain        Dominio puro (agent, items, payments, errors, agents/, wallets/)
src/http          Transporte (server, routes, error-handler, auth)
src/services      Casos de uso (agents/, wallets/, item-service, payment-intent-service…)
src/integrations  Adaptadores (stellar/, wallets/, agents/, postgres, qdrant…)
src/ui            Presentación framework-agnostic (sin React; DOM + EventTarget + CustomEvent)
specs/            openapi.json + reglas de contrato
supabase/         Migraciones SQL (comercio, RLS por agente, transiciones, TTL purge)
scripts/          validate-openapi.ts, migrate-smoke.ts
audits/           Informes de auditoría (este documento incluido)
tests/            Pruebas de servicio + tests/contract/
```

Aislamiento verificado en `src/ui/`: no se importan SDK de wallet, `window`,
`localStorage` ni Preact/`@reown/appkit`; las dependencias externas se inyectan.

---

## 6. Seguridad

- **Escaneo de secretos** (patrones `sk-*`, `AKIA*`, `ghp_*`, claves privadas
  PEM) sobre `*.ts`, `*.json`, `*.toml`, `*.md`, `*.yml` excluyendo
  `node_modules`: **sin hallazgos** (solo coincidió el ejemplo literal de
  `AGENTS.md` con `agent/task-…`, no un secreto).
- `.env` y `dist/` permanecen ignorados por git; no se versionan secretos.
- `createProductCard` usa `textContent`, evitando inyección de HTML/JS (XSS).

---

## 7. Pendientes / recomendaciones

1. **Upstream de la rama `agent`:** no tiene upstream configurado; decidir si se
   publica (`origin/agent`) o se consolida con `coding_agent/agentic-commerce`.
2. **PR hacia `dev`/`main`:** abrir el PR desde la rama de trabajo una vez
   confirmada la política de destino.
3. **Higiene de ramas:** consolidar/eliminar ramas de agente redundantes
   (`bot/`, `openhands/agentic-commerce`, `openhands/agentic-commerce-fix1`,
   `chore/agentic-commerce-ci-deps`) tras confirmar integración.
4. **Cobertura de integración real:** `postgres-checkpointer.ts` y las
   migraciones están cubiertas con dobles; una corrida contra Supabase real
   (contenedor) sigue siendo un pendiente de verificación en vivo.
5. **ADR 0004** continúa en estado **Proposed**; decidir aceptación o postergación.

---

*Auditoría generada por un agente de IA (OpenHands) el 2026-09-28 contra el árbol
de trabajo de la rama `agent` (HEAD `2021100`). Los comandos se ejecutaron
localmente; no se modificó código de producción durante la auditoría.*
