<#
.SYNOPSIS
  Installs (or updates) Oilix Print Agent for the current Windows user.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -AllowOrigin http://192.168.1.10:3000

.DESCRIPTION
  - Copies OilixPrintAgent.exe to %LOCALAPPDATA%\Programs\OilixPrintAgent (no admin rights needed).
  - Pre-approves the Oilix web address(es) given with -AllowOrigin.
  - -RestrictPairing: only those addresses may even request pairing.
  - Registers start with Windows (HKCU Run) and starts the agent in the notification area.
  Re-running the script updates an existing installation; pairings and settings are kept.
#>
param(
    [string[]]$AllowOrigin = @(),
    [switch]$RestrictPairing,
    [switch]$NoAutoStart
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'OilixPrintAgent.exe'
if (-not (Test-Path $source)) { throw "OilixPrintAgent.exe introuvable à côté de install.ps1 ($PSScriptRoot)" }

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\OilixPrintAgent'
$target = Join-Path $installDir 'OilixPrintAgent.exe'

# WebView2 Runtime (Evergreen) renders and prints the documents. Preinstalled on Windows 11.
$wv2Keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$wv2 = $wv2Keys | Where-Object { Test-Path $_ } | ForEach-Object { (Get-ItemProperty $_).pv } |
    Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
if (-not $wv2) {
    Write-Warning 'Microsoft Edge WebView2 Runtime introuvable. Installez-le : https://go.microsoft.com/fwlink/p/?LinkId=2124703'
} else {
    Write-Host "WebView2 Runtime $wv2" -ForegroundColor DarkGray
}

# Stop a running instance so the exe can be replaced (update).
Get-Process -Name 'OilixPrintAgent' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Arrêt de l'agent en cours (PID $($_.Id))..."
    $_ | Stop-Process -Force
    $_.WaitForExit(5000) | Out-Null
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item $source $target -Force
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $installDir -Force -ErrorAction SilentlyContinue

$configArgs = @()
foreach ($o in $AllowOrigin) { $configArgs += '--allow-origin', $o }
if ($RestrictPairing) { $configArgs += '--restrict-pairing' }
if ($configArgs.Count -gt 0) {
    $p = Start-Process -FilePath $target -ArgumentList ($configArgs + '--configure-only') -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Configuration échouée (code $($p.ExitCode))" }
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($NoAutoStart) {
    Remove-ItemProperty -Path $runKey -Name 'OilixPrintAgent' -ErrorAction SilentlyContinue
} else {
    New-Item -Path $runKey -Force | Out-Null
    Set-ItemProperty -Path $runKey -Name 'OilixPrintAgent' -Value "`"$target`" --background"
}

Start-Process -FilePath $target -ArgumentList '--background'
Start-Sleep -Seconds 2

try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:17777/v1/health' -TimeoutSec 5
    Write-Host "Oilix Print Agent v$($h.version) actif sur http://127.0.0.1:17777" -ForegroundColor Green
} catch {
    Write-Warning "L'agent ne répond pas encore. Vérifiez l'icône dans la zone de notification et les journaux : $env:LOCALAPPDATA\Oilix\PrintAgent\logs"
}

Write-Host ''
Write-Host 'Étape suivante : dans Oilix, ouvrez Appareils > Imprimantes de ce poste, appairez le navigateur'
Write-Host 'avec le code affiché par l''agent, choisissez les imprimantes puis « Tester l''impression ».'
