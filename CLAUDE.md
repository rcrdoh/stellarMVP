# CLAUDE.md

Guía para agentes de código en esta base **Bun / TypeScript** (Fastify + Zod).
Complementa a `AGENTS.md`; sus reglas son estrictas y prevalecen. Léelo entero.

## Contexto del repo

Plantilla base para servicios HTTP con Bun, TypeScript ESM estricto, Fastify y
Zod. Es una de las bases de `service-base-shells`; se copia como punto de
partida de un repo nuevo. La fuente de verdad del API es `specs/openapi.json`
(Spec Driven Development).

## Antes de tocar código

1. Lee `README.md`, `docs/sdd.md`, `docs/solid.md`, `docs/errors.md` y la
   carpeta afectada por el cambio.
2. Si usas Bun, TypeScript, Fastify, Zod, Biome o Prisma, revisa su
   documentación oficial y aplica el patrón recomendado para este repo antes de
   implementar.
3. Si la instrucción es ambigua, declara supuestos concretos. En modo plan avisa
   que el usuario puede corregirlos; en una prompt puntual, que puede detenerte.

## Estructura por capas (no romperla)

```txt
src/config/       Variables de entorno tipadas
src/domain/       Schemas, tipos y errores puros (dominio)
src/http/         Servidor Fastify, rutas y serialización de errores (transporte)
src/services/     Casos de uso
src/integrations/ Adaptadores reemplazables
src/index.ts      Entrada del proceso
config/           TOML versionable (perfiles dev/staging/prod)
specs/            OpenAPI canónico y reglas de contrato
tests/            Pruebas de contrato (tests/contract) y de servicios
```

- SOLID: los servicios dependen de interfaces/puertos, no de adaptadores
  concretos. No pongas reglas de negocio en rutas Fastify.
- SDD: los cambios de contrato van **primero** en `specs/openapi.json`, luego
  implementación, pruebas y documentación. Rechaza divergencias spec↔código.
- Si un cambio afecta docs, specs o taxonomía, propágalo a las subcarpetas y
  actualiza el README/doc asociado a esa carpeta o archivo.

## Flujo SDD

1. Edita `specs/openapi.json`.
2. `bun run spec:check`.
3. Implementa rutas, schemas y servicios.
4. Agrega contract tests en `tests/contract`.
5. `bun test`.

## Comandos de verificación (obligatorios antes de cerrar)

```bash
bun run spec:check
bun test
bun run check-types
bun run check   # biome check
```

Desarrollo local: `bun install` && `bun run dev`. Health/spec:
`/v1/health/live`, `/v1/health/ready`, `/openapi.json` (puerto 3000 por defecto).

## Configuración e integraciones

- Precedencia: defaults del código < `[app]` TOML < perfil TOML < entorno de Bun.
- Perfil por `APP_ENV=dev|staging|prod`.
- Las capas `database`, `bucket` y `cache` son opcionales y por defecto están en
  `false` (`*_ENABLED`); una capa deshabilitada no conecta ni cuenta para
  readiness. Postgres → patrón documentado es Prisma Client.

## Pruebas y operación

- Pruebas permanentes en `tests/` o `tests/contract/`. Recomienda test
  permanente cuando el cambio cubra contrato, bug o comportamiento esperado.
- Prueba volátil: avisa al usuario y guárdala en `tmp/`; no la mezcles con las
  permanentes salvo que el usuario lo pida.
- Si las pruebas pasan, actualiza la documentación relacionada antes de terminar.
- No guardes secretos en TOML, `.env.example`, docs ni tests.
- No dejes servidores, contenedores ni procesos corriendo sin informarlo.
