# Seguridad

Principios y controles de seguridad del connector NavaSoft.

## Acceso a la base de datos

- **SQL READ ONLY**: el connector debe usar un usuario con permisos exclusivos de
  lectura sobre la réplica. Nunca producción.
- **Réplica**: se trabaja siempre contra una réplica, nunca contra producción.
- **Sin escritura**: no se ejecutan `INSERT/UPDATE/DELETE/MERGE/DROP/ALTER/TRUNCATE`.
- **Sin CDC automático**: no se activa Change Data Capture ni se crean triggers.
- **Guard propio** (`src/db/sql-guard.ts`): toda query configurable debe comenzar
  con `SELECT` o `WITH`; se rechazan palabras de escritura/DDL, prefijos `sp_`/`xp_`
  y múltiples sentencias. No se confía únicamente en los permisos SQL.
- **Queries parametrizadas**: los valores se bindean; los identificadores se citan
  con corchetes y se escapan. No hay interpolación de valores.
- **Timeouts**: `SQL_CONNECTION_TIMEOUT_MS` y `SQL_REQUEST_TIMEOUT_MS` acotan las
  operaciones.
- **Lecturas limitadas**: paginación con `OFFSET/FETCH` y `TOP (@n)` parametrizado.
- **Tabla real**: solo se lee `dbo.ProductoStock` mediante la capa
  `src/products/repository.ts` (query canónica centralizada).

## Red

- **Solo HTTPS saliente (443)** hacia la API BKM.
- El connector **no abre puertos entrantes** y **no necesita recibir tráfico** de
  Internet.
- **NO abrir SQL Server / 1433 a Internet.** El connector corre en el mismo
  Windows Server y se conecta a `localhost` (`SQL_HOST=localhost`).
- La comunicación externa preferida es **OUTBOUND** desde el servidor hacia la
  infraestructura de BKM (nunca conexiones entrantes hacia SQL Server).
- Reintentos con backoff; si la API cae, se conserva el diagnóstico de cada lote
  (`syncId`, `batchId`, `batchIndex`, error) y la sync termina en `FAILED` o
  `PARTIAL` sin modificar SQL.

## API local del connector

- Escucha por defecto en `127.0.0.1:3000` (`API_HOST`/`PORT`), no expuesta a
  Internet.
- Todos los endpoints salvo `GET /health` requieren
  `Authorization: Bearer <CONNECTOR_API_TOKEN>` (comparación timing-safe).
- Si `CONNECTOR_API_TOKEN` está vacío, los endpoints protegidos responden `503`
  (`AUTH_NOT_CONFIGURED`) en lugar de quedar abiertos.
- **CORS cerrado**: solo los orígenes de `CORS_ALLOWED_ORIGINS`; nunca `*`.
- **Rate limiting** en memoria (`API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS`).
- `GET /health` nunca expone usuario SQL, password, connection string ni stack
  traces; los errores HTTP usan códigos genéricos.

## Secretos

- Los secretos viven **solo** en `.env`, que está en `.gitignore`.
- `.env.example` no contiene secretos reales.
- El artefacto `dist-release/` **no incluye** `.env`.
- En logs, Pino redacta `password`, `apiKey`, `DB_PASSWORD`, `SQL_PASSWORD`,
  `REMOTE_API_KEY`, `BKM_API_TOKEN`, `CONNECTOR_API_TOKEN` y `authorization`.
- No se loguean payloads completos ni datos sensibles de clientes; el token de BKM
  nunca aparece en logs.

## Autenticación con la API

- API BKM: `Authorization: Bearer <BKM_API_TOKEN>`.
- La API key es **revocable**; rotarla ante sospecha.
- `Idempotency-Key` (por batch), `X-Sync-Id` y `X-Batch-Index` facilitan auditoría
  y evitan duplicados.
- El diseño permite reemplazar Bearer por HMAC o mTLS implementando `AuthStrategy`
  (`src/remote/auth.ts`) sin tocar el resto del sistema.

## Datos sensibles

- Los reportes de discovery enmascaran columnas sensibles (`ruc`, `dni`,
  `documento`, `telefono`, `email`, `direccion`, `razon_social`, `password`, etc.).
- `docs/discovery-report.*` y `config/mapping.json` están en `.gitignore`.
- Las muestras son limitadas y no se vuelcan tablas completas.

## Mínimo privilegio

- Usuario SQL dedicado con `db_datareader` (o `SELECT` por tabla) y **sin**
  `db_datawriter`, `db_owner` ni roles de escritura.
- Cuenta de servicio de Windows con los mínimos permisos sobre la carpeta del
  connector.

## Scheduler y persistencia

- El estado local (queue y cursores) se guarda en `data/` con escritura atómica
  (archivo temporal + rename) para evitar corrupción ante cortes.
- Un batch rechazado con error no reintentable (4xx) se marca permanente y no se
  reintenta; los errores de red/5xx se reintentan con backoff.
