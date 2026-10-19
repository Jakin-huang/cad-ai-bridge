param([Parameter(Mandatory=$true)][string]$Report)
$ErrorActionPreference='Stop'
$record=Get-Content -Raw -LiteralPath $Report | ConvertFrom-Json
$owned=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
if(-not $owned){return}
if($owned.ProcessName -ne 'acad' -or $owned.StartTime.ToUniversalTime() -ne ([datetime]$record.startedAt).ToUniversalTime()){throw 'Owned CAD process identity mismatch; no process stopped'}
Stop-Process -Id $owned.Id -Force
