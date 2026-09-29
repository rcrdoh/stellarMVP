# Docker

Este proyecto es independiente. Todos los comandos se ejecutan desde la carpeta del servicio.

Hay dos imagenes:

- `Dockerfile`: la API Fastify (proceso `src/index.ts`).
- `Dockerfile.web`: el frontend React ACP x402 (SPA + proxy `/v1/*`), pensado
  para Render.

## Construir (API)

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

El servicio queda publicado en `http://127.0.0.1:8010`. Postgres se publica en
`127.0.0.1:5432` (usuario `stellar`, base `stellarmvp`).

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
- `HOST=0.0.0.0`
- `PORT=3000`
- `CONFIG_FILE=config/settings.toml`
- `DATABASE_URL` (requerido para el estado de ordenes; en Compose apunta a
  `postgres://stellar:password@postgres:5432/stellarmvp`)

Puedes sobrescribir cualquier valor con `-e`.

## Apagar Compose

```bash
docker compose down
```

## Frontend React ACP x402 (`Dockerfile.web`)

Sirve el SPA (`/`, `/main.js`, `/styles.css`) y hace proxy de `/v1/*` hacia el
backend indicado en `UI_API_TARGET`. Escucha en `0.0.0.0:$PORT` (por defecto
`3000`).

```bash
docker build -f Dockerfile.web -t stellarmvp-web .
docker run --rm -p 8010:3000 \
  -e UI_API_TARGET=http://host.docker.internal:8010 \
  -e REACT_MOCK_MODE=0 \
  stellarmvp-web
```

Variables relevantes:

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
```
