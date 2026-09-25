# Instalación en Windows Server 2016

El connector corre como Windows Service usando **NSSM** (recomendado) o **WinSW**
como alternativa. No requiere Docker, Redis ni puertos entrantes.

## Requisitos

- Windows Server 2016 (x64).
- **Node.js LTS >= 18** (probado con Node 18/20/22). No se requieren Build Tools:
  el connector no usa módulos nativos.
- **NSSM** para instalar el servicio.
- Acceso a la réplica de SQL Server (usuario READ ONLY).
- Salida HTTPS (443) hacia la API externa.

> Importante: no instalar dependencias nativas. El proyecto fue diseñado sin
> módulos compilados (`better-sqlite3` fue descartado y reemplazado por un
> almacén JSON atómico en `data/`).

## 1. Instalar Node.js

1. Descargar el instalador MSI de Node.js LTS desde <https://nodejs.org>.
2. Instalar con opciones por defecto.
3. Verificar en PowerShell:

```powershell
node --version
npm --version
```

## 2. Instalar NSSM

NSSM no se descarga automáticamente (política de seguridad). Instalarlo manualmente:

1. Descargar desde <https://nssm.cc/download>.
2. Descomprimir, por ejemplo, en `C:\nssm`.
3. Localizar `C:\nssm\win64\nssm.exe`.
4. Opcional: agregar `C:\nssm\win64` al `PATH`.

Los scripts buscan NSSM en `%ProgramFiles%\nssm`, `C:\nssm`, `C:\tools\nssm` o el
`PATH`. También se puede pasar la ruta explícita con `-NssmPath`.

Si no se desea usar NSSM, ver "Alternativa WinSW" al final.

## 3. Copiar y preparar el proyecto

**Opción recomendada (artefacto compilado, sin git en el servidor):**

1. Generar el release en desarrollo: `npm run package`.
2. Copiar `dist-release/` al servidor (ej. `C:\NavaSoftConnector`).

**Opción alternativa (código fuente):**

```powershell
git clone <repo> C:\NavaSoftConnector
cd C:\NavaSoftConnector
npm ci
npm run build
```

## 4. Configurar entorno

```powershell
cd C:\NavaSoftConnector
copy .env.example .env
notepad .env
```

Completar como mínimo:

- `SQL_HOST=localhost`, `SQL_DATABASE=BdRebi`, `SQL_USER`, `SQL_PASSWORD`
- `CONNECTOR_API_TOKEN` (protege la API local)
- `BKM_API_URL`, `BKM_API_TOKEN`
- `SYNC_ENABLED=false` por defecto (activar solo cuando Sistemas confirme la
  frecuencia real de actualización de la réplica)

Nunca commitear `.env` (está en `.gitignore`).

En el release compilado, instalar dependencias de producción:

```powershell
npm ci --omit=dev
```

## 5. Validar conexión y API local

```powershell
npm run db:test        # confirma conexión SQL y READ ONLY
npm start              # levanta la API local en 127.0.0.1:3000
# en otra consola:
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer <CONNECTOR_API_TOKEN>" "http://127.0.0.1:3000/products?limit=5"
# sync manual (requiere BKM configurado):
curl -X POST -H "Authorization: Bearer <CONNECTOR_API_TOKEN>" http://127.0.0.1:3000/sync
```

`npm run discovery` sigue disponible como herramienta de diagnóstico del esquema,
pero la tabla y el mapeo reales ya están fijos en el código.

## 6. Instalar el servicio

Abrir PowerShell **como Administrador**:

```powershell
cd C:\NavaSoftConnector
npm run service:install
```

El script verifica Node, ejecuta `npm ci` + `npm run build` (salvo `-SkipBuild`),
crea `data/` y `logs/`, e instala y arranca el servicio con NSSM.

### Parámetros

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 `
  -ServiceName NavaSoftConnector `
  -AppDir C:\NavaSoftConnector `
  -NssmPath C:\nssm\win64\nssm.exe `
  -SkipBuild
```

## 7. Operar el servicio

| Acción | Comando |
| --- | --- |
| Instalar | `npm run service:install` |
| Iniciar | `npm run service:start` |
| Detener | `npm run service:stop` |
| Reiniciar | `npm run service:restart` |
| Estado | `npm run service:status` |
| Desinstalar | `npm run service:uninstall` |

Desinstalar **no** borra `data/`, `logs/` ni `.env`.

## 8. Logs y estado

- Logs: `logs\connector.log` (rotación por tamaño) y `logs\service-out.log` /
  `logs\service-err.log` (stdout/stderr capturados por NSSM).
- Estado local: `data\sync-state.json` (cursores), `data\last-sync.json` (último
  resultado de sync) y `data\connector.sqlite` (queue del modo genérico).
- Nunca se registran `SQL_PASSWORD`, `BKM_API_TOKEN` ni `CONNECTOR_API_TOKEN`.

## Actualizar la versión

1. Generar nuevo `dist-release/` en desarrollo.
2. Detener el servicio (`npm run service:stop`).
3. Reemplazar `dist/` (y `scripts/`, `docs/` si cambiaron).
4. `npm run service:start`.

No se recomienda `git pull` en el servidor del cliente.

## Troubleshooting

- **El servicio no arranca**: revisar `logs\service-err.log`. Suele ser `.env`
  incompleto o una variable con formato inválido.
- **"Missing SQL_HOST"**: completar `.env` (o usar los alias `DB_*`).
- **READ ONLY = NO**: pedir al DBA un usuario con permisos solo de lectura.
- **`/health` responde `degraded`**: SQL Server caído o credenciales incorrectas.
- **`/sync` responde `503 SYNC_NOT_CONFIGURED`**: falta `BKM_API_URL`/`BKM_API_TOKEN`.
- **`/products` responde `503 AUTH_NOT_CONFIGURED`**: falta `CONNECTOR_API_TOKEN`.
- **No aparecen tablas en discovery**: el login no puede leer `sys.*`; pedir permiso
  de lectura de catálogo.
- **NSSM no encontrado**: instalarlo o pasar `-NssmPath`.

## Alternativa WinSW

WinSW permite definir el servicio con un XML (`navasoft-connector.xml`) y también
soporta auto-restart y logging. Se puede usar en lugar de NSSM:

1. Descargar `WinSW-x64.exe` desde el repositorio oficial de WinSW.
2. Crear `navasoft-connector.xml` apuntando a `node` con argumento
   `dist\index.js serve` y `workingdirectory` al proyecto.
3. `navasoft-connector.exe install` / `start`.

NSSM sigue siendo la opción recomendada por simplicidad para Windows Server 2016.
