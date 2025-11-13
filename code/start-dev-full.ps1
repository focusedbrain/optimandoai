# Optimando Full Development Setup Script
# This script starts Electron AND builds the extension

param(
    [switch]$SkipBuild,
    [switch]$ElectronOnly
)

Write-Host "Starting Optimando Development Environment..." -ForegroundColor Cyan
Write-Host ""

# Start Electron app in a new PowerShell window
Write-Host "Starting Electron Desktop App (SQLite Backend)..." -ForegroundColor Yellow
$electronPath = Join-Path $PSScriptRoot "apps\electron-vite-project"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$electronPath'; Write-Host 'Electron App - SQLite Backend Server' -ForegroundColor Cyan; Write-Host 'API: http://127.0.0.1:51248' -ForegroundColor Green; Write-Host ''; npm run dev"

Start-Sleep -Seconds 2
Write-Host "Electron app is starting in a separate window!" -ForegroundColor Green
Write-Host ""

# Build extension if not skipped
$shouldBuild = (-not $ElectronOnly) -and (-not $SkipBuild)
if ($shouldBuild) {
    Write-Host "Building Chrome Extension..." -ForegroundColor Yellow
    $extensionPath = Join-Path $PSScriptRoot "apps\extension-chromium"
    
    Push-Location $extensionPath
    npm run build
    $buildSuccess = $LASTEXITCODE -eq 0
    Pop-Location
    
    if ($buildSuccess) {
        Write-Host "Extension built successfully!" -ForegroundColor Green
    } else {
        Write-Host "Extension build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

Write-Host "============================================================" -ForegroundColor Gray
Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Electron API: http://127.0.0.1:51248/api/orchestrator/status" -ForegroundColor Yellow
Write-Host "Extension location: apps\extension-chromium\dist\" -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Wait for Electron window to open (~5-10 seconds)" -ForegroundColor White

if ($ElectronOnly -or $SkipBuild) {
    Write-Host "  2. Build extension: cd apps\extension-chromium; npm run build" -ForegroundColor White
    Write-Host "  3. Load/Reload extension in Chrome (chrome://extensions/)" -ForegroundColor White
} else {
    Write-Host "  2. Load/Reload extension in Chrome (chrome://extensions/)" -ForegroundColor White
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Gray
