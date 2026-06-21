# VMware Workstation path — detect + document; idempotent if VMX already exists.

param(
  [string]$VmName = 'WRDesk-Home-Isolation-Guest',
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.opengiraffe\guest-state' }
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

$detect = & (Join-Path $here 'detect-hypervisor.ps1')
if ($detect -ne 'vmware') {
  throw "VMware provisioning requires VMware Workstation; detected: $detect"
}

$vmrun = @(
  (Get-Command vmrun.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "${env:ProgramFiles(x86)}\VMware\VMware Workstation\vmrun.exe",
  "${env:ProgramFiles}\VMware\VMware Workstation\vmrun.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

$ports = Get-Content (Join-Path $here 'wrdesk-guest-ports.json') -Raw | ConvertFrom-Json
$coord = [int]$ports.coordination.port
$p2p = [int]$ports.p2pIngest.port

$fetchOut = & (Join-Path $here 'fetch-ubuntu-cloud-image.ps1') | ConvertFrom-Json
$imagePath = $fetchOut.path

$vmxDir = Join-Path $StateDir 'vmware'
New-Item -ItemType Directory -Force -Path $vmxDir | Out-Null
$vmxPath = Join-Path $vmxDir "$VmName.vmx"
$statePath = Join-Path $StateDir 'provision-state.json'

if (-not (Test-Path -LiteralPath $vmxPath)) {
  Write-Host @"
VMware automated import is not fully scripted in this release.
Manual step (one-time):
  1. Open VMware Workstation.
  2. Create a new VM from existing disk: $imagePath
  3. Name it: $VmName
  4. Configure NAT port forwarding:
     - Host $coord -> Guest $coord (coordination)
     - Host $p2p -> Guest $p2p (P2P ingest)
  5. Save VMX to: $vmxPath
Then re-run provision-win-home-guest.ps1
"@
  throw 'VMware VMX not found; complete manual import per instructions above.'
}

$state = [ordered]@{
  vmName = $VmName
  hypervisor = 'vmware'
  vmxPath = $vmxPath
  provisionedAt = (Get-Date).ToUniversalTime().ToString('o')
  imagePath = $imagePath
  ports = @{ coordination = $coord; p2pIngest = $p2p }
  applianceKind = 'isolation-depackaging'
  orchestratorMode = 'host-only-on-windows'
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Host "VMware provision state recorded: $statePath"
$statePath
