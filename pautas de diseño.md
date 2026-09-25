# Pautas de diseño – Capas 1 y 2

## 1. Capa 1: Agente de Compras (interacción con usuario)

**Responsabilidades:** El **Shopping Agent** (o *Commerce Orchestrator*) maneja la conversación completa: interpreta la intención del usuario, clarifica datos faltantes, construye la petición de búsqueda de productos, presenta opciones y procesa la selección. Se recomienda usar un framework stateful como **LangGraph.js** (TypeScript) por su soporte de ejecución durable y mezcla de lógica determinista con pasos basados en LLM.  El agente debe **persistir estado** entre mensajes (intención reconocida, restricciones, resultados de búsqueda, producto seleccionado, cotización pendiente).  Por ejemplo, un posible estado del agente podría ser:

- `understanding`: procesando la intención (este es el inicio tras mensaje del usuario).  
- `searching`: consultando fuentes de producto.  
- `awaiting_selection`: esperando al usuario para elegir entre las opciones presentadas.  
- `quoting`: calculando la cotización final.  
- `awaiting_approval`: esperando confirmación final del usuario.  
- `authorized`: pago autorizado.  
- `completed` / `failed`: flujo terminado con éxito o error.  

La persistencia de estado y la capacidad de **human-in-the-loop** son características claves de LangGraph. El flujo interno del agente debe separar claramente los pasos *deterministas* (filtrar ofertas, calcular totales) de los pasos *LLM* (interpretar lenguaje natural, explicar opciones).  

**DTOs y esquemas (Capa 1):** Definir contratos estrictos con *Zod* o *TypeScript* es esencial. Por ejemplo, un esquema para la intención de compra puede incluir campos como producto buscado, presupuesto máximo, moneda y destino:

```ts
import { z } from "zod";

const ShoppingIntentSchema = z.object({
  query: z.string().min(1),               // Qué quiere comprar el usuario
  maxPrice: z.number().optional(),       // Precio máximo
  currency: z.string().default("PEN"),   // Moneda (default PEN)
  country: z.string().optional(),        // Destino de envío
  city: z.string().optional(),           // Ciudad de envío (opcional)
  brand: z.string().optional(),          // Restricción de marca (opcional)
  model: z.string().optional(),          // Restricción de modelo (opcional)
});
type ShoppingIntent = z.infer<typeof ShoppingIntentSchema>;
```

También es útil definir **estados del agente** como un enum, p.ej.:
```ts
enum ShoppingAgentStatus {
  Idle = "idle",
  Understanding = "understanding",
  Searching = "searching",
  Comparing = "comparing",
  Quoting = "quoting",
  AwaitingApproval = "awaiting_approval",
  Authorized = "authorized",
  Completed = "completed",
  Failed = "failed",
}
```
y un esquema de estado completo, p.ej.:
```ts
type ShoppingState = {
  sessionId: string;
  status: ShoppingAgentStatus;
  intent?: ShoppingIntent;
  candidates?: ProductOffer[];
  selectedProduct?: ProductOffer;
  quote?: QuoteSnapshot;
  // ...otros campos (mensajes, etc.)
};
```
Almacenar estado en **MongoDB** facilita guardar objetos JSON flexibles (habilidades, historial de chat, estado del agente, etc.), mientras que **PostgreSQL** se suele reservar para datos transaccionales de catálogo (ver más abajo). 

## 2. Capa 2: Descubrimiento de productos y precios

**Responsabilidades:** El **Search Agent** se encarga de encontrar y comparar productos. Usa un *Query Planner* (quizá un paso LLM limitado) para generar consultas e invocar diversos orígenes de datos. Las fuentes típicas incluyen:

- **Catálogo UCP/Global (Shopify MCP):** Búsqueda cruzada entre múltiples comercios compatibles con UCP. Ofrece endpoints estandarizados (`search_catalog`, `lookup_catalog`, etc.) para descubrir productos.  
- **Catálogo local (PostgreSQL):** Base de datos canónica con productos y ofertas agregadas, rica en detalles y relaciones (SKU, GTIN, variante, etc.). PostgreSQL es ideal aquí para cumplir invariantes de inventario y relaciones complejas.  
- **APIs de comercios:** Conectores para minoristas conocidos (Amazon, MercadoLibre, AliExpress, Ripley, Falabella, etc.), preferiblemente APIs oficiales o MCP cuando existan. En un MVP 48h, vale priorizar servicios ya disponibles (Shopify Global Catalog) y luego añadir *scrapers* controlados.  
- **Índice semántico (vector DB):** Opcionalmente, un motor de búsqueda por embeddings para hallar coincidencias difusas (keywords ampliadas, sinónimos). Importante: usar vectores *solo para descubrimiento*, **no confiar en ellos para precio/stock**, sino refrescar con fuentes en vivo después.

