# src

Codigo fuente del servicio. La entrada del proceso vive en `index.ts`; `http/server.ts` crea la app testeable.

- `config/`: carga y validacion tipada de entorno/TOML.
- `domain/`: schemas, tipos y errores sin dependencia de Fastify.
- `http/`: servidor, rutas, hooks y serializacion de errores.
- `integrations/`: adaptadores reemplazables para recursos externos.
- `services/`: casos de uso desacoplados del transporte HTTP.
- `index.ts`: entrada del proceso. Construye la app, exporta la instancia como
  `export default` (requerido por la Function de Vercel) y solo llama a
  `app.listen` fuera de Vercel.
