<#
.SYNOPSIS
  Builds, tests and publishes Oilix Print Agent for Windows x64.

.DESCRIPTION
  Output: print-agent\dist\OilixPrintAgent\ (OilixPrintAgent.exe + install/uninstall scripts).
  Default is a self-contained single-file exe (no .NET install needed on the workstation).
  Use -FrameworkDependent for a much smaller exe when the .NET 8 Desktop + ASP.NET Core
  runtimes are already installed on every workstation.
#>
param(
    [switch]$FrameworkDependent,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\OilixPrintAgent\OilixPrintAgent.csproj'
$dist = Join-Path $root 'dist\OilixPrintAgent'

if (-not $SkipTests) {
    dotnet test (Join-Path $root 'OilixPrintAgent.sln') -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
}

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }

$publishArgs = @(
    'publish', $project,
    '-c', 'Release',
    '-r', 'win-x64',
    '-o', $dist,
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:DebugType=none'
)
if ($FrameworkDependent) {
    $publishArgs += '--self-contained', 'false'
} else {
    $publishArgs += '--self-contained', 'true', '-p:EnableCompressionInSingleFile=true'
}

dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw 'Publish failed' }

Copy-Item (Join-Path $PSScriptRoot 'install.ps1') $dist
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $dist
Copy-Item (Join-Path $root 'README.md') $dist -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "Published to $dist" -ForegroundColor Green
Get-ChildItem $dist | Select-Object Name, Length | Format-Table -AutoSize
