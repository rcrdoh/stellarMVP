# Auditoría de frontend — código completo y flujo UI/UX

- **Fecha:** 2026-09-29
- **Rama:** `feature/task-1790692427-frontend-localhost-readme`
- **HEAD:** `e979918` — "Add browser UI shell, localhost dev server and README; prune Vercel"
- **Runtime:** Bun `1.4.x` (engines `>=1.4.0`), TypeScript strict ESM, Biome
- **Alcance:** toda la capa de presentación `src/ui/`, el *composition root* de
  navegador (`src/ui/browser/`), el servidor de desarrollo `scripts/serve-ui.ts`,
  el shell HTML `src/ui/index.html` y el flujo UI/UX extremo a extremo
  (búsqueda → carrito → checkout → estado de transacción → wallet).
- **Auditor:** agente de IA (OpenHands) bajo reglas `AGENTS.md`

> Este informe complementa, no reemplaza, `2026-09-28-module4-ui-status.md`
> (estado del Módulo 4 y su DoD). Aquí el foco es el **frontend ejecutable en el
> navegador** y su **flujo de experiencia**, incluyendo los huecos de
> integración que el checklist del Módulo 4 no cubría porque solo verificaba
> componentes aislados sobre `happy-dom`.

---

## 1. Resumen ejecutivo

La capa `src/ui/` es de **calidad alta** a nivel de componentes: diseño
framework-agnostic consistente (solo `document`, `EventTarget`, `CustomEvent`),
inyección de dependencias, texto de catálogo renderizado con `textContent`
(anti-XSS), `AbortController` para cancelar búsquedas y proyección de los estados
de pago del dominio a pasos de UI. La suite `tests/ui.test.ts` (18 casos) pasa y
cubre cada componente con dobles, sin tocar el SDK ni la red.

Sin embargo, el **flujo UI/UX de extremo a extremo está incompleto en el
navegador**: la UI funciona como una *demo de catálogo* y no como un cliente real
del backend. Los tres huecos principales, todos verificables en el árbol de
trabajo actual:

1. **El carrito no lleva a ningún lado.** `mountApp` no pasa `onCheckout`, y
   `createAppLayout` no lo inyecta por defecto. El botón *Checkout* del drawer
   (`shopping-cart-drawer.ts:116-120`) invoca un callback opcional que en el
   navegador es `undefined`: pulsar *Checkout* no produce ningún efecto visible.
2. **El stepper de transacción nunca se muestra.** `createTransactionProgress`
   existe y está probado, pero **no se importa ni se monta** en ningún punto del
   árbol de navegador (`browser/entry.ts`, `app-layout.ts`). No hay pantalla de
   estado de pago en la UI real.
3. **La búsqueda no usa el backend.** El shell usa `createDemoSearchClient`
   (`demo-search-client.ts`), un catálogo en memoria que no llama a
   `/v1/agent/*`. `grep "fetch(" src/ui/` no devuelve resultados: la UI nunca
   habla con la API. El servidor `serve-ui.ts` sí proxyea `/v1/*`, pero no hay un
   `ProductSearchClient` HTTP que lo aproveche.

Además, la wallet se inicializa en `TESTNET` fijo y el *Connecting…* no se
refresca al terminar (ver §7). La verificación automatizada global sigue verde:
`spec:check` OK, **163 tests / 0 fallos**, `check-types` y `check` limpios.

**Veredicto:** APTO para demo local y como base de componentes reutilizables;
**NO APTO aún como frontend de producto** hasta cerrar los huecos 1–3 (el flujo
de compra debe conectar con la API y mostrar el estado de la transacción).

---

## 2. Inventario del frontend

