# integrations

Adaptadores de infraestructura reemplazables por implementaciones reales.

Capas disponibles por defecto:

- `database.ts`: placeholder local de disponibilidad, sin conexión real.
- `bucket.ts`: placeholder local y punto de conexion para S3/GCS/MinIO u otro
  bucket.
- `cache.ts`: placeholder local y punto de conexion para Redis.

Los placeholders no abren conexiones externas. Estas capas son opcionales: si
`DATABASE_ENABLED`, `BUCKET_ENABLED` o `CACHE_ENABLED` estan en `false`, la capa
se reporta como `disabled` y no cuenta para readiness. Al activar un proveedor
real, inyéctalo desde `src/http/server.ts` o desde el composition root del
servicio y conserva credenciales en el entorno.

Para comercio asistido, el diseño acordado usa MongoDB en un adaptador nuevo;
`mongodb/payment-store.ts` persiste las cotizaciones aprobadas existentes e
intents de pago cuando `PAYMENTS_ENABLED=true`. `stellar/stellar-payment-gateway.ts`
construye, verifica, envía y consulta pagos clásicos en Testnet. La conexión
Mongo y los índices se inicializan desde `src/http/server.ts`; el placeholder
`database.ts` sigue separado. Consulta `docs/stellar-payments-plan.md`.
