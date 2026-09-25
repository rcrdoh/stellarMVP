# http

Servidor, rutas, hooks y serializacion de errores.

La ruta raiz `/` redirige a `/docs`; las rutas publicas y sus respuestas se
mantienen sincronizadas con `specs/openapi.json`.

Las rutas `/v1/payment-intents` son internas al BFF: requieren el token de
servicio configurado y el `x-principal-id` del usuario ya autenticado. La
feature se registra en Testnet solo cuando `PAYMENTS_ENABLED=true`.
