# Diseño: comercio asistido por agentes de IA

Estado: diseño en implementación incremental; el flujo interno inicial de
Shopping Agent y los payment intents Stellar Testnet ya están implementados
por capas. Este documento sigue como pauta
normativa `pautas de diseño.md`, que prevalece ante divergencias con otros
documentos. La ampliación pública de payment intents queda limitada a Testnet;
no habilita compras reales.

## Objetivo y límites

Permitir que una persona exprese una necesidad en lenguaje natural, compare
ofertas de varios comercios y llegue a una cotización verificable. El sistema
puede completar una compra solo después de una aprobación explícita en la
primera versión. El catálogo, el precio final, el stock, los permisos y el
estado de la orden los determina código de aplicación y el comercio, nunca el
LLM.

El producto se organiza en dos capas principales:

1. **Agente de Compras (Shopping Agent):** conversa con la persona, administra
   intención y estado durable, pide aclaraciones, presenta opciones y espera
   selección o aprobación.
2. **Descubrimiento de productos y precios (Search Agent):** consulta fuentes,
   normaliza, deduplica, revalida los candidatos y produce cotizaciones
   reproducibles.

El pago y la creación/fulfillment de la orden son capacidades deterministas
llamadas por el flujo de compra; no son decisiones delegadas al agente.

## Arquitectura

```mermaid
flowchart LR
  U[Persona] <--> SA[Shopping Agent\nLangGraph]
  SA --> SS[Servicio de búsqueda\nreglas deterministas]
  SS --> GC[Shopify Global Catalog\nUCP Catalog MCP]
  SS --> MC[APIs oficiales / MCP\npor comercio]
  SS --> PG[(PostgreSQL\ncatálogo y órdenes)]
  SS -. sólo descubrimiento .-> Q[(Qdrant\níndice opcional)]
  SA --> MG[(MongoDB\ncheckpoints LangGraph)]
  SA --> CO[Checkout / Order Service]
  CO --> PAY[Payment Provider port]
  PAY --> STR[Stripe / PSP]
  PAY --> ST[Stellar x402]
  CO --> WI[Wallet Payment Intent]
  WI --> H[Horizon Testnet]
  WI --> PG
  CO --> F[Fulfillment adapter]
  ING[Worker de ingesta] --> PG
  ING --> Q
  ING --> SCR[ScrapeGraph\nfuentes permitidas]
```

Las flechas representan dependencias lógicas; no implican que todos los
proveedores estén habilitados en el MVP. Los contratos internos aíslan
proveedores de las capas de servicio.

### Capa 1: Shopping Agent

- LangGraph.js modela pasos, reanudación, estado y pausas para selección o
  aprobación humana.
- `ShoppingState` conserva `sessionId`, estado, intención normalizada,
  candidatos mostrados, selección, cotización pendiente y referencias a
  checkout/orden. No conserva secretos de pago ni datos de tarjeta.
- El estado durable del grafo y la conversación se guardan con el checkpointer
  MongoDB de LangGraph. El adaptador está instalado, pero su conexión y ciclo de
  vida todavía no están cableados al servidor.
- Jev produce señales estructuradas de dominio/ruta/riesgo. Con confianza
  inferior a 0.85, ruta no permitida, evidencia insuficiente, escalación o fallo
  del proveedor, el grafo pide aclaración y no busca.
- Para una ruta RAG aceptada, el ciclo ReAct de Groq solo conoce la herramienta
  `search_merchants`, detrás del puerto `MerchantSearchAgent`. No se permite al
  modelo invocar otro agente o herramienta.
- La intención implementada usa el mensaje actual como consulta básica; la
  extracción conversacional completa de filtros aún falta.
- Nodos deterministas: validar el DTO, aplicar límites, buscar, filtrar ofertas,
  sumar importes, crear la cotización, comprobar aprobación y avanzar estados.
- El modelo no puede inventar atributos ausentes, alterar una cotización,
  escoger un método de pago no permitido, autorizar un importe distinto ni
  ejecutar herramientas fuera de la allowlist del usuario/tenant.

Estados de conversación propuestos:

`understanding -> searching -> awaiting_selection -> quoting ->
awaiting_approval -> authorized -> completed`; las salidas de error conducen a
`failed`, y una persona puede volver a `understanding` o cancelar mientras no se
haya confirmado la orden.

Persistir el estado del grafo no convierte el grafo en fuente autoritativa de
la transacción: órdenes, pagos y stock tienen registros propios en PostgreSQL o
en el proveedor correspondiente.

