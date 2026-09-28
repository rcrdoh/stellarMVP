# Audit: Módulo 7 — Normalización, Ranking de Productos y Handoff a Base de Datos

- **Repository**: `stellarMVP` (ChapaTuOferta)
- **Branch**: `feature/task-1790628289-vector-catalog-engine` (`agent` apunta al mismo commit)
- **HEAD**: `ab3c2d3` — *[AGENT:product-ranking-engine] Implement Module 7 product normalization, ranking and DB handoff*
- **Base**: `2d6782d` — *Audit Module 6 vector catalog implementation status*
- **Runtime**: Bun `1.4.2`, TypeScript ESM estricto, Biome
- **Audit date**: 2026-09-28
- **Working tree**: limpio (todo commiteado; `git status --short` vacío)
- **Hallazgo de auditoría abordado**: **L2 (Low)** — ausencia de validación Zod estricta en payloads de ranking de productos y parámetros de descubrimiento; se extiende la frontera de sanitización del Módulo 6 al pipeline de normalización/ranking.

## 1. Objetivo

Implementar y verificar el Módulo 7 del eSDD: convertir los candidatos crudos
`MerchantProduct[]` recuperados por el motor vectorial del Módulo 6 en ofertas
normalizadas, deduplicadas y rankeadas (`ProductOffer[]`), y entregarlas a la
capa de persistencia mediante un *handoff* desacoplado. Todos los parámetros de
entrada se sanean estrictamente con Zod (remediación **L2**), y el pipeline debe
operar de forma determinista sin Supabase configurado.

## 2. Alcance entregado

| Artefacto | Rol | Estado |
| --- | --- | --- |
| `src/domain/ranking/types.ts` | Entidades y esquemas Zod puros: `ProductOfferSchema`, `NormalizationConfigSchema` + tipos `ProductOffer`, `NormalizationConfig` | Implementado |
| `src/schemas/ranking.schema.ts` | Esquemas HTTP de la ruta: `ProductRankingRequestSchema`, `ProductRankingResponseSchema` + tipos | Implementado |
| `src/services/agents/normalization.ts` | `ProductNormalizationService`: deduplicación por URL o `merchantId:title` y conversión a unidades menores de la moneda base | Implementado |
| `src/services/agents/ranking-engine.ts` | `ProductRankingEngine`: score compuesto (relevancia/precio/stock), orden descendente y truncado a `topK` | Implementado |
| `src/services/agents/ports/search-repository.ts` | Puerto `SearchRepository` (inversión de dependencias Supabase ↔ caso de uso) | Implementado |
| `src/services/agents/product-handoff.ts` | Caso de uso `ProductHandoffService`: rankea y persiste vía puerto opcional (`persisted`) | Implementado |
| `src/integrations/supabase/search-repository.ts` | Adaptador `SupabaseSearchRepository` sobre PostgREST estructural (`search_sessions`, `search_results`) | Implementado |
| `src/http/routes.ts` | Ruta `POST /v1/agent/products/rank` (auth + scope `agent:search`, gate opcional) | Implementado |
| `src/http/server.ts` | Composición opcional de `ranking` en `AgentIntegrations` / `buildAgentRoutes` | Implementado |
| `src/domain/catalog/types.ts` | `url` opcional añadido a `MerchantProductSchema` (alineación contrato M6↔M7) | Actualizado |
| `specs/openapi.json` | Ruta `agentProductsRank` + schemas `ProductRankingRequest`, `ProductRankingResponse` y `url` en `MerchantProduct` | Actualizado, `spec:check` verde |
| `tests/product-ranking.test.ts` | 12 pruebas del pipeline (normalización, dedup, ranking, ruta HTTP, Zod) | Verde |
| `README.md` | Tabla de rutas de agente ampliada con `/v1/agent/catalog/search` y `/v1/agent/products/rank` | Actualizado |

## 3. Decisiones de diseño

- **Contrato primero (SDD)**: la ruta y los schemas se declararon en
  `specs/openapi.json` (`operationId: agentProductsRank`, seguridad `agentToken`,
  respuestas `200/401/403/422/429/503`) antes de validar la implementación con
  `spec:check`.
