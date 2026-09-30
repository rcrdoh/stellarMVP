# Docker

Este proyecto es independiente. Todos los comandos se ejecutan desde la carpeta del servicio.

Hay una sola imagen, `Dockerfile`: la API Fastify **y** el frontend React ACP
x402 (SPA + proxy `/v1/*`) dentro del mismo contenedor. Compila `src/` a `dist/`
con `bun run build` y arranca con `bun run start:all`
(`scripts/start-all.ts`), que levanta ambos procesos:

- API interna en `API_HOST`/`API_PORT` (por defecto `127.0.0.1:3000`), no
  publica.
- Frontend publico en `HOST`/`PORT` (Render inyecta `PORT`), con proxy de
  `/v1/*` hacia la API via `UI_API_TARGET`.

Asi un unico servicio sirve la pagina y la API bajo el mismo origen.

## Construir

```bash
docker build -t stellarmvp .
```

## Levantar con Compose

```bash
docker compose up --build -d
```

Levanta dos servicios:

- `postgres`: Postgres 15 (imagen `postgres:15-alpine`) para el estado
  transaccional de ordenes (`orders`). Datos persistidos en el volumen
  `postgres-data`.
- `stellarmvp`: la API, conectada a Postgres via `DATABASE_URL`.

El servicio queda publicado en `http://127.0.0.1:8010` y sirve tanto la SPA como
`/v1/*`. Postgres se publica en `127.0.0.1:5432` (usuario `stellar`, base
`stellarmvp`).

`stellarmvp` espera a que `postgres` pase el healthcheck (`pg_isready`).

## Ejecutar

```bash
docker run --rm -p 8010:3000 \
  -e DATABASE_URL=postgres://stellar:password@host:5432/stellarmvp \
  stellarmvp
```

## Probar

```bash
curl -fsS http://127.0.0.1:8010/v1/health/live
curl -fsS http://127.0.0.1:8010/openapi.json
```

## Configuracion

El contenedor usa:

- `APP_ENV=prod`
- `HOST=0.0.0.0` (frontend publico)
- `PORT=3000` (frontend publico; Render lo inyecta)
- `API_HOST=127.0.0.1`, `API_PORT=3000` (API interna)
- `UI_API_TARGET=http://127.0.0.1:3000` (destino del proxy `/v1/*`)
- `CONFIG_FILE=config/settings.toml`
- `DATABASE_URL` (requerido para el estado de ordenes; en Compose apunta a
  `postgres://stellar:password@postgres:5432/stellarmvp`)

Puedes sobrescribir cualquier valor con `-e`.

## Apagar Compose

```bash
docker compose down
```

## Frontend React ACP x402

El mismo contenedor sirve el SPA (`/`, `/main.js`, `/styles.css`) y hace proxy de
`/v1/*` hacia el backend indicado en `UI_API_TARGET`. El frontend escucha en
`0.0.0.0:$PORT` (por defecto `3000`); la API corre interna en
`127.0.0.1:$API_PORT`.

Variables relevantes del frontend:

- `UI_API_TARGET` (default `http://127.0.0.1:3000`): backend del proxy `/v1/*`.
- `REACT_MOCK_MODE` (`0` usa clientes HTTP reales).
- `REACT_AGENT_TOKEN`, `REACT_SERVICE_TOKEN`, `REACT_PRINCIPAL_ID`: auth del modo
  real; se sustituyen en el bundle en **build time**, por lo que cambiar cualquiera
  exige reconstruir la imagen.

Probar:

```bash
curl -fsS http://127.0.0.1:8010/
curl -fsS -o /dev/null -w "js:%{http_code}\n"  http://127.0.0.1:8010/main.js
curl -fsS -o /dev/null -w "css:%{http_code}\n" http://127.0.0.1:8010/styles.css
curl -fsS http://127.0.0.1:8010/v1/health/live
```

## Render Blueprint (`render.yaml`)

`render.yaml` describe **un unico servicio** Docker web que sirve la SPA y la API
desde el mismo contenedor, y se aplica con `render blueprint launch` (o Dashboard:
New > Blueprint):

| Servicio | Dockerfile | Health check | Rol |
| --- | --- | --- | --- |
| `stellarmvp` | `./Dockerfile` | `/` | SPA React + proxy `/v1/*` + API Fastify interna |

Render inyecta `PORT` para el servidor web publico; la API usa `API_PORT`
(por defecto `3000`, ligada a `127.0.0.1`), de modo que la pagina y la API
comparten origen y no hace falta configurar CORS ni copiar URLs entre servicios.
Las variables de secretos usan `sync: false` y se definen en el Dashboard;
`SERVICE_TOKEN` se genera con `generateValue: true`.

`PAYMENTS_ENABLED` y `AGENT_COMMERCE_ENABLED` quedan en `false` en el Blueprint.
Activar cualquiera exige aportar antes todas sus dependencias (Stellar, Qdrant,
claves de LLM, `DATABASE_URL`) o el arranque falla con `ZodError`.
