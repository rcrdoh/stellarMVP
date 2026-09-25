# Error Codes

Los errores publicos siguen la taxonomia v1 definida en
`docs/Taxonomia_Errores_v1.md`.

## Reglas

- Usa codigos `SVC-<DOMINIO>-<NNNN>`.
- Define codigos en `src/domain/error-codes.ts` con `defineErrorCode`.
- Toda respuesta HTTP de error usa `application/problem+json`.
- Expone el mismo codigo en `code` y en el header `x-error-code`.
- Incluye siempre `behavior`, `correlation.trace_id` y `occurred_at`.
- No pongas secretos, PII, stack traces ni mensajes literales de proveedor en el
  problem.
- Cambiar el `behavior` de un codigo existente requiere ADR.

## Dominio PAYMENT (Agentic Commerce / x402)

- `SVC-PAYMENT-4020` (`payment_required`, HTTP `402`): falta o es invalido el
  header `X-402-Payment-Token`. La respuesta incluye `X-402-Challenge` con el
  challenge ACP para auto-negociacion.
- `SVC-PAYMENT-4022` (`payment_failed`, HTTP `402`): la liquidacion on-chain en
  Stellar/Horizon fue rechazada, fallo o expiro.

## Alcance actual

Esta base implementa codigos `CORE` emitibles y el dominio `PAYMENT` para las
rutas de agent commerce. Dominios adicionales se agregan con `defineErrorCode`
dentro del rango reservado del dominio.
