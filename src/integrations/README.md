# integrations

Adaptadores de infraestructura reemplazables por implementaciones reales.

Capas disponibles por defecto:

- `database.ts`: placeholder local y punto de conexion para Postgres via Prisma.
- `bucket.ts`: placeholder local y punto de conexion para S3/GCS/MinIO u otro
  bucket.
- `cache.ts`: placeholder local y punto de conexion para Redis.

Los placeholders no abren conexiones externas. Estas capas son opcionales: si
`DATABASE_ENABLED`, `BUCKET_ENABLED` o `CACHE_ENABLED` estan en `false`, la capa
se reporta como `disabled` y no cuenta para readiness. Al activar un proveedor
real, usa Prisma Client para TypeScript/Postgres, inyectalo desde
`src/http/server.ts` o desde el composition root del servicio y conserva
credenciales en settings/entorno.

`integrations/agents/` contiene el adaptador MongoDB del checkpointer LangGraph.
El composition root controla conexión, setup y cierre; no se conecta por efecto
lateral al importar módulos.
