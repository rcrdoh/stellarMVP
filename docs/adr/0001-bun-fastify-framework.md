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

El servicio se despliega como Function Fastify en Vercel. La documentacion de
Vercel reconoce `src/index.ts` como entrypoint y empaqueta la aplicacion Fastify
como una Function; por eso no corresponde tratar este proyecto como un sitio
estatico. Durante el despliegue se encontraron fallos por declarar patrones de
`functions` que no viven bajo `api/`, por forzar `public` como salida y por
dependencias entre las declaraciones de tipos Bun y el chequeo/transpilacion
que Vercel aplica a la Function.

## Decision

Usar Bun, TypeScript estricto, Fastify y Zod como base:

- Bun `>=1.4.0`.
- TypeScript ESM estricto.
- Fastify para transporte HTTP.
- Zod para validacion y schemas internos.
- Biome para formato/lint.
- OpenAPI canonico en `specs/openapi.json` validado por script SDD.
- Vercel usa el preset `fastify` y detecta la entrada `src/index.ts`; esta
  entrada importa `Fastify` directamente y construye la aplicacion desde ahi.
- La configuracion versionada de Vercel es la fuente de verdad:
  `framework: "fastify"`, `buildCommand: null`, `outputDirectory: null` y
  `bunVersion: "1.4.x"`. No agregar `functions` apuntando a `src/index.ts`, ni
  establecer `outputDirectory: "public"`: el primer patron no corresponde a
  funciones dentro de `api/` y el segundo convierte incorrectamente el build en
  uno estatico.
- `src/index.ts` es un modulo ESM que **exporta la instancia de Fastify**
  (`export default app`). Vercel importa este modulo y usa la instancia exportada
  como handler de la Function; sin ese export no hay handler y todas las rutas
  responden `404` aunque el build pase. `app.listen(...)` se ejecuta solo cuando
  la variable `VERCEL` no esta presente, porque en Vercel no existe un puerto que
  atender: alli el enrutamiento lo provee la plataforma.
- `tsconfig.json` mantiene `types: []` para que el compilador de la Function no
  dependa de la resolucion global de tipos Bun. Los tipos de Bun para
  `check-types` viven en `tsconfig.check.json`; las APIs Bun usadas en codigo de
  produccion se declaran junto a cada modulo que las usa, ya que el build de
  Vercel no incorporo el `.d.ts` auxiliar en los errores observados.

### Proteccion de la configuracion de despliegue

Los valores de `vercel.json`, el entrypoint y la separacion de configuracion de
tipos descritos arriba son decisiones de arquitectura, no ajustes cosmeticos.
No se deben cambiar para silenciar un error aislado sin identificar primero la
fase exacta del build y el contrato del preset Fastify. En particular:

1. No agregar `outputDirectory`, `functions` o comandos de build personalizados
   sin evidencia de que el preset Fastify actual los requiere.
2. No mover el entrypoint ni envolver `Fastify` de forma que el detector deje de
   reconocer la aplicacion. En particular, no eliminar el `export default app` de
   `src/index.ts` ni llamar `app.listen(...)` sin condicionarlo a entornos no
   serverless: eso reintroduce el `404` en Vercel.
3. No volver a agregar `types: ["bun"]` al `tsconfig.json` usado por Vercel ni
   eliminar las declaraciones locales de `Bun` para satisfacer solo al checker
   local.
4. Antes de aceptar un cambio en esta configuracion, ejecutar las comprobaciones
   locales y validar un deployment Preview de Vercel desde el commit exacto. El
   build local de TypeScript no sustituye la validacion del builder de Vercel.
   Si no se puede obtener ese Preview, dejar el cambio como propuesta y no
   presentar la configuracion como verificada.

Referencias primarias: [Fastify en Vercel](https://vercel.com/docs/frameworks/backend/fastify),
[configuracion de proyecto Vercel](https://vercel.com/docs/project-configuration)
y [opcion `typeRoots` de TypeScript](https://www.typescriptlang.org/tsconfig/typeRoots.html).

## Consequences

- `src/http` contiene transporte HTTP; la logica de negocio vive en
  `src/services` y `src/domain`.
- La documentacion oficial de Bun, TypeScript, Fastify y Zod debe revisarse
  antes de cambiar patrones de runtime, validacion o arranque.
- Cambiar runtime/framework o romper esta estructura requiere una nueva ADR.
- La configuracion funcional de Vercel debe conservar las restricciones y el
  proceso de validacion de la seccion **Proteccion de la configuracion de
  despliegue**.
