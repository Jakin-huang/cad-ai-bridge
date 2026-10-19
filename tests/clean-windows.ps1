param([string]$PackageRoot='C:\BridgePackage',[string]$ReportRoot='C:\BridgeReports')
# Run inside a fresh Windows Sandbox/VM. No CAD, WorkBuddy, accounts or trust is installed.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
New-Item -ItemType Directory -Path $ReportRoot -Force | Out-Null
$checks=@();$ok=$false;$errorMessage=$null
function Invoke-Recorded([string]$Executable,[string[]]$Arguments,[string]$Log){
  $savedPreference=$ErrorActionPreference
  $ErrorActionPreference='Continue'
  & $Executable @Arguments *> $Log
  $code=$LASTEXITCODE
  $ErrorActionPreference=$savedPreference
  return $code
}
$target=Join-Path ([Environment]::GetFolderPath('UserProfile')) ('CAD Bridge Clean '+[guid]::NewGuid().ToString('N'))
try{
  New-Item -ItemType Directory -Path $target | Out-Null
  Copy-Item -Path (Join-Path $PackageRoot '*') -Destination $target -Recurse
  $env:PATH="$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0"
  $env:CADBRIDGE_RUNTIME_ISOLATED='1';$env:CADBRIDGE_OFFLINE='1'
  . (Join-Path $target 'scripts\ensure-runtimes.ps1')
  $runtimes=Ensure-Runtimes
  $runtimeHome=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CADBridge\runtimes'
  if(-not $runtimes.node.StartsWith($runtimeHome) -or -not $runtimes.powershell.StartsWith($runtimeHome)){throw 'Runtime escaped user runtime directory'}
  $checks+='offline portable Node and PowerShell work without PATH dependencies'
  $code=Invoke-Recorded $runtimes.node @((Join-Path $target 'scripts\verify-dependencies.mjs')) (Join-Path $ReportRoot 'dependencies.txt')
  if($code -ne 0){throw 'Offline dependencies failed'};$checks+='bundled locked dependencies load without npm or network'
  $code=Invoke-Recorded $runtimes.node @((Join-Path $target 'bin\cadbridge.mjs'),'help') (Join-Path $ReportRoot 'help.txt')
  if($code -ne 0){throw 'CLI failed'};$checks+='CLI loads on the clean system'
  $client=Join-Path $target 'isolated-client'
  $env:CADAGENT_POWERSHELL=$runtimes.powershell
  # The fresh system has no licensed AutoCAD. It must stop before modifying the client.
  $setupCode=Invoke-Recorded $runtimes.node @((Join-Path $target 'bin\cadbridge.mjs'),'setup','--client','workbuddy','--client-home',$client) (Join-Path $ReportRoot 'missing-cad.txt')
  if($setupCode -eq 0 -or (Test-Path -LiteralPath (Join-Path $client 'mcp.json')) -or -not ((Get-Content -LiteralPath (Join-Path $ReportRoot 'missing-cad.txt') -Raw) -match 'CAD_NOT_SUPPORTED')){throw 'Missing-CAD boundary did not preserve client configuration'}
  $checks+='missing AutoCAD has an actionable error and leaves client unconfigured'
  $ok=$true
}catch{$errorMessage=$_.Exception.Message}
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
[ordered]@{ok=$ok;checkedAt=[DateTime]::UtcNow.ToString('o');scope='Fresh VM bootstrap and missing-CAD boundary only; no licensed CAD or WorkBuddy task assertion';os=[Environment]::OSVersion.VersionString;elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);checks=$checks;error=$errorMessage}|ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ReportRoot 'clean-windows-report.json') -Encoding UTF8
if(-not $ok){exit 1}
