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

La aplicacion se despliega actualmente en Render; el despliegue en Render ya fue
realizado. El repositorio incluye un `Dockerfile` de produccion que fija el
runtime Bun, instala dependencias de produccion y ejecuta el servicio HTTP.
Render puede construir y ejecutar el contenedor desde ese archivo. No hay un
`render.yaml` en el repositorio, por lo que la seleccion de rama, el tipo de
servicio, el puerto configurado en Render, las variables de entorno y los
health checks del Dashboard no quedan declarados como infraestructura en este
repo.

El repositorio conserva `vercel.json` y compatibilidad de entrypoint para
Vercel, resultado del intento de despliegue anterior. Esa configuracion es
heredada y no describe el destino de produccion vigente. Los errores historicos
de Vercel (patrones `functions`, salida estatica `public` y resolucion de tipos)
explican la compatibilidad restante, pero no deben dirigir cambios del
despliegue activo en Render.

## Decision

Usar Bun, TypeScript estricto, Fastify y Zod como base:

- Bun `>=1.4.0`.
- TypeScript ESM estricto.
- Fastify para transporte HTTP.
- Zod para validacion y schemas internos.
- Biome para formato/lint.
- OpenAPI canonico en `specs/openapi.json` validado por script SDD.
- Render es la plataforma activa para el servicio HTTP. El artefacto de
  despliegue versionado es el `Dockerfile` en la raiz; el servicio de Render
  debe usar runtime Docker y construir desde ese archivo. Render usa el `CMD`
  del Dockerfile como comando de inicio, salvo que el Dashboard lo reemplace.
- El `Dockerfile` fija Bun `1.4.0`, instala dependencias de produccion con
  `bun install --frozen-lockfile --production`, copia `src`, `config`,
  `public` y `specs`, y arranca con `bun run start`. `public` contiene los
  assets de la consola de pruebas servida por Fastify.
- El servicio HTTP debe escuchar en `0.0.0.0`. El contenedor declara
  `HOST=0.0.0.0` y `PORT=3000`; el puerto de servicio configurado en Render debe
  coincidir con el puerto donde escucha la app. Render usa `10000` por defecto
  para servicios web, y permite configurar el puerto; si se cambia el puerto
  del contenedor, hay que mantener sincronizados `PORT`, `EXPOSE` y Render.
- `src/index.ts` importa Fastify directamente, construye la app, la exporta
  como default y llama `app.listen(...)` en ejecucion normal. La condicion
  `VERCEL` conserva compatibilidad con el despliegue serverless anterior; en
  Render la variable no debe definirse para que el proceso abra su puerto.
- `tsconfig.json` mantiene `types: []`; `tsconfig.check.json` habilita los tipos
  completos de Bun para `check-types`. Las APIs Bun utilizadas por produccion
  tienen declaraciones locales en los modulos que las usan.
- `vercel.json` es una configuracion heredada. No es la fuente de verdad del
  despliegue Render ni debe cambiarse como solucion a fallos en Render.

### Proteccion de la configuracion de Render

El `Dockerfile`, el entrypoint, el host/puerto y la configuracion del servicio
Render son decisiones funcionales. No se deben cambiar para silenciar un error
aislado sin identificar primero si falla el build de imagen, el arranque, el
health check o el enrutamiento. En particular:

1. No retirar ni cambiar el runtime Docker, `CMD`, `HOST`, `PORT` o `EXPOSE` sin
   verificar el contrato del servicio configurado en Render.
2. No establecer `VERCEL` en Render: `src/index.ts` lo usa para omitir el bind
   del puerto en Vercel.
3. No agregar un `render.yaml` parcial para un servicio existente: Render
   advierte que un Blueprint debe incluir la configuracion actual del recurso,
   pues los valores omitidos pueden divergir del Dashboard. Si se decide
   versionar la infraestructura, primero exportar/verificar todos los ajustes
   actuales y mantenerlos sincronizados.
4. Antes de aceptar cambios de despliegue, ejecutar las comprobaciones locales
   y validar un deploy Preview de Render o un deploy equivalente que no reemplace
   el servicio activo. Un build local no sustituye la validacion en Render.
5. `vercel.json` y el soporte de Vercel se consideran legado hasta que una ADR
   nueva restablezca formalmente Vercel como destino activo.

Referencias primarias: [Docker en Render](https://render.com/docs/docker),
[Web Services de Render y binding de puerto](https://render.com/docs/web-services),
[Blueprint YAML de Render](https://render.com/docs/blueprint-spec) y
[Fastify en Vercel](https://vercel.com/docs/frameworks/backend/fastify) para el
soporte heredado.

## Consequences

- `src/http` contiene transporte HTTP; la logica de negocio vive en
  `src/services` y `src/domain`.
- La documentacion oficial de Bun, TypeScript, Fastify y Zod debe revisarse
  antes de cambiar patrones de runtime, validacion o arranque.
- Cambiar runtime/framework o romper esta estructura requiere una nueva ADR.
- La configuracion de Render debe conservar las restricciones y el proceso de
  validacion de la seccion **Proteccion de la configuracion de Render**.
