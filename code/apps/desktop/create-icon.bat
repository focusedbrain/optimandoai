@echo off
echo Creating a simple icon for OpenGiraffe Desktop App...

REM Create a simple text-based icon using PowerShell
powershell -Command "
$iconPath = 'icon.ico'
$bitmap = New-Object System.Drawing.Bitmap(32, 32)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Purple)
$font = New-Object System.Drawing.Font('Arial', 12, [System.Drawing.FontStyle]::Bold)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$graphics.DrawString('O', $font, $brush, 8, 8)
$graphics.Dispose()
$bitmap.Save('icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Host 'Icon created: icon.png'
"

echo ✅ Icon created!
pause