```
src/ui/
  index.html                          Shell HTML (13 líneas), monta #app, carga /entry.js
  browser/
    entry.ts                          Composition root (mountApp, resolveContainer, boot)
    demo-search-client.ts             ProductSearchClient en memoria + toProblem
  components/
    app-layout.ts                     Shell: header + main + cart drawer
    header.ts                         Marca, badge de carrito, slot de wallet
    product-card.ts                   Tarjeta de oferta + "Add to Cart"
    product-stream.ts                 Form de búsqueda + grid con streaming/errores
    shopping-cart-drawer.ts           Drawer slide-over del carrito + Checkout
    skeleton.ts                       Placeholders de carga
    transaction-progress.ts           Stepper de estado de pago (NO montado)
  stores/
    cart-store.ts                     CartStore extends EventTarget
  wallet-controller.ts                WalletController extends EventTarget
scripts/serve-ui.ts                   Dev server: Bun.build + estáticos + proxy /v1/*
src/ui/dom.ts                         requireElement<T>
```

Total: **13 archivos, ~1088 líneas**. Todo el frontend es `vanilla`
(DOM + eventos nativos), sin React, sin Vite, sin framework de estado.

### 2.1 Grafo de composición (navegador)

```
index.html ──> /entry.js (bundle de browser/entry.ts)
                    │
                    └─ mountApp()
                         ├─ new CartStore()                      (estado del carrito)
                         ├─ new WalletController({TESTNET})      (sesión de wallet)
                         ├─ createProductStream({demoClient})    (búsqueda + grid)
                         └─ createAppLayout()
                              ├─ createHeader()   ← CartStore + WalletController
                              ├─ <main>           ← product-stream.element
                              └─ createShoppingCartDrawer({cartStore})  [sin onCheckout]
```

---

## 3. Flujo UI/UX: recorrido del comprador

### 3.1 Flujo implementado (real, en el navegador)

| # | Acción del usuario | Componente | Resultado observable | Estado |
| --- | --- | --- | --- | --- |
| 1 | Abre `http://127.0.0.1:3001` | `index.html` + `entry.ts` | Shell con header, buscador y marca "ChapaTuOferta" | ✅ funciona |
| 2 | Escribe y pulsa *Search* | `product-stream.ts` | Grid con 3 skeletons y luego tarjetas; estado vacío si no hay match | ✅ funciona |
| 3 | Pulsa *Add to Cart* | `product-card.ts` | El ítem entra al `CartStore` y el badge del header sube | ✅ funciona |
| 4 | El drawer se abre solo | `cart-store.ts` (`add` → `isOpen=true`) | Drawer slide-over con ítems y subtotal "locked" | ✅ funciona |
| 5 | Ajusta el carrito | `shopping-cart-drawer.ts` | *Remove* por ítem, *Close* / clic en backdrop, subtotal reactivo | ✅ funciona |
| 6 | Pulsa *Checkout* | `shopping-cart-drawer.ts:116` | **Nada** (callback `onCheckout` undefined) | ❌ roto |
| 7 | Conecta wallet | `header.ts` + `wallet-controller.ts` | Botón *Connect Freighter* (ver notas §7) | ⚠️ parcial |
| 8 | Observa estado del pago | `transaction-progress.ts` | **Nunca se monta**: no hay pantalla de estado | ❌ ausente |

### 3.2 Flujo previsto por el dominio (no consumido por la UI)

El backend expone el ciclo completo (`specs/openapi.json`):

- `POST /v1/agent/shopping` — conversación durable de compra (scopes de agente).
- `POST /v1/agent/catalog/search` y `POST /v1/agent/products/rank` — catálogo y ranking.
- `POST /v1/agent/checkout` — checkout ACP x402 (requiere `X-402-Payment-Token`).
- `POST /v1/payment-intents` → `.../submission` → `.../reconcile` — ciclo de pago Stellar.

La UI **no consume ninguno** de estos endpoints en el navegador. El
`ProductSearchClient` es una abstracción correcta (puerto), pero solo tiene una
implementación: la demo en memoria. La pieza que falta es un adaptador HTTP que
implemente ese puerto contra `/v1/agent/...` y un `onCheckout` que dispare el
payment intent y monte `createTransactionProgress` con el estado resultante.

### 3.3 Diagrama del hueco de flujo

