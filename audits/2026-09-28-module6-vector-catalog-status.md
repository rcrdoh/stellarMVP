# Audit: Módulo 6 — Motor de Recuperación Vectorial y Extracción de Catálogo

- **Repository**: `stellarMVP` (ChapaTuOferta)
- **Branch**: `feature/task-1790628289-vector-catalog-engine` (commits locales; push pendiente)
- **HEAD**: `42a8ab2` — *Implement Module 6 vector retrieval and catalog extraction engine*
- **Base**: `4260413` — *Implement Module 5 agent resilience and rate limiting*
- **Runtime**: Bun `1.4.2`, TypeScript ESM estricto, Biome
- **Audit date**: 2026-09-28
- **Working tree**: limpio (todo commiteado)
- **Hallazgo de auditoría abordado**: **L2 (Low)** — parámetros no validados en rutas de consulta vectorial y ausencia de validación Zod estricta en payloads de descubrimiento de productos.

## 1. Objetivo

Implementar y verificar el Módulo 6 del eSDD: integrar el catálogo vectorial de
comercios sobre Qdrant, transformar los payloads recuperados en entidades
tipadas `MerchantProduct`, y sanear estrictamente todos los parámetros de
consulta vectorial con Zod (remediación del hallazgo **L2**). El diseño debe
admitir un *fallback* determinista offline para pruebas unitarias y ejecución sin
Qdrant.

## 2. Alcance entregado

| Artefacto | Rol | Estado |
| --- | --- | --- |
| `src/domain/catalog/types.ts` | Entidades y esquemas Zod puros del catálogo (`MerchantProductSchema`, `CatalogQueryOptionsSchema`) + tipos `MerchantProduct`, `CatalogQueryOptions`, `CatalogQueryInput` | Implementado |
| `src/domain/catalog/README.md` | Documentación del contrato de dominio (sanitización, tipos de entrada/salida) | Implementado |
| `src/schemas/catalog.schema.ts` | Esquemas HTTP de la ruta: `CatalogSearchRequestSchema`, `CatalogSearchResultSchema`, `CatalogSearchResponseSchema` | Implementado |
| `src/services/agents/ports/catalog-search-engine.ts` | Puerto `CatalogSearchEngine` (inversión de dependencias Qdrant ↔ HTTP) | Implementado |
| `src/services/agents/catalog-search.ts` | Caso de uso `CatalogSearchService` (sanea payload, delega, proyecta respuesta) | Implementado |
| `src/integrations/agents/qdrant-catalog-engine.ts` | Adaptador `QdrantCatalogEngine`: top-K en Qdrant, mapeo de payloads validado y *fallback* determinista | Implementado |
| `src/http/routes.ts` | Ruta `POST /v1/agent/catalog/search` (auth + scope `agent:search`, gate opcional) | Implementado |
| `src/http/server.ts` | Composición opcional de `CatalogSearchService` a partir de `catalogEngine` | Implementado |
| `specs/openapi.json` | Ruta `agentCatalogSearch` + schemas `CatalogSearchRequest`, `CatalogSearchResponse`, `MerchantProduct` | Actualizado, `spec:check` verde |
| `tests/catalog-engine.test.ts` | 8 pruebas del motor (fallback, filtros, límite, validación Zod, mapeo Qdrant, payload corrupto) | Verde |
| `tests/catalog-search.test.ts` | 7 pruebas del servicio y de la ruta HTTP (401/403/200/422, sanitización) | Verde |
| `tests/contract/openapi-contract.test.ts` | Contrato de la ruta de catálogo y sus schemas | Ampliado (+1) |

## 3. Decisiones de diseño

- **Contrato primero (SDD)**: la ruta y los schemas se declararon en
  `specs/openapi.json` (`operationId: agentCatalogSearch`, seguridad
  `agentToken`, respuestas `200/401/403/422/429/503`) antes de validar la
  implementación con `spec:check`.
- **Sanitización en la frontera (Audit L2)**: `CatalogQueryOptionsSchema` es el
  único punto de validación de parámetros vectoriales. Acota `limit` a
  `[1, 50]`, fija `minScore` a `[0, 1]`, rechaza `maxPrice` no positivo y
  trunca `queryText` a 256 caracteres. El motor sanea tanto en la ruta Qdrant
  como en el *fallback*, de modo que ninguna entrada sin validar alcanza el
  backend vectorial.
- **Frontera dominio/adaptador (SOLID)**: los tipos y esquemas Zod viven en
  `src/domain/catalog/` sin importar Qdrant ni Fastify. El puerto
  `CatalogSearchEngine` permite sustituir el adaptador Qdrant por un doble
  determinista en pruebas sin tocar el transporte. El dominio expone un tipo de
  entrada (`CatalogQueryInput = z.input<...>`) para que los llamadores puedan
  omitir `limit`/`minScore` y el esquema aplique los defaults.
- **Fallback determinista**: `QdrantCatalogEngine` degrada a un catálogo en
  memoria cuando Qdrant no está configurado, es inalcanzable o entrega payloads
  no parseables. `setFallbackCatalog` valida cada entrada con
  `MerchantProductSchema` al registrarla. `isFallback()` reporta el modo
  degradado y `CatalogSearchService` lo propaga como `fallback` en la respuesta.
- **Cliente estructural inyectable**: el motor depende de una vista estructural
  mínima del cliente Qdrant (`QdrantCatalogClient`) en lugar del `QdrantClient`
  concreto, manteniendo el adaptador unit-testeable. En producción se construye
  el cliente real desde `QDRANT_URL`/`QDRANT_API_KEY` (spread condicional para
  respetar `exactOptionalPropertyTypes`).
