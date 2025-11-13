# Query the Orchestrator SQLite database through HTTP API
# This will show what session data is stored in SQLite

$baseUrl = "http://localhost:3000"

Write-Host "=== Querying Orchestrator Database via HTTP API ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check connection status
Write-Host "1. Checking connection status..." -ForegroundColor Yellow
try {
    $status = Invoke-RestMethod -Uri "$baseUrl/api/orchestrator/status" -Method GET
    Write-Host "OK Orchestrator Status:" -ForegroundColor Green
    $status | ConvertTo-Json -Depth 3
} catch {
    Write-Host "FAIL Failed to connect to Orchestrator API" -ForegroundColor Red
    Write-Host "Make sure Electron app is running (npm run dev)" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# 2. Get all keys
Write-Host "2. Getting all keys from database..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/orchestrator/get-all" -Method GET
    Write-Host "OK Database Contents:" -ForegroundColor Green
    
    if ($response.data -and $response.data.PSObject.Properties.Count -gt 0) {
        Write-Host "Found $($response.data.PSObject.Properties.Count) keys in database" -ForegroundColor White
        Write-Host ""
        
        # List all keys
        Write-Host "Keys in database:" -ForegroundColor Cyan
        $response.data.PSObject.Properties | ForEach-Object {
            $key = $_.Name
            $value = $_.Value
            $valuePreview = if ($value.Length -gt 100) { 
                $value.Substring(0, 100) + "..." 
            } else { 
                $value 
            }
            Write-Host "  - $key" -ForegroundColor White
            Write-Host "    Preview: $valuePreview" -ForegroundColor Gray
        }
        
        Write-Host ""
        
        # Show session keys specifically
        $sessionKeys = $response.data.PSObject.Properties | Where-Object { $_.Name -like "session_*" }
        if ($sessionKeys) {
            Write-Host "OK Found $($sessionKeys.Count) session(s) in SQLite:" -ForegroundColor Green
            $sessionKeys | ForEach-Object {
                Write-Host "  Session: $($_.Name)" -ForegroundColor Cyan
                try {
                    $sessionData = $_.Value | ConvertFrom-Json
                    Write-Host "    - Name: $($sessionData.tabName)" -ForegroundColor White
                    Write-Host "    - Timestamp: $($sessionData.timestamp)" -ForegroundColor White
                    Write-Host "    - Agent boxes: $($sessionData.agentBoxes.Count)" -ForegroundColor White
                    Write-Host "    - Agents: $($sessionData.agents.Count)" -ForegroundColor White
                } catch {
                    Write-Host "    (Could not parse session data)" -ForegroundColor Gray
                }
            }
        } else {
            Write-Host "WARN No session_* keys found in SQLite" -ForegroundColor Yellow
        }
        
    } else {
        Write-Host "WARN Database is empty (no keys found)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "FAIL Failed to get database contents: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
