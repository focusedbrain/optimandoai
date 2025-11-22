# Force restart Electron app with CPU capability check

Write-Host "===== RESTARTING ELECTRON APP WITH CPU CHECK =====" -ForegroundColor Cyan

# 1. Kill all electron processes
Write-Host "Stopping all Electron and Node processes..." -ForegroundColor Yellow
Get-Process -Name electron,node,OpenGiraffe -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 2. Delete all compiled output
Write-Host "Deleting compiled output..." -ForegroundColor Yellow
Remove-Item -Path dist-electron -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path .vite -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path node_modules/.vite -Recurse -Force -ErrorAction SilentlyContinue

# 3. Start dev server
Write-Host "Starting dev server..." -ForegroundColor Green
npm run dev

