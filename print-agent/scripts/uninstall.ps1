<#
.SYNOPSIS
  Removes Oilix Print Agent for the current Windows user.
  -KeepData keeps pairings, settings and logs (%LOCALAPPDATA%\Oilix\PrintAgent).
#>
param([switch]$KeepData)

$ErrorActionPreference = 'Stop'

Get-Process -Name 'OilixPrintAgent' -ErrorAction SilentlyContinue | ForEach-Object {
    $_ | Stop-Process -Force
    $_.WaitForExit(5000) | Out-Null
}

Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'OilixPrintAgent' -ErrorAction SilentlyContinue

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\OilixPrintAgent'
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }

if (-not $KeepData) {
    $dataDir = Join-Path $env:LOCALAPPDATA 'Oilix\PrintAgent'
    if (Test-Path $dataDir) { Remove-Item $dataDir -Recurse -Force }
}

Write-Host 'Oilix Print Agent désinstallé.' -ForegroundColor Green
