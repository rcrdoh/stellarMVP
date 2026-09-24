# contract

Pruebas que verifican que la implementacion cumple `specs/openapi.json`.

Incluye `vercel-entrypoint.test.ts`, que importa `src/index.ts` con `VERCEL=1`
para comprobar que el entrypoint exporta una instancia Fastify como handler por
defecto y enruta sin abrir puerto, evitando la regresion del `404` en Vercel.

