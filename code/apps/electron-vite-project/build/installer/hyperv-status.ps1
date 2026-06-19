# Returns: enabled | disabled | unknown
# Non-blocking probe for NSIS Pro notice. Does not enable Hyper-V.

$ErrorActionPreference = 'SilentlyContinue'

try {
  $vmms = Get-Service -Name vmms -ErrorAction SilentlyContinue
  if ($null -ne $vmms -and $vmms.Status -eq 'Running') {
    Write-Output 'enabled'
    exit 0
  }

  $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction SilentlyContinue
  if ($null -ne $feature -and $feature.State -eq 'Enabled') {
    Write-Output 'enabled'
    exit 0
  }

  if ($null -ne $feature) {
    Write-Output 'disabled'
    exit 0
  }
} catch {
  # fall through
}

Write-Output 'unknown'
exit 0
