# cooperacion-navasoft-connector (rebi-connector-bkm)

Connector liviano que lee la **réplica READ ONLY** de NavaSoft (SQL Server),
normaliza los datos, detecta cambios, los encola localmente y los envía por
**HTTPS saliente** a una API externa.

Diseñado para correr en **Windows Server 2016**, sin puertos entrantes, sin
Docker, sin Redis, sin servicios externos y **sin tocar producción**.

```
SQL Server (réplica, READ ONLY)
        ↓
Connector TypeScript (mssql)
        ↓  normalización (mappers + Zod)
        ↓  detección de cambios (full/incremental)
        ↓  queue local + retry (sobre data/)
        ↓  HTTPS 443 saliente
API externa (bearer auth)
```

## Qué NO hace

- No escribe en NavaSoft ni en la réplica.
- No crea triggers, no activa CDC, no abre SQL Server a Internet.
- No necesita puertos entrantes.
- No guarda secretos en Git.
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
# 1) Configurar credenciales de la replica
copy .env.example .env
notepad .env

# 2) Probar conexion y confirmar READ ONLY
npm run db:test

# 3) Descubrir el esquema real y generar reportes
npm run discovery
#    -> docs/discovery-report.md / .json

# 4) Crear config/mapping.json a partir del "Mapping sugerido"
#    (ver docs/DATABASE_MAPPING.md)

# 5) Validar sin enviar
npm run sync:products -- --dry-run

# 6) Carga inicial real
npm run sync:full

# 7) Instalar como servicio
npm run service:install
```

## Scripts

| Script                                                             | Descripción                                |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `npm run dev`                                                      | Ejecuta el servicio en modo watch (tsx).   |
| `npm run build`                                                    | Compila a `dist/`.                         |
| `npm start`                                                        | Ejecuta el servicio compilado.             |
| `npm run typecheck` / `lint` / `test`                              | Verificación.                              |
| `npm run db:test`                                                  | Conexión + diagnóstico READ ONLY.          |
| `npm run db:tables`                                                | Tablas/vistas con row count.               |
| `npm run db:columns -- <tabla>`                                    | Columnas detalladas.                       |
| `npm run db:relations`                                             | Foreign keys.                              |
| `npm run db:search -- <termino>`                                   | Busca tablas/columnas.                     |
| `npm run db:sample -- <tabla> --limit 20`                          | Muestra limitada.                          |
| `npm run discovery`                                                | Genera reportes de esquema.                |
| `npm run sync:products\|stock\|prices\|clients`                    | Full sync de un dataset.                   |
| `npm run sync:full`                                                | Full sync de todo lo mapeado.              |
| `npm run sync:incremental`                                         | Incremental (estrategia configurada/auto). |
| `npm run queue:status`                                             | Estado de queue y sync state.              |
| `npm run queue:drain`                                              | Envía pendientes.                          |
| `npm run service:install\|start\|stop\|restart\|status\|uninstall` | Servicio Windows.                          |
| `npm run package`                                                  | Genera `dist-release/` sin secretos.       |

## Estructura

```
src/
  index.ts                     # entrypoint (CLI o servicio)
  config/{env,constants}.ts    # validacion Zod + constantes
  db/
    connection.ts health.ts inspector.ts metadata.ts sql-guard.ts
    queries/{base,products,stock,prices,clients,dictionaries}.ts
  discovery/                   # heuristica + muestras + reporte
  mapping/                     # modelos normalizados, mapping y mappers
  sync/                        # full, incremental, estado y scheduler
  queue/                       # queue local + retry (JSON atomico)
  remote/                      # api-client, auth, payloads
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

Todas las variables se validan con Zod en `src/config/env.ts`.
El proceso se niega a sincronizar si faltan variables críticas
(SQL o API) cuando `SYNC_ENABLED=true`. Ver `.env.example`.

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

Pendiente hasta contar con acceso a la réplica: credenciales, nombre real de la
DB, esquema real, tablas y endpoints finales. Todo está preparado para completarse
ajustando `.env` y `config/mapping.json` sin reescribir el proyecto.
