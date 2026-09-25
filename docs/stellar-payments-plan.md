# Plan de pagos USDC en Stellar para compras asistidas

Estado: primera etapa del backend implementada en `design/stellar-payments`.
Incluye rutas internas, lectura de cotizaciones aprobadas desde MongoDB, intents
idempotentes, construcción y validación de XDR, envío y conciliación en Stellar
Testnet. `PAYMENTS_ENABLED` está apagado por defecto. No se ha ejecutado una
compra real en Testnet; no habilita fondos reales ni Mainnet. El frontend
Freighter, el checkpointer MongoDB de LangGraph y las smart accounts Soroban
siguen pendientes.

## Decisiones de alcance

- La persistencia acordada es **MongoDB**: checkpoints del agente y colecciones
  de negocio separadas para cotizaciones, aprobaciones, intentos de pago,
  órdenes y eventos. El checkpoint de LangGraph no es el registro autoritativo
  de un pago.
- El comprador aprueba cada compra en una interfaz determinista y firma con su
  wallet. Para el piloto web se recomienda la extensión Freighter mediante
  `@stellar/freighter-api`; este repositorio solo contiene el backend, por lo
  que la interfaz de wallet aún debe construirse o integrarse desde otro
  frontend. El LLM puede explicar una oferta, pero no construir ni modificar el
  importe, activo, red o destinatario de una operación.
- El primer flujo blockchain usa USDC en **Stellar Testnet**, un comercio piloto
  y una cotización de importe fijo. El comercio debe aceptar ese USDC y poder
  relacionar el pago con su orden. La dirección de cobro no se obtiene de texto
  producido por el agente ni de una página scrapeada.
- El diagrama muestra el pago USDC al comercio, pero no especifica una comisión
  para la plataforma ni una segunda dirección receptora. La comisión se trata
  como decisión de producto pendiente; no se agrega a una cotización en silencio.
- El camino inicial para demostrar el pago puede usar una cuenta Stellar
  clásica, una operación `payment` y firma humana. El diagrama completo requiere
  además límites de gasto verificables on-chain: ese hito usa una smart account
  Soroban con una política probada y una transferencia del Stellar Asset
  Contract. No se debe afirmar que el primer camino ya impone límites on-chain.
- x402 y MPP quedan fuera del checkout piloto: son integraciones de cobro HTTP
  por recurso. Se evaluarán por separado si el agente paga APIs externas o el
  servicio vende una consulta. Tampoco se asume que un comercio UCP acepte una
  transferencia Stellar sin anunciar un handler compatible.

## Contrato entre equipos

El servicio de búsqueda entrega una `QuoteSnapshot` inmutable con `quoteId`,
`merchantId`, producto/variante, cantidad, disponibilidad observada, precio,
impuestos, envío, total, moneda, origen de cada dato, `expiresAt` y versión/hash
de la oferta. Para pagar en USDC incluye la tasa de cambio obtenida de un
proveedor definido, instante, expiración, fuente y regla de redondeo. Todos los
importes se representan como cadenas decimales exactas o enteros en unidades
menores, nunca como `number` binario.

El servicio de checkout revalida con el comercio variante, stock, destino y
total antes de aceptar una aprobación. La aprobación guarda usuario/tenant,
`quoteId`, hash canónico de la cotización, importe máximo, red, activo,
destinatario y vencimiento. Cualquier cambio de esos datos invalida la
aprobación. El servicio de pagos recibe esa aprobación validada y crea un
`PaymentIntent`; no acepta un importe o destinatario libre enviados por el
cliente o el agente.

Campos mínimos de `PaymentIntent`: `intentId`, `quoteId`, `quoteHash`, `orderId`,
`userId`, `merchantId`, `networkPassphrase`, `payerAddress`, `assetCode`,
`assetIssuer` (o contract ID para Soroban), `totalAmountAtomic`,
`assetDecimals`, `paymentLegs` (`purpose`, `payTo`, `amountAtomic`),
`expiresAt`, `idempotencyKey`, `status` y marcas de tiempo. Sin comisión pagada
por el comprador, `paymentLegs` contiene solo la partida del comercio.
`PaymentAttempt` agrega `attemptId`, `intentId`, `txHash`, `ledger`, resultado,
motivo de fallo normalizado y número de intento. Los valores de red, emisor y
destinatario deben resolverse de configuración/registro autorizado del comercio
y quedar copiados en el intent aprobado.

## Comisión de plataforma: decisión pendiente

