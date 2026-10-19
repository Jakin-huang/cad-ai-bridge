@echo off
call "%~dp0setup.cmd" --client workbuddy %*
set "CADBRIDGE_CONNECT_EXIT=%ERRORLEVEL%"
if not "%CADBRIDGE_CONNECT_EXIT%"=="0" echo WorkBuddy setup failed. See the error above.
if "%~1"=="" pause
exit /b %CADBRIDGE_CONNECT_EXIT%
