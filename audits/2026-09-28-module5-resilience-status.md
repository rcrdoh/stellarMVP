# Audit: Módulo 5 — Resiliencia, Rate Limiting y Manejo de Errores

- **Repository**: `stellarMVP` (ChapaTuOferta)
- **Branch**: `coding_agent/agentic-commerce`
- **HEAD**: `b21d7bf` — *Implement Stellar wallet payment intents*
- **Runtime**: Bun `1.4.2`, TypeScript ESM estricto, Biome
- **Audit date**: 2026-09-28
- **Working tree**: cambios sin commitear (spec, ruta, esquemas, utilidades, pruebas)

## 1. Objetivo

Implementar y verificar el Módulo 5 del eSDD: capa de resiliencia para el
subsistema de agentes, compuesta por *rate limiting* scoped a `/v1/agent/*`,
*circuit breaker* para llamadas al LLM y normalización de errores hacia el
contrato RFC 9457.

## 2. Alcance entregado

| Artefacto | Rol | Estado |
| --- | --- | --- |
| `src/schemas/intent.schema.ts` | Esquemas Zod de intención de compra y request de chat (`sessionId`, `message`) | Implementado |
| `src/utils/circuit-breaker.ts` | Circuit breaker tipado sobre `opossum` (`createLLMCircuitBreaker`, `circuitOptions`) | Implementado |
| `src/services/agents/discovery-agent.ts` | Servicio LangGraph de descubrimiento; extrae `ShoppingIntent` de texto libre | Implementado |
| `src/http/routes.ts` | Rate limit scoped a `/v1/agent/*` + ruta `POST /v1/agent/chat` | Implementado |
| `specs/openapi.json` | Ruta `POST /v1/agent/chat` y schemas `AgentChatRequest`, `AgentChatResponse`, `DiscoveryShoppingIntent` | Actualizado, `spec:check` verde |
| `tests/agent-resilience.test.ts` | 9 pruebas de resiliencia (rate limit 429, breaker abierto, chat 200/422) | Verde |
| `tests/contract/openapi-contract.test.ts` | Contrato de la ruta de chat y sus schemas | Ampliado |

## 3. Decisiones de diseño

- **Rate limiting scoped**: se registra `@fastify/rate-limit` únicamente en el
  plugin de rutas de agente (`/v1/agent/*`), evitando penalizar rutas públicas
  como `/v1/health/*`. Las respuestas `429` cumplen el contrato
  `application/problem+json` e incluyen `retry-after`.
- **Circuit breaker**: `createLLMCircuitBreaker` envuelve la llamada al LLM con
  `opossum`; el umbral y el `resetTimeout` se centralizan en `circuitOptions`.
  Un circuito abierto se traduce en `503` con cuerpo de problema.
- **Contrato primero (SDD)**: la ruta y los schemas se declararon en
  `specs/openapi.json` antes de cerrar la implementación, manteniendo `spec:check`
  como puerta de calidad.
- **Fronteras limpias**: la utilidad de breaker y los esquemas viven fuera del
  dominio puro; no se introdujo `window`, `localStorage` ni dependencias de
  framework en dominio/puertos.

## 4. Verificación

Cadena de comandos ejecutada (todos exit code `0`):

```bash
bun run spec:check
bun test
bun run check-types
bun run check
bun run build
```

- `bun run spec:check` → `OpenAPI spec OK`.
- `bun test` → **111 pass / 0 fail** (15 archivos).
- `bun run check-types` → sin errores.
- `bun run check` → sin errores ni warnings (Biome aplicó fixes de import order /
  formato).
- `bun run build` → ESM válido en `dist/`.

## 5. Cobertura de contrato de la ruta de chat

`POST /v1/agent/chat`:

| Caso | Estado esperado |
| --- | --- |
| Sin token | `401` |
| Token sin scope `agent:discovery` | `403` |
| Cuerpo de turno inválido | `422` |
| Turno válido | `200` con `{ status: "success", intent }` |
| Exceso de tasa | `429` |
| LLM caído (breaker abierto) | `503` |

## 6. Deuda y seguimiento

- El *rate limiting* usa el store en memoria por defecto; en producción con
  múltiples instancias deberá apuntar a Redis (`agent.redis` ya se inyecta en la
  composición de `buildServer`).
- El *circuit breaker* no expone aún métricas; se recomienda instrumentarlo con
  los eventos de `opossum` cuando se integre observabilidad.

## 7. Conclusión

El Módulo 5 queda **implementado y verificado** a nivel de contrato, ruta,
servicio y pruebas. La verificación automática completa finaliza con exit code
`0` en todos los pasos.
