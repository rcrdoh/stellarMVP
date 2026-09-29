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
  ui/           Capa de presentacion framework-agnostic (sin React)
  ui/index.html Shell HTML del cliente (Tailwind via CDN)
  ui/browser/   Composition root y clientes para ejecutar la UI en el navegador
  index.ts      Entrada del proceso
config/         TOML versionable con perfiles dev, staging y prod
docs/           SDD, errores, SOLID, Docker y ADR
specs/          OpenAPI canonico y reglas de contrato
supabase/       Migraciones SQL (esquema de comercio y RLS por agente)
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
bun run ui:dev
bun run build
bun run spec:check
bun test
bun run check
bun run check-types
```

`bun run build` emite a `dist/` via `tsconfig.build.json`. El runtime local sigue siendo Bun sobre `src/` (`dev` / `start`). `bun run ui:dev` sirve la UI del navegador (ver [Frontend](#frontend-shell-en-el-navegador)).

## Ejecutar en localhost

### Valores minimos (arranque sin dependencias externas)

La aplicacion arranca **sin configurar ninguna variable de entorno**: todos los
valores del schema tienen default y las integraciones externas quedan
deshabilitadas. Verificado con `bun src/index.ts` (live `200`, ready `200`,
raiz `302`).

| Variable | Valor por defecto | Descripcion |
| --- | --- | --- |
| `APP_ENV` | `dev` | Perfil activo (`dev`, `staging`, `prod`) |
| `HOST` | `127.0.0.1` | Interfaz de escucha local |
| `PORT` | `3000` | Puerto HTTP |
| `LOG_LEVEL` | `info` (perfil `dev`: `debug`) | Nivel de logs |
| `CONFIG_FILE` | `config/settings.toml` | TOML versionable de perfiles |
| `DATABASE_ENABLED` | `false` | Postgres deshabilitado |
| `BUCKET_ENABLED` | `false` | Almacenamiento de objetos deshabilitado |
| `CACHE_ENABLED` | `false` | Redis deshabilitado |
| `AGENT_COMMERCE_ENABLED` | `false` | Rutas `/v1/agent/*` no registradas |
| `PAYMENTS_ENABLED` | `false` | Rutas `/v1/payment-intents/*` no registradas |

Pasos:

1. Instala Bun `>=1.4.0`.
2. Instala dependencias:

```bash
bun install
```

3. Arranca el servicio (recarga automatica con `--watch`):

```bash
bun run dev
```

4. Verifica health y spec:

```bash
curl -I http://127.0.0.1:3000/            # 302 -> /docs
curl http://127.0.0.1:3000/v1/health/live # {"status":"ok",...}
curl http://127.0.0.1:3000/v1/health/ready
curl http://127.0.0.1:3000/openapi.json
curl http://127.0.0.1:3000/docs
```

La ruta raiz `/` redirige a `/docs`, donde se sirve la referencia interactiva
del API.

5. (Opcional) Levanta el frontend en otra terminal y abre
   `http://127.0.0.1:3001`:

```bash
bun run ui:dev
```

El shell del navegador funciona solo (catalogo demo en memoria) y hace proxy de
`/v1/*` hacia el backend en `:3000`. Detalles en
[Frontend](#frontend-shell-en-el-navegador).

### Overrides locales (`.env`)

Copia `.env.example` a `.env` (cargado por Bun; no lo subas a git) y ajusta solo
lo que necesites. Valores tipicos para desarrollo:

```env
APP_ENV=dev
HOST=127.0.0.1
PORT=3000
LOG_LEVEL=debug
SERVICE_TOKEN=local-dev-token
```

Con `SERVICE_TOKEN` definido, las rutas de `items` exigen el bearer
(verificacion: sin token `401`, con token `201`):

```bash
curl -X POST http://127.0.0.1:3000/v1/items \
  -H "Authorization: Bearer local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"name":"demo","metadata":{}}'
```

### Habilitar agentes (`AGENT_COMMERCE_ENABLED=true`)

Registra las rutas `/v1/agent/*`. Requiere las integraciones que consumen esos
casos de uso; si faltan, el arranque falla al construir el runtime. Valores
minimos a definir en `.env`:

```env
AGENT_COMMERCE_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=postgres://stellar:password@127.0.0.1:5432/stellarmvp
OPENAI_API_KEY=<clave>
GROQ_API_KEY=<clave>
```

### Habilitar pagos (`PAYMENTS_ENABLED=true`)

El schema (`src/config/env.ts`) **exige** estos valores cuando los pagos estan
activos; si falta alguno, el proceso no arranca y muestra el `ZodError`:

| Variable | Valor requerido | Motivo |
| --- | --- | --- |
| `SERVICE_TOKEN` | no vacio | Autenticacion de las rutas de pago |
| `DATABASE_URL` | no vacio | Persistencia de payment intents |
| `STELLAR_NETWORK` | `testnet` | Los pagos de wallet solo corren en testnet |
| `STELLAR_USDC_ISSUER` | cuenta Stellar `G...` (56 chars) | Asset USDC |
| `STELLAR_HORIZON_URL` | debe empezar por `https://` (default `https://horizon-testnet.stellar.org`) | Endpoint de Horizon |

Ejemplo de `.env` para pagos en local:

```env
PAYMENTS_ENABLED=true
SERVICE_TOKEN=local-dev-token
DATABASE_URL=postgres://stellar:password@127.0.0.1:5432/stellarmvp
STELLAR_NETWORK=testnet
STELLAR_USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_SOURCE_SECRET=<secret opcional, solo si el backend firma>
```

Puedes levantar un Postgres local con el `docker-compose.yml` del repo
(`docker compose up -d postgres`) y usar la `DATABASE_URL` de ejemplo.

### Frontend (shell en el navegador)

La capa `src/ui` es framework-agnostic (sin React). El shell del navegador vive
en `src/ui/index.html`, compone los componentes desde `src/ui/browser/entry.ts`
y se sirve con un dev server propio que resuelve el bundle ESM en memoria con
`Bun.build`, por lo que no requiere paso de compilacion ni pipeline de Vite.

```bash
bun run ui:dev
```

Salidas del proceso:

```txt
UI shell on http://127.0.0.1:3001
Proxying /v1/* -> http://127.0.0.1:3000
```

Abre `http://127.0.0.1:3001` en el navegador. El dev server:

- Sirve `src/ui/index.html` en `/` (y `/index.html`).
- Sirve el bundle del navegador en `/entry.js` (Tailwind se carga por CDN en el HTML).
- Hace proxy de `/v1/*` hacia el backend (`UI_API_TARGET`, por defecto
  `http://127.0.0.1:3000`) para que UI y API compartan origen.
- Responde `404` para cualquier otra ruta.

Variables de entorno opcionales:

| Variable | Valor por defecto | Descripcion |
| --- | --- | --- |
| `UI_HOST` | `127.0.0.1` | Interfaz de escucha del dev server |
| `UI_PORT` | `3001` | Puerto del dev server |
| `UI_API_TARGET` | `http://127.0.0.1:3000` | Backend destino del proxy `/v1/*` |

Por defecto el shell usa un catalogo demo en memoria
(`src/ui/browser/demo-search-client.ts`), por lo que la UI funciona sola, sin
backend, LLM, Qdrant ni variables de entorno. Para usar el backend real, deja
`bun run dev` corriendo en `:3000` y apunta `UI_API_TARGET` a esa URL; para
inyectar otro cliente de busqueda, pasa `searchClient` a `mountApp`.

### Antes de abrir cambios

```bash
bun run spec:check
bun test
bun run check-types
bun run check
```

## API Endpoints

Contrato canonico en `specs/openapi.json`. Las rutas `GET /`, `/openapi.json`,
`/docs` y los probes de `/v1/health/*` son publicos.

### Sistema y salud

| Metodo | Ruta | Auth | Descripcion |
| --- | --- | --- | --- |
| GET | `/` | Publico | Redirige a `/docs` |
| GET | `/openapi.json` | Publico | Spec OpenAPI canonico |
| GET | `/docs` | Publico | Referencia interactiva (Scalar) |
| GET | `/v1/health/live` | Publico | Liveness probe |
| GET | `/v1/health/ready` | Publico | Readiness probe (incluye estado de integraciones) |
| GET | `/api/hello_api` | Publico | Conectividad basica |

### Catalogo de items

| Metodo | Ruta | Auth | Descripcion |
| --- | --- | --- | --- |
| POST | `/v1/items` | Service Token | Crea un item |
| GET | `/v1/items/{itemId}` | Service Token | Obtiene detalle de un item |

Requieren `Authorization: Bearer <SERVICE_TOKEN>` solo cuando `SERVICE_TOKEN`
esta configurado (ver seccion Configuracion).

### Comercio asistido por agentes (ACP x402)

Disponibles unicamente cuando las integraciones de agente estan habilitadas
(`/v1/agent/*` no se registran por defecto). Requieren token de agente.

| Metodo | Ruta | Auth | Descripcion |
| --- | --- | --- | --- |
| POST | `/v1/agent/search` | Agent Token (scope search) | Busqueda del agente |
| POST | `/v1/agent/catalog/search` | Agent Token (scope search) | Busqueda vectorial en el catalogo de comerciantes |
| POST | `/v1/agent/products/rank` | Agent Token (scope search) | Normaliza, deduplica y rankea ofertas, con handoff de persistencia |
| POST | `/v1/agent/checkout` | Agent Token (scope checkout) + `X-402-Payment-Token` | Inicia checkout ACP x402 |

### Stellar Payment Intents

Requieren `PAYMENTS_ENABLED=true`, `SERVICE_TOKEN` no vacio y
`Authorization: Bearer <SERVICE_TOKEN>` mas `X-Principal-Id`.

| Metodo | Ruta | Descripcion |
| --- | --- | --- |
| POST | `/v1/payment-intents` | Crea un payment intent (requiere `Idempotency-Key`) |
| GET | `/v1/payment-intents/{intentId}` | Consulta el estado de un payment intent |
| POST | `/v1/payment-intents/{intentId}/submission` | Envia la transaccion firmada (XDR) |

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

Si falta la credencial, la API responde `SVC-CORE-2001`; si el token es
incorrecto, responde `SVC-CORE-2002`. Ver un ejemplo de `.env` y `curl` en la
seccion [Ejecutar en localhost](#ejecutar-en-localhost).

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
capturar primero todos sus valores actuales. Consulta
`docs/adr/0001-bun-fastify-framework.md` antes de cambiar la configuración.