- **Sanitización en la frontera (Audit L2)**: `ProductRankingRequestSchema` es el
  único punto de validación del payload HTTP. Exige `sessionId` UUID, acota
  `products` a `[1, 100]` elementos con `MerchantProductSchema`, trunca `query` a
  256 caracteres, fija `topK` a `[1, 10]` y `baseCurrency` a 3 letras. El motor
  vuelve a sanear internamente y sanea cada `ProductOffer` de salida.
- **Frontera dominio/adaptador (SOLID)**: los tipos y esquemas Zod viven en
  `src/domain/ranking/` sin importar Supabase ni Fastify. El puerto
  `SearchRepository` desacopla el caso de uso del adaptador Supabase, de modo que
  las pruebas inyectan un doble determinista. El servicio de handoff acepta
  `repository: SearchRepository | null` y reporta `persisted` en consecuencia.
- **Dinero sin punto flotante aguas abajo**: `ProductNormalizationService`
  convierte cada precio a unidades menores enteras (`normalizedPriceMinor`) con
  la tabla `exchangeRates`; una moneda desconocida cae a tasa 1:1 para no anular
  el precio. El resultado se redondea con `Math.round(price * rate * 100)`.
- **Score compuesto determinista**: `S = w_rel·VectorScore + w_price·(MinPrice/Price) + w_stock·StockBonus`
  con pesos por defecto `{relevance: 0.6, price: 0.3, stock: 0.1}`. `VectorScore`
  usa el `score` de Qdrant (0.5 por defecto), `StockBonus` es 1 para productos en
  stock, y el resultado se clampa a `[0, 1]`, se fija a 4 decimales y se ordena
  descendente.
- **`idFactory` inyectable**: `ProductRankingEngine` acepta `idFactory` para
  sustituir `crypto.randomUUID` y hacer deterministas las pruebas.
- **URL sintética de respaldo**: `ProductOffer.url` es obligatoria y RFC 3986; el
  motor sintetiza `https://catalog.stellar.local/offers/<slug>` cuando el
  merchant no publica URL, preservando la validación estricta sin romper ofertas.
- **IDs de catálogo no-UUID**: `ProductOffer.id` se relajó de `.uuid()` a
  `.min(1)` para admitir los identificadores de catálogo del Módulo 6
  (`prod_1`, etc.) mientras `sessionId` permanece UUID.
- **Handoff que falla ruidosamente**: `SupabaseSearchRepository` exige
  `offer.metadata.productRankedId` (columna `search_results.product_ranked_id`
  es `NOT NULL` con FK a `products_ranked`); si falta, lanza error en lugar de
  escribir una fila huérfana. El adaptador depende de una vista estructural
  mínima (`SupabaseClientLike`) para ser unit-testeable.
- **Gate opcional**: la ruta solo se registra cuando la composición provee
  `agentRoutes.ranking`, de modo que entornos sin Supabase no exponen el endpoint.

## 4. Verificación

Cadena de comandos ejecutada sobre el árbol commiteado (todos exit code `0`):

```bash
bun run spec:check
bun test
bun run check-types
bun run check
bun run build
```

- `bun run spec:check` → `OpenAPI spec OK: specs/openapi.json`.
- `bun test` → **139 pass / 0 fail** (18 archivos, ~1.1–1.2 s). Baseline
  Módulo 6 = 127 pruebas / 17 archivos; el Módulo 7 añade +12 pruebas netas en
  `tests/product-ranking.test.ts`.
- `bun run check-types` → sin errores (`tsc -p tsconfig.check.json`).
- `bun run check` → 111 archivos, sin errores ni warnings (`biome check .`).
- `bun run build` → ESM válido en `dist/` (`tsc -p tsconfig.build.json`).

> **Nota de entorno**: los comandos `tsc`/`biome` requieren
> `LD_LIBRARY_PATH=` para evitar el fallo de enlazado dinámico descrito en
> `AGENTS.md` (conflicto `GLIBCXX`/`OPENSSL`).

### Inventario de pruebas del Módulo 7 (`tests/product-ranking.test.ts`)

| Foco | Pruebas |
| --- | --- |
| `ProductNormalizationService` (Module 7) | 3 |
| `ProductRankingEngine` (Module 7) | 4 |
| `POST /v1/agent/products/rank` (Module 7) | 5 |
| **Total** | **12** |

