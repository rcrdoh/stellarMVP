# ADR 0005: Intents de pago Stellar Testnet

## Status

Proposed

## Context

El backend debía recibir el XDR firmado por la wallet y confirmar un pago USDC
asociado a una cotización aprobada. La comisión, el comercio piloto, el BFF de
identidad y la experiencia de wallet aún no están definidos en este repositorio.

## Decision propuesta

- Implementar primero transferencias `payment` de activos clásicos en Stellar
  Testnet con `@stellar/stellar-sdk`; reservar Soroban smart accounts para otro
  hito, porque exigen contrato, política de gasto y firma de auth entries.
- Persistir `approved_quotes` y `payment_intents` con el driver oficial
  `mongodb`. La cotización aprobada es la autoridad de importe, activo, pagador,
  red y destinatarios. La comisión solo viaja como una partida ya aprobada.
- Dar al BFF rutas internas protegidas por `SERVICE_TOKEN` y `x-principal-id`.
  La wallet firma el XDR exacto; el backend comprueba el hash y la firma del
  pagador antes de enviar.
- Mantener un intent activo por pagador para que dos XDR no compartan el mismo
  número de secuencia. Guardar el hash antes del envío y consultar Horizon tras
  una respuesta incierta. Confirmar solo al leer el ledger y verificar todas
  las operaciones y sus destinatarios/importes.
- Apagar la feature por defecto y fallar al iniciar si se habilita sin MongoDB,
  token de servicio y configuración Testnet.

## Consecuencias

- El flujo permite conectar el frontend Freighter sin que el navegador conozca
  el token de servicio ni custodie claves en el backend.
- La API no crea cotizaciones, órdenes, reembolsos ni una comisión. El BFF debe
  entregar un principal autenticado y el checkout debe escribir la cotización
  aprobada antes del pago.
- La implementación no incluye smart-account limits on-chain, LangGraph Mongo
  checkpointer ni una prueba de pago end-to-end en Testnet. No representa un
  checkout listo para fondos reales.
- Los importes clásicos usan enteros `10^-7` (stroops) y el pago puede incluir
  como máximo una partida merchant y una platform en la misma transacción.

## Referencias

- `../stellar-payments-plan.md`.
- [Stellar JS SDK: payment app tutorial](https://developers.stellar.org/docs/build/apps/example-application-tutorial/payment).
- [Freighter: sign a transaction](https://developers.stellar.org/docs/build/guides/freighter/prompt-to-sign-tx).
- [MongoDB Node.js Driver: connect](https://www.mongodb.com/docs/drivers/node/current/connect/).
