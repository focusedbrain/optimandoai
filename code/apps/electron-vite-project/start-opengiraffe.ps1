# Start OpenGiraffe.exe for testing
$exePath = Join-Path $PSScriptRoot "release\0.0.0\win-unpacked\opengiraffe.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "❌ opengiraffe.exe not found at: $exePath" -ForegroundColor Red
    Write-Host "Please run 'npm run build' first" -ForegroundColor Yellow
    exit 1
}

Write-Host "🚀 Starting OpenGiraffe..." -ForegroundColor Green
Start-Process -FilePath $exePath -WindowStyle Normal
Write-Host "✓ OpenGiraffe started!" -ForegroundColor Green
Write-Host "The app should be available at http://127.0.0.1:51248" -ForegroundColor Cyan

