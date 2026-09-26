# Docker

Este proyecto es independiente. Todos los comandos se ejecutan desde la carpeta del servicio.

## Construir

```bash
docker build -t stellarmvp .
```

## Levantar con Compose

```bash
docker compose up --build -d
```

Levanta cuatro servicios:

- `postgres`: Postgres 15 (`postgres:15-alpine`) para el estado transaccional.
- `redis`: Redis 7 (`redis:7-alpine`) para cache y rate limiting.
- `mongodb`: MongoDB 7 (`mongo:7-jammy`) para checkpoints del agente.
- `stellarmvp`: la API, conectada a las dependencias por la red de Compose.

Los contenedores reciben nombres y labels del entorno local: `stellarmvp-postgres-local`,
`stellarmvp-redis-local`, `stellarmvp-mongodb-local` y `stellarmvp-api-local`.
Puedes cambiar las imágenes o esos nombres mediante las variables `*_IMAGE`,
`*_CONTAINER_NAME` y `APP_CONTAINER_NAME` del `.env`.

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

Cuando ejecutas Bun directamente en el host (`bun run dev`), usa las URLs
publicadas por Docker en `127.0.0.1`: Postgres `5432`, Redis `6379` y MongoDB
`27017`. No uses los nombres internos `postgres`, `redis` o `mongodb` desde el
host; esos nombres solo resuelven dentro de la red de Compose.

Puedes sobrescribir cualquier valor con `-e`.

## Apagar Compose

```bash
docker compose down
```
