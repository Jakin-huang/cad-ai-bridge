param([Parameter(ValueFromRemainingArguments=$true)][string[]]$SetupArguments)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $project
function Find-Executable([string]$Name,[string[]]$Candidates){
  $command=Get-Command $Name -ErrorAction SilentlyContinue
  if($command){return $command.Source}
  foreach($candidate in $Candidates){if($candidate -and (Test-Path -LiteralPath $candidate)){return $candidate}}
  return $null
}
# Fail before downloading or changing client configuration when the unzip directory is read-only.
$probe=Join-Path $project ('.write-probe-'+[guid]::NewGuid().ToString('N'))
try{[IO.File]::WriteAllText($probe,'');Remove-Item -LiteralPath $probe -Force}catch{throw 'INSTALL_DIRECTORY_READ_ONLY: unzip to a writable folder under your user account, then retry. Administrator rights are not required.'}
. (Join-Path $PSScriptRoot 'ensure-runtimes.ps1')
$runtimes=Ensure-Runtimes
$node=$runtimes.node
$powershell=$runtimes.powershell
$env:CADAGENT_POWERSHELL=$powershell
$env:PATH=(Split-Path -Parent $node)+';'+$env:PATH
# Exact package-lock match avoids unnecessary downloads on repeat or offline setup.
& $node (Join-Path $PSScriptRoot 'verify-dependencies.mjs')
if($LASTEXITCODE -ne 0){
  if($env:CADBRIDGE_OFFLINE -eq '1'){throw 'DEPENDENCIES_OFFLINE_MISSING: re-extract the complete Windows user package, or retry setup online. Client configuration was not changed.'}
  $npm=Find-Executable 'npm.cmd' @((Join-Path (Split-Path -Parent $node) 'npm.cmd'))
  if(-not $npm){throw 'NPM_MISSING: use a complete Node distribution'}
  & $npm ci --ignore-scripts --no-audit --no-fund
  if($LASTEXITCODE -ne 0){throw 'DEPENDENCIES_FAILED: dependency install failed; retry setup with network or prepared offline dependencies'}
}
& $node (Join-Path $project 'bin\cadbridge.mjs') setup @SetupArguments
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& $node (Join-Path $project 'bin\cadbridge.mjs') doctor
exit $LASTEXITCODE
