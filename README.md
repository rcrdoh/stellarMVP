# Stellar MVP

Servicio HTTP para Stellar MVP, basado en Bun, TypeScript estricto, Fastify y Zod.
El endpoint `/api/hello_api` informa si `STELLAR_NETWORK` esta configurada sin
exponer su valor. El SDK Stellar construye, valida y envía intents de pago
clásicos en Testnet cuando la feature está habilitada.

El primer flujo backend de pago USDC con cuenta Stellar clásica está
implementado para Testnet y permanece deshabilitado por defecto. Genera un
intent desde una cotización aprobada, devuelve un XDR para firma humana, valida
el XDR firmado y concilia el resultado. El repo aún no contiene el frontend de
Freighter ni las smart accounts Soroban del diagrama. Consulta
`docs/agentic-commerce-design.md` y `docs/stellar-payments-plan.md`.

## Stack

- Bun `>=1.4.0`
- TypeScript ESM estricto
- Fastify
- Zod
- MongoDB Node.js Driver
- `@stellar/stellar-sdk`
- Biome
- `bun test`

## Estructura

```txt
src/
  config/       Variables de entorno tipadas
  domain/       Schemas, tipos y errores puros
  http/         Servidor, rutas y serializacion de errores
  integrations/ Adaptadores reemplazables
  services/     Casos de uso
  index.ts      Entrada del proceso
config/         TOML versionable con perfiles dev, staging y prod
docs/           SDD, errores, SOLID, Docker y ADR
specs/          OpenAPI canonico y reglas de contrato
scripts/        Automatizacion SDD local
tests/          Pruebas de contrato y servicios
AGENTS.md       Reglas estrictas para agentes de codigo
Dockerfile      Imagen de produccion
docker-compose.yml Orquestacion local de contenedor
```

## Comandos

```bash
bun install
bun run dev
bun run build
bun run spec:check
bun test
bun run check
bun run check-types
```

`bun run build` emite a `dist/` via `tsconfig.build.json`. El runtime local sigue siendo Bun sobre `src/` (`dev` / `start`).

## Ejecutar desde cero

1. Instala Bun `>=1.4.0`.
2. Instala dependencias:

```bash
bun install
```

3. Revisa la configuracion versionable en `config/settings.toml`.
4. Si necesitas overrides locales, crea `.env` tomando `.env.example` como base.
   No guardes secretos en TOML ni en git.
5. Arranca el servicio:

```bash
bun run dev
```

6. Verifica health y spec:

```bash
curl -I http://127.0.0.1:3000/
curl http://127.0.0.1:3000/v1/health/live
curl http://127.0.0.1:3000/v1/health/ready
curl http://127.0.0.1:3000/openapi.json
curl http://127.0.0.1:3000/docs
```

La ruta raiz `/` redirige a `/docs`, donde se sirve la referencia interactiva
del API.

7. Antes de abrir cambios, ejecuta:

```bash
bun run spec:check
bun test
bun run check-types
bun run check
```

## Spec Driven Development

El contrato canonico vive en `specs/openapi.json`. Para cambiar el API:

1. Cambia primero `specs/openapi.json`.
2. Ejecuta `bun run spec:check`.
3. Implementa o ajusta rutas, schemas y servicios.
4. Agrega contract tests en `tests/contract`.
5. Ejecuta `bun test`.

## Errores y SOLID

- Taxonomia de errores y `application/problem+json`: `docs/errors.md`.
- ADR aceptadas: `docs/adr/`.
- Principios SOLID aplicados: `docs/solid.md`.

## Configuracion

Configura defaults versionables en `config/settings.toml`. Usa `APP_ENV=dev`,
`APP_ENV=staging` o `APP_ENV=prod` para seleccionar perfil. Usa `.env` o
variables reales de entorno para secretos y overrides locales.

Precedencia: defaults del codigo < `[app]` TOML < perfil TOML < entorno cargado
por Bun.

Las capas `database`, `bucket` y `cache` existen como integraciones opcionales.
Por defecto `DATABASE_ENABLED`, `BUCKET_ENABLED` y `CACHE_ENABLED` estan en
`false`; una capa deshabilitada no se conecta ni cuenta para readiness. El
placeholder `database.ts` todavía no abre una conexión real.

El placeholder `database.ts` sigue independiente. Para habilitar pagos, configura
`PAYMENTS_ENABLED=true`, `MONGODB_URI`, `MONGODB_DATABASE`, `STELLAR_NETWORK=testnet`, `STELLAR_USDC_ISSUER`
y `SERVICE_TOKEN` en el entorno. El servidor conecta MongoDB al iniciar; si la
configuración o la conexión falla, no arranca. Nunca habilita Mainnet.

El checkout interno exige `Authorization: Bearer <SERVICE_TOKEN>` y el header
`x-principal-id` afirmado por un BFF autenticado. El cliente nunca recibe el
token de servicio. El BFF obtiene una cotización aprobada y envía solo su
`quoteId`; monto, activo, red y destinatarios se leen de MongoDB. La interfaz
web debe mostrar el resumen y pedir a Freighter que firme el `unsignedXdr`,
luego enviar el `signedXdr` al BFF para que lo entregue al backend.

Los pagos se crean únicamente desde documentos aprobados de
`approved_quotes`. La comisión no se calcula en el servicio; solo se usa si ya
forma parte de `paymentLegs` de la cotización aprobada. Ver
`docs/stellar-payments-plan.md` para el esquema y los pendientes de producto.

MongoDB también es la decisión acordada para los checkpoints de LangGraph, pero
el checkpointer aún no está conectado en este repositorio.

`SERVICE_TOKEN` es opcional. Si esta vacio, las rutas `items` no requieren
autenticacion. Si esta configurado, `POST /v1/items` y `GET /v1/items/{itemId}`
requieren `Authorization: Bearer <token>`. Los endpoints `/v1/health/live`,
`/v1/health/ready`, `/openapi.json` y `/docs` permanecen publicos.

```env
SERVICE_TOKEN=local-dev-token
```

```bash
curl -X POST http://127.0.0.1:3000/v1/items \
  -H "Authorization: Bearer local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"demo","metadata":{}}'
```

Si falta la credencial, la API responde `SVC-CORE-2001`; si el token es
incorrecto, responde `SVC-CORE-2002`.

## Docker

Manual: `docs/docker.md`.

```bash
docker compose up --build -d
```

## Render

El despliegue activo usa Render con el `Dockerfile` de la raíz. La imagen instala
dependencias de producción con Bun 1.4 y arranca mediante `bun run start`. El
contenedor escucha en `0.0.0.0:3000`; si cambias el puerto en el Dockerfile,
sincroniza `PORT`, `EXPOSE` y la configuración del servicio en Render.

No hay `render.yaml`: la rama, variables, health check y ajustes del Dashboard
viven en Render. No agregues un Blueprint parcial al servicio existente sin
capturar primero todos sus valores actuales. `vercel.json` y el guardado
`VERCEL` en `src/index.ts` se conservan por compatibilidad anterior, no como
configuración del despliegue activo. Consulta
`docs/adr/0001-bun-fastify-framework.md` antes de cambiar la configuración.
