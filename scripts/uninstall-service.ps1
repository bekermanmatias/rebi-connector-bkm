#Requires -Version 5.1
<#
  Detiene y elimina el Windows Service del connector.
  No borra datos (data/, logs/, .env).
#>
[CmdletBinding()]
param(
  [string]$ServiceName = "NavaSoftConnector",
  [string]$NssmPath = ""
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecutar este script como Administrador (PowerShell elevado)."
  }
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
  return $null
}

Assert-Admin

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Write-Host "El servicio '$ServiceName' no existe."
  exit 0
}

Write-Host "Deteniendo servicio '$ServiceName'..."
if ($service.Status -ne "Stopped") {
  Stop-Service -Name $ServiceName -Force
  (Get-Service -Name $ServiceName).WaitForStatus("Stopped", "00:00:30")
}

$nssm = Resolve-NssmExe -Explicit $NssmPath
if ($nssm) {
  Write-Host "Eliminando con NSSM..."
  & $nssm remove $ServiceName confirm | Out-Null
}
else {
  Write-Host "NSSM no encontrado; eliminando con sc.exe..."
  & sc.exe delete $ServiceName | Out-Null
}

Write-Host "Servicio '$ServiceName' eliminado. Los datos en data/ y logs/ se conservan."
