#Requires -Version 5.1
[CmdletBinding()]
param([string]$ServiceName = "NavaSoftConnector")
$ErrorActionPreference = "Stop"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Write-Host "El servicio '$ServiceName' NO esta instalado."
  exit 1
}

$service.Refresh()
Write-Host "Servicio : $ServiceName"
Write-Host "Estado   : $($service.Status)"
Write-Host "Inicio   : $($service.StartType)"
$wmi = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if ($wmi) {
  Write-Host "PathName : $($wmi.PathName)"
  Write-Host "PID      : $($wmi.ProcessId)"
}
