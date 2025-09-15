@echo off
echo Creating desktop shortcut for Optimando Desktop App...

REM Get the current directory
set "CURRENT_DIR=%~dp0"

REM Create a VBS script to create the shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%USERPROFILE%\Desktop\Optimando Desktop.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "%CURRENT_DIR%start-optimando.bat" >> CreateShortcut.vbs
echo oLink.WorkingDirectory = "%CURRENT_DIR%" >> CreateShortcut.vbs
echo oLink.Description = "Optimando Desktop App - WebSocket Server" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs

REM Run the VBS script
cscript CreateShortcut.vbs

REM Clean up
del CreateShortcut.vbs

echo ✅ Desktop shortcut created!
echo 📁 You can now start the app by double-clicking "Optimando Desktop" on your desktop
pause
