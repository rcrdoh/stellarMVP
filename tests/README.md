# tests

Pruebas con `bun test`.

- `tests/contract`: valida OpenAPI y el contrato HTTP.
- `tests/error-codes.test.ts`: valida la taxonomia de errores y el registro de
  codigos.
- `tests/health.test.ts`: valida health/readiness e integraciones opcionales.
- `tests/items.test.ts`: valida el caso de uso demo.
- `tests/agents.test.ts`: valida fail-closed del gate Jev, búsqueda permitida,
  pausas/reanudación de selección y aprobación, límites, hash y capas de agentes.
