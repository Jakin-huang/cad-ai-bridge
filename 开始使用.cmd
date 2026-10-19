@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0开始使用.exe" (
  start "" "%~dp0开始使用.exe" %*
  exit /b 0
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-user.ps1" %*
exit /b %errorlevel%
