$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$project=Split-Path -Parent $PSScriptRoot
$source=Join-Path $PSScriptRoot 'UserLauncher.cs'
$output=Join-Path $project 'plugin\bin\CadBridge.Start.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$automation=[System.Management.Automation.PowerShell].Assembly.Location
if(-not (Test-Path -LiteralPath $compiler) -or -not (Test-Path -LiteralPath $automation)){throw 'LAUNCHER_BUILD_MISSING: .NET Framework compiler and Windows PowerShell 5.1 are required'}
$compilerArgs=@('/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Core.dll',('/reference:'+$automation))
$recipe=[ordered]@{compiler=(Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash;automation=(Get-FileHash -LiteralPath $automation -Algorithm SHA256).Hash;arguments=$compilerArgs} | ConvertTo-Json -Depth 4 -Compress
$recipeHasher=[Security.Cryptography.SHA256]::Create()
try{$recipeDigest=[BitConverter]::ToString($recipeHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($recipe))).Replace('-','').ToLowerInvariant()}finally{$recipeHasher.Dispose()}
$metadata=Join-Path $project 'plugin\bin\user-launcher-build.json'
$sourceDigest=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$builderDigest=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
# Preserve the exact accepted executable during documentation-only packaging.
# Legacy metadata used this compiler recipe; add the recipe digest once.
if((Test-Path -LiteralPath $output) -and (Test-Path -LiteralPath $metadata)){
  try{
    $prior=Get-Content -LiteralPath $metadata -Raw -Encoding UTF8 | ConvertFrom-Json
    $binaryDigest=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
    if($prior.source -eq 'scripts/UserLauncher.cs' -and $prior.sourceSHA256 -eq $sourceDigest -and $prior.sha256 -eq $binaryDigest -and (-not $prior.recipeSHA256 -or $prior.recipeSHA256 -eq $recipeDigest)){
      [ordered]@{source='scripts/UserLauncher.cs';sourceSHA256=$sourceDigest;sha256=$binaryDigest;builderSHA256=$builderDigest;recipeSHA256=$recipeDigest} | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding UTF8
      Write-Output 'Reusing verified Windows launcher.'
      return
    }
  }catch{Write-Verbose 'Launcher cache is invalid; rebuilding from source.'}
}
[IO.Directory]::CreateDirectory((Split-Path -Parent $output)) | Out-Null
& $compiler @compilerArgs ('/out:'+$output) $source
if($LASTEXITCODE -ne 0){throw 'LAUNCHER_BUILD_FAILED'}
[ordered]@{source='scripts/UserLauncher.cs';sourceSHA256=$sourceDigest;sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant();builderSHA256=$builderDigest;recipeSHA256=$recipeDigest} | ConvertTo-Json | Set-Content -LiteralPath $metadata -Encoding UTF8
