# VirtualBox-specific idempotent guest provisioning for Windows Home.

param(
  [string]$VmName = 'WRDesk-Home-Isolation-Guest',
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.opengiraffe\guest-state' }
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

$detect = & (Join-Path $here 'detect-hypervisor.ps1')
if ($detect -ne 'virtualbox') {
  throw "VirtualBox provisioning requires VirtualBox; detected: $detect"
}

$vbox = @(
  (Get-Command VBoxManage.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "${env:ProgramFiles}\Oracle\VirtualBox\VBoxManage.exe",
  "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

$ports = Get-Content (Join-Path $here 'wrdesk-guest-ports.json') -Raw | ConvertFrom-Json
$coord = [int]$ports.coordination.port
$p2p = [int]$ports.p2pIngest.port

$fetchOut = & (Join-Path $here 'fetch-ubuntu-cloud-image.ps1') | ConvertFrom-Json
$imagePath = $fetchOut.path

$statePath = Join-Path $StateDir 'provision-state.json'
$vmExists = $false
& $vbox list vms 2>$null | ForEach-Object {
  if ($_ -match "`"$([regex]::Escape($VmName))`"") { $vmExists = $true }
}

if (-not $vmExists) {
  Write-Host "Creating VM: $VmName"
  & $vbox createvm --name $VmName --ostype Ubuntu_64 --register
  & $vbox modifyvm $VmName --memory 4096 --cpus 2 --nested-hw-virt on --graphicscontroller vmsvga
  & $vbox modifyvm $VmName --nic1 nat
  & $vbox modifyvm $VmName --natpf1 "coordination,tcp,,$coord,,$coord"
  & $vbox modifyvm $VmName --natpf1 "p2p-ingest,tcp,,$p2p,,$p2p"
  & $vbox storagectl $VmName --name SATA --add sata --controller IntelAhci
  & $vbox storageattach $VmName --storagectl SATA --port 0 --device 0 --type hdd --medium $imagePath --nonrotational on
  $cloudIso = & (Join-Path $here 'build-cloud-init-iso.ps1')
  & $vbox storageattach $VmName --storagectl SATA --port 1 --device 0 --type dvddrive --medium $cloudIso
} else {
  Write-Host "VM already exists: $VmName (re-converging port forwards)"
  & $vbox modifyvm $VmName --natpf1 delete coordination 2>$null
  & $vbox modifyvm $VmName --natpf1 delete p2p-ingest 2>$null
  & $vbox modifyvm $VmName --natpf1 "coordination,tcp,,$coord,,$coord"
  & $vbox modifyvm $VmName --natpf1 "p2p-ingest,tcp,,$p2p,,$p2p"
}

$state = [ordered]@{
  vmName = $VmName
  hypervisor = 'virtualbox'
  provisionedAt = (Get-Date).ToUniversalTime().ToString('o')
  imagePath = $imagePath
  ports = @{ coordination = $coord; p2pIngest = $p2p }
  applianceKind = 'isolation-depackaging'
  orchestratorMode = 'host-only-on-windows'
  note = 'Guest is isolation appliance; Windows host stays mode host per installer spec'
}
$state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
Write-Host "Provision state written: $statePath"
$statePath
