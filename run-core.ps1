param([Parameter(Mandatory=$true)][string]$JobRoot,[Parameter(Mandatory=$true)][string]$CadRoot,[Parameter(Mandatory=$true)][string]$ProductKey,[string]$Language='en-US',[int]$TimeoutSeconds=45)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'src\host-common.ps1')
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$runs=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runs'))+[IO.Path]::DirectorySeparatorChar
$job=[IO.Path]::GetFullPath($JobRoot)
if(-not $job.StartsWith($runs,[StringComparison]::OrdinalIgnoreCase)){throw 'JobRoot must be under this middleware runs directory'}
$mutex=New-Object Threading.Mutex($false,'Local\CadAgentMiddlewareAutoCAD2022')
$locked=$false;$p=$null;$watch=[Diagnostics.Stopwatch]::StartNew()
$profileRoot='HKCU:\'+$ProductKey+'\Profiles'
$profile=(Get-Item -LiteralPath $profileRoot).GetValue('')
if([String]::IsNullOrEmpty($profile)){throw 'Unable to resolve current AutoCAD 2022 profile'}
$variables=Join-Path (Join-Path $profileRoot $profile) 'Variables'
$key=Get-Item -LiteralPath $variables
$originalPresent=$key.GetValueNames() -contains 'TRUSTEDPATHS'
$previous=[string]$key.GetValue('TRUSTEDPATHS','')
$plugin=Join-Path $PSScriptRoot 'plugin\bin\CadAgent.dll'
$pluginDir=Split-Path -Parent $plugin
$trusted=if($previous -eq ''){$pluginDir}else{$previous+';'+$pluginDir}
try {
    try{$locked=$mutex.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$locked=$true}
    if(-not $locked){throw 'Another CAD middleware job is still running'}
    # Read again under the cross-process lock. All paths passed via child-only env,
    # never interpolated into AutoLISP code.
    $key=Get-Item -LiteralPath $variables
    $originalPresent=$key.GetValueNames() -contains 'TRUSTEDPATHS'
    $previous=[string]$key.GetValue('TRUSTEDPATHS','')
    $trusted=if($previous -eq ''){$pluginDir}else{$previous+';'+$pluginDir}
    $env:CADAGENT_PLUGIN=$plugin
    $env:CADAGENT_TRUST=$trusted
    $env:CADAGENT_PREVIOUS_TRUST=$previous
    $env:CADAGENT_REQUEST=Join-Path $job 'request.json'
    $env:CADAGENT_RESPONSE=Join-Path $job 'response.json'
    $env:CADAGENT_OUTPUT=Join-Path $job 'output.dwg'
    $env:CADAGENT_DXF=Join-Path $job 'output.dxf'
    $script=Join-Path $job 'run.scr'
    $lines=@(
      '(princ (strcat "\nCADAGENT_SECURITY_BEFORE=" (itoa (getvar "SECURELOAD")) "\n"))',
      '(setvar "TRUSTEDPATHS" (getenv "CADAGENT_TRUST"))',
      '_.NETLOAD','(getenv "CADAGENT_PLUGIN")',
      '(if (= (getvar "TRUSTEDPATHS") (getenv "CADAGENT_TRUST")) (setvar "TRUSTEDPATHS" (if (getenv "CADAGENT_PREVIOUS_TRUST") (getenv "CADAGENT_PREVIOUS_TRUST") "")) (princ "CADAGENT_TRUST_RESTORE_CONFLICT"))',
      '(princ (strcat "\nCADAGENT_TRUST_RESTORED=" (getvar "TRUSTEDPATHS") "\n"))',
      'CADAGENTRUN','_.QUIT','_Y',''
    )
    [IO.File]::WriteAllText($script,($lines -join "`n"),[Text.Encoding]::ASCII)
    $argsForCad=@('/s',('"'+$script+'"'),'/l',$Language)
    $inputDrawing=Join-Path $job 'input.dwg'
    if(-not (Test-Path -LiteralPath $inputDrawing)){
        $template=Get-ChildItem -LiteralPath (Join-Path $CadRoot 'UserDataCache') -Filter 'acadiso.dwt' -File -Recurse | Select-Object -First 1
        if(-not $template){throw 'SEED_TEMPLATE_MISSING: no acadiso.dwt found in selected AutoCAD installation'}
        Copy-Item -LiteralPath $template.FullName -Destination $inputDrawing
    }
    if(Test-Path -LiteralPath $inputDrawing){$argsForCad=@('/i',('"'+$inputDrawing+'"'))+$argsForCad}
    $p=Start-Process -FilePath (Join-Path $CadRoot 'accoreconsole.exe') -ArgumentList $argsForCad -WorkingDirectory $job -WindowStyle Hidden -RedirectStandardOutput (Join-Path $job 'stdout.raw.log') -RedirectStandardError (Join-Path $job 'stderr.log') -PassThru
    $null=$p.Handle
    $finished=$p.WaitForExit($TimeoutSeconds*1000)
    if(-not $finished){$p.Kill();$p.WaitForExit()}
    $bytes=[IO.File]::ReadAllBytes((Join-Path $job 'stdout.raw.log'))
    $encoding=if($bytes.Length -gt 1 -and ($bytes[1] -eq 0 -or $bytes[0] -eq 255)){[Text.Encoding]::Unicode}else{[Text.Encoding]::UTF8}
    $log=$encoding.GetString($bytes)
    [IO.File]::WriteAllText((Join-Path $job 'stdout.log'),$log,(New-Object Text.UTF8Encoding($false)))
    $watch.Stop()
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$pluginHash=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($plugin))).Replace('-','')}finally{$sha.Dispose()}
    [ordered]@{exitCode=$p.ExitCode;timedOut=(-not $finished);elapsedMs=$watch.ElapsedMilliseconds;pluginSHA256=$pluginHash} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $job 'host.json') -Encoding utf8
    if(-not $finished){throw 'TIMEOUT_STATE_UNKNOWN: CAD process timed out; inspect retained job evidence before retrying'}
    if($p.ExitCode -ne 0){throw "CAD host exited with code $($p.ExitCode); see $job\stdout.log"}
    if(-not (Test-Path -LiteralPath $env:CADAGENT_RESPONSE)){throw "No plugin response. See $job\stdout.log; sandboxed registry writes may require host execution outside the sandbox."}
} finally {
    if($p){$p.Dispose()}
    if($locked){
        try {
            Restore-CadTrust $variables $originalPresent $previous $trusted
        } finally {$mutex.ReleaseMutex()}
    }
    $mutex.Dispose()
}