La superficie `POST /v1/payment-intents` y sus endpoints de consulta/envío
implementan la ruta de wallet separada del checkout ACP x402. Recibe una quote
aprobada por el servicio de compra, exige `SERVICE_TOKEN` más `x-principal-id`
del BFF y solo construye pagos USDC en Stellar Testnet. El firmante conserva la
clave privada: el servidor entrega XDR sin firmar, verifica el XDR firmado y
reconcilia la transacción con Horizon antes de marcar la orden como pagada.
PostgreSQL mantiene quotes, órdenes, intents y attempts; MongoDB solo mantiene
checkpoints de LangGraph.

### Capa 2: Search Agent y catálogo

El Search Agent recibe `ProductSearchRequest` y coordina fuentes en paralelo,
con timeouts, límites por fuente, aislamiento de errores y normalización común.

Orden propuesto de fuentes:

1. Shopify Global Catalog MCP para descubrimiento multi-comercio Shopify y
   lookup de productos/variantes. Requiere perfil UCP del agente. Sus datos
   inferidos se tratan como señales de descubrimiento, no como afirmaciones del
   vendedor.
2. Catálogo local PostgreSQL para productos/ofertas de comercios integrados y
   datos canónicos que controle StellarMVP.
3. APIs oficiales o MCP de comercios adicionales, priorizando proveedores con
   autorización y política de uso documentadas.
4. Scraping asíncrono y controlado como fallback, nunca como fuente de precio o
   stock final de checkout.

El índice vectorial (Qdrant, ya instalado) es opcional y sirve únicamente para
recuperar candidatos semánticos. Nunca fija precio, stock, variante, impuestos,
envío ni aptitud de compra. Se vuelve a consultar la fuente autoritativa antes
de presentar la cotización final.

Normalización mínima de `ProductOffer`:

| Campo | Regla |
| --- | --- |
| `productId`, `merchantId` | Identidad estable de producto/variante y vendedor |
| `title`, `description`, `brand`, `model`, `gtin`, `sku` | Texto/datos fuente; marcar valores inferidos y procedencia |
| `price`, `currency` | Importe decimal exacto en unidades menores, no `number` binario |
| `availability` | `in_stock`, `out_of_stock`, `limited` o `unknown` |
| `shippingCost`, `taxes`, `totalCost` | Componentes separados; total calculado en servidor |
| `url`, `source`, `fetchedAt` | Procedencia y antigüedad de la oferta |
| `deliveryEstimate`, `returnPolicyUrl` | Opcionales; no inferir sin respaldo de fuente |

El Query Planner puede usar LLM para proponer variaciones de consulta. El
fan-out, los filtros duros (presupuesto, país, moneda, marca, disponibilidad),
la deduplicación, la cotización y el orden final los ejecuta código
determinista. La explicación al usuario solo puede apoyarse en los campos
normalizados disponibles.

### Datos e ingesta

- **MongoDB:** estado/checkpoints del agente, historial operativo mínimo y
  datos flexibles de ejecución. Retención y borrado se definirán antes de
  producción.
- **PostgreSQL:** `merchants`, `products`, `offers`, `quotes`, `checkouts`,
  `orders`, `payment_attempts` y eventos de dominio que requieren transacciones,
  relaciones e idempotencia.
- **Qdrant:** índice derivado, reconstruible desde fuentes/catálogo y no
  autoritativo.
- **Worker asíncrono:** ingesta/refresh de comercios y scraping; con límites de
  coste, páginas y tiempo. No ejecutar crawling ni mantener una petición del
  usuario abierta mientras termina.

El worker debe bloquear loopback, redes privadas y link-local; resolver y
revalidar DNS/redirecciones; limitar tamaño, profundidad y duración; permitir
cancelación; registrar procedencia; y respetar políticas y condiciones de cada
fuente.

### Cotización, checkout y orden

`QuoteSnapshot` es inmutable y liga la selección del usuario a la compra:

- IDs de merchant, producto, variante y oferta fuente.
- Título/atributos presentados, cantidad y disponibilidad observada.
- Precio, moneda, envío, impuestos y total en la moneda de origen.
- Si el pago requiere USDC: cantidad USDC, cotización FX, proveedor/origen,
  timestamp, expiración y regla de redondeo explícitos. No convertir con el LLM
  ni mantener el campo sugerido `totalAmountUSDC` sin fuente de tipo de cambio.
- URL de política, condiciones de entrega/devolución y `expiresAt`.
- `quoteId`, versión/hash de precio, tenant/usuario y estado de aprobación.

Antes de crear checkout, el servidor vuelve a validar precio, stock, variante,
destino e importe total con la fuente del merchant. Si algo cambia, invalida la
cotización y solicita selección/aprobación otra vez. La aprobación queda ligada
al hash exacto de la cotización; cualquier cambio requiere nueva aprobación.

