# Quick Client Video Recording Script
Write-Host "🎬 PREPARING CLIENT PROGRESS VIDEO" -ForegroundColor Green
Write-Host "=" * 50

# Step 1: Clean Environment
Write-Host "`n1️⃣ Setting up clean recording environment..."
Write-Host "Please do the following manually:"
Write-Host "   □ Close unnecessary applications (browser tabs, Slack, etc.)"
Write-Host "   □ Turn off Windows notifications (Win + N, then click 'Turn off')"
Write-Host "   □ Mute phone or put in airplane mode"
Write-Host "   □ Have water ready for clear speech"
Write-Host "`nPress Enter when environment is ready..." -ForegroundColor Yellow
Read-Host

# Step 2: Test Recording
Write-Host "`n2️⃣ Testing screen recording capability..."
Write-Host "Starting Windows Game Bar test..."
Write-Host "Press Win + G to open Game Bar, then test audio levels"
Write-Host "`nPress Enter to continue..." -ForegroundColor Yellow
Read-Host

# Step 3: Navigate to project
Write-Host "`n3️⃣ Navigating to project directory..."
Set-Location "D:\projects\Oscar\optimandoai\code"
Write-Host "✅ Ready in: $(Get-Location)"

# Step 4: Prepare demo files
Write-Host "`n4️⃣ Preparing demo environment..."
Write-Host "Running setup script..."
& .\setup-demo.ps1

# Step 5: Recording instructions
Write-Host "`n🎬 READY TO RECORD!" -ForegroundColor Green
Write-Host "=" * 50

Write-Host "`nRECORDING SEQUENCE:"
Write-Host "1. Press Win + G to open Game Bar"
Write-Host "2. Click 'Record' or press Win + Alt + R"
Write-Host "3. Follow this script:"

Write-Host "`n📋 RECORDING SCRIPT (5-7 minutes):"
Write-Host "-" * 40

Write-Host "`nSEGMENT 1 (45 sec) - INTRODUCTION:"
Write-Host "'Hello [Client], I'm excited to show you our GlassView progress.'"
Write-Host "'Today I'll demonstrate what we've built and our market readiness.'"
Write-Host "ACTION: Show desktop, then open VS Code project"

Write-Host "`nSEGMENT 2 (90 sec) - PROJECT OVERVIEW:"
Write-Host "'Let me walk through our complete GlassView application.'"
Write-Host "ACTION: Navigate through project structure"
Write-Host "SHOW: apps/glassview/, src/, test/ directories"

Write-Host "`nSEGMENT 3 (3 min) - LIVE DEMO:"
Write-Host "'Now watch the working application in action.'"
Write-Host "ACTION: Run these commands ON CAMERA:"

Write-Host "`n   Command 1: cd apps\glassview"
Write-Host "   Command 2: node test\run-tests.js"
Write-Host "   Command 3: node test\live-demo.js"
Write-Host "   Command 4: start test\browser-test.html"

Write-Host "`nSEGMENT 4 (60 sec) - TECHNICAL EXCELLENCE:"
Write-Host "'The technical implementation is production-ready.'"
Write-Host "ACTION: Show test results, browser interface, file changes"

Write-Host "`nSEGMENT 5 (45 sec) - NEXT STEPS:"
Write-Host "'We've achieved all objectives and ready for Kickstarter launch.'"
Write-Host "ACTION: Show Kickstarter materials, mention timeline"

Write-Host "`n🎯 QUICK COMMANDS FOR RECORDING:" -ForegroundColor Yellow
Write-Host "cd apps\glassview"
Write-Host "node test\run-tests.js"
Write-Host "node test\live-demo.js" 
Write-Host "cd test"
Write-Host "start browser-test.html"

Write-Host "`n📤 AFTER RECORDING:" -ForegroundColor Green
Write-Host "1. Save video as MP4"
Write-Host "2. Upload to Google Drive/Dropbox"
Write-Host "3. Share link with client"
Write-Host "4. Use the email template in CLIENT_VIDEO_GUIDE.md"

Write-Host "`n🚀 Break a leg! Your application is impressive!" -ForegroundColor Green
Write-Host "Press Enter to start the first demo command..." -ForegroundColor Yellow
Read-Host

# Ready to start
Write-Host "`nStarting first demo command..."
Set-Location "apps\glassview"
Write-Host "Ready to run: node test\run-tests.js"
Write-Host "Press Enter to execute..." -ForegroundColor Yellow
Read-Host
node test\run-tests.js