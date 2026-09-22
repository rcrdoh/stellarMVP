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

El servicio queda publicado en `http://127.0.0.1:8010`.

## Ejecutar

```bash
docker run --rm -p 8010:3000 stellarmvp
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

Puedes sobrescribir cualquier valor con `-e`.

## Apagar Compose

```bash
docker compose down
```
