# Guía de puesta en marcha de Agentic Commerce

Esta guía deja operativo el camino actual de StellarMVP en local y en Render:

- API Fastify ejecutada con Bun dentro del `Dockerfile`.
- PostgreSQL y Redis para las capacidades de agente, órdenes y control de gasto.
- Qdrant Cloud como índice vectorial derivado.
- Embeddings mediante un proveedor compatible con la API de OpenAI.
- Catálogo Bazaar/x402 de HeinrichsTech como fuente de descubrimiento actual.
- Payment intents en Stellar Testnet y firma desde una wallet del navegador.
- Consola web local/remota en `/app`.

UCP y Vercel aparecen al final como integraciones opcionales. El catálogo
Bazaar/x402 no equivale a un checkout UCP, y el flujo de payment intents
Stellar del proyecto no sustituye todavía a un cliente comprador x402 v2.

Las referencias externas se revisaron el **26-09-2026**. Los valores secretos
se escriben solo en el entorno local o en el gestor de secretos del proveedor.

## 1. Prerrequisitos

Instala:

- Git.
- Bun `>=1.4.0`.
- Docker Engine y Docker Compose.
- Una cuenta Qdrant Cloud.
- Una cuenta del proveedor de embeddings elegido.
- Una wallet Stellar de prueba, preferiblemente Freighter, para Stellar
  Testnet.
- Una cuenta Render si vas a publicar la API.

Comprueba las versiones:

```bash
git --version
bun --version
docker --version
docker compose version
```

Clona el repositorio y entra en la rama que quieras desplegar:

```bash
git clone <URL_DEL_REPOSITORIO>
cd stellarMVP
git checkout dev
bun install
```

Antes de modificar código, revisa `AGENTS.md`, `README.md`, `docs/sdd.md`,
`docs/solid.md` y `docs/errors.md`. Los cambios de API siguen el flujo SDD:
primero `specs/openapi.json`, después la implementación y las pruebas.

## 2. Configuración local segura

Copia la plantilla de variables. El archivo `.env` no debe entrar en Git:

```bash
cp .env.example .env
```

Configura como mínimo el modo de desarrollo:

```env
APP_ENV=dev
HOST=127.0.0.1
PORT=3000
AGENT_COMMERCE_ENABLED=false
PAYMENTS_ENABLED=false
```

Cuando actives pagos, la validación exige también:

```env
PAYMENTS_ENABLED=true
SERVICE_TOKEN=<token-largo-generado-localmente>
DATABASE_URL=postgres://stellar:password@127.0.0.1:5432/stellarmvp
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_USDC_ISSUER=<issuer-USDC-Testnet>
STELLAR_PAYMENT_PAY_TO=<cuenta-Stellar-receptora>
STELLAR_PAYMENT_AMOUNT_USDC=0.01
```

Genera un token local sin incluirlo en commits:

```bash
bun -e 'console.log(crypto.randomUUID()+crypto.randomUUID())'
```

No pongas en TOML, documentación, pruebas ni imágenes Docker:

- `SERVICE_TOKEN`.
- `QDRANT_API_KEY`.
- `EMBEDDINGS_API_KEY`.
- Claves secretas Stellar.
- Cadenas de conexión con contraseñas.

## 3. Levantar PostgreSQL, Redis y MongoDB local

El Compose del proyecto usa etiquetas y nombres explícitos para no confundir
los servicios con otras instalaciones locales:

```bash
docker compose up --build -d
docker compose ps
```

Comprueba que los tres servicios de datos estén saludables:

```bash
docker inspect --format '{{.Name}} {{.State.Health.Status}}' \
  stellarmvp-postgres-local \
  stellarmvp-redis-local \
  stellarmvp-mongodb-local
```

Para la API ejecutada directamente con Bun, usa estos hosts:

```env
DATABASE_URL=postgres://stellar:password@127.0.0.1:5432/stellarmvp
REDIS_URL=redis://127.0.0.1:6379
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=stellarmvp
```

El contenedor `stellarmvp` del Compose ya usa los nombres de servicio internos
(`postgres`, `redis`, `mongodb`) y publica la API en
`http://127.0.0.1:8010`. MongoDB queda preparado para el estado/checkpoint del
agente, pero el runtime actual no lo exige para arrancar.

