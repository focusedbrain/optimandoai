# Simple script to read Electron console logs
# Run this script to see what Electron is logging

$logPath = "$env:USERPROFILE\.opengiraffe\electron-console.log"

if (Test-Path $logPath) {
    Write-Host "✅ Found Electron log file!" -ForegroundColor Green
    Write-Host "Location: $logPath" -ForegroundColor Cyan
    Write-Host "`n=== Last 50 lines of Electron console ===" -ForegroundColor Yellow
    Get-Content $logPath -Tail 50
    Write-Host "`n=== Searching for DB_TEST_CONNECTION messages ===" -ForegroundColor Yellow
    Get-Content $logPath | Select-String -Pattern "DB_TEST_CONNECTION|RAW WEBSOCKET MESSAGE|ping|pong" | Select-Object -Last 20
} else {
    Write-Host "❌ Log file not found at: $logPath" -ForegroundColor Red
    Write-Host "`nThe log file will be created when Electron starts with the logging code." -ForegroundColor Yellow
    Write-Host "Make sure you:" -ForegroundColor Yellow
    Write-Host "1. Restarted Electron (npm run dev)" -ForegroundColor White
    Write-Host "2. See '[MAIN] Console logging to file: ...' in the Electron terminal" -ForegroundColor White
    Write-Host "3. Then test the connection" -ForegroundColor White
}





