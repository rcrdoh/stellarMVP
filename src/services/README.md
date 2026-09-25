# services

Casos de uso. Orquestan dominio e integraciones sin acoplarse al transporte HTTP.

Los servicios dependen de interfaces, no de adaptadores concretos. Eso mantiene la regla de inversion de dependencias y permite reemplazar memoria por DB, cola o API externa sin tocar el caso de uso.

`services/agents/` contiene la clase base LangGraph y las especializaciones
Shopping/Search. Shopping recibe checkpointer, provider de decisión, modelo,
puerto de búsqueda y cotizador. Usa Jev para habilitar rutas y el modelo solo
puede ejecutar la herramienta de búsqueda. `start` inicia/continúa el flujo y
`resume` responde a las pausas de selección/aprobación con el mismo `threadId`.
La aprobación no ejecuta checkout ni pago. Search sigue siendo un esqueleto.
