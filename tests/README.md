# tests

Pruebas con `bun test`.

- `tests/contract`: valida OpenAPI y el contrato HTTP.
- `tests/error-codes.test.ts`: valida la taxonomia de errores y el registro de
  codigos.
- `tests/health.test.ts`: valida health/readiness e integraciones opcionales.
- `tests/items.test.ts`: valida el caso de uso demo.
- `tests/agents.test.ts`: valida fail-closed del gate Jev, búsqueda permitida,
  pausas/reanudación de selección y aprobación, límites, hash y capas de agentes.
- `tests/shopping-route.test.ts`: valida la ruta `POST /v1/agent/shopping`
  (auth, scope, validación de turno y avance real sobre `ShoppingAgent` con
  puertos deterministas).
- `tests/supabase-migrations.test.ts`: valida el DDL de las migraciones y la
  inicialización segura del checkpointer Postgres (rechazo de URL vacía antes de
  abrir pool, cierre ante fallo de `setup`).
- `tests/vector-catalog.test.ts`: valida el adaptador `VectorMerchantCatalog`
  (transformación de hits de Qdrant a `MerchantOffer`, filtros de payload y
  fail-closed ante documentos incompatibles).
- `tests/wallets.test.ts`: valida los contratos de wallet (`truncateAddress`,
  schemas), el ciclo de vida de `WalletSessionService` con dobles en memoria
  (connect/restore/disconnect/sign y mapeo de errores a `SVC-WALLET-*`) y el
  adaptador `StellarWalletKitConnector` con un SDK falso cargado bajo demanda.
