@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\cli-local.ps1" %*
exit /b %errorlevel%
