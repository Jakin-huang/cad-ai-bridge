param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArguments)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ensure-runtimes.ps1')
$runtimes=Ensure-Runtimes
$env:CADAGENT_POWERSHELL=$runtimes.powershell
& $runtimes.node (Join-Path $RuntimeProject 'bin\cadbridge.mjs') @CliArguments
exit $LASTEXITCODE
