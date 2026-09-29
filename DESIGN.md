# DESIGN.md — Diseño del frontend (estado actual)

- **Última actualización:** 2026-09-29
- **Rama de referencia:** `feature/task-1790692427-frontend-localhost-readme`
- **Estado:** funcional como demo local; **flujo de compra incompleto** (§7)
- **Alcance:** capa de presentación `src/ui/`, composition root de navegador,
  shell HTML y servidor de desarrollo local.
- **Auditoría detallada asociada:** `audits/2026-09-29-frontend-ui-ux-audit.md`

> Este documento describe **cómo está diseñado el frontend hoy** (arquitectura,
> contratos, flujo y estado de cada pieza). Para el diseño de las capas de
> backend/agentes ver `docs/agentic-commerce-design.md` y `pautas de diseño.md`.

---

## 1. Objetivo y principios

El frontend es una **capa de presentación framework-agnostic** para el comercio
asistido por agentes (ACP x402 sobre Stellar). Principios rectores:

1. **Sin framework de UI.** Solo APIs nativas: `document`, `EventTarget`,
   `CustomEvent`. Sin React, sin Vite, sin store de terceros.
2. **Inversión de dependencias (DIP).** Los componentes dependen de puertos
   (`ProductSearchClient`, `WalletConnector`, `WalletSessionStore`,
   `TransactionSubmitter`), no de adaptadores concretos.
3. **Capa aislada.** Los componentes no importan `src/http` ni `src/services`;
   reciben todo por inyección desde un *composition root*.
4. **Seguro por defecto.** El texto no confiable del catálogo se renderiza con
   `textContent`, nunca `innerHTML` interpolado.
5. **Testable sin navegador.** El mismo código corre en navegador y en
   `happy-dom` (suite `tests/ui.test.ts`).

---

## 2. Estructura de archivos

```
src/ui/                                  (13 archivos, ~1088 líneas)
  index.html                             Shell HTML: #app, Tailwind CDN, /entry.js
  dom.ts                                 requireElement<T> (guard de selectores)
  browser/                               Adapter de entorno navegador
    entry.ts                             mountApp, resolveContainer, boot (73)
    demo-search-client.ts                ProductSearchClient en memoria + toProblem (79)
  components/                            UI pura, sin estado global
    app-layout.ts                        header + main + cart drawer (49)
    header.ts                            marca, badge de carrito, slot wallet (115)
    product-card.ts                      tarjeta de oferta + "Add to Cart" (47)
    product-stream.ts                    form búsqueda + grid streaming/errores (164)
    shopping-cart-drawer.ts              drawer slide-over del carrito (126)
    skeleton.ts                          placeholders de carga (32)
    transaction-progress.ts              stepper de pago (122) — NO montado
  stores/
    cart-store.ts                        CartStore extends EventTarget (98)
  wallet-controller.ts                   WalletController extends EventTarget (154)

scripts/serve-ui.ts                      Dev server local (70)
tests/ui.test.ts                         Suite UI sobre happy-dom (18 casos)
```

---

## 3. Arquitectura de capas

```
┌──────────────────────────────────────────────────────────────┐
│  Navegador (index.html)                                        │
│    └─ <script type="module" src="/entry.js">                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ bundle (Bun.build)
┌──────────────────────────────▼───────────────────────────────┐
│  Composition root — browser/entry.ts :: mountApp()             │
│    • CartStore                    (estado del carrito)         │
│    • WalletController             (sesión de wallet)           │
│    • createProductStream(...)     (búsqueda + grid)            │
│    • createAppLayout(...)         (chrome: header + drawer)    │
└──────────────────────────────┬───────────────────────────────┘
                               │ inyección de dependencias
┌──────────────────────────────▼───────────────────────────────┐
│  Componentes (components/*) — sin estado global, sin red       │
│    header · product-card · product-stream · cart-drawer ·      │
│    skeleton · transaction-progress                             │
└──────────────────────────────┬───────────────────────────────┘
                               │ puertos (interfaces)
┌──────────────────────────────▼───────────────────────────────┐
│  Ports: ProductSearchClient · WalletConnector ·                │
│         WalletSessionStore · TransactionSubmitter              │
└──────────────────────────────┬───────────────────────────────┘
                               │ adaptadores
┌──────────────────────────────▼───────────────────────────────┐
│  Adapters: demo-search-client · WalletController               │
│            (LocalStorage/InMemory store, StellarWalletsKit)    │
└───────────────────────────────────────────────────────────────┘
```