```
[Search demo]──>[Add to cart]──>[Drawer]──>[Checkout]──>✗ (onCheckout undefined)
                                              │
                                              └─ debería ─> POST /v1/payment-intents
                                                            │
                                                            ├─> signAndSubmit(wallet)
                                                            └─> createTransactionProgress(status)
                                                                 (componente listo, sin montar)
```

---

## 4. Hallazgos

Severidad: 🔴 bloqueante de producto · 🟠 importante · 🟡 menor · 🔵 mejora.

### 🔴 H1 — Checkout sin efecto en el navegador

`shopping-cart-drawer.ts:116-120` llama `options.onCheckout?.(subtotal)` solo si
existe. `app-layout.ts:39-44` lo propaga solo si viene definido y
`browser/entry.ts:40-45` **no** lo pasa. Resultado: el botón principal del flujo
de compra es un no-op. El test
`shopping cart drawer > ... invokes checkout` (línea 180) pasa porque inyecta el
callback manualmente, lo que **oculta** el hecho de que el navegador nunca lo
recibe.

**Impacto:** el usuario no puede completar una compra. Es el hueco más grave del
frontend.

### 🔴 H2 — `createTransactionProgress` nunca se monta

El componente está implementado y probado (`tests/ui.test.ts:338-366`) pero no
aparece en `browser/entry.ts`, `app-layout.ts` ni ningún otro punto del árbol de
navegador. La UI no tiene forma de mostrar `pending_confirmation`, `submitted`,
`paid` ni `failed`.

**Impacto:** sin feedback de estado, el usuario no sabe si su pago se envió,
confirmó o falló. Es indispensable para un flujo con dinero real.

### 🔴 H3 — La búsqueda no usa el backend

`createDemoSearchClient` devuelve catálogo hardcodeado (`demo-search-client.ts:13-46`).
No existe un `ProductSearchClient` HTTP. `serve-ui.ts` ya proxya `/v1/*`
(`scripts/serve-ui.ts:56-63`), infraestructura lista pero desaprovechada.

**Impacto:** la "búsqueda agéntica" —el valor central del producto— no es
demostrable desde la UI; solo se ve un catálogo estático.

### 🟠 H4 — Wallet fija a TESTNET, sin selector de red

`browser/entry.ts:32` hace `new WalletController({ network: "TESTNET" })`. El
dominio soporta `PUBLIC`, `TESTNET`, `FUTURENET`, `SANDBOX`, `STANDALONE`
(`domain/wallets/contracts.ts:9-15`). No hay forma de cambiar de red en la UI ni
de inyectarla por entorno.

### 🟠 H5 — *Connecting…* no se limpia al terminar la conexión

En `header.ts`, `renderWallet` se re-renderiza con `wallet-changed`,
`wallet-connecting` y `wallet-error`. Pero `wallet-controller.ts:97-112` pone
`#isConnecting = false` en el `finally` **después** de despachar
`wallet-changed`, y **no despacha un evento al salir del estado de conexión**.
En consecuencia, el botón puede quedar deshabilitado mostrando "Connecting..."
tras un `connect()` exitoso, hasta que otro evento dispare un re-render.

**Detalle:** `connect()` despacha `WALLET_CONNECTING_EVENT` (con
`#isConnecting=true`) y luego `WALLET_CHANGED_EVENT` con la sesión, pero el
`finally` baja la bandera sin notificar. El header ya muestra el bloque de sesión
si `currentSession !== null`, así que en el caso feliz se recupera; el caso
patológico es un `connect()` que resuelve con sesión `null` sin error, o la
ventana entre eventos.

### 🟡 H6 — Métricas de calidad no verificadas en el navegador

`index.html` no declara `lang` dinámico por locale (usa `lang="es"` fijo),
`meta description` ni `theme-color`. El `<title>` es correcto.

### 🟡 H7 — Accesibilidad del drawer incompleta

`shopping-cart-drawer.ts` marca `role="dialog"` y `aria-label`, pero:
- No hay *focus trap* ni `.focus()` al abrir; el foco queda en el botón del header.
- No hay cierre con tecla `Escape`.
- El `backdrop` (contenedor real, `drawer` es hijo) se oculta con `hidden`, pero
  no se marca `aria-hidden`/`inert` para lectores de pantalla.
