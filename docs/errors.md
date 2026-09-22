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

## Alcance actual

Esta base implementa codigos `CORE` emitibles. Dominios adicionales se agregan
con `defineErrorCode` dentro del rango reservado del dominio.