Regla de dependencia: las flechas apuntan **hacia abajo**; ningún componente
importa un adaptador concreto. La única excepción documentada es
`wallet-controller.ts`, que es explícitamente un *composition root* del cliente
(importa `src/integrations/wallets/*` e `src/services/wallets/*`).

---

## 4. Modelo de estado y reactividad

No hay framework de estado. La comunicación es por **eventos nativos DOM**:

| Fuente | Evento | Detalle (`CustomEvent.detail`) | Consumidores |
| --- | --- | --- | --- |
| `CartStore` | `cart-updated` | `CartSnapshot` `{items,isOpen,subtotal}` | header (badge), drawer |
| `WalletController` | `wallet-changed` | `WalletSession \| null` | header (slot wallet) |
| `WalletController` | `wallet-connecting` | `null` | header |
| `WalletController` | `wallet-error` | `string` (código de taxonomía) | header |

**`CartStore`** (`stores/cart-store.ts`): `EventTarget` con `add`, `remove`,
`clear`, `open`, `close`, `toggle`, `snapshot()`. Al añadir, clona y **congela**
la oferta (`Object.freeze`) para que un stream de búsqueda posterior no mute un
ítem ya seleccionado. El `subtotal` se calcula derivado de `items`.

**`WalletController`** (`wallet-controller.ts`): envuelve `WalletSessionService`
y publica su ciclo de vida como eventos. `restore`, `connect`, `disconnect`,
`signAndSubmit`. La construcción es **libre de efectos** en runtime sin DOM
(cae a store en memoria cuando no hay `localStorage`).

---

## 5. Contratos de UI (hooks de testabilidad)

Los componentes exponen hooks estables por atributo, usados por la suite y
disponibles para integración:

| `data-role` | Componente | Función |
| --- | --- | --- |
| `search-form` | product-stream | form de búsqueda |
| `problem` / `empty` | product-stream | estados de error / vacío |
| `cart-toggle` | header | abre/cierra el drawer |
| `cart-badge` | header | contador de ítems |
| `wallet-slot` | header | estado de wallet |
| `cart-backdrop` | cart-drawer | overlay / cierre por clic |
| `cart-items` | cart-drawer | lista de ítems |
| `cart-subtotal` | cart-drawer | subtotal "locked" |
| `cart-close` / `cart-checkout` | cart-drawer | cerrar / confirmar |

Puertos (interfaces) clave:

```ts
interface ProductSearchClient {
  search(query: string, signal?: AbortSignal): AsyncIterable<readonly ProductOffer[]>;
}

interface ProductOffer {   // snapshot de UI
  readonly id: string; readonly title: string; readonly price: number;
  readonly currency: string; readonly merchant: string; readonly score: number;
}
```

`ProductStream` soporta **múltiples lotes** vía `for await`, cancela búsquedas
en vuelo con `AbortController` y renderiza `ProblemDetails` (RFC 9457) cuando
falla.

---

## 6. Flujo UI/UX: recorrido del comprador

### 6.1 Lo que hoy funciona en el navegador

```
[1] Abre :3001 ──> shell (header + buscador + marca "ChapaTuOferta")   ✅
[2] Search ──────> 3 skeletons ──> tarjetas de producto / estado vacío ✅
[3] Add to Cart ─> CartStore.add() ─> badge del header sube            ✅
[4] ─────────────> drawer se abre solo (add ⇒ isOpen=true)             ✅
[5] Ajuste ──────> Remove / Close / clic backdrop / subtotal reactivo  ✅
[6] Checkout ────> ✗ sin efecto (onCheckout no cableado)               ❌
[7] Connect wallet→ Connect Freighter (ver §7.4)                       ⚠️
[8] Estado pago ─> ✗ transaction-progress nunca se monta              ❌
```

### 6.2 Flujo previsto por el dominio (no consumido)

El backend ofrece el ciclo completo; la UI aún no lo consume desde el navegador:

```
Search demo ─> Add to cart ─> Drawer ─> Checkout ╳ (no-op)
                                          │
   (previsto) ─────────────────────────┐  │
   POST /v1/payment-intents            ▼  ▼
   ─> signAndSubmit(wallet) ─> createTransactionProgress(status)
                                 (componente listo, sin montar)
```

Endpoints disponibles en `specs/openapi.json`: `/v1/agent/shopping`,
`/v1/agent/catalog/search`, `/v1/agent/products/rank`, `/v1/agent/checkout`,
`/v1/payment-intents` (+ `/submission`, `/reconcile`).

