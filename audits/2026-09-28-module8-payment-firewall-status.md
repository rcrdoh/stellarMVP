# Audit: Módulo 8 — Payment Agent, Service Token Spend Scopes & x402 Checkout Firewall

- **Repository**: `stellarMVP` (ChapaTuOferta)
- **Branch**: `agent` (`coding_agent/agentic-commerce` como rama objetivo)
- **HEAD**: `9552b58` — *[AGENT:product-ranking-engine] Add Module 7 repository state audit*
- **Base de trabajo**: `ab3c2d3` (Módulo 7) + cambios locales del Módulo 8 sin commitear
- **Runtime**: Bun `1.4.2`, TypeScript ESM estricto, Biome
- **Audit date**: 2026-09-28
- **Working tree**: con cambios locales del Módulo 8 pendientes de commit
  (`git status --short`: 4 archivos modificados, 6 nuevos)
- **Hallazgos de auditoría abordados**: **H2 (High)** — ausencia de un firewall de
  gasto y de scopes de servicio en la ruta de checkout agéntico; un token podía
  drenar el saldo sin límite de por vida ni verificación de alcance. Se añade la
  negociación x402 (`402` + `X-402-Challenge`) para pagadores desconocidos.

## 1. Objetivo

Implementar y verificar el Módulo 8 del eSDD: interponer un **Payment Agent** entre
la ruta HTTP `/v1/agent/checkout` y el `AgentCheckoutService` (Módulo previo) que
(a) exija el scope `checkout:execute` sobre el service token, (b) reserve
atómicamente el importe contra un tope de gasto de por vida (`maxSpendAtomic`), y
(c) responda `402 Payment Required` con un challenge x402 serializado en base64
para que un agente autónomo pueda negociar credenciales y reintentar. El firewall
debe ser determinista y testeable sin Qdrant, Redis ni Stellar.

## 2. Alcance entregado

| Artefacto | Rol | Estado |
| --- | --- | --- |
| `src/domain/checkout/types.ts` | Dominio puro: `SERVICE_TOKEN_SCOPES`, `ServiceTokenScopeSchema`, `ServiceTokenMetadataSchema`, `X402ChallengePayloadSchema` y tipos | Nuevo |
| `src/schemas/checkout.schema.ts` | Esquemas HTTP: `CheckoutRequestSchema` (`.strict()`), `CheckoutResponseSchema`, `X402ChallengeResponseSchema` | Nuevo |
| `src/services/agents/ports/service-token-store.ts` | Puerto `ServiceTokenStore` (`findByToken`, `reserveSpend`) + guard `tokenHasScope` | Nuevo |
| `src/services/agents/payment-agent.ts` | `PaymentAgentService` / `PaymentFirewall`: resuelve el token, verifica scope y reserva el importe; emite challenge x402 si el token es desconocido | Nuevo |
| `src/integrations/memory-service-token-store.ts` | Adaptador determinista `MemoryServiceTokenStore` (hash SHA-256, reserva atómica en un turno del event loop) | Nuevo |
| `src/http/middleware/auth.ts` | `bearerToken`, `requireScopedServiceToken` (401/403) y `enforceSpendCap` como middleware reutilizable | Nuevo |
| `src/http/errors/x402.ts` | `encodeX402Challenge` (base64 JSON validado con Zod) y `replyWithX402Challenge` (cabecera `X-402-Challenge`) | Nuevo |
| `src/domain/error-codes.ts` | Códigos `SVC-CORE-2001/2002/2003/2004/2005` y `PAYMENT_REQUIRED` | Actualizado |
| `src/domain/errors.ts` | `PaymentRequiredError` (con `challengePayload`), `InsufficientScopeError`, `SpendCapExceededError` | Actualizado |
| `src/http/error-handler.ts` | Adjunta `X-402-Challenge` cuando el error es `PaymentRequiredError` | Actualizado |
| `src/http/routes.ts` | `POST /v1/agent/checkout` invoca `agentRoutes.firewall.authorize(...)` antes del checkout | Actualizado |
| `src/http/server.ts` | Composición opcional de `serviceTokens` → `PaymentAgentService` como `firewall` | Actualizado |
| `specs/openapi.json` | `agentCheckout` con parámetro `X-402-Payment-Token`, respuestas `201` y `402` + challenge | Actualizado, `spec:check` verde |
| `tests/checkout-firewall.test.ts` | 17 pruebas del firewall (store, agente, Zod, integración HTTP) | Verde |
| `README.md` | *(pendiente de revisión)* documentación de la ruta de checkout/firewall | Seguimiento |