- El badge del carrito (`header.ts:34`) no tiene `aria-live`, así que su cambio
  no se anuncia.

### 🟡 H8 — Errores de búsqueda con código genérico

`toProblem` (`demo-search-client.ts:72-79`) fija `code: "SVC-CORE-5000"` y
`status: 500` para cualquier error. Cuando se conecte el backend real, lo correcto
es proyectar el `application/problem+json` recibido (código y status reales) en
lugar de un valor fijo.

### 🔵 H9 — `streaming` visual es un solo lote

`product-stream.ts:111-122` soporta múltiples lotes vía `for await`, pero el
cliente demo emite un único lote (`yield matches`), por lo que la sensación de
*streaming* progresivo no se aprecia. Correcto como contrato; mejorable como demo.

### 🔵 H10 — Precio formateado sin locale

Tanto `product-card.ts:33` como el drawer usan `` `${item.price} ${item.currency}` ``.
No hay `Intl.NumberFormat`, por lo que `42.5 USDC` no se muestra como moneda
localizada. Aceptable para USDC, pero a revisar si se muestran fiat.

### 🔵 H11 — Tailwind por CDN en el shell

`index.html:7` carga `https://cdn.tailwindcss.com`. Es válido para desarrollo,
pero implica dependencia de red y JIT en runtime; para producción conviene un
build de Tailwind con CSP. No hay `Content-Security-Policy` en el dev server.

---

## 5. Arquitectura y capas (AGENTS.md)

✅ Estructura por capas respetada: `src/ui/` es presentación pura; los
componentes no importan `src/http`, `src/services` ni adaptadores concretos,
salvo `wallet-controller.ts`, que sí importa adaptadores de
`src/integrations/wallets/*` — pero es **intencional**: `WalletController` es el
*composition root* del cliente declarado como tal
(`wallet-controller.ts:32-41`), por lo que la excepción está documentada y
justificada.

✅ Inversión de dependencias (DIP): `ProductSearchClient`,
`WalletConnector`, `WalletSessionStore` y `TransactionSubmitter` son puertos
inyectados; los componentes reciben dobles en `tests/ui.test.ts`.

✅ Sin reglas de negocio en componentes: `transaction-progress.ts` mapea estados
del dominio a presentación sin redefinir la semántica de negocio
(`expired → failed` está razonado en `transaction-progress.ts:18-21`).

⚠️ Excepción menor: `header.ts:1` importa `truncateAddress` de
`src/domain/wallets/contracts.ts`. Es un helper puro de presentación de dato, no
una regla de negocio; aceptable, aunque podría vivir en `src/ui/`.

---

## 6. Seguridad

| Vector | Estado | Evidencia |
| --- | --- | --- |
| XSS por texto de catálogo | ✅ mitigado | `product-card.ts:40-41` y drawer usan `textContent`; solo el `% match` numérico va por plantilla |
| XSS por `errorMessage` en stepper | ✅ mitigado | `transaction-progress.ts:114` usa `textContent` en `.progress-error-message` |
| XSS por `problem.detail` | ✅ mitigado | `product-stream.ts:86-89` usa `textContent` |
| Fuga de secretos al cliente | ✅ sin hallazgos | El bundle del navegador no lee env del backend; `serve-ui.ts` no expone `.env` |
| CSP en dev server | 🟡 ausente | `serve-ui.ts` no añade cabeceras de seguridad; Tailwind CDN requiere red abierta |

Nota: `product-card.ts:20-38` **sí** usa `innerHTML`, pero solo con contenido
estático del template; los datos dinámicos (`title`, `merchant`) se inyectan
después con `textContent`. El `matchPercent` interpolado es un número calculado
(`Math.round`), no input del usuario. Patrón correcto.

---

## 7. Verificación automatizada