---

## 7. Estado actual por pieza

| Pieza | Estado | Notas |
| --- | --- | --- |
| `index.html` | ✅ estable | Shell mínimo, Tailwind por CDN |
| `browser/entry.ts` | ⚠️ incompleto | No pasa `onCheckout`; no monta el stepper |
| `demo-search-client.ts` | ⚠️ demo | Catálogo hardcodeado; nunca llama a `/v1` |
| `app-layout.ts` | ✅ estable | Composición header + main + drawer |
| `header.ts` | ⚠️ parcial | `Connecting…` no se limpia de forma garantizada |
| `product-card.ts` | ✅ estable | Anti-XSS con `textContent` |
| `product-stream.ts` | ✅ estable | Streaming, cancelación, errores RFC 9457 |
| `shopping-cart-drawer.ts` | ✅ estable | Checkout depende de callback externo |
| `skeleton.ts` | ✅ estable | Placeholders de carga |
| `transaction-progress.ts` | ✅ implementado | **No montado** en el árbol de navegador |
| `cart-store.ts` | ✅ estable | Snapshots inmutables |
| `wallet-controller.ts` | ⚠️ parcial | Red fija `TESTNET` |

### 7.1 Bloqueantes de producto

1. **Checkout sin efecto.** `mountApp` no define `onCheckout`
   (`entry.ts:40-45`), así que `cart-checkout` es un no-op
   (`shopping-cart-drawer.ts:116-120`).
2. **Stepper sin montar.** `createTransactionProgress` no aparece en
   `entry.ts` ni `app-layout.ts`.
3. **Búsqueda sin backend.** No existe un `ProductSearchClient` HTTP;
   `grep "fetch(" src/ui/` no devuelve resultados.

### 7.2 No bloqueantes

- Wallet fija a `TESTNET` (dominio soporta 5 redes).
- Errores fijados a `SVC-CORE-5000`/`500` en lugar de propagar el problem real.
- Precio sin `Intl.NumberFormat`.

---

## 8. Entorno de ejecución local

`scripts/serve-ui.ts` es un *dev server* mínimo (`bun run ui:dev`):

```
Bun.build(browser/entry.ts) ─> bundle ESM (sourcemap inline)
Bun.serve(:3001)  ├─ GET  /            -> index.html
                  ├─ GET  /entry.js    -> bundle
                  └─ ANY  /v1/*        -> proxy a UI_API_TARGET (default :3000)
```

Variables: `UI_PORT` (default `3001`), `UI_HOST` (`127.0.0.1`),
`UI_API_TARGET` (`http://127.0.0.1:3000`). Un solo origen sirve la página y la
API. El backend corre aparte con `bun run dev` (`:3000`).

---

## 9. Verificación

| Comando | Resultado |
| --- | --- |
| `bun run spec:check` | ✅ |
| `bun test` | ✅ 163 pass / 0 fail |
| `bun test tests/ui.test.ts` | ✅ 18 pass / 0 fail |
| `bun run check-types` | ✅ |
| `bun run check` | ✅ Biome (128 archivos) |

**Laguna conocida:** ninguna prueba ejercita `mountApp` (composition root). Por
eso los bloqueantes de §7.1 no se detectan: cada componente se prueba aislado
con dependencias inyectadas.

---

## 10. Roadmap de diseño

1. **Cerrar el flujo de compra:** cablear `onCheckout` en `mountApp` → crear
   payment intent → firmar con wallet → montar `transaction-progress`.
2. **Adapter HTTP de búsqueda:** `browser/http-search-client.ts` implementando
   `ProductSearchClient` contra `/v1/agent/catalog/search`, con fallback demo.
3. **Test de integración `mountApp`** sobre `happy-dom` (protege el cableado).
4. **Wallet configurable** por entorno (`UI_WALLET_NETWORK`) y limpieza
   garantizada del estado `Connecting…`.
5. **Accesibilidad:** focus trap, cierre con `Escape`, `aria-live` en el badge.
6. **Producción:** build de Tailwind + CSP (hoy CDN).

---

*Diseño documentado por un agente de IA (OpenHands) el 2026-09-29 contra el
árbol de trabajo de la rama `feature/task-1790692427-frontend-localhost-readme`.
Refleja el estado verificable; ver `audits/2026-09-29-frontend-ui-ux-audit.md`
para hallazgos con severidad y evidencia.*
