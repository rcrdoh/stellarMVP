# ADR 0001: Bun, TypeScript y Fastify como framework base

## Status

Accepted

## Context

Esta base necesita un runtime JavaScript moderno, rapido, con TypeScript
estricto y tooling simple para servicios HTTP. La referencia vigente verificada
es Bun `1.4.0`, marcado como latest release en agosto de 2026 por la pagina
oficial de Bun.

Fastify aporta un servidor HTTP maduro y Zod mantiene validacion explicita en el
borde. Esta combinacion permite SDD con OpenAPI canonico y separacion de capas
sin introducir un framework de aplicacion pesado.

## Decision

Usar Bun, TypeScript estricto, Fastify y Zod como base:

- Bun `>=1.4.0`.
- TypeScript ESM estricto.
- Fastify para transporte HTTP.
- Zod para validacion y schemas internos.
- Biome para formato/lint.
- OpenAPI canonico en `specs/openapi.json` validado por script SDD.

## Consequences

- `src/http` contiene transporte HTTP; la logica de negocio vive en
  `src/services` y `src/domain`.
- La documentacion oficial de Bun, TypeScript, Fastify y Zod debe revisarse
  antes de cambiar patrones de runtime, validacion o arranque.
- Cambiar runtime/framework o romper esta estructura requiere una nueva ADR.
