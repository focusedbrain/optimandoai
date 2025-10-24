@echo off
setlocal
echo Starting install in %cd%...
"%ProgramFiles%\nodejs\npm.cmd" ci --no-audit --fund=false
if errorlevel 1 goto :error
echo Running build...
"%ProgramFiles%\nodejs\npm.cmd" run build
if errorlevel 1 goto :error
echo SUCCESS > build-success.txt
exit /b 0
:error
echo FAIL > build-fail.txt
exit /b 1

