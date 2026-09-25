# Taxonomía de errores, códigos y comportamientos informativos v1

**Estado:** contrato normativo de la plantilla · **Ámbito:** dominios `CORE` y `PAY` de este servicio
**Base:** RFC 9457 (`application/problem+json`) extendido con campos de comportamiento
**Regla de oro:** *"falló"* y *"no sé si ocurrió"* son estados distintos. Confundirlos produce reintentos peligrosos o pérdida silenciosa. Esta taxonomía existe para que ese error sea imposible de cometer por accidente.

---

## 1. Por qué el contrato de error se fija primero

El error se define **antes** de que exista lo que puede fallar. Si cada cambio inventa su propio formato, los clientes ya están parseando strings y no pueden distinguir un rechazo de un timeout.

Esta base implementa los dominios `CORE` y `PAY`. Cada dominio se registra con `defineErrorCode` y conserva su rango semántico.

---

## 2. Formato del código

```
SVC-<DOMINIO>-<NNNN>
```

| Parte | Regla |
| --- | --- |
| `SVC` | Prefijo fijo. Distingue errores propios de errores de proveedor, que nunca se propagan tal cual. |
| `<DOMINIO>` | 3 o 4 letras mayúsculas. Los dominios registrados son `CORE` y `PAY`. |
| `<NNNN>` | Rango numérico que **determina la categoría semántica**. Un código nunca cambia de rango. |

### 2.1 Dominios

| Dominio | Módulo | Responsable de emitir |
| --- | --- | --- |
| `CORE` | Plataforma / kernel HTTP | Validación, autenticación, idempotencia, dependencias |
| `PAY` | Pagos Stellar | Cotización aprobada, ownership, intent y validación de transacción |

Otros dominios pueden añadirse al copiar la plantilla. El patrón público es `SVC-[A-Z]{3,4}-[0-9]{4}`.

### 2.2 Rangos = categorías

| Rango | Categoría | HTTP típico | Reintento | Efecto financiero posible |
| --- | --- | --- | --- | --- |
| `1000–1999` | `VALIDATION` | 400 / 422 | `never` | `none` |
| `2000–2999` | `AUTHN_AUTHZ` | 401 / 403 | `never` | `none` |
| `3000–3999` | `DECISION_DENY` | 403 / 409 | `never` | `none` |
| `4000–4999` | `STATE_CONFLICT` (idempotencia, estado, concurrencia) | 409 / 412 | `conditional` | `none` |
| `5000–5999` | `DEPENDENCY` (upstream, timeout, rate limit) | 429 / 502 / 504 | `safe_if_idempotent` | `none` o `unknown` |
| `6000–6999` | `INDETERMINATE` | 202 / 409 | `after_reconcile` | **`unknown`** |
| `9000–9999` | `INTERNAL` | 500 | `never` | `unknown` |

> El rango `6000` justifica la taxonomía. Un `6xxx` **nunca** se reintenta automáticamente: se persiste y se reconcilia.

---

## 3. Envelope canónico

```json
{
  "type": "https://example.com/errors/SVC-CORE-4003",
  "title": "resource_state_conflict",
  "status": 409,
  "code": "SVC-CORE-4003",
  "category": "STATE_CONFLICT",
  "detail_key": "core.resource_state_conflict",
  "behavior": {
    "retryable": "conditional",
    "financial_effect": "none",
    "human_action": "none",
    "agent_hint": "NONE",
    "retry_after_s": null
  },
  "correlation": {
    "trace_id": "01JZ..."
  },
  "occurred_at": "2026-08-30T14:02:11Z"
}
```

**Invariantes del envelope**

1. `detail_key` es una clave i18n, **no** un texto libre: el mensaje al usuario se resuelve en la UI y nunca contiene PII, montos de terceros, nombres de proveedor ni detalle interno.
2. `correlation` incluye siempre `trace_id`. Un error sin `trace_id` es un defecto, no un error.
3. Ningún error de proveedor se propaga literalmente. Se mapea a un código `SVC-*` y el original se guarda en el log, no en la respuesta.
4. `behavior` es **obligatorio y declarativo**: el consumidor (cliente, UI, workflow) decide qué hacer leyendo estos campos, nunca parseando el título.

### 3.1 Campos de comportamiento

| Campo | Valores | Quién lo consume |
| --- | --- | --- |
| `retryable` | `never` · `safe_if_idempotent` · `conditional` · `after_reconcile` | Clientes HTTP y orquestación |
| `financial_effect` | `none` · `unknown` · `possible_partial` | Operación y conciliación |
| `human_action` | `none` · `approve` · `step_up` · `contact_support` | UI / aprobación humana |
| `agent_hint` | enum cerrado (ver §5) | Clientes automáticos |
| `retry_after_s` | entero o `null` | Backoff del cliente; se refleja en header `Retry-After` |

> `agent_hint` es un enum cerrado a propósito. Si el consumidor pudiera recibir texto libre del error, el error se convierte en un vector de prompt injection.

---

## 4. Catálogo v1 — dominio `CORE`

