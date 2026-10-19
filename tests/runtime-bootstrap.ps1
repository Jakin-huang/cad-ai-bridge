$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\ensure-runtimes.ps1')
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('cadbridge-runtime-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$checks=@()
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
try{
  $asset=[pscustomobject]@{file='fixture.zip';url='https://example.invalid/fixture.zip';sha256='';executable='missing.exe';directory='';version='1'}
  $cache=Join-Path $testRoot 'cache';New-Item -ItemType Directory -Path $cache | Out-Null
  $archive=Join-Path $cache $asset.file;[IO.File]::WriteAllText($archive,'verified fixture');$asset.sha256=(Get-FileHash -LiteralPath $archive).Hash
  $env:CADBRIDGE_OFFLINE='1';Assert ((Get-RuntimeArchive $asset $cache) -eq $archive) 'Valid offline archive was not reused';$checks+='valid offline cache reused'
  [IO.File]::WriteAllText($archive,'damaged')
  try{Get-RuntimeArchive $asset $cache;throw 'Expected digest failure'}catch{Assert ($_.Exception.Message -like 'RUNTIME_HASH_MISMATCH*') $_.Exception.Message}
  Assert (-not (Test-Path -LiteralPath $archive)) 'Damaged archive remained eligible';Assert (@(Get-ChildItem -LiteralPath $cache -Filter '*.bad-*').Count -eq 1) 'Damaged archive not preserved';$checks+='damaged offline archive quarantined before execution'
  try{Get-RuntimeArchive $asset $cache;throw 'Expected offline missing failure'}catch{Assert ($_.Exception.Message -like 'RUNTIME_OFFLINE_MISSING*') $_.Exception.Message};$checks+='offline missing runtime has actionable failure'
  $env:CADBRIDGE_OFFLINE='0';$script:attempts=0
  function Invoke-WebRequest {param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing);$script:attempts++;[IO.File]::WriteAllText($OutFile,'partial');throw 'simulated network interruption'}
  try{Get-RuntimeArchive $asset $cache;throw 'Expected network failure'}catch{Assert ($_.Exception.Message -like 'RUNTIME_DOWNLOAD_FAILED*') $_.Exception.Message}
  Assert ($script:attempts -eq 2) 'Download retries are not bounded';Assert (@(Get-ChildItem -LiteralPath $cache -Filter '*.download-*').Count -eq 0) 'Partial download leaked';$checks+='network failure bounded to two attempts and partial download removed'
  function Invoke-WebRequest {param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing);[IO.File]::WriteAllText($OutFile,'wrong bytes')}
  try{Get-RuntimeArchive $asset $cache;throw 'Expected downloaded hash failure'}catch{Assert ($_.Exception.Message -like 'RUNTIME_HASH_MISMATCH*') $_.Exception.Message};Assert (-not (Test-Path -LiteralPath $archive)) 'Unverified download installed';$checks+='unverified downloaded bytes rejected'
  # A verified but malformed ZIP must not be able to escape its extraction directory.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  Add-Type -AssemblyName System.IO.Compression
  $zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
  try{$entry=$zip.CreateEntry('../escaped.txt');$writer=New-Object IO.StreamWriter($entry.Open());$writer.Write('bad');$writer.Dispose()}finally{$zip.Dispose()}
  $asset.sha256=(Get-FileHash -LiteralPath $archive).Hash;$env:CADBRIDGE_OFFLINE='1'
  try{Install-PortableRuntime $asset 'fixture' (Join-Path $testRoot 'runtime') $cache;throw 'Expected traversal failure'}catch{Assert ($_.Exception.Message -like 'RUNTIME_ARCHIVE_INVALID*') $_.Exception.Message};Assert (-not (Test-Path -LiteralPath (Join-Path $testRoot 'runtime\escaped.txt'))) 'Archive escaped';$checks+='archive traversal rejected and staging cleaned'
  [ordered]@{ok=$true;checks=$checks}|ConvertTo-Json -Depth 4
}finally{
  if([IO.Path]::GetFullPath($testRoot).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $testRoot -Recurse -Force}
}
