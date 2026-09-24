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

- `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`
- `REMOTE_API_BASE_URL`, `REMOTE_API_KEY`
- `SYNC_ENABLED=true` (para que el servicio sincronice)

Nunca commitear `.env` (está en `.gitignore`).

En el release compilado, instalar dependencias de producción:

```powershell
npm ci --omit=dev
```

## 5. Descubrir el esquema y mapear

```powershell
npm run db:test
npm run discovery
# revisar docs/discovery-report.md
# crear config/mapping.json (ver docs/DATABASE_MAPPING.md)
npm run sync:products -- --dry-run
```

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
- Estado local: `data\connector.sqlite` (queue) y `data\sync-state.json` (cursores).
- Nunca se registran `DB_PASSWORD` ni `REMOTE_API_KEY`.

## Actualizar la versión

1. Generar nuevo `dist-release/` en desarrollo.
2. Detener el servicio (`npm run service:stop`).
3. Reemplazar `dist/` (y `scripts/`, `docs/` si cambiaron).
4. `npm run service:start`.

No se recomienda `git pull` en el servidor del cliente.

## Troubleshooting

- **El servicio no arranca**: revisar `logs\service-err.log`. Suele ser `.env`
  incompleto (`SYNC_ENABLED=true` exige SQL y API configurados).
- **"Missing DB_SERVER"**: completar `.env`.
- **READ ONLY = NO**: pedir al DBA un usuario con permisos solo de lectura.
- **No aparecen tablas en discovery**: el login no puede leer `sys.*`; pedir permiso
  de lectura de catálogo.
- **NSSM no encontrado**: instalarlo o pasar `-NssmPath`.

## Alternativa WinSW

WinSW permite definir el servicio con un XML (`navasoft-connector.xml`) y también
soporta auto-restart y logging. Se puede usar en lugar de NSSM:

1. Descargar `WinSW-x64.exe` desde el repositorio oficial de WinSW.
2. Crear `navasoft-connector.xml` apuntando a `node` con argumento
   `dist\index.js run` y `workingdirectory` al proyecto.
3. `navasoft-connector.exe install` / `start`.

NSSM sigue siendo la opción recomendada por simplicidad para Windows Server 2016.