El ciclo del checkout controla explícitamente: `created`, `ready_for_complete`,
`requires_buyer_input`, `requires_escalation`, `complete_in_progress`,
`completed` y `canceled`. El estado de pago y el estado de fulfillment se
modelan por separado. El merchant es autoridad del estado de checkout/orden y
el proveedor de pago de su estado de pago; una respuesta perdida se recupera
consultando el estado antes de reintentar.

Para checkout UCP, el agente puede ayudar a construir la sesión, pero la pauta
actual exige entregar el checkout a una interfaz determinista confiable para
que la persona revise los detalles y coloque la orden. Una futura compra
autónoma requeriría verificar otro perfil de plataforma/merchant y políticas de
delegación; no se infiere de la integración UCP de catálogo.

Invariantes:

- Clave de idempotencia estable para crear/completar checkout, crear intento de
  pago, capturar/liquidar y solicitar reembolso.
- Ninguna orden se marca pagada sin confirmación del proveedor/facilitador; no
  se confía en el texto o callback del agente.
- Ningún fulfillment se ejecuta dos veces por duplicación/reintento.
- Precio, merchant, línea, cantidad, moneda, importe máximo, red y destinatario
  del pago quedan ligados al mismo snapshot aprobado.
- No hay cargo adicional o incremento de importe silencioso.

### Pago: comercio vs. acceso a recursos

Separar dos usos que no deben compartir semántica:

- **Checkout de bienes/servicios:** Payment Provider port expone capacidades
  reales del proveedor elegido (por ejemplo, autorizar/capturar, liquidar,
  consultar, cancelar o reembolsar). Stripe/PSP o un payment handler UCP puede
  participar. No asumir que x402 implementa tarjeta, devolución, disputa,
  fulfillment o impuestos.
- **Cobro por consulta/recurso digital HTTP:** x402 puede proteger rutas
  seleccionadas y cobrar por request. `@x402/stellar` `exact` en Stellar
  testnet es candidato inicial, independiente de los pagos Stripe/base. No
  presentar x402 como checkout de carrito de mercancía ni suponer interoperar
  directamente con cada handler de pago UCP.

El adaptador presenta sus capacidades y límites; el caso de uso rechaza un
checkout si el método no cubre el ciclo requerido. Ninguna clave privada se
expone al grafo/LLM ni se guarda en MongoDB/PostgreSQL; las credenciales viven
en el gestor de secretos del runtime y el firmante debe poder limitarse por
red, destinatario, activo, monto y expiración.

## DTOs iniciales propuestos

Los ejemplos de `pautas de diseño.md` son la guía conceptual. Antes de
implementar, convertirlos en schemas Zod con convenciones de dinero seguras.

- `ShoppingIntent`: consulta, presupuesto máximo y moneda, país/ciudad de
  destino, marca/modelo y restricciones explícitas.
- `ProductSearchRequest`: consulta y filtros, límite acotado, destino, moneda y
  `inStock`.
- `ProductOffer`: oferta normalizada descrita arriba, con confianza/procedencia
  por campo cuando aplique.
- `QuoteSnapshot`: snapshot inmutable, conversión verificable, expiración,
  fuente y hash de aprobación.
- `ShoppingState`: estado durable de LangGraph y referencias de negocio, sin
  secretos ni credenciales de pago.

Los nombres y rutas HTTP siguen siendo borrador; por SDD, `specs/openapi.json`
se cambia antes de implementar endpoints públicos.

## MVP recomendado y criterios

### Fase 0: validar integración y decisiones

- Hacer una prueba de lectura a Shopify Global Catalog MCP y comprobar límites,
  profile requerido, política de datos y disponibilidad de variantes.
- Elegir merchant piloto, tipo de producto, país, moneda, settlement y dueño de
  la relación comercial; resolver explícitamente quién es merchant of record,
  responsable de impuestos, entrega, devoluciones y soporte.
- Verificar paquetes/compatibilidad de MongoDB checkpointer con Bun actual; no
  añadirlo hasta correr un smoke test de LangGraph con checkpoint y resume.

### Fase 1: sandbox de extremo a extremo

- Solo catálogo global Shopify y un catálogo local de prueba; máximo 5 ofertas.
- Producto digital o servicio simple de merchant único; sin scraper sin
  permiso y sin promesa de envío multi-comercio.
- Shopping Agent persistente, selección y aprobación humana explícita.
- Cotización con expiración y precio/stock revalidados; Payment Provider mock;
  crear orden idempotente y fulfillment simulado.
- Sin fondos reales, claves mainnet, pagos autónomos ni auto-compra.

### Fase 2: proveedor de pago piloto

