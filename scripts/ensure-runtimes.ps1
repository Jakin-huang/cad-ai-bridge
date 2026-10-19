param([switch]$DownloadOnly)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# Node-launched Windows PowerShell can inherit PowerShell 7's module search path.
# Put this host's own modules first so Get-FileHash and downloads work in 5.1 too.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$RuntimeProject=Split-Path -Parent $PSScriptRoot
function Test-Runtime([string]$Executable,[string]$Kind){
  if(-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)){return $false}
  try{
    if($Kind -eq 'node'){
      & $Executable -e 'const [a,b]=process.versions.node.split(/[.]/).map(Number);process.exit(process.arch===String.fromCharCode(120,54,52)&&(a>22||(a===22&&b>=19))?0:1)' 2>$null | Out-Null
    }else{& $Executable -NoProfile -NonInteractive -Command 'if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitProcess){exit 1}' 2>$null | Out-Null}
    return $LASTEXITCODE -eq 0
  }catch{return $false}
}
function Get-RuntimeArchive($Asset,[string]$Cache){
  New-Item -ItemType Directory -Path $Cache -Force | Out-Null
  $archive=Join-Path $Cache $Asset.file
  if(Test-Path -LiteralPath $archive){
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $Asset.sha256){return $archive}
    Move-Item -LiteralPath $archive -Destination ($archive+'.bad-'+[guid]::NewGuid().ToString('N'))
    if($env:CADBRIDGE_OFFLINE -eq '1'){throw ('RUNTIME_HASH_MISMATCH: replace the damaged offline archive '+$Asset.file)}
  }
  if($env:CADBRIDGE_OFFLINE -eq '1'){throw ('RUNTIME_OFFLINE_MISSING: use the Windows user package containing '+$Asset.file)}
  $temporary=$archive+'.download-'+[guid]::NewGuid().ToString('N')
  try{
    [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    [Console]::Error.WriteLine('Downloading verified portable runtime: '+$Asset.file)
    $downloaded=$false
    for($attempt=1;$attempt -le 2;$attempt++){
      try{Invoke-WebRequest -UseBasicParsing -Uri $Asset.url -OutFile $temporary -TimeoutSec 60; $downloaded=$true; break}
      catch{if($attempt -eq 2){throw ('RUNTIME_DOWNLOAD_FAILED: '+$Asset.file+'. Retry setup or use the offline user package. '+$_.Exception.Message)}}
    }
    if(-not $downloaded -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $Asset.sha256){throw ('RUNTIME_HASH_MISMATCH: '+$Asset.file+'; nothing was installed. Retry setup.')}
    Move-Item -LiteralPath $temporary -Destination $archive
    return $archive
  }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
}
function Install-PortableRuntime($Asset,[string]$Kind,[string]$RuntimeRoot,[string]$Cache){
  $target=Join-Path $RuntimeRoot ($Kind+'-'+$Asset.version)
  $executable=Join-Path $target $Asset.executable
  if(Test-Runtime $executable $Kind){return $executable}
  # A broken existing installation is retained; the replacement is staged separately.
  $archive=Get-RuntimeArchive $Asset $Cache
  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  $stage=Join-Path $RuntimeRoot ('.s-'+[guid]::NewGuid().ToString('N').Substring(0,8))
  New-Item -ItemType Directory -Path $stage | Out-Null
  try{
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try{
      $prefix=[IO.Path]::GetFullPath($stage)+[IO.Path]::DirectorySeparatorChar
      foreach($entry in $zip.Entries){if(-not [IO.Path]::GetFullPath((Join-Path $stage $entry.FullName)).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'RUNTIME_ARCHIVE_INVALID: archive path escapes staging directory'}}
    }finally{$zip.Dispose()}
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$stage)
    $expanded=$stage
    if($Asset.directory){$expanded=Join-Path $stage $Asset.directory}
    if(-not (Test-Runtime (Join-Path $expanded $Asset.executable) $Kind)){throw ('RUNTIME_INVALID: '+$Asset.file)}
    if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination ($target+'.bad-'+[guid]::NewGuid().ToString('N'))}
    Move-Item -LiteralPath $expanded -Destination $target
    return $executable
  }finally{
    # stage is always a fresh child of the explicitly selected runtime root.
    if((Test-Path -LiteralPath $stage) -and [IO.Path]::GetFullPath($stage).StartsWith([IO.Path]::GetFullPath($RuntimeRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $stage -Recurse -Force}
  }
}
function Ensure-Runtimes([switch]$DownloadOnly){
  if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){throw 'PLATFORM_UNSUPPORTED: Windows x64 is required by this AutoCAD 2022 package'}
  $assets=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-assets.json') -Raw | ConvertFrom-Json
  # A short per-user path avoids Windows PowerShell 5.1 / .NET MAX_PATH failures
  # in the official Node/npm tree when the package was unzipped in a deep folder.
  $runtimeRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CADBridge\runtimes'
  if($env:CADBRIDGE_RUNTIME_HOME){$runtimeRoot=[IO.Path]::GetFullPath($env:CADBRIDGE_RUNTIME_HOME)}
  $cache=Join-Path $RuntimeProject 'runtime-archives'
  if($env:CADBRIDGE_RUNTIME_CACHE){$cache=[IO.Path]::GetFullPath($env:CADBRIDGE_RUNTIME_CACHE)}
  if($DownloadOnly){foreach($kind in @('node','powershell')){Get-RuntimeArchive $assets.$kind $cache | Out-Null};return}
  $resolved=@{}
  foreach($kind in @('node','powershell')){
    $asset=$assets.$kind
    $candidates=@((Join-Path $runtimeRoot ($kind+'-'+$asset.version+'\'+$asset.executable)),(Join-Path $runtimeRoot ($kind+'\'+$asset.executable)))
    if($env:CADBRIDGE_RUNTIME_ISOLATED -ne '1'){
      $command=Get-Command $asset.executable -ErrorAction SilentlyContinue
      if($command){$candidates+=$command.Source}
      if($kind -eq 'node'){
        $candidates+=Join-Path $env:ProgramFiles 'nodejs\node.exe'
        $buddy=Join-Path ([Environment]::GetFolderPath('UserProfile')) '.workbuddy\binaries\node\versions'
        if(Test-Path -LiteralPath $buddy){$candidates+=@(Get-ChildItem -LiteralPath $buddy -Directory | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'node.exe'})}
      }else{
        $candidates+=Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
        try{$stored=(Get-Content -LiteralPath (Join-Path $RuntimeProject 'cadbridge.local.json') -Raw | ConvertFrom-Json).powershell;if($stored){$candidates+=$stored}}catch{}
      }
    }
    foreach($candidate in $candidates){if(Test-Runtime $candidate $kind){$resolved[$kind]=$candidate;break}}
    if(-not $resolved[$kind]){$resolved[$kind]=Install-PortableRuntime $asset $kind $runtimeRoot $cache}
  }
  return [pscustomobject]$resolved
}
if($MyInvocation.InvocationName -ne '.') { Ensure-Runtimes -DownloadOnly:$DownloadOnly }