## 3. Decisiones de diseño

- **Contrato primero (SDD)**: `/v1/agent/checkout` (`operationId: agentCheckout`)
  se declara en `specs/openapi.json` con el parámetro `X-402-Payment-Token`, la
  respuesta `402` y el header de challenge antes de validar con `spec:check`.
- **Sanitización en la frontera (SOLID / Audit H2)**:
  `CheckoutRequestSchema` es `.strict()` y exige `amountAtomic` entero positivo
  (≤ 10^12), de modo que el dinero nunca viaja como punto flotante en el ledger de
  gasto. Campos desconocidos se rechazan (422).
- **Inversión de dependencias (SOLID)**: el firewall depende de la interfaz
  `ServiceTokenStore`, no del adaptador. `MemoryServiceTokenStore` es el doble
  determinista para pruebas/offline; los adaptadores Redis/Postgres pueden
  sustituirse sin tocar la lógica de autorización.
- **Autoridad única del tope**: la reserva de gasto vive en el store
  (`reserveSpend`). Si la reserva desborda `maxSpendAtomic`, lanza
  `SpendCapExceededError` (**no** muta el ledger). `maxSpendAtomic: null` desactiva
  el firewall, solo aceptable para scopes de solo lectura.
- **Atomicidad mono-proceso**: el mutación del ledger es síncrona dentro del turno
  del event loop, por lo que `reserveSpend` es atómica para un único proceso — la
  anomalía que el firewall debe prevenir en las pruebas unitarias. En producción se
  requiere un adaptador con transacción distribuida (Redis `WATCH`/Lua o SQL).
- **Token desconocido ⇒ 402, no 401**: en lugar de un `401` plano, el firewall
  devuelve `402 Payment Required` con un `X-402-Challenge` base64 (red `testnet`,
  activo `USDC`, `amount` formateado a 2 decimales, `reason: service_token_unknown`)
  para permitir la auto-negociación ACP x402.
- **Distinción 401 vs 403**: `requireScopedServiceToken` mapea credenciales
  ausentes a 401 (`SVC-CORE-2001`), token inválido/expirado a 401
  (`SVC-CORE-2002`) y token válido pero sin scope a 403 (`SVC-CORE-2003`).
- **Gate opcional**: la ruta solo compone `firewall` cuando `agent.serviceTokens`
  está presente, de modo que entornos sin registro de tokens no exponen el
  enforcement (comportamiento heredado de módulos previos).
- **Idempotencia**: `idempotencyKey` en el payload evita el doble cargo de un
  reintento sobre el mismo service token (documentado en el esquema).

## 4. Verificación

Cadena de comandos ejecutada sobre el árbol con los cambios del Módulo 8 (todos
exit code `0`):

```bash
bun run spec:check
bun test
bun run check-types
bun run check
bun run build
```

- `bun run spec:check` → `OpenAPI spec OK: specs/openapi.json`.
- `bun test` → **156 pass / 0 fail** (19 archivos, ~1.2 s, 539 `expect()`).
  Baseline Módulo 7 = 139 pruebas / 18 archivos; el Módulo 8 añade +17 pruebas
  netas en `tests/checkout-firewall.test.ts`.
- `bun run check-types` → sin errores (`tsc -p tsconfig.check.json`).
- `bun run check` → 119 archivos, sin errores ni warnings (`biome check .`).
- `bun run build` → ESM válido en `dist/` (`tsc -p tsconfig.build.json`).

> **Nota de entorno**: los comandos `tsc`/`biome` requieren `LD_LIBRARY_PATH=`
> para evitar el fallo de enlazado dinámico descrito en `AGENTS.md`
> (conflicto `GLIBCXX`/`OPENSSL`).

### Inventario de pruebas del Módulo 8 (`tests/checkout-firewall.test.ts`)

| Foco | Pruebas |
| --- | --- |
| `MemoryServiceTokenStore` (reserva atómica, tope, cap nulo, token desconocido) | 4 |
| `PaymentAgentService` (challenge x402, scope, tope, autorización feliz) | 4 |
| `agentCheckoutRequestSchema` (Audit H2: sanitización estricta) | 3 |
| `POST /v1/agent/checkout` (integración HTTP: 401/402/403/422/201) | 6 |
| **Total** | **17** |

Cobertura destacada: reserva atómica con total acumulado, rechazo sin mutar el
ledger al desbordar el tope, `null` como ilimitado, challenge base64 decodificable,
403 por scope faltante, 403 por tope excedido, 422 por payload inválido
(`itemId` no-UUID, campos desconocidos), 402 con `X-402-Challenge` para token
desconocido, y `201` en el camino feliz con registro del pedido.

