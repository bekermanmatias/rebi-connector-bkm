# cooperacion-navasoft-connector (rebi-connector-bkm)

Connector liviano que lee la **réplica READ ONLY** de NavaSoft (SQL Server) en el
mismo Windows Server, normaliza los productos, los expone por una **API HTTP
local** y los envía por **HTTPS saliente** a la API de BKM.

Diseñado para correr en **Windows Server 2016**, sin puertos entrantes, sin
Docker, sin Redis, sin servicios externos y **sin tocar producción**.

```
NavaSoft
   ↓  (réplica gestionada por Sistemas)
BdRebi.dbo.ProductoStock
   ↓  SELECT READ ONLY (localhost)
rebi-connector-bkm
   ├── API local  (GET /health, /products, /products/:code, /products/meta)
   └── sincronización HTTPS saliente (POST /sync → lotes de 500)
             ↓
          API BKM
             ↓
        CRM / Bot / IA
```

Tabla real: `dbo.ProductoStock` (PK `codi`). Mapeo:

| Columna SQL | Campo normalizado              |
| ----------- | ------------------------------ |
| `codi`      | `code` (PK)                    |
| `codf`      | `manufacturerCode`             |
| `nomfam`    | `family`                       |
| `nomsub`    | `subfamily`                    |
| `nomgru`    | `productGroup`                 |
| `descr`     | `description`                  |
| `marc`      | `brand` (vacío → `null`)       |
| `umed`      | `unit`                         |
| `stoc`      | `stock` (decimal, consolidado) |

Las columnas `CHAR` se leen con `RTRIM`. `price`, `priceList` y `currency` están
en el contrato pero hoy siempre valen `null` (todavía no hay precio en la réplica).

## Qué NO hace

- No escribe en NavaSoft ni en la réplica (todas las consultas pasan por un guard READ ONLY).
- No crea tablas, triggers, ni activa CDC.
- No abre SQL Server/1433 a Internet: se conecta a `localhost`.
- No necesita puertos entrantes; el tráfico hacia BKM es OUTBOUND HTTPS.
- No guarda secretos en Git.
- No elimina productos en el destino si desaparecen de una lectura.
- No depende de n8n.

## Quickstart (desarrollo)

```bash
git clone <repo>
cd rebi-connector-bkm
npm install
cp .env.example .env      # Windows: copy .env.example .env
# editar .env
npm run typecheck
npm run lint
npm test
npm run build
```

## Uso el día 1 en el servidor (RDP)

```powershell
# 1) Instalar dependencias y compilar
npm install
npm run build

# 2) Configurar credenciales y tokens (NO van a Git)
copy .env.example .env
notepad .env

# 3) Probar conexion SQL y confirmar READ ONLY
npm run db:test

# 4) Levantar la API local
npm start
#    -> http://127.0.0.1:3000/health

# 5) Probar endpoints (requieren Bearer CONNECTOR_API_TOKEN)
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer <CONNECTOR_API_TOKEN>" "http://127.0.0.1:3000/products?search=nicoll&inStock=true"

# 6) Disparar una sincronizacion manual hacia BKM
curl -X POST -H "Authorization: Bearer <CONNECTOR_API_TOKEN>" http://127.0.0.1:3000/sync
#    o por CLI:
npm run sync:bkm

# 7) (Opcional, cuando Sistemas confirme la frecuencia) activar sync automatico
#    en .env: SYNC_ENABLED=true y SYNC_INTERVAL_MINUTES=5
```

> El descubrimiento de esquema (`npm run discovery`) sigue disponible como
> herramienta de diagnóstico, pero ya no es un paso obligatorio: la tabla y el
> mapeo reales están fijos en el código.

## API local

Base por defecto: `http://127.0.0.1:3000` (`PORT` / `API_HOST`). Todos los
endpoints salvo `GET /health` requieren `Authorization: Bearer <CONNECTOR_API_TOKEN>`.

| Método | Ruta              | Descripción                                                                                               |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| GET    | `/health`         | Estado del proceso y de la conexión SQL. Público, sin secretos.                                           |
| GET    | `/products`       | Listado paginado. Filtros: `page`, `limit`, `search`, `brand`, `family`, `subfamily`, `group`, `inStock`. |
| GET    | `/products/:code` | Producto por `codi`. `404` si no existe.                                                                  |
| GET    | `/products/meta`  | `totalProducts`, `productsInStock`, `productsOutOfStock`, `brands`, `families`, `lastReadAt`.             |
| POST   | `/sync`           | Sincronización manual hacia BKM. `200`/`207`/`502`; `409` si ya corre; `503` si BKM no está configurada.  |
| GET    | `/sync/status`    | Estado de la sync en curso y último resumen.                                                              |

Si `CONNECTOR_API_TOKEN` está vacío, los endpoints protegidos responden `503`
(`AUTH_NOT_CONFIGURED`). CORS está cerrado: solo se habilitan los orígenes de
`CORS_ALLOWED_ORIGINS` y nunca se usa `*`. Hay rate limiting en memoria
(`API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS`).

Ver [docs/API_CONTRACT.md](docs/API_CONTRACT.md) para el contrato de la API local
y de los lotes enviados a BKM.

## Scripts

