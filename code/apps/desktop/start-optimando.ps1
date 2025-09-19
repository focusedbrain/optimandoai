# OpenGiraffe Desktop App Starter
Write-Host "🚀 Starting OpenGiraffe Desktop App..." -ForegroundColor Green
Write-Host "📡 WebSocket Server will run on port 51247" -ForegroundColor Cyan
Write-Host "💡 This window can be closed - the app will continue running" -ForegroundColor Yellow

# Start the app in headless mode
Start-Process -FilePath "npx" -ArgumentList "electron", "main.js", "--headless" -WindowStyle Hidden

Write-Host "✅ OpenGiraffe Desktop App started in background" -ForegroundColor Green
Write-Host "🔧 WebSocket Server is running on port 51247" -ForegroundColor Cyan
Write-Host "💡 To stop the app, use Task Manager or: taskkill /f /im electron.exe" -ForegroundColor Yellow

# Wait a moment then close this window
Start-Sleep -Seconds 3
exit
