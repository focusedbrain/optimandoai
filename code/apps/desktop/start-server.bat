@echo off
echo 🚀 Starting OpenGiraffe Desktop App in background...

start /B npx electron main.js --headless

echo ✅ OpenGiraffe Desktop App started in background
echo 📡 WebSocket server should be running on port 51247
echo 💡 To stop the app, use Task Manager or: taskkill /f /im electron.exe

pause
