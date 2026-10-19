@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-workbuddy.ps1" %*
set "CADBRIDGE_RESTORE_EXIT=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %CADBRIDGE_RESTORE_EXIT%
