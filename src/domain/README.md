# domain

Schemas, tipos y errores del dominio. No debe importar Fastify ni clientes externos.

`payments.ts` define cotizaciones aprobadas, intents, partidas de pago y
conversiones exactas entre stroops y decimales Stellar. Los importes del flujo
se guardan como cadenas enteras, sin `number` de punto flotante.
