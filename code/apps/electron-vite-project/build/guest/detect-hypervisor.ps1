# Detects user-installed hypervisors (VirtualBox first, then VMware). Never installs.
# Output: virtualbox | vmware | none

param(
  [switch]$Json
)

$ErrorActionPreference = 'SilentlyContinue'

function Find-VirtualBox {
  $candidates = @(
    (Get-Command VBoxManage.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "${env:ProgramFiles}\Oracle\VirtualBox\VBoxManage.exe",
    "${env:ProgramFiles(x86)}\Oracle\VirtualBox\VBoxManage.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return $candidates | Select-Object -First 1
}

function Find-VMware {
  $candidates = @(
    (Get-Command vmrun.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "${env:ProgramFiles(x86)}\VMware\VMware Workstation\vmrun.exe",
    "${env:ProgramFiles}\VMware\VMware Workstation\vmrun.exe"
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return $candidates | Select-Object -First 1
}

$vbox = Find-VirtualBox
if ($vbox) {
  $result = [ordered]@{
    hypervisor = 'virtualbox'
    toolPath   = $vbox
    downloadUrl = 'https://www.virtualbox.org/wiki/Downloads'
    recommended = $true
  }
  if ($Json) { $result | ConvertTo-Json -Compress } else { Write-Output 'virtualbox' }
  exit 0
}

$vmware = Find-VMware
if ($vmware) {
  $result = [ordered]@{
    hypervisor = 'vmware'
    toolPath   = $vmware
    downloadUrl = 'https://www.vmware.com/products/workstation-pro.html'
    recommended = $false
  }
  if ($Json) { $result | ConvertTo-Json -Compress } else { Write-Output 'vmware' }
  exit 0
}

if ($Json) {
  @{
    hypervisor = 'none'
    virtualBoxUrl = 'https://www.virtualbox.org/wiki/Downloads'
    vmwareUrl = 'https://www.vmware.com/products/workstation-pro.html'
    recommended = 'virtualbox'
  } | ConvertTo-Json -Compress
} else {
  Write-Output 'none'
}
exit 0
