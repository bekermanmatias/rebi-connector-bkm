#Requires -Version 5.1
[CmdletBinding()]
param([string]$ServiceName = "NavaSoftConnector")
$ErrorActionPreference = "Stop"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) { throw "El servicio '$ServiceName' no existe. Instalar con install-service.ps1." }

if ($service.Status -eq "Running") {
  Write-Host "El servicio '$ServiceName' ya esta en ejecucion."
  exit 0
}

Start-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus("Running", "00:00:30")
Write-Host "Servicio '$ServiceName' iniciado."
