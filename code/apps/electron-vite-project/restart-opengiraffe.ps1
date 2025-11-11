# Restart OpenGiraffe - Stop then Start
Write-Host "🔄 Restarting OpenGiraffe..." -ForegroundColor Cyan

# Stop first
& "$PSScriptRoot\stop-opengiraffe.ps1"

Start-Sleep -Seconds 2

# Start
& "$PSScriptRoot\start-opengiraffe.ps1"