Antes de definir el XDR final, el equipo debe fijar quién paga la comisión,
quién la recibe, la base de cálculo, el porcentaje o importe fijo, topes,
redondeo, impuestos, reembolsos y momento de liquidación. El modelo debe
aparecer en `QuoteSnapshot` y en la aprobación del usuario o en el acuerdo con
el comercio, según corresponda. Dos modelos viables para un piloto son:

1. **El comercio paga a la plataforma:** el comprador transfiere el total
   aprobado al comercio; la plataforma registra la comisión devengada y la
   cobra/liquida por un flujo separado acordado con ese comercio. El `txHash`
   de la compra solo acredita el pago al comercio, no el cobro de la comisión.
2. **El comprador paga dos destinos:** la cotización presenta subtotal del
   comercio, comisión y total USDC. Una transacción clásica Stellar puede
   contener dos operaciones `payment`, una al comercio y otra a la plataforma;
   la transacción se aplica de forma atómica. El `PaymentIntent` debe guardar
   ambas partidas y la conciliación debe verificar ambas operaciones, importes
   y destinatarios antes de confirmar la orden. Para una smart account Soroban,
   este reparto requeriría un diseño de invocación/contrato compatible con su
   política; no se asume que dos operaciones clásicas sirvan para ese camino.

Recibir el total en una wallet de la plataforma y reenviar la parte del
comercio cambiaría custodia, responsabilidades y conciliación. No es el modelo
del diagrama ni se propone sin un acuerdo explícito. Si el comercio utiliza
UCP, sus totales y métodos de pago son la fuente autoritativa del checkout:
la plataforma no debe añadir una comisión al importe del comercio por su cuenta.

## Ubicación en el repositorio

1. `specs/openapi.json` y `src/http/payment-routes.ts` exponen crear intent,
   consultar estado y entregar XDR firmado. Las tres rutas requieren
   `SERVICE_TOKEN` configurado y `x-principal-id` afirmado por el BFF autenticado.
   No se expone el token al navegador.
2. `src/domain/payments.ts` define quote, intent, estados, partidas y conversión
   exacta de stroops. `PaymentIntent` guarda las partidas aprobadas sin calcular
   ni agregar una comisión.
3. `src/services/payment-service.ts` aplica ownership, vencimiento, idempotencia,
   exclusión de intents activos por pagador, transiciones y conciliación mediante
   puertos.
4. `src/integrations/stellar/stellar-payment-gateway.ts` construye transacciones
   clásicas `payment`, comprueba que el XDR firmado conserve el hash exacto y
   tenga firma válida del pagador, lo envía a Horizon y compara cada operación
   incluida en ledger con las partidas aprobadas.
5. `src/integrations/mongodb/payment-store.ts` usa el driver oficial `mongodb`,
   inicializa índices únicos para idempotencia, hash de transacción y un intent
   activo por cuenta pagadora. Escribe intents en `payment_intents` y lee
   cotizaciones aprobadas de `approved_quotes`.
6. `src/http/server.ts` conecta MongoDB al iniciar solo con
   `PAYMENTS_ENABLED=true`, y readiness revisa esa conexión. Configuración
   inválida o MongoDB inaccesible detiene el arranque.
7. El checkpointer de LangGraph, la escritura/validación de cotizaciones por el
   checkout, la interfaz Freighter y Soroban no forman parte de esta etapa.

### Documento de cotización que consume el pago

El checkout debe escribir un documento en `approved_quotes` con esta forma:

```json
{
  "quoteId": "quote-123",
  "orderId": "order-123",
  "quoteHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "principalId": "user-123",
  "status": "approved",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "payerAddress": "G...",
  "assetCode": "USDC",
  "assetIssuer": "G...",
  "assetDecimals": 7,
  "paymentLegs": [
    { "purpose": "merchant", "payTo": "G...", "amountAtomic": "12500000" }
  ],
  "expiresAt": "2026-09-24T13:00:00.000Z",
  "memo": "optional-order-ref"
}
```

`amountAtomic` representa unidades de `10^-7` de un activo clásico Stellar;
todos los importes son cadenas enteras. Debe existir exactamente una partida
`merchant` y puede existir una partida `platform` si el checkout ya la aprobó.
El pago comprueba `principalId`, estado, red y vencimiento. El endpoint no
acepta montos, activo, receptor, red ni pagador arbitrarios del cliente. El
checkout es responsable de generar el `quoteHash`, fijar las partidas y guardar
el documento con permisos Mongo restringidos a ese servicio.

