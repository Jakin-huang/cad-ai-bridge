@echo off
setlocal
cd /d "%~dp0"
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<19))process.exit(1)"
if errorlevel 1 (
  echo Install Node.js 22.19 or newer, then run setup.cmd again.
  exit /b 1
)
pwsh.exe -NoProfile -NonInteractive -Command "if($PSVersionTable.PSVersion.Major -lt 7){exit 1}"
if errorlevel 1 (
  echo Install PowerShell 7 or newer, then run setup.cmd again.
  exit /b 1
)
call npm ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 exit /b 1
node bin\cadbridge.mjs setup %*
if errorlevel 1 exit /b 1
node bin\cadbridge.mjs doctor
