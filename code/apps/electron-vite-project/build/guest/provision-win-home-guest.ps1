# Orchestrates Windows Home guest provisioning after hypervisor detection.
# Idempotent: safe to re-run; converges VM + port forwards + state file.

param(
  [string]$StateDir
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $StateDir) { $StateDir = Join-Path $env:USERPROFILE '.opengiraffe\guest-state' }

$kind = & (Join-Path $here 'detect-hypervisor.ps1')
if ($kind -eq 'none') {
  & (Join-Path $here 'show-manual-steps.ps1')
  exit 2
}

Write-Host "Provisioning isolation guest using hypervisor: $kind"

switch ($kind) {
  'virtualbox' {
    & (Join-Path $here 'provision-virtualbox-guest.ps1') -StateDir $StateDir
  }
  'vmware' {
    & (Join-Path $here 'provision-vmware-guest.ps1') -StateDir $StateDir
  }
  default {
    throw "Unsupported hypervisor: $kind"
  }
}

Write-Host 'Guest provisioning complete. Launch with launch-win-home-guest.ps1'
exit 0