Las fechas se escriben como UTC ISO 8601 con milisegundos y sufijo `Z` (el mismo
formato que `Date.toISOString()`). `quoteHash` es el SHA-256 hexadecimal de 64
caracteres en minúscula del snapshot canónico.
7. `contracts/`: solo al implementar límites on-chain. Partir de las smart
   accounts y políticas de OpenZeppelin Stellar; añadir código Rust Soroban,
   despliegue y pruebas del contexto de autorización que corresponda. Una
   allowlist por destinatario/activo requiere configuración o política probada;
   el límite de gasto por sí solo no la proporciona.

## Firma del comprador

Para una cuenta Stellar clásica (`G...`), la interfaz conecta Freighter, muestra
las partidas de pago y solicita `signTransaction` sobre el XDR exacto de
Testnet. Si la comisión la paga el comprador, el XDR contiene las dos
operaciones autorizadas. El backend verifica el XDR firmado antes de enviarlo
si actúa como relayer, y siempre concilia el resultado incluido en el ledger.

Para una smart account Soroban (`C...`), Freighter firma la autorización de
la invocación con `signAuthEntry`; la cuenta contrato no firma el sobre de la
transacción ni puede ser su source account. Hace falta una cuenta `G...` del
relayer para enviar la transacción y pagar fees. La compatibilidad entre la
política del contrato, Freighter y el flujo de comisión se prueba en Testnet
antes de ofrecer esa opción. MetaMask Connect no es el camino elegido para
Stellar en este piloto; su integración documentada cubre EVM y Solana.

## Flujo y conciliación

1. El comercio confirma la cotización y el usuario aprueba su hash exacto.
2. Se crea un intent idempotente, con red, USDC, receptor e importe inmutables.
3. El cliente presenta estos datos a la wallet para firma humana. En el camino
   clásico, el SDK construye la operación `payment` o, si se acuerda que el
   comprador paga la comisión, las dos operaciones aprobadas en una misma
   transacción, con límite temporal y una referencia de orden que permita
   conciliar. En el camino Soroban se firma la autorización de `transfer` del
   activo aceptado y se verifica el diseño de reparto elegido. Antes de usar
   una wallet concreta, probar que soporta el tipo de firma elegido.
4. Tras el envío se registra `txHash`, pero el intento permanece `submitted`.
   Un timeout se trata como estado incierto y se consulta la red antes de
   considerar otro envío.
5. El conciliador consulta Horizon/RPC según la operación, exige éxito incluido
   en ledger y verifica red, pagador, cada receptor, contrato o emisor USDC,
   cada importe exacto y referencia del intent. El hash recibido del cliente
   es solo una pista de búsqueda. Un mismo `txHash` no puede pagar dos intents.
6. Solo después de esa verificación se marca el intento `confirmed` y se
   avanza la orden. Si la entrega falla tras pagar, queda un caso de
   compensación/reembolso visible; no se duplica el cargo.

Estados propuestos del intento: `created -> awaiting_signature -> submitted ->
confirmed`. Desde los estados previos a confirmación puede terminar en `failed`
o `canceled` según la evidencia; el vencimiento de la cotización impide nuevas
firmas, pero un pago ya enviado exige conciliación antes de darlo por fallido.
El estado de orden y el de pago permanecen separados.

MongoDB impone unicidad en `(principalId, idempotencyKey)` y en
`(networkPassphrase, transactionHash)` cuando existe hash, además de un único
intent `awaiting_signature`, `submitting` o `submitted` por pagador. Antes de
crear otro intent se caducan los intents unsigned cuyo plazo pasó; intents ya
enviados no se caducan sin consultar la red. Las transiciones usan updates
condicionales por estado. Ninguna transacción MongoDB incluye el ledger Stellar:
la recuperación tras respuesta perdida depende de conciliación. Los registros
de pagos y auditoría no deben expirar automáticamente con los checkpoints de
conversación.

## Configuración y dependencias pendientes

- `mongodb` está instalado para pagos. Falta integrar y probar
  `@langchain/langgraph-checkpoint-mongodb` para checkpoint/reanudación en Bun.
  `MONGODB_URI` permanece en el gestor de secretos; colecciones y retención se
  configuran por entorno.
- `STELLAR_NETWORK` validada como Testnet para el piloto, `STELLAR_USDC_ISSUER`
  del asset de Testnet seleccionado, RPC/Horizon de esa red, dirección de cobro
  autorizada por comercio y política de fees. No interpolar estos valores desde
  contenido de productos.
