# Get Vault Debug Logs - Copy to Clipboard
# Run this script to get all logs for debugging

Write-Host "`n=== VAULT DEBUG LOG COLLECTOR ===" -ForegroundColor Cyan
Write-Host "Collecting logs...`n" -ForegroundColor Yellow

$logs = @()

# Electron console log
$electronLog = "$env:USERPROFILE\.opengiraffe\electron-console.log"
if (Test-Path $electronLog) {
    Write-Host "✓ Found Electron log" -ForegroundColor Green
    $logs += "`n=== ELECTRON CONSOLE LOG ===" 
    $logs += Get-Content $electronLog -Tail 100 -ErrorAction SilentlyContinue
} else {
    Write-Host "✗ Electron log not found: $electronLog" -ForegroundColor Red
}

# Electron dev log
$electronDevLog = "$env:TEMP\electron-dev.log"
if (Test-Path $electronDevLog) {
    Write-Host "✓ Found Electron dev log" -ForegroundColor Green
    $logs += "`n=== ELECTRON DEV LOG ===" 
    $logs += Get-Content $electronDevLog -Tail 50 -ErrorAction SilentlyContinue
}

# Extension build log
$extensionLog = "$env:TEMP\extension-build.log"
if (Test-Path $extensionLog) {
    Write-Host "✓ Found Extension build log" -ForegroundColor Green
    $logs += "`n=== EXTENSION BUILD LOG ===" 
    $logs += Get-Content $extensionLog -Tail 30 -ErrorAction SilentlyContinue
}

# Check if Electron is running
$electronProcess = Get-Process electron -ErrorAction SilentlyContinue
if ($electronProcess) {
    Write-Host "✓ Electron is running (PID: $($electronProcess.Id))" -ForegroundColor Green
    $logs += "`n=== ELECTRON PROCESS INFO ===" 
    $logs += "PID: $($electronProcess.Id)"
    $logs += "StartTime: $($electronProcess.StartTime)"
} else {
    Write-Host "✗ Electron is NOT running" -ForegroundColor Red
    $logs += "`n=== ELECTRON PROCESS INFO ===" 
    $logs += "Electron is NOT running!"
}

# Check HTTP server
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:51248/api/vault/status" -Method POST -Body '{}' -ContentType "application/json" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    Write-Host "✓ HTTP API server is responding" -ForegroundColor Green
    $logs += "`n=== HTTP API TEST ===" 
    $logs += "Status: OK"
    $logs += "Response: $($response.Content)"
} catch {
    Write-Host "✗ HTTP API server NOT responding" -ForegroundColor Red
    $logs += "`n=== HTTP API TEST ===" 
    $logs += "Status: FAILED"
    $logs += "Error: $($_.Exception.Message)"
}

# Combine all logs
$allLogs = $logs -join "`n"

# Copy to clipboard
$allLogs | Set-Clipboard
Write-Host "`n✓ All logs copied to clipboard!" -ForegroundColor Green
Write-Host "`n=== LOG SUMMARY ===" -ForegroundColor Cyan
Write-Host $allLogs
Write-Host "`n`nLogs are now in your clipboard. Paste them wherever you need!" -ForegroundColor Yellow

