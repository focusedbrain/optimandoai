# Surfaces ordered manual steps when no hypervisor is detected. Blocks provisioning.
# Use -Recheck to re-run detection after the user installs a hypervisor.

param(
  [switch]$Recheck
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$detect = Join-Path $here 'detect-hypervisor.ps1'

if ($Recheck) {
  Write-Host 'Re-checking for an installed hypervisor...' -ForegroundColor Cyan
}

$kind = & $detect
if ($kind -eq 'virtualbox' -or $kind -eq 'vmware') {
  Write-Host "Hypervisor detected: $kind" -ForegroundColor Green
  Write-Host 'You can run provision-win-home-guest.ps1 next.'
  exit 0
}

Write-Host ''
Write-Host '=== WR Desk Windows Home — manual steps required ===' -ForegroundColor Yellow
Write-Host ''
Write-Host 'No supported hypervisor was detected. WR Desk does not install or bundle VirtualBox or VMware.'
Write-Host ''
Write-Host '1. Install a hypervisor (choose one):'
Write-Host '   [Recommended] VirtualBox (open source): https://www.virtualbox.org/wiki/Downloads'
Write-Host '   [Alternative] VMware Workstation:       https://www.vmware.com/products/workstation-pro.html'
Write-Host ''
Write-Host '2. Re-run detection:'
Write-Host "   powershell -File `"$here\show-manual-steps.ps1`" -Recheck"
Write-Host ''
Write-Host '3. After detection succeeds, provision the Ubuntu isolation guest:'
Write-Host "   powershell -File `"$here\provision-win-home-guest.ps1`""
Write-Host ''
Write-Host '4. See the full checklist: build/guest/WIN-HOME-SETUP.md'
Write-Host ''
Write-Host 'Provisioning is blocked until a hypervisor is present.' -ForegroundColor Yellow
exit 2
