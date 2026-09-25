# Entorno de agente recuperador

Estado: la arquitectura de agente, ingesta y workers sigue propuesta. La primera
etapa del backend de pagos Stellar Testnet está implementada detrás de
`PAYMENTS_ENABLED=false`; checkout, el agente y los workers no están conectados.

## Decisiones de stack

- **Orquestación:** LangGraph.js para modelar recuperación, scraping, extracción,
  generación y reintentos como pasos con estado persistente. No añadir Google ADK
  en paralelo: ambos cubren orquestación. Para estado del Shopping Agent, el
  equipo eligió MongoDB y su checkpointer de LangGraph. Jev es un modelo para
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
- **Datos:** MongoDB para checkpoint/estado del agente y colecciones separadas
  de catálogo, órdenes y pagos; Qdrant solo para índice vectorial de
  descubrimiento. El servicio inicial de pagos usa MongoDB para cotizaciones
  aprobadas e intents idempotentes. El checkpointer, catálogo y órdenes aún no
  están integrados. Los trabajos de ingesta son asíncronos y deben tener
  persistencia e idempotencia, separadas del checkpoint conversacional.
- **Despliegue:** Fastify/API se despliega en Render; ejecutar scraping/ingesta
  en un worker Docker separado. La API debe aceptar trabajos y devolver su
  estado; no mantener una petición HTTP abierta hasta que termine el scraping.

## Dependencias añadidas

La instalación de paquetes prepara el entorno, pero no activa integraciones ni
cambia el comportamiento de la API:

- LangGraph.js y su checkpointer PostgreSQL actual: `@langchain/langgraph`,
  `@langchain/langgraph-checkpoint-postgres`. Está instalado, pero el diseño
  acordado requiere añadir `@langchain/langgraph-checkpoint-mongodb` y
  `mongodb`, tras una prueba de compatibilidad con Bun.
- Cliente LLM: `@langchain/openai`.
- Ingesta y vector store: `llamaindex`, `@qdrant/js-client-rest`.
- Scraping gestionado: `scrapegraph-js`.
- x402: `@x402/core`, `@x402/fastify`, `@x402/fetch`, `@x402/stellar` y
  `@x402/evm`.
- Pagos Stellar: `mongodb` está conectado al backend de intents. El SDK Stellar
  existente construye y concilia pagos clásicos en Testnet; no representa una
  integración activa de x402 ni de Soroban.
- Persistencia PostgreSQL heredada: `pg` (no activa en este diseño).
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

El diseño de compra por agentes está en `docs/agentic-commerce-design.md` y el
plan de pago en `docs/stellar-payments-plan.md`. UCP/Shopify
Global Catalog es candidato para descubrimiento de productos y checkout; x402
cubre pago HTTP por recurso y no sustituye carrito, orden, devolución o
fulfillment. El backend inicial de Stellar Testnet cuenta con rutas internas e
intents idempotentes en MongoDB; no hay endpoints de catálogo/checkout,
productor de cotizaciones ni integración end-to-end. No se ha realizado una
compra en Testnet ni está habilitado Mainnet.

## Configuración futura del agente

Estas variables corresponden al agente y sus integraciones pendientes; todavía
no están conectadas a la configuración tipada. Las variables del backend de
pagos se describen en `docs/stellar-payments-plan.md`.

| Variable | Uso |
| --- | --- |
| `LLM_API_KEY` | Credencial del proveedor LLM seleccionado |
| `LLM_PROVIDER` | Identificador del adaptador a usar |
| `LLM_MODEL` | Modelo de generación |
| `LLM_API_BASE_URL` | URL para proveedores compatibles, opcional |
| `SGAI_API_KEY` | Acceso a ScrapeGraphAI gestionado |
| `MONGODB_URI` | Pagos Testnet cuando están habilitados; checkpoints, catálogo y órdenes siguen pendientes |
| `QDRANT_URL` / `QDRANT_API_KEY` | Qdrant local o gestionado |
| `X402_NETWORK` | Red de prueba habilitada, por defecto testnet |
| `X402_FACILITATOR_URL` | Facilitador de la red elegida |

Las claves de pagador, facilitador, receptor y Stripe requieren nombres y
custodia acordes al flujo que se implemente; no reutilizar `LLM_API_KEY` para
ninguno de esos secretos.

## Pendientes de implementación

- Añadir adaptadores LLM y de embeddings; validar modelos/dimensiones de vectores
  con Qdrant y fijar estrategia de recuperación y citas.
- Crear contratos HTTP para crear una ingesta, consultar estado y hacer una
  pregunta; actualizar `specs/openapi.json` antes de exponer las rutas.
- Implementar persistencia de fuentes/documentos y ejecución durable con
  idempotencia, reintentos limitados y política de retención.
- Crear worker Docker, health checks y servicios locales MongoDB/Qdrant; no
  asumir que el filesystem del contenedor Render sirve
  para persistencia durable.
- Implementar extracción mediante ScrapeGraphAI, límites de páginas/coste,
  canonicalización, deduplicación y procedencia de cada fragmento.
- Proteger el scraping frente a SSRF: bloquear loopback, redes privadas y
  direcciones link-local, validar DNS/redirecciones, limitar tamaño/tiempo y
  permitir cancelar trabajos. Respetar términos, robots y restricciones de los
  sitios objetivo.
- Conectar el backend Stellar Testnet al checkout y al productor de cotizaciones;
  implementar el flujo de wallet en el frontend. Añadir x402 de entrada/salida
  por separado y no considerar Mainnet sin operación, autorización y pruebas de
  settlement aprobadas.
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
