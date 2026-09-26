# Agent services

`Agent` envuelve un grafo LangGraph compilado. `ShoppingAgent` recibe un
checkpointer y sus métodos `start`/`resume` requieren el mismo `threadId` para
continuar la sesión. Jev clasifica la ruta; el grafo pide aclaración si la
señal falla, es ambigua, tiene confianza menor a 0.85, carece de evidencia o
requiere escalación. Solo la ruta RAG habilita el ReAct de Groq con una única
herramienta permitida: `search_merchants`, inyectada mediante el puerto
`MerchantSearchAgent`.

Cuando hay ofertas, el grafo pausa para selección, obtiene una cotización del
puerto `ShoppingQuoteProvider` y pausa otra vez para aprobación ligada al hash
estable de la cotización. La aprobación solo marca el estado como autorizado;
no crea checkout, orden ni pago. La selección se liga al `offerId` y las
cotizaciones se validan contra la oferta seleccionada, moneda, importe y
expiración.

El agente normaliza el mensaje actual como consulta básica. La extracción
completa de filtros, la implementación del Search Agent y proveedores reales de
cotización siguen siendo responsabilidades pendientes de otros servicios.
La búsqueda vectorial está implementada en `agent-search.ts`; usa el índice
Qdrant y puede caer al adaptador de catálogo configurado en vivo.

`stableHash` liga la aprobación al snapshot. El límite de iteraciones de
LangGraph restringe el ciclo ReAct. Falta conectar `BudgetTracker` a métricas
por llamada/token y un almacén de aprobaciones de un solo uso si se habilita
checkout más adelante.
