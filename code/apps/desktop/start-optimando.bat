@echo off
echo 🚀 Starting OpenGiraffe Desktop App...
echo 📡 WebSocket Server will run on port 51247
echo 💡 This window can be closed - the app will continue running

REM Start the app in headless mode (no window)
start /B npx electron main.js --headless

echo ✅ OpenGiraffe Desktop App started in background
echo 🔧 WebSocket Server is running on port 51247
echo 💡 To stop the app, use Task Manager or: taskkill /f /im electron.exe

REM Keep this window open for a moment to show the message
timeout /t 3 /nobreak >nul

REM Close this window but keep the app running
exit