Cobertura destacada: deduplicación por URL/`merchantId:title`, conversión a
unidades menores enteras, ordenamiento por score compuesto, truncado a `topK`,
manejo de `url` ausente/presente, rechazo Zod de `sessionId` no-UUID, y casos
HTTP de la ruta de ranking.

## 5. Cobertura de contrato de la ruta de ranking

`POST /v1/agent/products/rank` (`operationId: agentProductsRank`, `agentToken`):

| Caso | Estado esperado |
| --- | --- |
| Sin token | `401` |
| Token sin scope `agent:search` | `403` |
| Cuerpo inválido (`sessionId` no-UUID, `products` vacío, `topK` fuera de `[1,10]`) | `422` |
| Petición válida | `200` con `{ sessionId, normalizedCurrency, results, count, persisted }` |
| Exceso de tasa (scoped `/v1/agent/*`) | `429` |
| Motor/composición no disponible | `503` |

## 6. Observaciones relevantes

- **Dos adaptadores de catálogo coexisten** (heredado del Módulo 6):
  `src/integrations/agents/vector-merchant-catalog.ts` (`VectorMerchantCatalog`,
  orientado a `src/domain/agents/`) y
  `src/integrations/agents/qdrant-catalog-engine.ts` (`QdrantCatalogEngine`,
  orientado a `MerchantProduct`). El Módulo 7 consume `MerchantProduct` desde el
  segundo. Persiste la recomendación de converger ambos en una entidad única.
- **Deduplicación por `merchantId:title`** puede colapsar listings legítimamente
  distintos del mismo comerciante con el mismo título y sin URL; conviene añadir
  una clave de negocio (SKU/EAN) cuando el feed la provea.
- **Tabla de tasas de cambio hardcodeada** (`USD/PEN/EUR`) como *default* de
  `NormalizationConfigSchema`; en producción debe provenir de un proveedor de FX
  versionado, no de constantes en el dominio.
- **`metadata.productRankedId` acopla el handoff a un paso previo de persistencia
  de `products_ranked`** que no forma parte del Módulo 7; el endpoint devuelve
  `persisted: false` mientras ese paso no exista en el flujo, evitando errores.

## 7. Deuda y seguimiento

- No hay métricas de ranking (distribución de scores, tasa de deduplicación,
  tasa de `persisted: false`); instrumentar al integrar observabilidad.
- El *fallback* de URL sintética usa el dominio `catalog.stellar.local`; debe
  alinearse con el dominio real del catálogo antes de producción.
- `topK` máximo de 10 y `products` máximo de 100 son límites conservadores que
  pueden requerir revisión según el volumen de candidatos del Módulo 6.
- El *push* de la rama sigue pendiente por limitación de entorno de red (SSH
  roto por política de cripto y ausencia de `GITHUB_TOKEN`); los commits
  permanecen locales en `feature/task-1790628289-vector-catalog-engine`.

## 8. Checklist DoD

- [x] `ProductOfferSchema` / `NormalizationConfigSchema` definidos con validación
      estricta (`sessionId` UUID, `url` RFC 3986, moneda ISO-4217).
- [x] `ProductRankingRequestSchema` con sanitización de payload (Audit L2).
- [x] `ProductNormalizationService`, `ProductRankingEngine` y
      `ProductHandoffService` implementados con el puerto `SearchRepository`.
- [x] Adaptador `SupabaseSearchRepository` y composición de ruta con gate opcional.
- [x] `tests/product-ranking.test.ts` creado y en verde (12 pruebas).
- [x] `bun test` → **139 pass / 0 fail** en 18 archivos (≥ 114 requerido;
      baseline Módulo 6 de 127 preservado).
- [x] `bun run spec:check`, `bun run check-types` y `bun run check` limpios.
- [x] Build ESM de producción en `dist/` vía `bun run build`.

## 9. Conclusión

El Módulo 7 queda **implementado y verificado** a nivel de dominio, puerto,
servicios, adaptador, ruta y contrato OpenAPI. La verificación automática
completa finaliza con exit code `0` en todos los pasos y eleva la cobertura a
139 pruebas / 18 archivos, preservando el baseline del Módulo 6. Queda como
seguimiento la convergencia de los dos adaptadores de catálogo, el suministro
externo de tasas de cambio y la publicación de la rama (bloqueada por el entorno
de red). El árbol de trabajo está limpio y el commit `ab3c2d3` consolida todo el
Módulo 7 en la rama de feature.
