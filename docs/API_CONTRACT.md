# API Contract

Este documento cubre dos contratos:

1. **API local del connector** (la que expone `rebi-connector-bkm`).
2. **Contrato saliente hacia BKM** (lo que el connector envía a `BKM_API_URL`).

Al final se conserva el contrato del **modo genérico/legado** (`REMOTE_API_*`).

---

## 1. API local

Base por defecto: `http://127.0.0.1:3000` (`PORT`, `API_HOST`). No se expone a
Internet. Autenticación: `Authorization: Bearer <CONNECTOR_API_TOKEN>` en todos
los endpoints salvo `GET /health`.

### Headers de seguridad

- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`
- CORS acotado a `CORS_ALLOWED_ORIGINS` (nunca `*`).
- Rate limit en memoria: `API_RATE_LIMIT_MAX` por `API_RATE_LIMIT_WINDOW_MS`.

### GET /health (público)

```json
{
  "status": "ok",
  "service": "cooperacion-navasoft-connector",
  "version": "0.1.0",
  "timestamp": "2026-01-01T12:00:00.000Z",
  "uptimeSeconds": 3600,
  "sql": { "connected": true, "latencyMs": 3 }
}
```

`status` es `ok` o `degraded` (SQL caído). Nunca incluye usuario, password,
connection string ni stack traces.

### GET /products

Query params:

| Param | Descripción |
| --- | --- |
| `page` | Página (1+). Default 1. |
| `limit` | Tamaño (1..`PRODUCTS_MAX_LIMIT`=500). Default 50. |
| `search` | Busca en code/description/brand/manufacturerCode/family/subfamily/group (LIKE por bind). |
| `brand` | Filtro exacto por `marc`. |
| `family` | Filtro exacto por `nomfam`. |
| `subfamily` | Filtro exacto por `nomsub`. |
| `group` | Filtro exacto por `nomgru`. |
| `inStock` | `true/1/yes/si/sí` → `stoc > 0`; `false/0/no` → `stoc <= 0`. |

```json
{
  "page": 1, "limit": 50, "total": 3319, "totalPages": 67,
  "data": [
    {
      "code": "123", "manufacturerCode": "ACME", "family": "HERRAMIENTAS",
      "subfamily": "MANUALES", "productGroup": "GENERAL", "description": "Martillo",
      "brand": "TRUPER", "unit": "UN", "stock": 12.5,
      "price": null, "priceList": null, "currency": null
    }
  ]
}
```

### GET /products/:code

Producto por `codi`. `404` (`NOT_FOUND`) si no existe.

### GET /products/meta

```json
{
  "totalProducts": 3319,
  "productsInStock": 1054,
  "productsOutOfStock": 2265,
  "brands": ["..."],
  "families": ["..."],
  "lastReadAt": "2026-01-01T11:59:50.000Z"
}
```

No existe `lastUpdatedAt`: la réplica no expone fecha de actualización hoy.

### POST /sync

Dispara una sincronización manual hacia BKM. Requiere Bearer.

- `200` → `status: "SUCCESS"`
- `207` → `status: "PARTIAL"` (algunos lotes fallaron)
- `502` → `status: "FAILED"` (todos fallaron o error)
- `409` `SYNC_IN_PROGRESS` si ya hay una sync corriendo
- `503` `SYNC_NOT_CONFIGURED` si falta `BKM_API_URL`/`BKM_API_TOKEN`

```json
{
  "syncId": "uuid", "status": "SUCCESS",
  "startedAt": "...", "finishedAt": "...", "durationMs": 1234,
  "totalRead": 3319, "totalSent": 3319,
  "batches": 7, "batchesSent": 7, "batchesFailed": 0,
  "success": true, "error": null, "errors": []
}
```

### GET /sync/status

`{ "running": false, "last": { ...SyncResult... } }`.

---

## 2. Contrato saliente hacia BKM

Base URL: `BKM_API_URL` (HTTPS). Auth: `Authorization: Bearer <BKM_API_TOKEN>`.
El connector hace `POST` por cada lote de `SYNC_BATCH_SIZE` (default **500**).

### Headers

| Header | Valor |
| --- | --- |
| `Authorization` | `Bearer <BKM_API_TOKEN>` |
| `Content-Type` | `application/json` |
| `X-Connector-Id` | `CONNECTOR_ID` |
| `X-Sync-Id` | `syncId` |
| `X-Batch-Index` | Índice del lote (0-based) |
| `Idempotency-Key` | `batchId` (estable entre reintentos) |
| `User-Agent` | `cooperacion-navasoft-connector/<version>` |

### Envelope de lote

```json
{
  "connectorId": "cooperacion-navasoft",
  "clientId": "cooperacion-peru",
  "dataset": "products",
  "syncId": "uuid",
  "batchId": "uuid",
  "batchIndex": 0,
  "totalBatches": 7,
  "sentAt": "2026-01-01T12:00:00.000Z",
  "mode": "upsert",
  "allowDeletions": false,
  "data": [ /* ProductDto */ ]
}
```

### Idempotencia y borrados

- Identidad de cada producto: **`code`**. Un mismo `code` es el mismo producto.
- La API BKM **debe** ser idempotente por `Idempotency-Key`/`batchId`.
- `allowDeletions: false`: el connector **no elimina** productos que desaparezcan
  de una lectura. La reconciliación explícita queda como trabajo futuro.

### Reintentos

- Éxito: `2xx`.
- Se reintenta ante red y `408, 425, 429, 5xx` hasta `BKM_RETRY_MAX` (default 2).
- `4xx` (excepto 408/425/429) es **definitivo**: no se reintenta.

---

## 3. Modo genérico (legado)

Contrato entre el connector y una API externa genérica. Se conserva por
compatibilidad; no es el flujo productivo actual.

Base URL: `REMOTE_API_BASE_URL` (HTTPS). Autenticación: `Bearer`.

### Endpoints de datos

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
