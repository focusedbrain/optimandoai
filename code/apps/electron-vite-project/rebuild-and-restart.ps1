# Rebuild and restart OpenGiraffe
Write-Host "🛑 Stopping OpenGiraffe..." -ForegroundColor Yellow
& "$PSScriptRoot\stop-opengiraffe.ps1"

Start-Sleep -Seconds 2

Write-Host "`n🔨 Building OpenGiraffe..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Build successful!" -ForegroundColor Green
    Write-Host "`n🚀 Starting OpenGiraffe..." -ForegroundColor Cyan
    & "$PSScriptRoot\start-opengiraffe.ps1"
    Write-Host "`n✓ Done! The app should now work correctly." -ForegroundColor Green
} else {
    Write-Host "`n❌ Build failed! Check the errors above." -ForegroundColor Red
    exit 1
}

