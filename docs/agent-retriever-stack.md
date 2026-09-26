# Entorno de agente recuperador

Estado: recuperación e ingesta de catálogos implementadas como primera
vertical. El
despliegue de la API y el índice Qdrant están preparados, pero la ingesta en
producción depende de que el comercio publique UCP y de configurar embeddings.
La ejecución de trabajos todavía es en memoria del proceso; para producción se
debe sustituir por un worker durable.

## Decisiones de stack

- **Orquestación:** LangGraph.js para modelar recuperación, scraping, extracción,
  generación y reintentos como pasos con estado persistente. No añadir Google ADK
  en paralelo: ambos cubren orquestación. Para estado del Shopping Agent, las
  pautas obligatorias eligen MongoDB y su checkpointer de LangGraph; PostgreSQL
  queda para catálogo y registros transaccionales. Jev es un modelo para
  decisiones tipadas (por ejemplo, clasificar o enrutar), no un sustituto del
  LLM generativo ni del grafo. Dejarlo como posible adaptador futuro.
- **LLM:** usar `LLM_API_KEY` y configuración de proveedor/modelo/base URL. El
  adaptador `@langchain/openai` puede atender endpoints compatibles con la API
  OpenAI; otros proveedores que no sean compatibles requerirán su adaptador.
  Esta variable genérica no implica que todas las APIs compartan protocolo.
- **Scraping:** ScrapeGraphAI gestionado con el SDK TypeScript y una credencial
  independiente (`SGAI_API_KEY`). El servicio gestionado proporciona renderizado
  JS y extracción. Puppeteer no se añade: en este modo duplicaría capacidades.
  La edición open source de ScrapeGraphAI es Python y usa Playwright; considerar
  ese modo solo si se decide autohospedar el scraper y aceptar mantener un
  segundo runtime.
- **Preprocesamiento y recuperación:** LlamaIndex.TS para documentos,
  transformaciones y segmentación; Qdrant como almacenamiento vectorial. Diseñar
  puntos con metadatos de origen, URL canónica, fecha, tenant y documento para
  poder filtrar y reconstruir citas. Evaluar recuperación híbrida semántica y
  léxica con datos reales antes de fijarla como requisito.
- **Datos:** MongoDB para checkpoint/estado del agente; PostgreSQL para catálogo
  transaccional y órdenes; Qdrant solo para índice vectorial de descubrimiento.
  Los trabajos de ingesta son asíncronos y deben tener persistencia e
  idempotencia, separadas del checkpoint conversacional.
- **Despliegue:** Fastify/API se despliega en Render; ejecutar scraping/ingesta
  en un worker Docker separado. La API debe aceptar trabajos y devolver su
  estado; no mantener una petición HTTP abierta hasta que termine el scraping.

## Dependencias añadidas

La instalación de paquetes prepara el entorno, pero no activa integraciones ni
cambia el comportamiento de la API:

- LangGraph.js y su checkpointer PostgreSQL actual: `@langchain/langgraph`,
  `@langchain/langgraph-checkpoint-postgres`. El checkpointer PostgreSQL está
  instalado, pero el diseño de compra por agentes requiere evaluar y añadir
  `@langchain/langgraph-checkpoint-mongodb` y `mongodb`; no intercambiar stores
  sin una decisión explícita.
- Cliente LLM: `@langchain/openai`.
- Ingesta y vector store: `llamaindex`, `@qdrant/js-client-rest`.
- Scraping gestionado: `scrapegraph-js`.
- x402: `@x402/core`, `@x402/fastify`, `@x402/fetch`, `@x402/stellar` y
  `@x402/evm`.
- Persistencia relacional: `pg`.
- Cliente de Stripe: `stripe`.

La versión resuelta se registra en `bun.lock`; revisar compatibilidad Bun/Node y
actualizar dependencias de forma controlada antes de habilitar cada integración.

## Pagos: límites de compatibilidad

