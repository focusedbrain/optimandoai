# Headless Mode Verification Script
# Run this after starting the app to verify headless mode is working

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Headless Mode Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Electron process is running
$electronProcess = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($electronProcess) {
    Write-Host "[OK] Electron process is running" -ForegroundColor Green
    Write-Host "    Process ID: $($electronProcess.Id)" -ForegroundColor Gray
} else {
    Write-Host "[FAIL] Electron process not found" -ForegroundColor Red
    exit 1
}

# Check if HTTP API is responding
Write-Host ""
Write-Host "Checking HTTP API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:51248/api/window/status" -Method Get -TimeoutSec 5
    Write-Host "[OK] HTTP API is responding" -ForegroundColor Green
    Write-Host "    Window exists: $($response.exists)" -ForegroundColor Gray
    Write-Host "    Window visible: $($response.visible)" -ForegroundColor Gray
    
    if ($response.visible -eq $false) {
        Write-Host ""
        Write-Host "[SUCCESS] App is running in HEADLESS mode!" -ForegroundColor Green -BackgroundColor Black
    } else {
        Write-Host ""
        Write-Host "[WARNING] Window is VISIBLE (not headless)" -ForegroundColor Yellow -BackgroundColor Black
    }
} catch {
    Write-Host "[FAIL] Cannot connect to HTTP API" -ForegroundColor Red
    Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  - Check system tray for app icon" -ForegroundColor White
Write-Host "  - Right-click tray icon to show/hide window" -ForegroundColor White
Write-Host "  - Use Chrome extension Dev Tools to control window" -ForegroundColor White
Write-Host ""



