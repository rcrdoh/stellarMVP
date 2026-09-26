# Stellar MVP

Servicio HTTP para Stellar MVP, basado en Bun, TypeScript estricto, Fastify y Zod.
El endpoint `/api/hello_api` informa si `STELLAR_NETWORK` esta configurada sin
exponer su valor. El SDK Stellar queda disponible para integraciones on-chain
que se definan posteriormente.

## Stack

- Bun `>=1.4.0`
- TypeScript ESM estricto
- Fastify
- Zod
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

### Consola de pruebas

`/app` sirve una consola web mínima para probar health checks, búsqueda del
agente, payment intents y el checkout ACP sin instalar un cliente adicional:

```bash
open http://127.0.0.1:3000/app
```

La consola no guarda tokens ni claves privadas. El payment intent entrega un
XDR sin firmar; la firma debe realizarse en una wallet Stellar de prueba y el
XDR firmado se pega manualmente en la consola. Para usar una API remota, el
servicio remoto debe permitir el origen del navegador mediante CORS.

La consola incluye conexión opcional con la extensión [Freighter](https://github.com/stellar/freighter-developer-docs/blob/main/extension/connecting.md).
Pulsa **Conectar Freighter** con la wallet configurada en la misma red que la
API; la dirección pública se copia a `payerAddress` y se usa para preparar el
micropago. La clave secreta nunca sale de la extensión. Si Freighter no está
instalado, puedes introducir manualmente una dirección pública Stellar.

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
`false`; una capa deshabilitada no se conecta ni cuenta para readiness. Para
Postgres en TypeScript, el patron documentado es Prisma Client.

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

El compose local levanta PostgreSQL (`5432`), Redis (`6379`) y MongoDB
(`27017`). La aplicación queda en `http://127.0.0.1:8010`, con pagos de prueba
habilitados en Stellar Testnet y un importe fijo de `0.01` USDC. El endpoint
`POST /v1/payment-quotes` recibe el `payerAddress` público de la wallet y usa
`STELLAR_PAYMENT_PAY_TO` como receptor.

La búsqueda del agente usa por defecto el catálogo Bazaar/x402 de HeinrichsTech
y crea la colección Qdrant `heinrichstech_services`. Configura
`EMBEDDINGS_API_KEY` y ejecuta `bun run catalog:ingest` para indexarlo. El
adaptador UCP sigue disponible con `CATALOG_ADAPTER=ucp` para comercios que
publiquen `/.well-known/ucp`.

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
