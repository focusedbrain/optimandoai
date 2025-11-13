# Optimando Development Startup Script
# This script starts the Electron app in the background

Write-Host "Starting Optimando Development Environment..." -ForegroundColor Cyan
Write-Host ""

# Start Electron app in a new PowerShell window
Write-Host "Starting Electron Desktop App (SQLite Backend)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\apps\electron-vite-project'; Write-Host 'Electron App Starting...' -ForegroundColor Cyan; npm run dev"

Write-Host "Electron app is starting in a separate window!" -ForegroundColor Green
Write-Host ""
Write-Host "============================================================" -ForegroundColor Gray
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Wait for Electron window to open (takes ~5-10 seconds)" -ForegroundColor White
Write-Host "   2. Build the Chrome extension:" -ForegroundColor White
Write-Host "      cd apps\extension-chromium" -ForegroundColor Yellow
Write-Host "      npm run build" -ForegroundColor Yellow
Write-Host "   3. Reload extension in Chrome (chrome://extensions/)" -ForegroundColor White
Write-Host ""
Write-Host "Electron API: http://127.0.0.1:51248/api/orchestrator/status" -ForegroundColor Cyan
Write-Host ""
Write-Host "============================================================" -ForegroundColor Gray