- **Gate opcional**: la ruta solo se registra cuando la composición provee un
  `catalogEngine`, de modo que entornos sin Qdrant no exponen el endpoint.

## 4. Verificación

Cadena de comandos ejecutada (todos exit code `0`):

```bash
bun run spec:check
bun test
bun run check-types
bun run check
bun run build
```

- `bun run spec:check` → `OpenAPI spec OK: specs/openapi.json`.
- `bun test` → **127 pass / 0 fail** (17 archivos). Baseline Módulo 5 = 111
  pruebas / 15 archivos; el Módulo 6 añade +16 pruebas netas en 2 archivos nuevos
  más la ampliación del test de contrato.
- `bun run check-types` → sin errores (`tsc -p tsconfig.check.json`).
- `bun run check` → 103 archivos, sin errores ni warnings (`biome check .`).
- `bun run build` → ESM válido en `dist/` (`tsc -p tsconfig.build.json`).

> **Nota de entorno**: los comandos `tsc`/`biome` requieren
> `LD_LIBRARY_PATH=` para evitar el fallo de enlazado dinámico descrito en
> `AGENTS.md` (conflicto `GLIBCXX`/`OPENSSL`).

### Inventario de pruebas del Módulo 6

| Archivo | Pruebas | Foco |
| --- | --- | --- |
| `tests/catalog-engine.test.ts` | 8 | Fallback offline, filtros categoría/precio, límite, validación Zod L2, mapeo Qdrant, payload inválido, defaults de entidad |
| `tests/catalog-search.test.ts` | 7 | Servicio (sanitización, clave vacía, parámetros fuera de rango) y ruta HTTP (401/403/200/422) |
| `tests/contract/openapi-contract.test.ts` | +1 | Declaración de ruta y schemas en el spec |

## 5. Cobertura de contrato de la ruta de catálogo

`POST /v1/agent/catalog/search` (`operationId: agentCatalogSearch`, `agentToken`):

| Caso | Estado esperado |
| --- | --- |
| Sin token | `401` |
| Token sin scope `agent:search` | `403` |
| Cuerpo sin `queryText` ni `vector` | `422` |
| Parámetros fuera de rango (`limit=-5`, `minScore=2`, `maxPrice<=0`) | `422` |
| Petición válida | `200` con `{ results, count, fallback }` |
| Exceso de tasa (scoped `/v1/agent/*`) | `429` |

## 6. Observaciones relevantes

- **Dos implementaciones de catálogo coexisten**: el repositorio ya contenía
  `src/integrations/agents/vector-merchant-catalog.ts` (`VectorMerchantCatalog`,
  orientado a `MerchantOffer`/contratos de `src/domain/agents/`) con su prueba
  `tests/vector-catalog.test.ts`. El Módulo 6 introduce un adaptador distinto,
  `QdrantCatalogEngine`, orientado a `MerchantProduct` y expuesto por la ruta
  `/v1/agent/catalog/search`. Se recomienda converger ambos en un único
  adaptador/entidad en un módulo de consolidación para evitar divergencia de
  contratos de producto (`MerchantOffer.priceMinor` vs `MerchantProduct.price`).
- **Resolución de conflicto spec vs. implementación**: el eSDD nombraba la clase
  `VectorMerchantCatalog` y la ruta `/v1/agent/search`; la implementación real usa
  `QdrantCatalogEngine` y `/v1/agent/catalog/search`. El nombre de la ruta
  difiere del eSDD y está registrado como `agentCatalogSearch` en el spec; debe
  confirmarse si se requiere alias `/v1/agent/search`.
- **Validación de payload Qdrant**: un hit con payload incompatible (`price <= 0`
  o campos faltantes) provoca `ZodError` dentro del `try`, que se traduce en
  *fallback* determinista en lugar de propagar datos parciales al pipeline.

## 7. Deuda y seguimiento

- El *fallback* vive en memoria; en producción el catálogo offline debería
  hidratarse desde una fuente persistente o snapshot versionado.
- `CatalogQueryOptionsSchema` no soporta aún `vector` con dimensión validada ni
  `offset`/paginación; considerar acotar la longitud del vector.
- No hay métricas del modo degradado (`fallback`) ni del motor Qdrant
  (latencia, tasa de *fallback*, `score`); instrumentar cuando se integre
  observabilidad.
- El *push* de la rama falló por entorno: SSH roto por política de cripto
  (`/etc/crypto-policies/back-ends/openssh.config: terminating, 1 bad
  configuration options`) y sin `GITHUB_TOKEN`. Los commits permanecen locales en
  `feature/task-1790628289-vector-catalog-engine`.

## 8. Checklist DoD

- [x] `@qdrant/js-client-rest` presente en `package.json` y `bun.lock`.
- [x] `MerchantProductSchema` y `CatalogQueryOptionsSchema` con sanitización
      estricta (Audit L2).
- [x] `QdrantCatalogEngine` con consulta vectorial Qdrant y *fallback*
      determinista.
- [x] `catalog-engine.test.ts` / `catalog-search.test.ts` creados y en verde.
- [x] `bun test` → **127 pass / 0 fail** en 17 archivos (≥ 114 requerido;
      baseline 111 preservado).
- [x] `bun run spec:check`, `bun run check-types` y `bun run check` limpios.
- [x] Build ESM de producción en `dist/` vía `bun run build`.

## 9. Conclusión

El Módulo 6 queda **implementado y verificado** a nivel de dominio, puerto,
adaptador, servicio, ruta y contrato OpenAPI. La verificación automática completa
finaliza con exit code `0` en todos los pasos y supera el umbral de pruebas del
eSDD. Queda como seguimiento la convergencia con el `VectorMerchantCatalog`
preexistente y la publicación de la rama (bloqueada por el entorno de red).