x402 define el intercambio HTTP de requisitos y prueba de pago. **Stripe x402
no es Stripe sobre Stellar.** Según la información pública de Stripe revisada
el 22-09-2026, Stripe empieza su soporte x402 con USDC en Base. Stellar utiliza
el adaptador y facilitador `@x402/stellar`, como una vía de pago separada.
Permitir ambas redes en el servicio significa anunciar y validar requisitos
separados; no significa que Stripe liquide transacciones Stellar.

Para Stellar, empezar con esquema `exact` en testnet y usar el SDK/facilitador
existentes. No implementar un esquema de liquidación propio. La documentación
del binding revisada indica `exact`; el esquema variable `upto` no debe asumirse
disponible en Stellar hasta que el soporte se publique y se verifique. Para
Stripe/Base, seguir la integración x402 de Stripe y sus requisitos de cuenta,
facilitador y settlement; no tratar el paquete `stripe` como middleware x402.

Los dos sentidos del pago son distintos y deberán construirse por separado:

- **El agente paga fuentes externas:** cliente x402 configurado solo para redes,
  activos y destinatarios permitidos, con presupuesto máximo por ejecución.
- **El servicio cobra al consumidor:** middleware x402 en rutas escogidas, con
  precio fijo y receptor configurado. Stellar y Base se anuncian por separado.

No cargar secretos de producción por defecto. Los pagos mainnet requieren una
decisión operativa explícita, límites de gasto, control de claves fuera del
proceso web y pruebas de settlement satisfactorias en testnet.

## UCP y comercio asistido

El diseño de compra por agentes, que sigue obligatoriamente
`pautas de diseño.md`, está en `docs/agentic-commerce-design.md`. El adaptador
Bazaar/x402 de HeinrichsTech está activo para descubrimiento de servicios; el
adaptador UCP queda como opción para comercios que publiquen el perfil y sus
capacidades. UCP/Shopify Global Catalog puede cubrir descubrimiento y checkout;
x402 cubre pago HTTP por recurso y no sustituye carrito, orden, devolución o
fulfillment. No implementar pagos reales hasta cerrar merchant, moneda,
settlement y políticas de autorización.

## Configuración

La configuración de recuperación de catálogo y Qdrant está tipada en `src/config/env.ts`:

| Variable | Uso |
| --- | --- |
| `LLM_API_KEY` | Credencial del proveedor LLM seleccionado |
| `LLM_PROVIDER` | Identificador del adaptador a usar |
| `LLM_MODEL` | Modelo de generación |
| `LLM_API_BASE_URL` | URL para proveedores compatibles, opcional |
| `SGAI_API_KEY` | Acceso a ScrapeGraphAI gestionado |
| `MONGODB_URI` | Checkpoints y estado durable del Shopping Agent |
| `DATABASE_URL` | PostgreSQL para catálogo/órdenes y datos transaccionales |
| `QDRANT_URL` / `QDRANT_API_KEY` | Qdrant local o gestionado |
| `QDRANT_COLLECTION` | Colección derivada para ofertas UCP |
| `CATALOG_ADAPTER` | `bazaar` para catálogos x402 o `ucp` para comercios UCP |
| `CATALOG_MERCHANT_URL` / `CATALOG_SOURCE_URL` | Origen y documento de catálogo |
| `CATALOG_MERCHANT_ID` / `CATALOG_QUERY` | Identidad y consulta de ingesta |
| `UCP_AGENT_PROFILE_URL` | URL `/.well-known/ucp` del agente, solo para el adaptador UCP |
| `EMBEDDINGS_API_KEY` / `EMBEDDINGS_MODEL` | Credencial y modelo del proveedor de embeddings compatible |
| `EMBEDDINGS_API_BASE_URL` | Base URL opcional del proveedor compatible |
| `X402_NETWORK` | Red de prueba habilitada, por defecto testnet |
| `X402_FACILITATOR_URL` | Facilitador de la red elegida |

Las claves de pagador, facilitador, receptor y Stripe requieren nombres y
custodia acordes al flujo que se implemente; no reutilizar `LLM_API_KEY` para
ninguno de esos secretos.