## 4. Preparar Stellar Testnet

### 4.1 Crear y fondear la wallet

Genera una keypair de prueba en Stellar Lab o con el SDK. La dirección pública
(`G...`) se puede compartir; la clave secreta (`S...`) nunca se comparte ni se
sube a Render como una variable de la API que no la necesita.

En Testnet, Friendbot puede crear y fondear la cuenta. Consulta la guía oficial
de [creación de cuentas Stellar](https://developers.stellar.org/docs/build/guides/transactions/create-account)
para el procedimiento vigente.

Conserva:

- `payerAddress`: dirección pública de la wallet que paga.
- La clave secreta únicamente en Freighter o en un cliente de prueba aislado.

### 4.2 Usar USDC Testnet

El issuer de USDC debe ser el de la red Testnet, no el de Pubnet. Configura el
issuer que corresponda a la red y establece `STELLAR_NETWORK=testnet`.

La cuenta receptora configurada en `STELLAR_PAYMENT_PAY_TO` debe existir en
Testnet. Si la cuenta recibe un activo Stellar clásico, crea antes la trustline
correspondiente desde Stellar Lab o Freighter.

La red, el issuer, la cuenta receptora, el importe y el `payerAddress` deben
pertenecer al mismo flujo. No mezcles:

- Testnet con Horizon Pubnet.
- Issuer USDC Testnet con un receptor Pubnet.
- Un importe de una cotización con otro importe firmado.

### 4.3 Probar el flujo de payment intent

Arranca la aplicación y abre la consola:

```bash
bun run dev
xdg-open http://127.0.0.1:3000/app
```

La secuencia es:

1. La wallet entrega solo su dirección pública.
2. El cliente solicita un quote en `/v1/payment-quotes`.
3. El servidor crea un intent y entrega un XDR sin firmar.
4. Freighter firma el XDR en la red seleccionada.
5. El cliente envía el XDR firmado a `/v1/payment-intents/:intentId/submission`.
6. El servidor lo verifica y reconcilia con Horizon.
7. El estado se consulta en `/v1/payment-intents/:intentId`.

La guía oficial de [x402 sobre Stellar](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide)
describe un flujo distinto: un recurso HTTP responde `402`, el cliente genera
`PAYMENT-SIGNATURE`, un facilitador verifica/liquida y el recurso responde con
el resultado. Esta aplicación aún mantiene separados ambos flujos.

## 5. Crear el cluster Qdrant Cloud

1. En Qdrant Cloud crea un cluster Free para pruebas o Standard para un entorno
   persistente.
2. Copia el endpoint del cluster, no el endpoint de gestión de la cuenta.
3. En la sección de API Keys del cluster crea una Database API Key con permisos
   mínimos, colección limitada si es posible y una expiración.
4. Guarda la clave en un gestor de secretos. Qdrant solo la muestra una vez.

La documentación oficial cubre [creación de clusters](https://qdrant.tech/documentation/cloud/create-cluster/),
[autenticación](https://qdrant.tech/documentation/cloud/authentication/) y
[acceso al endpoint](https://qdrant.tech/documentation/cloud/cluster-access/).

Configura localmente:

```env
QDRANT_URL=https://<cluster>.cloud.<region>.<provider>.qdrant.io:6333
QDRANT_API_KEY=<database-api-key>
QDRANT_COLLECTION=heinrichstech_services
```

El cliente del proyecto acepta la clave como autenticación de Qdrant. Verifica
la conectividad con una operación de solo lectura desde el panel de Qdrant o
con el endpoint de colecciones, sin imprimir la clave en la terminal compartida.

## 6. Configurar embeddings y catálogo

El adaptador actual usa `OpenAIEmbeddings` con un proveedor compatible. El
nombre de la variable es deliberadamente genérico:

```env
EMBEDDINGS_API_KEY=<api-key-del-proveedor>
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_API_BASE_URL=
```

Si el proveedor expone una API compatible en otra URL, completa
`EMBEDDINGS_API_BASE_URL`. El modelo debe producir siempre la misma dimensión
para la colección; si cambias de modelo con otra dimensión, crea una colección
nueva y vuelve a ingerir.

El camino activo usa Bazaar/x402 de HeinrichsTech:

```env
CATALOG_ADAPTER=bazaar
CATALOG_MERCHANT_URL=https://app.heinrichstech.com
CATALOG_MERCHANT_ID=heinrichstech
CATALOG_SOURCE_URL=https://app.heinrichstech.com/bazaar.json
CATALOG_QUERY=page
CATALOG_MAX_PRODUCTS=50
CATALOG_REQUEST_TIMEOUT_MS=10000
```

Ejecuta una ingesta manual:

```bash
bun run catalog:ingest
```

El resultado debe indicar un job completado, el merchant, la colección, el
número de ofertas y el número de puntos insertados. Después prueba la búsqueda
con el endpoint del agente cuando `AGENT_COMMERCE_ENABLED=true`.

La ingesta conserva los términos de pago anunciados por el catálogo, pero esos
datos no convierten automáticamente al servicio en un comprador x402. El
precio, stock y estado final de una compra deben revalidarse con el comercio.

## 7. Activar el runtime de agente

Para registrar `/v1/agent/search`, `/v1/agent/checkout` y la ingesta HTTP,
configura:

```env
AGENT_COMMERCE_ENABLED=true
DATABASE_URL=postgres://stellar:password@127.0.0.1:5432/stellarmvp
REDIS_URL=redis://127.0.0.1:6379
SERVICE_TOKEN=<token-largo>
QDRANT_URL=<cluster-endpoint>
QDRANT_API_KEY=<database-api-key>
EMBEDDINGS_API_KEY=<embeddings-api-key>
```

El runtime crea/migra las tablas de órdenes en PostgreSQL y usa Redis para
scopes y límites de gasto. Las rutas del agente requieren un Bearer token con
el scope almacenado para la operación correspondiente (`agent:search` o
`agent:checkout`).

Ejemplo de búsqueda:

```bash
curl -X POST http://127.0.0.1:3000/v1/agent/search \
  -H 'Authorization: Bearer <agent-token>' \
  -H 'Content-Type: application/json' \
  -d '{"query":"page change monitoring","limit":5}'
```

Si Qdrant o embeddings no están disponibles, el servicio puede usar el catálogo
en vivo como fallback cuando el adaptador está configurado. La respuesta debe
tratarse como descubrimiento; no como una autorización de pago.

## 8. Arrancar y validar localmente

Para ejecutar Bun directamente:

```bash
bun run dev
```

Verifica:

```bash
curl -i http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/v1/health/live
curl -s http://127.0.0.1:3000/v1/health/ready
curl -s http://127.0.0.1:3000/openapi.json
```

La raíz redirige a `/docs`; la consola de prueba está en `/app`.

Antes de integrar cambios:

```bash
bun run spec:check
bun --no-env-file test
bun run check-types
bun run check
bun run build
```

`bun --no-env-file test` evita que el `.env` personal cambie las condiciones de
las pruebas locales.

## 9. Desplegar en Render

El despliegue activo usa el `Dockerfile` de la raíz. Render debe configurarse
como **Web Service** con runtime **Docker** y el repositorio/branch deseados.

### 9.1 Ajustes del servicio

1. Selecciona el repositorio y la rama.
2. Selecciona Docker como runtime.
3. Usa `Dockerfile` en la raíz.
4. No reemplaces el `CMD` salvo que exista una razón operativa; el proyecto
   arranca con `bun run start` dentro de la imagen.
5. Configura el health check HTTP en `/v1/health/live`.
6. Conserva `HOST=0.0.0.0` y usa el `PORT` que Render inyecte o el que definas
   de forma consistente con `EXPOSE`.

Render documenta el flujo de [Docker](https://render.com/docs/docker), los
[deploys](https://render.com/docs/deploys) y los [health checks](https://render.com/docs/health-checks).
El proceso debe escuchar en `0.0.0.0`; enlazar solo a `127.0.0.1` impide que el
proxy de Render alcance el servicio.

### 9.2 Variables y secretos

En **Environment** agrega las variables del entorno desplegado. Como mínimo
para el agente con pagos Testnet:

```env
APP_ENV=prod
HOST=0.0.0.0
AGENT_COMMERCE_ENABLED=true
PAYMENTS_ENABLED=true
SERVICE_TOKEN=<secret>
DATABASE_URL=<postgres-remoto>
REDIS_URL=<redis-remoto>
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_USDC_ISSUER=<issuer-USDC-Testnet>
STELLAR_PAYMENT_PAY_TO=<cuenta-receptora-Testnet>
QDRANT_URL=<cluster-endpoint>
QDRANT_API_KEY=<database-api-key>
QDRANT_COLLECTION=heinrichstech_services
EMBEDDINGS_API_KEY=<embeddings-api-key>
EMBEDDINGS_MODEL=text-embedding-3-small
CATALOG_ADAPTER=bazaar
CATALOG_MERCHANT_URL=https://app.heinrichstech.com
CATALOG_MERCHANT_ID=heinrichstech
CATALOG_SOURCE_URL=https://app.heinrichstech.com/bazaar.json
```

Render permite cargar variables desde un `.env` local, pero revisa y limpia el
archivo antes de hacerlo. Para varios servicios usa un Environment Group y
rota las claves con expiración. Consulta la guía oficial de
[variables y secretos de Render](https://render.com/docs/configure-environment-variables).

No pongas secretos en `render.yaml`, porque el archivo se versiona. Si usas
secret files, recuerda que Render los monta en `/etc/secrets/<nombre>` y que la
imagen Docker no debe incorporar credenciales durante el build.

### 9.3 Deploy y smoke test

Después de guardar las variables, ejecuta el deploy desde Render y espera a que
el health check sea exitoso. Luego prueba el dominio público:

```bash
export APP_URL=https://<servicio>.onrender.com
curl -i "$APP_URL/"
curl -s "$APP_URL/v1/health/live"
curl -s "$APP_URL/v1/health/ready"
curl -s "$APP_URL/openapi.json" >/tmp/stellarmvp-openapi.json
```

Si `ready` aparece como `degraded`, revisa primero PostgreSQL, Redis, Horizon,
Qdrant y las variables obligatorias. Un deploy saludable no implica que la
ingesta o el pago hayan sido probados: ejecuta los smoke tests de las secciones
anteriores después del deploy.

## 10. Integración opcional con UCP

UCP usa un perfil de descubrimiento en `/.well-known/ucp` que declara servicios,
capabilities y payment handlers. El agente anuncia su perfil mediante el header
`UCP-Agent`; el comercio y la plataforma negocian la intersección de
capabilities.

La documentación oficial explica los [conceptos de UCP](https://ucp.dev/documentation/core-concepts/)
y el [binding REST de catálogo](https://ucp.dev/specification/shopping/catalog/rest/).

Para usar el adaptador UCP del proyecto:

```env
CATALOG_ADAPTER=ucp
CATALOG_MERCHANT_URL=https://<comercio>
CATALOG_MERCHANT_ID=<merchant-id>
UCP_AGENT_PROFILE_URL=https://<agente>/.well-known/ucp
```

Antes de activar esta opción verifica que el comercio publique un perfil UCP
válido, que anuncie el transporte requerido y que sus endpoints respondan con
el esquema y la versión negociada. UCP Catalog no garantiza que el comercio
acepte checkout, pago o fulfillment.

## 11. Vercel como compatibilidad heredada

El despliegue activo del proyecto es Render. `vercel.json` y la detección de
`VERCEL` en `src/index.ts` se conservan por compatibilidad anterior.

Si se prueba Vercel, hay que separar su modelo de Functions del modelo Docker:

- Una regla `functions` debe apuntar a un archivo que Vercel detecte dentro de
  `api/`.
- Un backend Fastify no se convierte automáticamente en una función por tener
  `src/index.ts`.
- Un `outputDirectory` está pensado para un artefacto de salida que realmente
  exista; no debe apuntar a `public` si el build no genera esa carpeta.
- Las variables, el puerto y el ciclo de vida de Vercel no sustituyen la
  configuración de Render.

No mezcles una configuración de Functions de Vercel con el `Dockerfile` usado
por Render sin validar el entrypoint, el build y las rutas públicas por separado.

## 12. Diferenciar los tres flujos de pago

### Payment intents del proyecto

Wallet del usuario, XDR sin firmar, firma en Freighter, envío a Horizon y
reconciliación. Está limitado a Stellar Testnet por configuración.

### Checkout del agente

La ruta `/v1/agent/checkout` usa la autorización y el almacenamiento de órdenes
del proyecto. No debe marcar una orden como pagada sin una confirmación del
proveedor.

### x402 para recursos HTTP

El flujo x402 v2 empieza con HTTP `402`, procesa `PAYMENT-REQUIRED`, firma
`PAYMENT-SIGNATURE`, reintenta el mismo recurso y valida la respuesta de
settlement. Un catálogo que anuncia `accepts` no significa que este cliente ya
sepa pagar automáticamente.

HeinrichsTech anuncia actualmente sus propias redes y activos. Antes de pagar,
compara siempre `network`, `asset`, `amount`, `payTo` y el recurso solicitado
con la política Testnet del entorno. Si el recurso solo anuncia Pubnet, no lo
uses como prueba de pago Testnet.

## 13. Diagnóstico rápido

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| `DATABASE_URL is required when PAYMENTS_ENABLED is true` | Pagos habilitados sin PostgreSQL | Configura `DATABASE_URL` o deshabilita pagos |
| El agente no registra sus rutas | `AGENT_COMMERCE_ENABLED=false` | Activa el flag y reinicia |
| `QDRANT_URL is required for catalog ingestion` | Qdrant no configurado | Configura endpoint y API key |
| `EMBEDDINGS_API_KEY is required` | Falta la credencial de embeddings | Agrega la variable en el entorno correcto |
| Colección con dimensión incompatible | Se cambió el modelo de embeddings | Usa una colección nueva y reingiere |
| Render no pasa health check | Bind a loopback o puerto incorrecto | Usa `HOST=0.0.0.0`, revisa `PORT` y `/v1/health/live` |
| HTTP 402 con red inesperada | El recurso anuncia otra red o activo | Detén el pago y valida el rail anunciado |
| Pago Testnet no reconcilia | Issuer, trustline, cuenta o Horizon incorrectos | Comprueba todos los valores en la misma red |
| Búsqueda devuelve cero resultados | No se ejecutó la ingesta o la colección está vacía | Ejecuta `bun run catalog:ingest` y revisa Qdrant |
| Checkout no completa aunque haya búsqueda | Descubrimiento no equivale a orden/fulfillment | Implementa y prueba el adaptador comercial correspondiente |

## 14. Checklist de aceptación

- [ ] `bun install` termina sin errores.
- [ ] PostgreSQL, Redis y MongoDB locales están saludables.
- [ ] `/v1/health/live` responde `200`.
- [ ] `/v1/health/ready` muestra pagos y dependencias esperadas.
- [ ] La wallet Testnet está fondeada y tiene la trustline necesaria.
- [ ] `payerAddress` es una dirección pública, nunca una clave secreta.
- [ ] Qdrant responde y la API key tiene permisos limitados.
- [ ] `bun run catalog:ingest` crea/actualiza la colección configurada.
- [ ] La búsqueda autenticada devuelve ofertas o un fallback explícito.
- [ ] El payment intent firma y reconcilia en Testnet.
- [ ] Render escucha en `0.0.0.0` y pasa el health check.
- [ ] No hay secretos en Git, logs, TOML, tests ni imágenes.
- [ ] Se distingue el catálogo Bazaar de una implementación UCP.
- [ ] Se distingue payment intent Stellar de un cliente x402 comprador.

## Referencias

- [Render: Docker](https://render.com/docs/docker)
- [Render: deploys](https://render.com/docs/deploys)
- [Render: health checks](https://render.com/docs/health-checks)
- [Render: environment variables and secrets](https://render.com/docs/configure-environment-variables)
- [Stellar: crear una cuenta](https://developers.stellar.org/docs/build/guides/transactions/create-account)
- [Stellar x402 Quickstart](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide)
- [Qdrant Cloud: crear un cluster](https://qdrant.tech/documentation/cloud/create-cluster/)
- [Qdrant Cloud: autenticación](https://qdrant.tech/documentation/cloud/authentication/)
- [Qdrant Cloud: acceso al cluster](https://qdrant.tech/documentation/cloud/cluster-access/)
- [OpenAI: embeddings](https://platform.openai.com/docs/guides/embeddings)
- [UCP: conceptos principales](https://ucp.dev/documentation/core-concepts/)
- [UCP: catálogo REST](https://ucp.dev/specification/shopping/catalog/rest/)
- [UCP: checkout](https://ucp.dev/specification/checkout/)
