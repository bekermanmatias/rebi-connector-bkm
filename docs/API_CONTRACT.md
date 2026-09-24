# API Contract

Contrato entre el connector y la API externa. La API todavía no está definida por
el cliente; este documento define lo que el connector **espera y envía**, para que
la API se implemente en consecuencia.

Base URL: `REMOTE_API_BASE_URL` (HTTPS). Autenticación: `Bearer`.

## Headers

| Header | Valor |
| --- | --- |
| `Authorization` | `Bearer <REMOTE_API_KEY>` |
| `Content-Type` | `application/json` |
| `X-Connector-Id` | `CONNECTOR_ID` |
| `X-Request-Id` | UUID por envío lógico |
| `Idempotency-Key` | `batchId` (estable entre reintentos) |
| `User-Agent` | `cooperacion-navasoft-connector/<version>` |

## Endpoints de datos

| Dataset | Método | Endpoint |
| --- | --- | --- |
| products | POST | `/integrations/navasoft/products/batch` |
| stock | POST | `/integrations/navasoft/stock/batch` |
| prices | POST | `/integrations/navasoft/prices/batch` |
| clients | POST | `/integrations/navasoft/clients/batch` |
| dictionaries | POST | `/integrations/navasoft/dictionaries/batch` |

## Envelope de batch

```json
{
  "connectorId": "cooperacion-navasoft",
  "clientId": "cooperacion-peru",
  "dataset": "products",
  "sentAt": "2026-01-01T12:00:00.000Z",
  "batchId": "8f1e...uuid",
  "data": [ /* registros normalizados */ ]
}
```

Tamaño de batch configurable con `REMOTE_BATCH_SIZE` (default **500**).

### Registros por dataset

**products**
```json
{
  "sourceId": "123", "sku": "A-100", "barcode": null,
  "name": "Martillo", "description": null,
  "brand": { "id": "5", "name": "Stanley" },
  "family": "Herramientas", "subfamily": null, "group": null,
  "unit": "UN", "active": true,
  "sourceUpdatedAt": "2026-01-01T00:00:00.000Z"
}
```

**stock**
```json
{ "productSourceId": "123", "warehouseSourceId": "1", "physical": 10, "reserved": 2, "committed": 0, "available": 8, "sourceUpdatedAt": null }
```

**prices**
```json
{ "productSourceId": "123", "priceListSourceId": "2", "amount": 12.5, "currency": "PEN", "taxIncluded": true, "sourceUpdatedAt": null }
```

**clients**
```json
{ "sourceId": "900", "taxId": "20123456789", "businessName": "Ferreteria X", "priceListSourceId": "2", "active": true, "sourceUpdatedAt": null }
```

**dictionaries**
```json
{ "type": "brands", "sourceId": "5", "name": "Stanley", "active": true, "sourceUpdatedAt": null }
```

## Heartbeat

`POST /integrations/navasoft/heartbeat` cada `HEARTBEAT_SECONDS` (default 30):

```json
{
  "connectorId": "cooperacion-navasoft",
  "clientId": "cooperacion-peru",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "version": "0.1.0",
  "sqlConnected": true,
  "lastDbReadAt": "2026-01-01T11:59:50.000Z",
  "lastSuccessfulSyncAt": "2026-01-01T11:58:00.000Z",
  "queuePending": 0,
  "memoryUsageMb": 48.2,
  "uptimeSeconds": 3600,
  "replicaLastUpdateAt": "2026-01-01T11:55:00.000Z",
  "replicaLagSeconds": 300
}
```

`replicaLastUpdateAt` y `replicaLagSeconds` son **best-effort** (pueden ser `null`
si no hay columna de fecha detectada).

## Respuestas y reintentos

- Éxito: HTTP `2xx`.
- El connector reintenta (inmediato, hasta 2 veces) ante errores de red y
  `408, 425, 429, 5xx`.
- Tras agotar los reintentos inmediatos, el batch queda en la queue local
  (`FAILED`) y se reintenta con backoff: 5s, 15s, 30s, 1m, 5m, 15m, 30m y luego
  cada 30m.
- `4xx` distinto de 408/425/429 se considera **definitivo**: el batch no se
  reintenta (se marca `permanent` y se loguea como error).

### Idempotencia

La API **debe** ser idempotente por `Idempotency-Key` / `batchId`: si un batch ya
fue procesado, responder `2xx` sin duplicar datos. Esto es clave porque el
connector puede reintentar tras timeouts.

## Autenticación futura

El cliente HTTP usa `AuthStrategy` (`src/remote/auth.ts`). Se puede migrar a
**HMAC-SHA256** o **mTLS** sin cambiar el resto del sistema.