| Código | `title` | HTTP | `retryable` | `financial_effect` | `human_action` |
| --- | --- | --- | --- | --- | --- |
| `SVC-CORE-1001` | `malformed_request_body` | 400 | never | none | none |
| `SVC-CORE-1002` | `schema_validation_failed` | 422 | never | none | none |
| `SVC-CORE-1003` | `unsupported_media_type` | 415 | never | none | none |
| `SVC-CORE-1004` | `idempotency_key_required` | 400 | never | none | none |
| `SVC-CORE-1005` | `invalid_money_amount_or_currency` | 422 | never | none | none |
| `SVC-CORE-1006` | `unknown_canonical_field` | 422 | never | none | none |
| `SVC-CORE-2001` | `credentials_missing` | 401 | never | none | none |
| `SVC-CORE-2002` | `credentials_invalid_or_expired` | 401 | never | none | none |
| `SVC-CORE-2003` | `insufficient_scope` | 403 | never | none | contact_support |
| `SVC-CORE-2004` | `mtls_required` | 401 | never | none | contact_support |
| `SVC-CORE-4001` | `idempotency_key_reused_with_different_payload` | 409 | never | none | none |
| `SVC-CORE-4002` | `idempotent_request_in_progress` | 409 | safe_if_idempotent | none | none |
| `SVC-CORE-4003` | `resource_state_conflict` | 409 | conditional | none | none |
| `SVC-CORE-4004` | `optimistic_lock_failed` | 409 | safe_if_idempotent | none | none |
| `SVC-CORE-5001` | `dependency_unavailable` | 502 | safe_if_idempotent | none | none |
| `SVC-CORE-5002` | `dependency_timeout` | 504 | safe_if_idempotent | unknown | none |
| `SVC-CORE-5003` | `rate_limited` | 429 | safe_if_idempotent | none | none |
| `SVC-CORE-5004` | `service_unavailable` | 503 | safe_if_idempotent | none | none |
| `SVC-CORE-6001` | `outcome_indeterminate` | 409 | after_reconcile | unknown | none |
| `SVC-CORE-9001` | `unhandled_internal_error` | 500 | never | unknown | contact_support |
| `SVC-CORE-9002` | `invalid_configuration_at_startup` | — (fail fast) | never | none | contact_support |

`SVC-CORE-9002` no se emite por HTTP: el proceso falla al arrancar.

### 4.1 Catálogo v1 — dominio `PAY`

| Código | `title` | HTTP | `retryable` | `financial_effect` | `human_action` |
| --- | --- | --- | --- | --- | --- |
| `SVC-PAY-3001` | `payment_quote_not_found` | 404 | never | none | none |
| `SVC-PAY-3002` | `payment_quote_expired` | 409 | never | none | none |
| `SVC-PAY-3003` | `payment_principal_not_authorized` | 403 | never | none | contact_support |
| `SVC-PAY-3004` | `payment_transaction_mismatch` | 409 | never | none | none |
| `SVC-PAY-3005` | `payment_intent_not_found` | 404 | never | none | none |

---

## 5. `agent_hint` — enum cerrado v1

| Valor | Significado para el consumidor |
| --- | --- |
| `NONE` | No hay acción automática válida; informar y detenerse. |
| `FIX_AND_RETRY` | El payload es corregible; reintentar una vez corregido. |
| `RETRY_WITH_BACKOFF` | Reintentar con la misma clave de idempotencia tras `retry_after_s`. |
| `REQUEST_HUMAN_APPROVAL` | Escalar a aprobación humana. |
| `REQUEST_STEP_UP` | Se requiere autenticación reforzada del principal. |
| `WAIT_FOR_SETTLEMENT` | Estado no terminal; no reintentar, esperar evento. |
| `ABORT_AND_REPORT` | Detener el flujo y reportar; posible efecto desconocido. |

---

## 6. Comportamientos informativos (no son errores)

Un estado pendiente no es un fallo. Si el cliente interpreta `PENDING` como error y reintenta, puede duplicar efectos.

| Respuesta | HTTP | Cuándo | Qué debe hacer el consumidor |
| --- | --- | --- | --- |
| `ACCEPTED_PENDING_SETTLEMENT` | 202 | Ejecución enviada, sin confirmación terminal | `WAIT_FOR_SETTLEMENT`; nunca reintentar |
| `ACCEPTED_PENDING_APPROVAL` | 202 | Requiere aprobación humana | Presentar al usuario; conservar el identificador de la operación |
| `PARTIALLY_SETTLED` | 200 | Liquidación parcial confirmada | No compensar automáticamente; abrir conciliación |
| `DEGRADED_MODE` | 200 + header `Warning` | Dependencia opcional caída | Continuar; registrar degradación en SLO |
| `IDEMPOTENT_REPLAY` | 200 + header `X-Idempotent-Replay: true` | Misma clave, mismo payload | Tratar como éxito original, no como nueva operación |

---

## 7. Pruebas obligatorias del catálogo

| # | Prueba | Falla si… |
| --- | --- | --- |
| 1 | **Registro único** | dos códigos comparten número, o un código no está en el registro central |
| 2 | **Código lanzado ⇒ código registrado** | un servicio emite un `SVC-*` ausente del registro (test estático + runtime) |
| 3 | **Coherencia rango↔categoría↔HTTP** | un `3xxx` se mapea a 500, o un `6xxx` declara `retryable: safe_if_idempotent` |
| 4 | **Envelope válido** | falta `code`, `category`, `behavior` o `correlation.trace_id` |
| 5 | **Sin fuga de datos** | el envelope contiene PII, secretos, stack trace o el mensaje literal del proveedor |
| 6 | **Idempotencia** | misma clave + mismo payload no devuelve la respuesta original; misma clave + payload distinto no devuelve `SVC-CORE-4001` |
| 7 | **`agent_hint` cerrado** | aparece un valor fuera del enum |
| 8 | **Snapshot de contrato** | el schema `problem+json` cambia sin bump de versión ni ADR |

---

## 8. Gobierno del catálogo

- Fuente de verdad: `src/domain/error-codes.ts` y este documento. Ambos se mantienen alineados.
- Añadir un código requiere PR con: rango correcto, `behavior` completo, prueba negativa que lo produce y entrada en el registro.
- Cambiar el `behavior` de un código existente requiere ADR: es un cambio de contrato para clientes ya desplegados.
- Un código nunca se reutiliza ni se renumera. Se deprecia con `deprecated_at` y se mantiene documentado.
