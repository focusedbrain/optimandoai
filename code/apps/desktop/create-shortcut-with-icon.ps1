# Create Desktop Shortcut with Icon for Optimando Desktop App
Write-Host "🚀 Creating desktop shortcut with icon..." -ForegroundColor Green

# Get current directory
$currentDir = Get-Location

# Create shortcut path
$shortcutPath = "$env:USERPROFILE\Desktop\Optimando Desktop.lnk"

# Create WScript.Shell object
$WshShell = New-Object -comObject WScript.Shell

# Create shortcut
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "$currentDir\start-optimando.bat"
$Shortcut.WorkingDirectory = $currentDir
$Shortcut.Description = "Optimando Desktop App - WebSocket Server"
$Shortcut.IconLocation = "shell32.dll,14"  # Use a default Windows icon
$Shortcut.Save()

Write-Host "✅ Desktop shortcut created!" -ForegroundColor Green
Write-Host "📁 Location: $shortcutPath" -ForegroundColor Cyan
Write-Host "🔧 Icon: Default Windows icon (shell32.dll,14)" -ForegroundColor Yellow
Write-Host "💡 You can now start the app by double-clicking the shortcut" -ForegroundColor White

# Test if shortcut was created
if (Test-Path $shortcutPath) {
    Write-Host "✅ Shortcut verification: SUCCESS" -ForegroundColor Green
} else {
    Write-Host "❌ Shortcut verification: FAILED" -ForegroundColor Red
}

Read-Host "Press Enter to continue"