## 5. Cobertura de contrato de la ruta de checkout

`POST /v1/agent/checkout` (`operationId: agentCheckout`, header `X-402-Payment-Token`):

| Caso | Estado esperado |
| --- | --- |
| Sin token de agente | `401` |
| Token de agente sin scope `checkout:execute` | `403` |
| Service token desconocido (firewall) | `402` + `X-402-Challenge` |
| Importe sobre el tope de por vida del token | `403` (`SVC-CORE-2005`) |
| Payload inválido (`itemId` no-UUID, campos extra) | `422` |
| Checkout en alcance y bajo el tope | `201` con la orden persistida |
| Exceso de tasa (scoped `/v1/agent/*`) | `429` |

## 6. Observaciones relevantes

- **`MemoryServiceTokenStore` no es multi-proceso**: su atomicidad depende de un
  único event loop. Un despliegue con varios workers requiere un adaptador con
  transacción real (Redis `WATCH`/script Lua o `SELECT ... FOR UPDATE` en SQL).
- **Solo existe el adaptador en memoria**: no hay `RedisServiceTokenStore` ni
  migración SQL para `service_tokens`; el registro de tokens productivo queda como
  seguimiento.
- **El challenge es estático** (`network: "testnet"`, `asset: "USDC"`): debe
  derivarse de la configuración/red de pago real antes de producción.
- **`destination` del challenge es `"unknown"`** para tokens desconocidos: no se
  filtra el destino del comercio, lo que es correcto para un pagador no
  autenticado pero limita la auto-negociación completa.
- **Los cambios del Módulo 8 permanecen locales** (sin commitear) en la rama
  `agent`; el commit/auditoría del Módulo 7 (`9552b58`) es el último punto de
  control.

## 7. Deuda y seguimiento

- Implementar adaptadores productivos de `ServiceTokenStore` (Redis/SQL) con
  reserva atómica distribuida y pruebas de concurrencia.
- Parametrizar `network`, `asset` y `destination` del challenge x402 desde
  configuración en lugar de constantes.
- Instrumentar métricas del firewall: tasa de 402, rechazos por scope, rechazos por
  tope, importe medio reservado.
- Añadir cobertura de idempotencia (mismo `idempotencyKey` reintentado no debe
  doble-reservar ni doble-cobrar).
- Actualizar `README.md` con la ruta de checkout y el flujo de negociación x402.
- Converger la documentación de scopes entre `auth.ts` (`agent:checkout`) y el
  dominio (`checkout:execute`) para evitar deriva terminológica.

## 8. Checklist DoD

- [x] Dominio y esquemas Zod con validación estricta de checkout y x402
      (`CheckoutRequestSchema` `.strict()`, `amountAtomic` entero).
- [x] Puerto `ServiceTokenStore` y adaptador `MemoryServiceTokenStore` con reserva
      atómica y tope de gasto por vida.
- [x] `PaymentAgentService` (firewall) que aplica scope `checkout:execute`, tope de
      gasto y challenge x402 para tokens desconocidos.
- [x] Rutas/composición: `/v1/agent/checkout` con firewall opcional y
      `X-402-Challenge` vía error handler.
- [x] `specs/openapi.json` actualizado (`agentCheckout`, parámetro
      `X-402-Payment-Token`, respuestas `201`/`402`).
- [x] `tests/checkout-firewall.test.ts` creado y en verde (17 pruebas).
- [x] `bun test` → **156 pass / 0 fail** en 19 archivos (≥ 114 requerido;
      baseline Módulo 7 de 139 preservado).
- [x] `bun run spec:check`, `bun run check-types` y `bun run check` limpios.
- [x] Build ESM de producción en `dist/` vía `bun run build`.

## 9. Conclusión

El Módulo 8 queda **implementado y verificado** a nivel de dominio, puerto,
servicio firewall, middleware, adaptador en memoria, composición de ruta y contrato
OpenAPI. La verificación automática completa finaliza con exit code `0` en todos
los pasos y eleva la cobertura a **156 pruebas / 19 archivos**, preservando el
baseline del Módulo 7 (139/18). El firewall bloquea el drenaje de saldo (H2) con
scope `checkout:execute` y tope de por vida, y negocia credenciales mediante
`402` + `X-402-Challenge` para agentes autónomos. Queda como seguimiento el
adaptador de tokens productivo (Redis/SQL), la parametrización del challenge, la
cobertura de idempotencia y la actualización del `README.md`. Los cambios del
Módulo 8 permanecen locales en la rama `agent`, pendientes de commit.
