$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$source=Join-Path $PSScriptRoot 'UserLauncher.cs'
$output=Join-Path $project 'plugin\bin\CadBridge.Start.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$automation=[System.Management.Automation.PowerShell].Assembly.Location
if(-not (Test-Path -LiteralPath $compiler) -or -not (Test-Path -LiteralPath $automation)){throw 'LAUNCHER_BUILD_MISSING: .NET Framework compiler and Windows PowerShell 5.1 are required'}
[IO.Directory]::CreateDirectory((Split-Path -Parent $output)) | Out-Null
& $compiler /nologo /target:winexe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Core.dll ('/reference:'+$automation) ('/out:'+$output) $source
if($LASTEXITCODE -ne 0){throw 'LAUNCHER_BUILD_FAILED'}
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
@{source='scripts/UserLauncher.cs';sourceSHA256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'plugin\bin\user-launcher-build.json') -Encoding UTF8
