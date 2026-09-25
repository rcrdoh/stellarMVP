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

## Adaptadores de agent commerce

- `postgres.ts`: `pg.Pool` desde `DATABASE_URL` (requerido) y repositorio de la
  tabla `orders` para el estado transaccional de checkout/ordenes. El pool se
  cierra en el hook `onClose` del servidor.
- `redis.ts`: cliente Redis compartido para scopes de agente, velocidad de gasto
  y rate limiting.
- `stellar.ts`: `Horizon.Server.submitTransaction` con confirmacion on-chain;
  falla con `SVC-PAYMENT-4022` si `successful !== true` o hay timeout.
- `qdrant.ts` / `openai.ts`: llamadas salientes envueltas en circuit breakers
  (`circuit-breaker.ts`) que mapean a `SVC-CORE-5005` cuando el proveedor no
  responde.
- `agent-runtime.ts`: composicion del runtime del agente para el servidor HTTP.
