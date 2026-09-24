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
- **Timeouts**: `DB_CONNECTION_TIMEOUT_MS` y `DB_REQUEST_TIMEOUT_MS` acotan las
  operaciones.
- **Lecturas limitadas**: paginación con `OFFSET/FETCH` y `TOP (@n)` parametrizado.

## Red

- **Solo HTTPS saliente (443)** hacia la API externa.
- El connector **no abre puertos entrantes** y **no necesita recibir tráfico**.
- **No se expone SQL Server a Internet**: el connector corre dentro de la red del
  cliente o en el mismo servidor.
- Reintentos con backoff; si la API cae, los datos se encolan localmente y no se
  pierden.

## Secretos

- Los secretos viven **solo** en `.env`, que está en `.gitignore`.
- `.env.example` no contiene secretos reales.
- El artefacto `dist-release/` **no incluye** `.env`.
- En logs, Pino redacta `password`, `apiKey`, `DB_PASSWORD`, `REMOTE_API_KEY` y
  `authorization`.
- No se loguean payloads completos ni datos sensibles de clientes.

## Autenticación con la API

- `Authorization: Bearer <REMOTE_API_KEY>`.
- La API key es **revocable**; rotarla ante sospecha.
- `Idempotency-Key` (por batch) y `X-Request-Id` facilitan auditoría y evitan
  duplicados.
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
