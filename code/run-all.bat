@echo off
setlocal enableextensions enabledelayedexpansion

set NPM="%ProgramFiles%\nodejs\npm.cmd"
if not exist %NPM% (
  echo npm not found at %NPM%
  echo Please install Node.js LTS, then re-run this script.
  pause
  exit /b 1
)

mkdir logs 2>nul

call :do_app "apps\extension-chromium" || goto :any_fail
call :do_app "apps\electron-vite-project" || goto :any_fail
call :do_app "apps\desktop" || goto :any_fail

echo.
echo ==============================
echo All installs and builds SUCCESS
echo Logs are in %cd%\logs
echo ==============================
pause
exit /b 0

:any_fail
echo.
echo ==============================
echo One or more steps FAILED. See logs in %cd%\logs
echo ==============================
pause
exit /b 1

:do_app
set APPDIR=%~1
for %%I in ("%APPDIR%") do set APPNAME=%%~nI
echo.
echo === [%APPNAME%] installing in %APPDIR% ===
pushd "%~dp0%APPDIR%" || (
  echo Could not enter %APPDIR%
  echo FAIL > "%~dp0logs\%APPNAME%-fail.txt"
  popd 2>nul
  exit /b 1
)
%NPM% ci --no-audit --fund=false > "%~dp0logs\%APPNAME%-install.log" 2>&1
if errorlevel 1 (
  echo [FAIL] npm ci for %APPNAME%
  echo FAIL > "%~dp0logs\%APPNAME%-fail.txt"
  popd
  exit /b 1
)
echo === [%APPNAME%] building ===
%NPM% run build > "%~dp0logs\%APPNAME%-build.log" 2>&1
if errorlevel 1 (
  echo [FAIL] build for %APPNAME%
  echo FAIL > "%~dp0logs\%APPNAME%-fail.txt"
  popd
  exit /b 1
)
echo SUCCESS > "%~dp0logs\%APPNAME%-success.txt"
popd
exit /b 0

