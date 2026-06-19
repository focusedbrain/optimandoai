# Starts the isolation guest and writes handoff for the Windows host launcher.
# Windows host does NOT start a local orchestrator process — only surfaces guest UI URL.

param(
  [string]$StateDir,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.opengiraffe\guest-state' }

$statePath = Join-Path $StateDir 'provision-state.json'
if (-not (Test-Path -LiteralPath $statePath)) {
  Write-Host 'Guest not provisioned. Run provision-win-home-guest.ps1 first.' -ForegroundColor Yellow
  exit 2
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$ports = Get-Content (Join-Path $here 'wrdesk-guest-ports.json') -Raw | ConvertFrom-Json
$coord = [int]$ports.coordination.port
$uiUrl = "http://127.0.0.1:$coord/"

$vmName = [string]$state.vmName
$hypervisor = [string]$state.hypervisor

switch ($hypervisor) {
  'virtualbox' {
    $vbox = @(
      (Get-Command VBoxManage.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
      "${env:ProgramFiles}\Oracle\VirtualBox\VBoxManage.exe",
      "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    $running = & $vbox list runningvms 2>$null | Where-Object { $_ -match [regex]::Escape($vmName) }
    if (-not $running) {
      Write-Host "Starting VirtualBox VM: $vmName"
      & $vbox startvm $vmName --type headless
    } else {
      Write-Host "VM already running: $vmName"
    }
  }
  'vmware' {
    $vmrun = @(
      (Get-Command vmrun.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
      "${env:ProgramFiles(x86)}\VMware\VMware Workstation\vmrun.exe",
      "${env:ProgramFiles}\VMware\VMware Workstation\vmrun.exe"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    $vmx = [string]$state.vmxPath
    if (-not (Test-Path -LiteralPath $vmx)) { throw "VMX missing: $vmx" }
    $list = & $vmrun list 2>$null
    if ($list -notmatch [regex]::Escape($vmx)) {
      Write-Host "Starting VMware VM: $vmx"
      & $vmrun start $vmx nogui
    } else {
      Write-Host 'VMware VM already running.'
    }
  }
  default { throw "Unknown hypervisor in state: $hypervisor" }
}

$handoffDir = Join-Path $env:USERPROFILE '.opengiraffe\electron-data'
New-Item -ItemType Directory -Force -Path $handoffDir | Out-Null
$handoffPath = Join-Path $handoffDir 'win-home-guest-handoff.json'

$handoff = [ordered]@{
  role = 'host'
  guestAppliance = 'isolation-depackaging'
  orchestratorUiUrl = $uiUrl
  coordinationPort = $coord
  p2pIngestPort = [int]$ports.p2pIngest.port
  vmName = $vmName
  hypervisor = $hypervisor
  launchedAt = (Get-Date).ToUniversalTime().ToString('o')
  note = 'Windows host launcher only; orchestrator runs inside guest appliance'
}
$handoff | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $handoffPath -Encoding UTF8

Write-Host "Handoff written: $handoffPath"
Write-Host "Orchestrator UI (guest): $uiUrl"

if (-not $NoBrowser) {
  Start-Process $uiUrl
}

exit 0