Implementar un proveedor solo después de decidir settlement del merchant y
probar la ruta oficial del proveedor en sandbox/testnet. Para Stellar x402:
`exact`, testnet, allowlist de activo/red/receptor, presupuesto por sesión y
pruebas de firma, replay, expiración, importe, red, fallo de facilitador y
conciliación. Tarjeta/Stripe es una integración separada y no implica settlement
en Stellar.

### Criterios de salida antes de producción

- El agente sobrevive reinicios y puede reanudar selección/aprobación sin
  duplicar checkout, orden, cargo o fulfillment.
- La cotización coincide con validación de merchant y matemáticas en unidades
  menores; variación invalida aprobación.
- Las políticas de gasto se evalúan de forma determinista y todo pago tiene
  usuario/tenant, merchant, purpose, amount, currency/network y expiración.
- Prompt injection en catálogo, URLs y contenido scrapeado no cambia
  herramientas permitidas ni política de pago.
- Telemetría permite correlacionar sesión, quote, order y payment attempt sin
  guardar secretos, PAN, claves ni PII innecesaria.
- Se prueban replay, duplicados, respuesta perdida, timeout de settlement,
  cotización expirada, stock agotado, cancelación, devolución y desconexión de
  proveedores.
- Si el proveedor no confirma pago, no se entrega el bien; si el pago confirmó
  pero fulfillment falla, se crea caso de compensación/reembolso y alerta.

## Pendientes y decisiones abiertas

1. ¿El primer producto será catálogo multi-merchant/global o se limitará a un
   merchant Shopify? UCP Global Catalog es candidato de descubrimiento, pero no
   garantiza disponibilidad/compra de cualquier merchant o región.
2. ¿El producto de salida será solo software/servicios digitales o incluirá
   envío físico? Esto cambia checkout, dirección, impuestos, devolución y
   fulfillment.
3. ¿Quién contrata al merchant y quién responde legal/comercialmente ante el
   comprador? No construir marketplace, escrow ni custodia por inferencia.
4. ¿Qué checkout/payment handlers acepta el merchant piloto y cómo recibirá
   dinero? Dejar la decisión de Stripe vs Stellar y moneda liquidada abierta.
5. ¿Se requiere auto-compra futura? Definir límites por merchant/categoría,
   presupuesto por compra y ventana, aprobación por incremento, revocación y
   auditoría antes de habilitarla.
6. ¿Qué datos de sesión se retienen, por cuánto tiempo y cómo se eliminan de
   MongoDB/checkpoints y logs?
7. ¿Qué fuentes retailer tienen API oficial/MCP, permiso contractual y cobertura
   Perú/LatAm? La lista en pautas es candidata, no una integración verificada.

## Dependencias existentes y faltantes

Ya instaladas: LangGraph, checkpointers PostgreSQL y MongoDB, driver MongoDB,
LLM OpenAI-compatible, ScrapeGraph, Qdrant, `pg`, Stripe y x402
(Fastify/fetch/Stellar/EVM).

Implementado en esta fase: contratos Zod para intención/ofertas/cotización,
clase base LangGraph, gate Jev con umbral configurable, adaptador Jev TypeSafe,
adaptador Groq/OpenAI-compatible, ciclo ReAct con herramienta de búsqueda
allowlisted, pausas reanudables para selección y aprobación, validación de
cotización y hash estable, checkpointer MongoDB y factory de composición. La
aprobación queda registrada en el checkpoint como estado `authorized`; no crea
checkout, orden ni pago. La factory permite inyectar Search Agent y cotizador;
ninguno de esos proveedores está implementado ni conectado al servidor HTTP.

Persisten como faltantes la extracción robusta de filtros, los límites de
presupuesto por llamadas/tokens (el ciclo ReAct sí tiene límite de iteraciones),
consumo único de aprobación, implementación del Search Agent, revalidación
comercial de cotización y composición/ciclo de vida del agente en el servidor.

Faltan: worker de ingesta, servicios/repos transaccionales de catálogo y
comercio, DTOs completos, adaptadores de fuente, checkout/payment/fulfillment,
eventos y contratos OpenAPI. La incorporación del driver no demuestra aún
compatibilidad operativa en Render ni una política de retención.

## Referencias primarias

- [Pautas de diseño del proyecto](../pautas%20de%20dise%C3%B1o.md).
- [UCP: repositorio y capacidades](https://github.com/Universal-Commerce-Protocol/ucp).
- [UCP: Checkout](https://ucp.dev/specification/shopping/checkout/).
- [Shopify Global Catalog MCP](https://shopify.dev/docs/agents/catalog/global-catalog).
- [Shopify Catalog APIs](https://shopify.dev/docs/agents/catalog).
- [x402 v2: especificación](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
- [Stellar x402 quickstart](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide).
- [LangGraph JS: persistencia](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md).
- [MongoDB LangGraph.js checkpointer](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/).
