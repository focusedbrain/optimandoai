$ErrorActionPreference = 'Stop'
$target = 'C:\build-output\build017'
Stop-Service WSearch -Force -ErrorAction SilentlyContinue
Get-Process SearchProtocolHost,SearchFilterHost,soffice.bin -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
if (Test-Path -LiteralPath $target) {
  Write-Error "Still exists: $target"
  exit 1
}
Write-Host "Deleted $target"
Start-Service WSearch -ErrorAction SilentlyContinue