## Implementado en la primera vertical de catálogo

- `UcpCatalogClient` es un adaptador opcional: descubre `/.well-known/ucp`, valida
  el servicio REST y consulta `/catalog/search` con `UCP-Agent` y `Request-Id`.
- `BazaarCatalogClient` es el adaptador activo para HeinrichsTech: consume
  `/bazaar.json`, normaliza PageDelta y conserva sus rails x402 `accepts[]`.
- `CatalogIngestionService` transforma ofertas UCP, obtiene embeddings mediante
  un proveedor OpenAI-compatible y
  crea o actualiza una colección Qdrant. `bun run catalog:ingest` ejecuta una
  ingesta explícita; las rutas autenticadas de ingesta devuelven un trabajo y
  su estado.
- `AgentSearchService` usa Qdrant cuando hay índice y cae al catálogo configurado
  en vivo cuando el índice está vacío o falla. Los adaptadores dependen de
  puertos y no de Qdrant ni del proveedor de embeddings directamente.
- La API publica `/.well-known/ucp` para que el comercio pueda identificar al
  agente (con `/ucp/agent-profile.json` como alias de compatibilidad). Las rutas
  de ingesta requieren `SERVICE_TOKEN`.

El comercio activo es HeinrichsTech (`https://app.heinrichstech.com`): publica
un catálogo Bazaar/x402 con PageDelta y no un perfil UCP. El adaptador UCP queda
disponible para otro comercio cuando publique su perfil. Tampoco se debe poner
una credencial en Git; `EMBEDDINGS_API_KEY` se configura únicamente en el
entorno de ejecución.

## Pendientes de implementación

- Persistir los trabajos de ingesta fuera del proceso web, con idempotencia,
  reintentos limitados y política de retención.
- Validar la dimensión de una colección Qdrant ya existente antes de hacer
  `upsert`, y añadir citas/procedencia completas al resultado de búsqueda.
- Crear worker Docker, health checks y servicios locales MongoDB,
  PostgreSQL/Qdrant; no asumir que el filesystem del contenedor Render sirve
  para persistencia durable.
- Implementar extracción mediante ScrapeGraphAI, límites de páginas/coste,
  canonicalización, deduplicación y procedencia de cada fragmento.
- Proteger el scraping frente a SSRF: bloquear loopback, redes privadas y
  direcciones link-local, validar DNS/redirecciones, limitar tamaño/tiempo y
  permitir cancelar trabajos. Respetar términos, robots y restricciones de los
  sitios objetivo.
- Añadir x402 de entrada/salida separadamente, empezar con pagos simulados y
  Stellar testnet, y probar firma, importe, red, replay, límites y fallos de
  facilitador antes de considerar mainnet.
- Añadir pruebas de recuperación/citas, seguridad, reintentos, duplicados y
  fallos de cada dependencia; actualizar OpenAPI, documentación y variables de
  entorno cuando la lógica exista.

## Referencias

- [LangGraph: persistencia](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LlamaIndex.TS: ejemplo con Qdrant](https://github.com/run-llama/ts-agents)
- [Qdrant: cliente TypeScript](https://qdrant.tech/documentation/interfaces/)
- [ScrapeGraphAI: SDK TypeScript y modos de operación](https://github.com/ScrapeGraphAI/scrapegraph-js)
- [x402: SDKs y flujo HTTP](https://github.com/x402-foundation/x402)
- [Stellar: x402 y ejemplos](https://github.com/stellar/x402-stellar)
- [Estado del esquema `upto` en Stellar](https://github.com/stellar/x402-stellar/issues/71)
- [Stripe: soporte x402 inicial en Base](https://stripe.com/blog/10-lessons)
- [UCP: conceptos y protocolo de checkout](https://github.com/Universal-Commerce-Protocol/ucp/blob/main/docs/documentation/core-concepts.md)
- [UCP: REST binding de catálogo](https://ucp.dev/specification/shopping/catalog/rest/)