Un flujo típico en Capa 2 sería:

1. El **Agente Vendedor** envía un `ProductSearchRequest`, con campos similares a `ShoppingIntent`.  
2. El *Search Agent* orquesta la búsqueda: planifica la consulta (quizá pidiendo a un LLM variantes), distribuye la petición a fuentes concurrentemente (UCP, DB, APIs), y recoge todos los resultados.
3. **Normalización y deduplicación:** Se normalizan los datos de cada fuente en un modelo común, p.ej.:
   ```ts
   const ProductOfferSchema = z.object({
     productId: z.string(),
     merchantId: z.string(),
     title: z.string(),
     description: z.string().optional(),
     brand: z.string().optional(),
     model: z.string().optional(),
     gtin: z.string().optional(),
     sku: z.string().optional(),
     price: z.number(),
     currency: z.string(),
     availability: z.enum(["in_stock","out_of_stock","limited","unknown"]),
     shippingCost: z.number().optional(),
     taxes: z.number().optional(),
     totalCost: z.number(),            // price + shipping + taxes
     url: z.string(),
     fetchedAt: z.string(),
     source: z.enum(["ucp", "catalog", "api", "scraper"]),
   });
   type ProductOffer = z.infer<typeof ProductOfferSchema>;
   ```
4. **Filtrado y restricción:** Aplicar condiciones duras (presupuesto, stock, país destino, marcas excluidas, etc.) de forma determinista.
5. **Validación en vivo (Top-K):** Para los ~5–10 candidatos finales, hacer un *re-refresh* de precio/stock vía `lookup_catalog` o llamada API, asegurando la información actual antes de cotizar.
6. **Ordenamiento determinista:** Calcular un puntaje combinado (coincidencia semántica, precio, tiempo de entrega, reputación) y seleccionar el top 3–5. El agente explicará las diferencias (esta parte sí puede usar LLM).

Los **Entidades de negocio** principales en esta capa incluyen *Merchant*, *Product* y *Offer*.  Por ejemplo, un modelo de datos relacional en PostgreSQL podría tener tablas `merchants`, `products` y `offers`, con llaves foráneas y campos como SKU, GTIN, categoría, etc. MongoDB se puede usar para almacenar logs o datos ingeridos sin estructura fija (p.ej. resultados intermedios o historiales), mientras PostgreSQL guarda los datos maestros consistentes.

**DTOs y esquemas (Capa 2):** Además de `ProductOffer` arriba, se recomienda definir:
- **ProductSearchRequest:** lo que envía el Agente Vendedor al Buscador. Por ejemplo:
   ```ts
   const ProductSearchRequestSchema = z.object({
     query: z.string(),
     filters: z.object({
       brands: z.array(z.string()).optional(),
       maxPrice: z.number().optional(),
       currency: z.string().optional(),
       destinationCountry: z.string().optional(),
       inStock: z.boolean().default(true),
     }).optional(),
     limit: z.number().int().positive().default(5),
   });
   type ProductSearchRequest = z.infer<typeof ProductSearchRequestSchema>;
   ```
- **QuoteSnapshot:** documento inmutable final antes del pago, conteniendo producto elegido y detalle de costo. P.ej.:
   ```ts
   const QuoteSnapshotSchema = z.object({
     productId: z.string(),
     merchantId: z.string(),
     totalAmount: z.number(),
     currency: z.string(),
     totalAmountUSDC: z.number(),
     expiresAt: z.string(),  // UTC
     sourceOffer: ProductOfferSchema,
   });
   type QuoteSnapshot = z.infer<typeof QuoteSnapshotSchema>;
   ```
El `QuoteSnapshot` sirve de entrada a la autorización de pago (capa 3).

## 3. Infraestructura y datos

