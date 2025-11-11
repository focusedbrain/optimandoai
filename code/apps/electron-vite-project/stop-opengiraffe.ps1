# Stop all OpenGiraffe processes
Write-Host "🛑 Stopping OpenGiraffe processes..." -ForegroundColor Yellow

$processes = Get-Process | Where-Object {
    $_.ProcessName -like "*opengiraffe*" -or 
    $_.ProcessName -like "*electron*" -or
    ($_.Path -and $_.Path -like "*opengiraffe*")
}

if ($processes) {
    $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "✓ Stopped $($processes.Count) process(es)" -ForegroundColor Green
} else {
    Write-Host "✓ No OpenGiraffe processes found" -ForegroundColor Green
}

# Also kill any Node processes that might be related (be careful with this)
$nodeProcesses = Get-Process | Where-Object {
    $_.ProcessName -eq "node" -and 
    $_.Path -and 
    $_.Path -like "*electron-vite-project*"
}

if ($nodeProcesses) {
    Write-Host "⚠ Found $($nodeProcesses.Count) related Node process(es)" -ForegroundColor Yellow
    $nodeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "✓ Stopped Node processes" -ForegroundColor Green
}

Start-Sleep -Seconds 1
Write-Host "✓ All processes stopped" -ForegroundColor Green

