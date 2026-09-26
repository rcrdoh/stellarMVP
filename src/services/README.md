# services

Casos de uso. Orquestan dominio e integraciones sin acoplarse al transporte HTTP.

Los servicios dependen de interfaces, no de adaptadores concretos. Eso mantiene la regla de inversion de dependencias y permite reemplazar memoria por DB, cola o API externa sin tocar el caso de uso.

`services/agents/` contiene la clase base LangGraph y las especializaciones
Shopping/Search. Shopping recibe checkpointer, provider de decisión, modelo,
puerto de búsqueda y cotizador. Usa Jev para habilitar rutas y el modelo solo
puede ejecutar la herramienta de búsqueda. `start` inicia/continúa el flujo y
`resume` responde a las pausas de selección/aprobación con el mismo `threadId`.
La aprobación no ejecuta checkout ni pago. `agent-search.ts` soporta Qdrant con
fallback al catálogo configurado.

Casos de uso de agent commerce:

- `agent-auth.ts`: verifica scopes por token (hash SHA-256 en Redis) y controla
  la velocidad de gasto diaria (`max_daily_spend`). Emite `SVC-CORE-4001` para
  scope insuficiente y `SVC-CORE-5003` al exceder el limite.
- `agent-search.ts`: busqueda vectorial desacoplada de Fastify.
- `agent-checkout.ts`: orquesta scope, challenge `X-402-Payment-Token`,
  velocidad de gasto, liquidacion on-chain, persistencia de orden y marcado de
  item `purchased` solo tras settlement exitoso. Un pago fallido devuelve
  `SVC-PAYMENT-4022`.