- `@stellar/freighter-api` en el frontend web; si después se requieren varias
  wallets Stellar, evaluar Stellar Wallets Kit. Cuentas piloto con saldo y
  trustline USDC cuando corresponda. El backend no almacena claves del
  comprador. La opción de patrocinio de fees se diseña y prueba por separado.
- El BFF debe autenticar al comprador y afirmar el mismo `x-principal-id` usado
  en `approved_quotes`; este repo no implementa identidad de usuario.
- El productor de `QuoteSnapshot`, comercio piloto y forma de entregar/consultar
  la orden todavía deben integrarse antes de habilitar el endpoint en un
  entorno compartido.
- Al activar un proveedor real, readiness debe comprobar MongoDB y dependencias
  críticas del flujo. No se considera listo por la disponibilidad del
  placeholder `LocalDatabase` actual.

## Pruebas y criterio de demostración

- Unitarias: conversión exacta de importes, expiración, hash de cotización,
  cambios de estado, presupuesto e intent duplicado.
- Contrato: autenticación/propiedad del intent, operaciones OpenAPI, respuestas
  `application/problem+json` y códigos de error del dominio.
- Integración MongoDB: índices únicos, concurrencia, reintentos y transición
  condicional. Probar recuperación después de reiniciar el proceso.
- Integración Stellar Testnet: pago USDC real del comprador piloto al receptor
  piloto; verificar ledger, activo, emisor, origen, destino e importe. Cubrir
  firma rechazada, red incorrecta, fondos/trustline insuficientes, quote vencida,
  pago duplicado y respuesta perdida tras el envío.
- Si se acuerda una comisión, probar su cálculo y redondeo, presentación en la
  cotización, aprobación del total, conciliación de cada destinatario y el caso
  en que una de las partidas falla.
- Para afirmar cumplimiento del diagrama de smart account: prueba de límite por
  operación y por ventana, destinatario/activo no permitidos, revocación y
  rechazo on-chain de un intento fuera de política.
- Demo terminada: desde selección y aprobación de una oferta hasta una orden
  asociada a un único pago USDC confirmado, con `txHash` consultable. No marcar
  `paid` por recibir un hash ni por una respuesta del agente.

## Decisiones que debe cerrar el equipo

1. Comercio piloto y titular de la dirección que recibirá USDC; quién es
   merchant of record y cómo confirma/entrega la orden.
2. Producto digital o físico, moneda de precio y fuente de FX si no cotiza en
   USDC. Si no hay precio USDC verificable y vigente, no crear el intent.
3. Si la primera demo exige los límites on-chain del diagrama. Si los exige,
   priorizar la smart account Soroban y su integración de firma antes de llamar
   completo al flujo; el pago clásico es un hito parcial.
4. Si se devuelve el XDR al navegador para firma/envío o si el backend recibe
   el XDR firmado y lo envía. En ambos casos se verifica la operación realmente
   ejecutada en la red.
5. Política de reembolsos, errores del proveedor, retención de auditoría y
   custodia de cualquier cuenta operada por el servicio.
6. Si habrá comisión de plataforma y cuál de los dos modelos anteriores se
   usará; fijar tasa, base, topes, moneda, impuestos y devolución de la comisión.

## Fuentes primarias

- [Stellar: operación de pago con JavaScript](https://developers.stellar.org/docs/build/apps/example-application-tutorial/payment).
- [Stellar: firma de transacciones con Freighter](https://developers.stellar.org/docs/build/guides/freighter/prompt-to-sign-tx) y [firma de autorizaciones Soroban](https://developers.stellar.org/docs/build/guides/freighter/sign-auth-entries).
- [Stellar: cuentas contrato y firma de invocaciones](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations).
- [MetaMask Connect: redes soportadas](https://docs.metamask.io/metamask-connect/).
- [Stellar: operaciones múltiples y atomicidad](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions).
- [UCP: totales y autoridad del comercio en checkout](https://ucp.dev/specification/shopping/checkout/).
- [Stellar: x402 y wallets compatibles](https://developers.stellar.org/docs/build/agentic-payments/x402).
- [Stellar: interfaz de tokens Soroban](https://developers.stellar.org/docs/tokens/token-interface).
- [OpenZeppelin Stellar: smart accounts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account) y [políticas](https://docs.openzeppelin.com/stellar-contracts/accounts/policies).
- [MongoDB: transacciones del driver Node.js](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/) e [índices únicos](https://www.mongodb.com/docs/manual/core/index-unique/).
- [MongoDB: checkpointer de LangGraph.js](https://www.mongodb.com/docs/atlas/ai-integrations/langgraph-js/).