| Comando | Resultado |
| --- | --- |
| `bun run spec:check` | ✅ OpenAPI OK |
| `bun test` | ✅ **163 pass / 0 fail** (19 archivos) |
| `bun test tests/ui.test.ts` | ✅ **18 pass / 0 fail** |
| `bun run check-types` | ✅ sin errores |
| `bun run check` | ✅ Biome OK (128 archivos) |

Cobertura de `tests/ui.test.ts` por componente: `CartStore` (2), card &
skeleton (2), drawer (1), product stream (4), transaction progress (2),
`WalletController` (4), header & app layout (3).

**Laguna de cobertura clave:** no existe un test que ejercite `mountApp` (el
*composition root*) ni un test de integración del flujo navegador completo. Por
eso H1 y H2 no se detectan: cada componente se prueba aislado con dependencias
inyectadas, y la ausencia de cableado en `entry.ts` no aparece en ninguna
prueba. La corrección recomendada es añadir un test que llame a `mountApp` sobre
`happy-dom` y verifique que *Add to Cart → Checkout* dispara el callback y que un
estado de pago monta el stepper.

---

## 8. Recomendaciones priorizadas

1. **Cerrar H1 (bloqueante).** Definir `onCheckout` en `mountApp` y cablearlo:
   al confirmar el carrito, crear el payment intent, firmar con la wallet y
   montar el stepper. Sin esto el flujo no termina.
2. **Montar H2 (bloqueante).** Integrar `createTransactionProgress` en el layout
   (p. ej., una zona `data-role="transaction-slot"` en `app-layout.ts`) y
   suscribirla al estado del intent.
3. **Implementar H3 (bloqueante de demo).** Añadir
   `src/ui/browser/http-search-client.ts` que implemente `ProductSearchClient`
   contra `/v1/agent/catalog/search` (o `/v1/agent/shopping`) y proyecte el
   `application/problem+json` real. Inyectarlo en `mountApp` cuando
   `UI_API_TARGET`/feature flag lo permitan; mantener el demo como fallback.
4. **Añadir test de `mountApp`** sobre `happy-dom` (H1/H2/H3 como red de
   seguridad): verifica el cableado, no solo los componentes.
5. **H4:** exponer la red de wallet (env `UI_WALLET_NETWORK` o parámetro de
   `mountApp`) con default `TESTNET`.
6. **H5:** despachar `wallet-changed`/un evento explícito `wallet-idle` en el
   `finally` de `connect()` para limpiar el estado *Connecting…*.
7. **H7:** añadir *focus trap*, cierre con `Escape` y `aria-live` en el badge.
8. **H8:** dejar de fijar `SVC-CORE-5000` y propagar el problema recibido.
9. **H11:** planificar build de Tailwind + CSP antes de producción.

---

## 9. Estado de despliegue / Vercel

El frontend es ahora un *shell* de navegador servido por `bun run ui:dev`
(`scripts/serve-ui.ts`) en `http://127.0.0.1:3001`, con proxy `/v1/*` al backend
en `:3000`. No hay pipeline de despliegue para la UI. Las referencias a Vercel
(`vercel.json`, workflow de deploy, guarda `VERCEL` en `src/index.ts`, test
`vercel-entrypoint.test.ts`) fueron **eliminadas** en el HEAD auditado; solo
queda una mención histórica intencional en una nota de auditoría.

---

## 10. Conclusión

El frontend está bien construido a nivel de **componentes** y de **principios
SOLID/SDD**, con anti-XSS correcto y buena testabilidad. Su debilidad es de
**integración y flujo**: es una demo de catálogo, no todavía un cliente de
compra. Los tres bloqueantes (H1 checkout sin efecto, H2 stepper sin montar, H3
búsqueda sin backend) son de cableado, no de rediseño, y se cierran sin tocar los
componentes existentes. Cerrarlos —con un test de `mountApp` que los proteja—
convierte la UI actual en el frontend de producto.

---

*Auditoría generada por un agente de IA (OpenHands) el 2026-09-29 contra el
árbol de trabajo de la rama `feature/task-1790692427-frontend-localhost-readme`
(HEAD `e979918`). No se modificó código de producción durante la auditoría.*
