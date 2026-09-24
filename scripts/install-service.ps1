#Requires -Version 5.1
<#
  Instala el connector NavaSoft como Windows Service usando NSSM.
  Requiere: Node.js LTS (>=18), npm, NSSM (ver docs/INSTALL_WINDOWS.md).
  NO descarga binarios. Si NSSM no esta, indica como instalarlo.
#>
[CmdletBinding()]
param(
  [string]$ServiceName = "NavaSoftConnector",
  [string]$AppDir = "",
  [string]$NssmPath = "",
  [string]$NodePath = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

if (-not $AppDir) {
  $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecutar este script como Administrador (PowerShell elevado)."
  }
}

function Resolve-NodeExe {
  param([string]$Explicit)
  if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Node.js no encontrado en PATH. Instalar Node.js LTS (>=18) y reintentar." }
  return $cmd.Source
}

function Resolve-NssmExe {
  param([string]$Explicit)
  if ($Explicit -and (Test-Path $Explicit)) { return (Resolve-Path $Explicit).Path }
  $candidates = @(
    (Join-Path ${env:ProgramFiles} "nssm\nssm.exe"),
    "C:\nssm\nssm.exe",
    "C:\tools\nssm\nssm.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw @"
No se encontro nssm.exe.
Instalar NSSM manualmente (no se descarga automaticamente):
  1. Descargar de https://nssm.cc/download
  2. Descomprimir (ej: C:\nssm) y localizar win64\nssm.exe
  3. Reejecutar este script con: -NssmPath C:\nssm\win64\nssm.exe
Alternativa soportada: WinSW. Ver docs/INSTALL_WINDOWS.md.
"@
}

Write-Host "== Instalacion del servicio: $ServiceName =="
Assert-Admin

$node = Resolve-NodeExe -Explicit $NodePath
Write-Host "Node.js: $node"
& $node --version

Push-Location $AppDir
try {
  if (-not $SkipBuild) {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
    if (-not $npm) { throw "npm no encontrado en PATH." }
    Write-Host "Instalando dependencias (npm ci)..."
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci fallo con codigo $LASTEXITCODE." }
    Write-Host "Compilando (npm run build)..."
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build fallo con codigo $LASTEXITCODE." }
  }
}
finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "data") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AppDir "logs") | Out-Null

$entry = Join-Path $AppDir "dist\index.js"
if (-not (Test-Path $entry)) { throw "No se encontro $entry. Ejecutar 'npm run build' primero." }
if (-not (Test-Path (Join-Path $AppDir ".env"))) {
  Write-Warning "No existe .env en $AppDir. Copiar .env.example a .env y completar credenciales antes de iniciar."
}

$nssm = Resolve-NssmExe -Explicit $NssmPath
Write-Host "NSSM: $nssm"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "El servicio ya existe; eliminando para reinstalar..."
  & $nssm stop $ServiceName | Out-Null
  Start-Sleep -Seconds 1
  & $nssm remove $ServiceName confirm | Out-Null
  Start-Sleep -Seconds 2
}

& $nssm install $ServiceName $node "`"$entry`" run"
& $nssm set $ServiceName AppDirectory $AppDir
& $nssm set $ServiceName DisplayName "NavaSoft Connector"
& $nssm set $ServiceName Description "Connector NavaSoft -> API externa (SQL READ ONLY)"
& $nssm set $ServiceName Start SERVICE_AUTO_START
& $nssm set $ServiceName AppStdout (Join-Path $AppDir "logs\service-out.log")
& $nssm set $ServiceName AppStderr (Join-Path $AppDir "logs\service-err.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 10485760
& $nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 5000

& $nssm start $ServiceName
Start-Sleep -Seconds 2
Write-Host "Servicio instalado. Estado:"
& $nssm status $ServiceName
Write-Host "Logs: $(Join-Path $AppDir 'logs')"
