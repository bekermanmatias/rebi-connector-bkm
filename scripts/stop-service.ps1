#Requires -Version 5.1
[CmdletBinding()]
param([string]$ServiceName = "NavaSoftConnector")
$ErrorActionPreference = "Stop"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) { throw "El servicio '$ServiceName' no existe." }

if ($service.Status -eq "Stopped") {
  Write-Host "El servicio '$ServiceName' ya esta detenido."
  exit 0
}

Stop-Service -Name $ServiceName -Force
(Get-Service -Name $ServiceName).WaitForStatus("Stopped", "00:00:30")
Write-Host "Servicio '$ServiceName' detenido."