| Script                                                             | Descripción                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `npm run dev`                                                      | Ejecuta el servicio en modo watch (tsx).                     |
| `npm run build`                                                    | Compila a `dist/`.                                           |
| `npm start`                                                        | Ejecuta el servicio compilado (API local + sync programada). |
| `npm run serve`                                                    | Ejecuta la API local en modo desarrollo (tsx).               |
| `npm run sync:bkm`                                                 | Sincronización manual hacia BKM por CLI.                     |
| `npm run typecheck` / `lint` / `test`                              | Verificación.                                                |
| `npm run db:test`                                                  | Conexión + diagnóstico READ ONLY.                            |
| `npm run db:tables`                                                | Tablas/vistas con row count.                                 |
| `npm run db:columns -- <tabla>`                                    | Columnas detalladas.                                         |
| `npm run db:relations`                                             | Foreign keys.                                                |
| `npm run db:search -- <termino>`                                   | Busca tablas/columnas.                                       |
| `npm run db:sample -- <tabla> --limit 20`                          | Muestra limitada.                                            |
| `npm run discovery`                                                | Genera reportes de esquema.                                  |
| `npm run sync:products\|stock\|prices\|clients`                    | Full sync de un dataset.                                     |
| `npm run sync:full`                                                | Full sync de todo lo mapeado.                                |
| `npm run sync:incremental`                                         | Incremental (estrategia configurada/auto).                   |
| `npm run queue:status`                                             | Estado de queue y sync state.                                |
| `npm run queue:drain`                                              | Envía pendientes.                                            |
| `npm run service:install\|start\|stop\|restart\|status\|uninstall` | Servicio Windows.                                            |
| `npm run package`                                                  | Genera `dist-release/` sin secretos.                         |

## Estructura

```
src/
  index.ts                     # entrypoint (CLI o servicio)
  config/{env,constants}.ts    # validacion Zod + constantes
  db/                          # pool mssql, guard READ ONLY, health, inspector
  products/                    # types + mapper + repository (dbo.ProductoStock) + service
  bkm/                         # cliente HTTP hacia BKM + sync-service en lotes
  http/                        # server node:http, router, security (auth/CORS/rate limit), errores
  server/bootstrap.ts          # arranque de la API local + scheduler
  discovery/                   # heuristica + muestras + reporte (diagnostico)
  mapping/                     # modelos normalizados, mapping y mappers (legado)
  sync/                        # full, incremental, estado y scheduler (legado)
  queue/                       # queue local + retry (JSON atomico, legado)
  remote/                      # api-client, auth, payloads (legado)
  health/heartbeat.ts
  cli/commands.ts
  runtime/context.ts
  util/{backoff,fs-atomic,misc}.ts
scripts/                       # PowerShell (servicio) + package.mjs
docs/                          # DISCOVERY, MAPPING, INSTALL, SECURITY, API
config/mapping.example.json    # EXAMPLE (no real)
data/ logs/                    # estado y logs (gitignored)
```

## Configuración

Todas las variables se validan con Zod en `src/config/env.ts`. Ver `.env.example`.

Bloque principal (real):

```ini
NODE_ENV=production
PORT=3000
API_HOST=127.0.0.1
CONNECTOR_API_TOKEN=
CORS_ALLOWED_ORIGINS=

SQL_HOST=localhost
SQL_PORT=1433
SQL_DATABASE=BdRebi
SQL_USER=
SQL_PASSWORD=
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true

BKM_API_URL=
BKM_API_TOKEN=

SYNC_ENABLED=false
SYNC_INTERVAL_MINUTES=5
SYNC_BATCH_SIZE=500
```

Las variables `DB_*` y `REMOTE_API_*` siguen soportadas como alias del modo
genérico/legado. `npm run db:test` confirma conexión y permisos de solo lectura.

## Descubrimiento y mapping

El connector **no conoce** los nombres reales de NavaSoft. `npm run discovery`
genera un reporte con candidatos (productos, stock, precios, clientes, marcas,
familias, depósitos, listas), columnas de modificación y un mapping sugerido que
hay que **revisar**. Ver `docs/DATABASE_DISCOVERY.md` y `docs/DATABASE_MAPPING.md`.

## Deployment

No se hace `git pull` en el servidor del cliente. El flujo es:

```
GitHub → release → artefacto compilado (dist-release/) → Windows Server
```

`npm run package` genera `dist-release/` con `dist/`, `scripts/`, `docs/`,
`package.json` (solo dependencias de producción), `package-lock.json`,
`.env.example` y `README-INSTALL.txt`. **No incluye `.env` ni secretos.**

## Documentación

- [docs/DATABASE_DISCOVERY.md](docs/DATABASE_DISCOVERY.md)
- [docs/DATABASE_MAPPING.md](docs/DATABASE_MAPPING.md)
- [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/API_CONTRACT.md](docs/API_CONTRACT.md)

## Estado / pendientes

1. **Precio**: la réplica todavía no expone precio. El contrato (`price`,
   `priceList`, `currency`) ya está preparado, pero hoy se envía `null`.
2. **Frecuencia NavaSoft → BdRebi**: aún no está confirmada. Por eso el sync
   automático viene desactivado (`SYNC_ENABLED=false`); se habilitará con
   `SYNC_INTERVAL_MINUTES` cuando Sistemas confirme la cadencia real.
3. `stoc` está confirmado como **stock total consolidado**.
4. `codf` está confirmado como **código de fabricante**.
5. **Reconciliación explícita**: el connector no elimina productos en el destino;
   el contrato envía `allowDeletions=false` y queda preparado para implementar
   bajas controladas en el futuro.
