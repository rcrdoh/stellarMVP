# Entorno de agente recuperador

Estado: arquitectura propuesta y dependencias instaladas. La lógica de agente,
ingesta, pagos y workers todavía no está implementada.

## Decisiones de stack

- **Orquestación:** LangGraph.js para modelar recuperación, scraping, extracción,
  generación y reintentos como pasos con estado persistente. No añadir Google ADK
  en paralelo: ambos cubren orquestación; LangGraph se elige por su persistencia
  con Postgres y por encajar con el servicio TypeScript actual. Jev es un modelo
  para decisiones tipadas (por ejemplo, clasificar o enrutar), no un sustituto
  del LLM generativo ni del grafo. Dejarlo como posible adaptador futuro.
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
- **Estado durable:** PostgreSQL para checkpoints de LangGraph y registro/cola
  de trabajos; Qdrant no reemplaza la base relacional ni guarda el estado de
  ejecución del grafo.
- **Despliegue:** conservar Fastify/API en Vercel y ejecutar scraping/ingesta en
  un worker Docker separado. La API debe aceptar trabajos y devolver su estado;
  no mantener una petición HTTP abierta hasta que termine el scraping.

## Dependencias añadidas

La instalación de paquetes prepara el entorno, pero no activa integraciones ni
cambia el comportamiento de la API:

- LangGraph.js y su checkpointer PostgreSQL: `@langchain/langgraph`,
  `@langchain/langgraph-checkpoint-postgres`.
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

## UCP

UCP se mantiene como decisión de arquitectura/documentación, no como dependencia
ni endpoint inicial. UCP cubre descubrimiento de capacidades comerciales,
carrito, checkout, órdenes y handlers de pago; x402 cubre acceso/pago HTTP por
recurso. Implementar UCP cuando StellarMVP tenga un flujo real de compra de
productos o servicios con checkout. No usarlo solo para cobrar consultas RAG.

## Configuración prevista

Nombres sugeridos para documentar al implementar; todavía no están conectados a
la configuración tipada:

| Variable | Uso |
| --- | --- |
| `LLM_API_KEY` | Credencial del proveedor LLM seleccionado |
| `LLM_PROVIDER` | Identificador del adaptador a usar |
| `LLM_MODEL` | Modelo de generación |
| `LLM_API_BASE_URL` | URL para proveedores compatibles, opcional |
| `SGAI_API_KEY` | Acceso a ScrapeGraphAI gestionado |
| `DATABASE_URL` | PostgreSQL, checkpoints y trabajos |
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
- Crear worker Docker, health checks y servicios locales PostgreSQL/Qdrant; no
  asumir que la memoria local de Vercel sirve para persistencia.
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
