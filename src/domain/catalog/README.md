# catalog

Tipos y schemas puros del catálogo vectorial (Module 6). No importa Fastify,
Qdrant ni ningún cliente externo: solo Zod.

- `MerchantProductSchema` valida el payload indexado en el vector store y lo
  proyecta a la entidad tipada `MerchantProduct` consumida por el motor de
  extracción de catálogo.
- `CatalogQueryOptionsSchema` sanitiza los parámetros de consulta vectorial
  (hallazgo de auditoría L2): acota `limit` a `[1, 50]`, fija `minScore` a
  `[0, 1]` y rechaza precios no positivos.
- `CatalogQueryOptions` es la forma ya parseada (con defaults aplicados).
  `CatalogQueryInput` es la forma de entrada (todo opcional salvo los límites);
  adaptadores y servicios aceptan el input y delegan la sanitización al schema.
