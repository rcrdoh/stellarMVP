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
  react-app/    Frontend React 19 + Tailwind v4 (ACP x402, sin Vite)
  index.ts      Entrada del proceso
config/         TOML versionable con perfiles dev, staging y prod
docs/           SDD, errores, SOLID, Docker y ADR
specs/          OpenAPI canonico y reglas de contrato
supabase/       Migraciones SQL (esquema de comercio y RLS por agente)
scripts/        Automatizacion SDD local
tests/          Pruebas de contrato y servicios
AGENTS.md       Reglas estrictas para agentes de codigo
Dockerfile      Imagen de produccion de la API
Dockerfile.web  Imagen de produccion del frontend React (Render)
docker-compose.yml Orquestacion local de contenedor
render.yaml     Blueprint de Render (API + frontend)
```

## Comandos

```bash
bun install
bun run dev
bun run ui:dev
bun run react:dev
bun run start:web
bun run build
bun run spec:check
bun test
bun run check
bun run check-types
```

`bun run build` emite a `dist/` via `tsconfig.build.json`. El runtime local sigue siendo Bun sobre `src/` (`dev` / `start`). `bun run ui:dev` sirve la UI del navegador legacy (ver [Frontend shell en el navegador](#frontend-shell-en-el-navegador)); `bun run react:dev` sirve el frontend React ACP x402 (ver [Frontend React ACP x402](#frontend-react-acp-x402)); `bun run start:web` sirve ese mismo frontend en modo produccion (`NODE_ENV=production`, bundle minificado, bind a `HOST`/`PORT`) para el despliegue en [Render](#render).

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

### Frontend React ACP x402

El frontend nuevo vive en `src/react-app` (React 19 + Tailwind v4, sin Vite ni
bundler externo) y se sirve con un dev server propio sobre `Bun.build` +
`bun-plugin-tailwind`. Ademas del SPA sirve `/main.js` y `/styles.css`, y hace
proxy de `/v1/*` hacia el backend para que pagina y API compartan origen.

```bash
bun install
bun run react:dev
```

Abre `http://127.0.0.1:5173`. El comando imprime la URL y el backend destino:

```txt
React ACP frontend on http://127.0.0.1:5173
Proxying /v1/* -> http://127.0.0.1:3000
```

Variables de entorno del dev server:

| Variable | Valor por defecto | Descripcion |
| --- | --- | --- |
| `REACT_UI_PORT` | `5173` | Puerto del dev server |
| `REACT_UI_HOST` | `127.0.0.1` | Interfaz de escucha |
| `UI_API_TARGET` | `http://127.0.0.1:3000` | Backend destino del proxy `/v1/*` |
| `REACT_MOCK_MODE` | `1` (mock) | Con `0` usa los clientes HTTP reales |
| `REACT_AGENT_TOKEN` | vacio | Token de agente para el modo real |
| `REACT_SERVICE_TOKEN` | vacio | Service token para el modo real |
| `REACT_PRINCIPAL_ID` | vacio | `X-Principal-Id` para el modo real |

Por defecto el frontend arranca en **modo mock** (blocker B1 en
`docs/react-app-recon.md`: el backend aun no expone un endpoint de quote), asi
que renderiza catalogo, carrito y checkout con datos simulados y funciona sin
backend. Para ejercitar el contrato real, arranca el backend y desactiva el modo
mock:

```bash
bun run dev                       # backend en 127.0.0.1:3000
REACT_MOCK_MODE=0 bun run react:dev
```

Los valores `REACT_*` se sustituyen en el bundle en **build time**, por lo que un
cambio exige reiniciar `react:dev`. En modo real las llamadas a `/v1/*` pasan por
el proxy y heredan los requisitos de auth del backend (service token, agente,
pagos).

Verificacion rapida:

```bash
curl -s -o /dev/null -w "index:%{http_code}\n" http://127.0.0.1:5173/
curl -s -o /dev/null -w "js:%{http_code}\n"    http://127.0.0.1:5173/main.js
curl -s -o /dev/null -w "css:%{http_code}\n"   http://127.0.0.1:5173/styles.css
```

Cierra el dev server con `Ctrl+C`; no dejes el proceso corriendo al terminar.

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
- Diseno del frontend y su estado actual: `DESIGN.md`.
- Auditoria del frontend y flujo UI/UX: `audits/2026-09-29-frontend-ui-ux-audit.md`.

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

API (raiz `Dockerfile`):

```bash
docker compose up --build -d
```

Frontend React (raiz `Dockerfile.web`, ver [Render](#render)):

```bash
docker build -f Dockerfile.web -t stellarmvp-web .
docker run --rm -p 8010:3000 -e UI_API_TARGET=http://127.0.0.1:3000 stellarmvp-web
```

## Render

El despliegue activo usa Render. La API y el frontend React ACP x402 se
despliegan como **dos servicios web Docker** del mismo repositorio; el frontend
hace de proxy de `/v1/*` hacia la API, de modo que el navegador trabaja con un
solo origen.

Ambos servicios se describen en `render.yaml` (Blueprint), de modo que se
crean juntos desde el mismo repositorio con las mismas instrucciones:

```bash
# En el Dashboard: New > Blueprint > selecciona rcrdoh/stellarMVP
# (o desde la CLI)
render blueprint launch
```

El Blueprint crea `stellarmvp-api` y `stellarmvp-web`, y enlaza el proxy del
frontend a la API con `UI_API_TARGET` = `RENDER_EXTERNAL_URL` de la API
(`fromService`), por lo que no hay que copiar URLs a mano. Las variables
marcadas `sync: false` (tokens y claves) no se guardan en git: defínelas en el
Dashboard tras el primer deploy.

> Nota: si ya existe un servicio creado a mano en el Dashboard, no apliques el
> Blueprint encima sin capturar antes sus valores actuales.

### Servicio 1 — API (obligatorio)

- Tipo: **Web Service** → **Docker**.
- `Dockerfile Path`: `./Dockerfile`.
- El contenedor escucha en `0.0.0.0:3000` (variables `HOST`/`PORT` del
  Dockerfile). Render inyecta `PORT`; si lo cambias, sincroniza `PORT`, `EXPOSE`
  y el puerto del servicio.
- Health check path: `/v1/health/live`.
- Variables: las de la seccion
  [Ejecutar en localhost](#ejecutar-en-localhost) que necesites. Sin variables
  externas el servicio arranca con las capas opcionales deshabilitadas.
- Autoriza el acceso a la base de datos y a Redis (si aplica) desde la region de
  Render; en Postgres gestionado usa la `DATABASE_URL` con SSL.

### Servicio 2 — Frontend React ACP x402

- Tipo: **Web Service** → **Docker**.
- `Dockerfile Path`: `./Dockerfile.web`.
- El contenedor sirve el SPA (`/`, `/main.js`, `/styles.css`) y hace proxy de
  `/v1/*` al backend. Escucha en `0.0.0.0:$PORT` (Render lo inyecta).
- Variables:

| Variable | Valor | Descripcion |
| --- | --- | --- |
| `UI_API_TARGET` | URL publica de la API | Backend destino del proxy `/v1/*` |
| `REACT_MOCK_MODE` | `0` | Usa los clientes HTTP reales |
| `REACT_AGENT_TOKEN` | token de agente (si aplica) | Auth para `/v1/agent/*` |
| `REACT_SERVICE_TOKEN` | service token (si aplica) | Auth para `/v1/items` y pagos |
| `REACT_PRINCIPAL_ID` | id del principal (si aplica) | Cabecera `X-Principal-Id` |

Sin `UI_API_TARGET` el frontend cae a `http://127.0.0.1:3000`, que no existe en
Render: define siempre la URL publica de la API. Los `REACT_*` se sustituyen en
el bundle en **build time**, por lo que cambiarlos exige redeploy del servicio de
frontend.

Con `REACT_MOCK_MODE` sin definir (o distinto de `0`) el frontend arranca en modo
mock (blocker B1 en `docs/react-app-recon.md`) y funciona sin API.

### Verificacion

```bash
curl -fsS https://<api>.onrender.com/v1/health/live
curl -fsS -o /dev/null -w "index:%{http_code}\n" https://<web>.onrender.com/
curl -fsS -o /dev/null -w "js:%{http_code}\n"    https://<web>.onrender.com/main.js
curl -fsS -o /dev/null -w "css:%{http_code}\n"   https://<web>.onrender.com/styles.css
```

### Notas

La topologia declarativa (dos servicios, Dockerfiles, health checks y
variables) vive en `render.yaml`. No apliques un Blueprint parcial al servicio
existente sin capturar primero todos sus valores actuales. `vercel.json` se
elimino junto con la configuracion de Vercel; el guardado `VERCEL` en
`src/index.ts` se conserva solo por compatibilidad anterior, no como despliegue
activo. Consulta `docs/adr/0001-bun-fastify-framework.md` antes de cambiar la
configuracion.
