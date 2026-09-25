# tests

Pruebas con `bun test`.

- `tests/contract`: valida OpenAPI y el contrato HTTP.
- `tests/error-codes.test.ts`: valida la taxonomia de errores y el registro de
  codigos.
- `tests/health.test.ts`: valida health/readiness e integraciones opcionales.
- `tests/items.test.ts`: valida el caso de uso demo.
- `tests/payments.test.ts`: valida importes exactos, ownership, idempotencia,
  estados y conciliación de pagos.
- `tests/stellar-payment-gateway.test.ts`: valida XDR firmado, hash, red y firma
  del pagador sin enviar fondos.
- `tests/contract/payments-contract.test.ts`: valida las rutas internas de pago
  contra OpenAPI y sus requisitos de autenticación.
