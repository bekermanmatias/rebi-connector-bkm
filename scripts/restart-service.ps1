#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ServiceName = "NavaSoftConnector",
  [int]$WaitSeconds = 5
)
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "stop-service.ps1") -ServiceName $ServiceName
Start-Sleep -Seconds $WaitSeconds
& (Join-Path $PSScriptRoot "start-service.ps1") -ServiceName $ServiceName
