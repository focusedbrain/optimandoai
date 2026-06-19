# Builds a cloud-init ISO from cloud-init-wrdesk.yaml (requires WSL + cloud-image-utils).
# Idempotent: skips if ISO exists and is newer than the yaml template.

param(
  [string]$OutIso,
  [string]$UserDataYaml
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $UserDataYaml) { $UserDataYaml = Join-Path $here 'cloud-init-wrdesk.yaml' }
if (-not $OutIso) { $OutIso = Join-Path $env:USERPROFILE '.opengiraffe\guest-state\cloud-init.iso' }

if (-not (Test-Path -LiteralPath $UserDataYaml)) {
  throw "cloud-init template missing: $UserDataYaml"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutIso) | Out-Null

if ((Test-Path -LiteralPath $OutIso) -and (Get-Item $OutIso).LastWriteTime -ge (Get-Item $UserDataYaml).LastWriteTime) {
  Write-Host "cloud-init ISO up to date: $OutIso"
  Write-Output $OutIso
  exit 0
}

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  throw @"
WSL is required to build the cloud-init ISO on Windows.
Install WSL, then inside Ubuntu run: sudo apt install cloud-image-utils
Re-run provision-win-home-guest.ps1
See build/guest/WIN-HOME-SETUP.md Step 4.
"@
}

$wslYaml = wsl wslpath -a $UserDataYaml
$wslIso = wsl wslpath -a $OutIso
wsl bash -lc "command -v cloud-localds >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq cloud-image-utils); cloud-localds '$wslIso' '$wslYaml'"

if (-not (Test-Path -LiteralPath $OutIso)) {
  throw "cloud-localds did not produce: $OutIso"
}

Write-Host "cloud-init ISO built: $OutIso"
Write-Output $OutIso
