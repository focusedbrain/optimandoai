# Writes orchestrator-mode.json for fresh Windows installs (NSIS customInstall).
# Path MUST match electron/bootstrapUserData.ts getWrDeskUserDataPath().
# Windows role is always host — never writes mode: sandbox.

param(
  [string]$UserProfileRoot = $env:USERPROFILE
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($UserProfileRoot)) {
  Write-Error 'USERPROFILE is not set'
  exit 1
}

$dataDir = Join-Path -Path $UserProfileRoot -ChildPath '.opengiraffe\electron-data'
$seedPath = Join-Path -Path $dataDir -ChildPath 'orchestrator-mode.json'

# Reinstall / upgrade: never overwrite an existing seed (preserve mode and identity).
if (Test-Path -LiteralPath $seedPath) {
  exit 0
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$deviceName = $env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($deviceName)) {
  $deviceName = 'Windows PC'
}

$instanceId = [guid]::NewGuid().ToString()
$pairingCode = '{0:D6}' -f (Get-Random -Minimum 0 -Maximum 1000000)

$config = [ordered]@{
  mode            = 'host'
  deviceName      = $deviceName
  instanceId      = $instanceId
  pairingCode     = $pairingCode
  connectedPeers  = @()
}

$json = $config | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($seedPath, $json, [System.Text.UTF8Encoding]::new($false))
exit 0
