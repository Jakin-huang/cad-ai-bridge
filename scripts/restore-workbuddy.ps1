param([Parameter(ValueFromRemainingArguments=$true)][string[]]$RestoreArguments)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ensure-runtimes.ps1')
$runtimes=Ensure-Runtimes
& $runtimes.node (Join-Path $RuntimeProject 'bin\cadbridge.mjs') restore-workbuddy @RestoreArguments
exit $LASTEXITCODE
