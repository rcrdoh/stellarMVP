# Spec Driven Development

`specs/openapi.json` es la fuente de verdad del API.

## Reglas

- Toda ruta publica debe existir primero en la spec.
- Cada operacion debe tener `operationId`.
- Toda respuesta no exitosa debe usar `Problem` con
  `application/problem+json`.
- Los ejemplos deben representar payloads reales y pequenos.
- Los cambios incompatibles requieren nueva version o migracion explicita.

## Flujo

1. Disenar o cambiar la operacion en `specs/openapi.json`.
2. Ejecutar `bun run spec:check`.
3. Implementar la ruta en `src/http/routes.ts`.
4. Mantener schemas Zod en `src/domain` alineados con `components.schemas`.
5. Cubrir el contrato con tests en `tests/contract`.

## Documentacion interactiva

`GET /docs` sirve Scalar API Reference apuntando a `GET /openapi.json`.
La fuente de verdad sigue siendo `specs/openapi.json`.
