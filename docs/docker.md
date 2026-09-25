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
