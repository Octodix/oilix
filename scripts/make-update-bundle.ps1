<#
.SYNOPSIS
  Packs the committed Oilix code into ONE file (git bundle) for an offline server update.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\make-update-bundle.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\make-update-bundle.ps1 -Upload

.DESCRIPTION
  - Refuses to run with uncommitted changes (only committed code is shipped).
  - Writes Desktop\oilix-update\oilix-update.bundle + server-update.sh + VERSION.txt.
  - -Upload: copies the folder to the server over the LAN (scp) and runs the update (ssh).
    You will be asked for the server password (twice: scp + ssh).
  Nothing goes through GitHub. No .env, no node_modules, no database is ever copied.
#>
param(
    [string]$Server = 'oilixu@192.168.1.249',
    [string]$OutDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'oilix-update'),
    [string]$Branch = 'main',
    [switch]$Upload
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    Write-Host $dirty
    throw 'Uncommitted changes. Commit first (git add -A ; git commit -m "...") then run again.'
}
$untracked = git status --porcelain | Where-Object { $_ -like '??*' }
if ($untracked) {
    Write-Warning "Untracked files are NOT shipped (add + commit them if needed):"
    $untracked | ForEach-Object { Write-Host "   $_" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$bundle = Join-Path $OutDir 'oilix-update.bundle'
if (Test-Path $bundle) { Remove-Item $bundle -Force }

git bundle create $bundle $Branch
if ($LASTEXITCODE -ne 0) { throw 'git bundle create failed' }
git bundle verify $bundle | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'git bundle verify failed' }

Copy-Item (Join-Path $repo 'scripts\server-update.sh') (Join-Path $OutDir 'server-update.sh') -Force
# LF line endings for bash on Ubuntu
$sh = Join-Path $OutDir 'server-update.sh'
[IO.File]::WriteAllText($sh, ([IO.File]::ReadAllText($sh) -replace "`r`n", "`n"))

$commit = git log -1 --format='%h %s (%ci)'
"Oilix update`r`nCommit: $commit`r`nBranch: $Branch`r`nCreated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')`r`n" |
    Set-Content -Encoding UTF8 (Join-Path $OutDir 'VERSION.txt')

$size = [Math]::Round((Get-Item $bundle).Length / 1MB, 1)
Write-Host ""
Write-Host "Update package ready: $OutDir  ($size MB)" -ForegroundColor Green
Write-Host "Commit: $commit"

if ($Upload) {
    Write-Host "`nCopying to $Server ..." -ForegroundColor Cyan
    ssh $Server 'mkdir -p /home/oilixu/updates'
    scp (Join-Path $OutDir 'oilix-update.bundle') $sh (Join-Path $OutDir 'VERSION.txt') "${Server}:/home/oilixu/updates/"
    if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
    Write-Host "Running the update on the server ..." -ForegroundColor Cyan
    ssh -t $Server 'bash /home/oilixu/updates/server-update.sh /home/oilixu/updates/oilix-update.bundle'
} else {
    Write-Host "`nNext: copy the folder to the server (USB or scp) and run:"
    Write-Host "  bash /home/oilixu/updates/server-update.sh /home/oilixu/updates/oilix-update.bundle"
}
