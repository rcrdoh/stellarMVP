# config

Configuracion versionable del servicio.

`settings.toml` contiene defaults por entorno que pueden vivir en git. Los secretos deben ir por variables de entorno o `.env`, no en TOML.

Ambientes soportados:

- `dev`
- `staging`
- `prod`

El ambiente se selecciona con `APP_ENV`. El loader aplica primero `[app]` y
luego `[profiles.<APP_ENV>.app]` cuando existe.

Precedencia:

1. Defaults del codigo.
2. `[app]` en `config/settings.toml` o la ruta indicada por `CONFIG_FILE`.
3. `[profiles.<APP_ENV>.app]` en el mismo TOML.
4. Variables de entorno cargadas por Bun, incluyendo `.env`.

Las integraciones externas son opt-in. Mantener `DATABASE_ENABLED`,
`BUCKET_ENABLED` o `CACHE_ENABLED` en `false` significa que esa capa no se
conecta ni cuenta para readiness.