- **Bases de datos:** Lo más práctico es combinar **PostgreSQL** y **MongoDB**. Usar PostgreSQL para el catálogo canónico de productos/ofertas, garantizando transacciones y relaciones. MongoDB (o similar) para almacenar el estado de sesiones/agentes y contenido semi-estructurado de ingestión. También podría usarse un índice de vectores (p.ej. Pinecone o Redis) conectado al catálogo para búsquedas semánticas.  
- **Catálogo y merchants:** Pre-popular el catálogo de comercio electrónico con datos de diversos marketplaces. Comercios recomendados: **Amazon, MercadoLibre, AliExpress** (mundo/LatAm), y tiendas locales populares (p.ej. Falabella, Ripley en Perú). Además, aprovechar el *Global Catalog* de Shopify (UCP) que permite buscar en múltiples merchants con un API unificado. Los **merchantId** en `ProductOffer` deberían corresponder a entradas en la tabla `merchants`.  
- **Ingesta agéntica:** Ejecutar un proceso asincrónico que recorra URLs de merchants (de `SourceRegistry`), extraiga metadatos (*JSON-LD Product/Offer*, OpenGraph) y complete con LLM si hace falta, normalice y alimente el catálogo PostgreSQL. Dejar que este crawler corra fuera del flujo síncrono (no hace esperar al usuario).  
- **Resiliencia y logs:** Implementar límites de tiempo, reintentos exponenciales y circuit breakers en llamadas a APIs externas. Registrar eventos estructurados (por `sessionId`, `requestId`, fuente, latencia, error) para trazabilidad. LangGraph y LangSmith pueden ayudar a inspeccionar el grafo de ejecución.

## 4. Estados y flujo de agente

**Estados del Agente de Compras (Capa 1):** Además del estado `ShoppingAgentStatus` mostrado, el agente mantendrá en su contexto los datos del intento de compra (el `ShoppingIntent`), los productos candidatos actuales (`ProductOffer[]`), el producto elegido y su cotización. En LangGraph, cada paso (nodo) puede actualizar el estado en forma de objetos crudos, sin formatear prompts hasta que se necesite. Esto facilita reintentos y claridad de flujo. 

**Estados del Agente Buscador (Capa 2):** El Search Agent puede modelar su pipeline internamente (por ejemplo, etapas de «planificar consulta», «consultar fuente», «normalizar resultados», «filtrar», «ordenar»). Si se implementa con LangGraph u otro motor, también puede tener estados explícitos, pero al menos debería manejar errores por fuente (p.ej. si UCP falla, intentar scraper).

**Degradación en fallos:** Si la búsqueda de producto no arroja resultados, la UCP sugiere redirigir al usuario a la página web completa del comercio como fallback. Esto se logra incluyendo en la respuesta un enlace (`continue_url`) a la tienda del merchant para que el usuario concluya la compra manualmente. Este fallback debe considerarse en la Capa 2 (y expuesto en UI si no hay ofertas válidas).

**Diagrama simplificado de flujo:**

```
Usuario --(consulta)--> Agente de Compras
Agente --(ProductSearchRequest)--> Search Agent
Search Agent -> {UCP, Catálogo, APIs} -> Resultado normalizado
Resultado -> Ranking -> Opciones Top-K
Agente -> Usuario: muestra comparativa
Usuario -> Agente: selecciona producto
Agente -> Cotización final -> QuoteSnapshot
```

Con estos elementos, la **Capa 1 (LangGraph + LLM)** quedaría responsable sólo de la conversación y orquestación, sin conocer detalles de HTML scraping o pagos. La **Capa 2** se encargaría de la lógica determinista de búsqueda, normalización y cálculo de precios, usando PostgreSQL, MongoDB y/o índices semánticos según convenga.  

**Referencias:** Esta arquitectura sigue recomendaciones de frameworks modernos. LangGraph es ideal para agents stateful combinando lógica determinista con IA. La UCP de Google/Shopify ofrece servicios estándar de catálogo compatibles con AP2/A2A y maneja correctamente degradación hacia el sitio web. En prácticas de datos, PostgreSQL maneja bien las relaciones de catálogo (inventarios, uniones), mientras MongoDB aporta flexibilidad de esquema para catálogos dinámicos. Todos estos aspectos son **pautas obligatorias** para implementar las capas 1 y 2 de forma robusta y escalable.

