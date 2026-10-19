param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'user-onboarding.ps1')
$request=[IO.File]::ReadAllText($RequestFile,[Text.Encoding]::UTF8) | ConvertFrom-Json
$result=Invoke-CadBridgeUserSetup $request
if(-not $result.ok){exit 1}
