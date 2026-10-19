param([Parameter(Mandatory=$true)][string]$JobRoot,[string]$CadRoot,[string]$TangentRoot,[string]$ProductKey,[string]$Profile='TElec20V8',[int]$TimeoutSeconds=120,[string]$RunsRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'src\host-common.ps1')
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$job=[IO.Path]::GetFullPath($JobRoot);if(-not $RunsRoot){$RunsRoot=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CADBridge\data\runs'}
$runs=[IO.Path]::GetFullPath($RunsRoot)+[IO.Path]::DirectorySeparatorChar
if(-not $job.StartsWith($runs,[StringComparison]::OrdinalIgnoreCase)){throw 'JobRoot must be under project runs'}
if(-not $CadRoot -or -not $TangentRoot -or -not $ProductKey){throw 'CAD, Tangent and registry product selection required; run cadbridge setup'}
if(-not (Test-Path -LiteralPath (Join-Path $TangentRoot 'sys24x64\tel_kernal.arx'))){throw 'Tangent V8 R24 native module missing'}
if(-not (Test-Path -LiteralPath (Join-Path $job 'input.dwg'))){throw 'GUI host requires a snapshotted input drawing'}
$mutex=New-Object Threading.Mutex($false,'Local\CadAgentMiddlewareAutoCAD2022');$locked=$false;$process=$null;$watch=[Diagnostics.Stopwatch]::StartNew()
$stage=Join-Path ([IO.Path]::GetTempPath()) ('CadBridgeGUI-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
# ASCII paths also work when AutoCAD starts an additional process that does not inherit environment variables.
if($stage -match '[^\x20-\x7e]'){throw 'GUI staging path must be ASCII; configure an ASCII TEMP directory'}
$vars=Join-Path ('HKCU:\'+$ProductKey+'\Profiles\'+$Profile) 'Variables'
$key=Get-Item -LiteralPath $vars
$hadTrust=$key.GetValueNames() -contains 'TRUSTEDPATHS';$previous=[string]$key.GetValue('TRUSTEDPATHS','');$trusted=if($previous){$previous+';'+$stage}else{$stage}
$tipChanged=$false;$tipPrevious=$null;$tipWasPresent=$false;$tipKey=$null
try {
  try{$locked=$mutex.WaitOne(60000)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked){throw 'CAD host busy'}
  $key=Get-Item -LiteralPath $vars;$hadTrust=$key.GetValueNames() -contains 'TRUSTEDPATHS';$previous=[string]$key.GetValue('TRUSTEDPATHS','');$trusted=if($previous){$previous+';'+$stage}else{$stage}
  # Native object modules load before /b. Trust only the selected installation's
  # exact runtime directory for this owned host, then restore the original value.
  $trusted=$trusted+';'+(Join-Path $TangentRoot 'sys24x64')
  $objectEnabler=Join-Path (Split-Path -Parent $TangentRoot) 'T20-PlugInV8.0\sys24x64'
  if(Test-Path -LiteralPath (Join-Path $objectEnabler 'tch_PipeBase.arx')){$trusted=$trusted+';'+$objectEnabler}
  Set-ItemProperty -LiteralPath $vars -Name TRUSTEDPATHS -Value $trusted
  # Tangent's benign "Tip of the day" modal runs before /b scripts. The installed
  # product INI names its UI registry root. Temporarily suppress only Tips/StartUp.
  $ini=[Text.Encoding]::GetEncoding(936).GetString([IO.File]::ReadAllBytes((Join-Path $TangentRoot 'sys\tch.ini')))
  $regMatch=[regex]::Match($ini,'(?m)^Registry=([^\r\n]+)')
  if(-not $regMatch.Success -or $regMatch.Groups[1].Value -notlike 'Software\Tangent\TElec\*'){throw 'Unrecognized Tangent UI registry root'}
  $tipKey='HKCU:\'+$regMatch.Groups[1].Value.Trim()+'\Tips'
  if(-not (Test-Path -LiteralPath $tipKey)){New-Item -Path $tipKey -Force | Out-Null}
  $tipReg=Get-Item -LiteralPath $tipKey;$tipWasPresent=$tipReg.GetValueNames() -contains 'StartUp';$tipPrevious=$tipReg.GetValue('StartUp',$null)
  if(-not $tipWasPresent -or $tipPrevious -ne 0){Set-ItemProperty -LiteralPath $tipKey -Name StartUp -Type DWord -Value 0;$tipChanged=$true}
  [IO.File]::WriteAllText((Join-Path $job 'startup-preferences.json'),([ordered]@{key=$tipKey;name='StartUp';previous=$tipPrevious;wasPresent=$tipWasPresent;temporaryValue=0;purpose='Suppress Tangent tip-of-the-day modal; no license settings touched'}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  foreach($name in @('input.dwg','request.json')){Copy-Item -LiteralPath (Join-Path $job $name) -Destination (Join-Path $stage $name)}
  Copy-Item -LiteralPath (Join-Path $job 'bootstrap.dwg') -Destination (Join-Path $stage 'startup.dwg')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'plugin\bin\CadAgent.dll') -Destination (Join-Path $stage 'CadAgent.dll')
  $lispStage=$stage.Replace('\','/')
  function Literal([string]$value){return '"'+$value.Replace('\','/').Replace('"','\"')+'"'}
  $script=Join-Path $stage 'run.scr'
  $lines=@(
    ('(setq cbNativeFile (open '+(Literal (Join-Path $stage 'native-status.txt'))+' "w"))'),
    '(prin1 (arx) cbNativeFile)','(princ "\n" cbNativeFile)',
    '(prin1 (mapcar ''getcname (list "rybz" "jxbz" "pmbx" "hlbh" "yjbh" "hljc")) cbNativeFile)',
    '(princ "\n" cbNativeFile)','(prin1 (getvar "SECURELOAD") cbNativeFile)','(close cbNativeFile)',
    '(setq cbPreviousTrust (getvar "TRUSTEDPATHS"))',
    ('(setvar "TRUSTEDPATHS" (strcat cbPreviousTrust ";" '+(Literal $stage)+'))'),
    ('(command "_.NETLOAD" '+(Literal (Join-Path $stage 'CadAgent.dll'))+')'),
    '(setvar "TRUSTEDPATHS" cbPreviousTrust)',
    ('(if (member "TEL_KERNAL.ARX" (mapcar ''strcase (arx))) (command "CADBRIDGEOPENRUNFILE" '+(Literal (Join-Path $stage 'request.json'))+') (princ "TANGENT_NATIVE_NOT_READY"))'),
    '_.QUIT','_N',''
  )
  [IO.File]::WriteAllText($script,($lines -join "`n"),[Text.Encoding]::ASCII)
  $env:TArchFolder=$TangentRoot;$env:PATH=(Join-Path $TangentRoot 'sys24x64')+';'+(Join-Path $TangentRoot 'sys')+';'+$CadRoot+';'+$env:PATH
  # Explicit CreateProcess avoids ShellExecute/UAC waits. RunAsInvoker is child-only:
  # it requests no elevated privilege and does not change AppCompat registry settings.
  $start=New-Object Diagnostics.ProcessStartInfo
  # Graphical AutoCAD must initialize an interactive desktop and may display first-run dialogs.
  $start.FileName=Join-Path $CadRoot 'acad.exe';$start.UseShellExecute=$false;$start.CreateNoWindow=$false;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
  $start.WorkingDirectory=Join-Path $TangentRoot 'sys24x64';$start.Environment['__COMPAT_LAYER']='RunAsInvoker'
  # Autodesk requires /b and its script to be the final command-line arguments.
  foreach($arg in @((Join-Path $stage 'startup.dwg'),'/p',$Profile,'/nologo')){$start.ArgumentList.Add($arg)}
  # Keep the manufacturer's module initialization order. Only its core is forced
  # early; object interpreters demand-load normally from the selected installation.
  $nativePreload=@('tch_kernal.arx')
  $moduleEvidence=@(foreach($module in $nativePreload){$modulePath=Join-Path (Join-Path $TangentRoot 'sys24x64') $module;if(-not(Test-Path -LiteralPath $modulePath)){throw ('Native module missing: '+$module)};$start.ArgumentList.Add('/ld');$start.ArgumentList.Add($modulePath);[ordered]@{name=$module;path=$modulePath;sha256=(Get-FileHash -LiteralPath $modulePath).Hash}})
  [IO.File]::WriteAllText((Join-Path $job 'native-preload.json'),($moduleEvidence|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  $start.ArgumentList.Add('/b');$start.ArgumentList.Add($script)
  $process=New-Object Diagnostics.Process;$process.StartInfo=$start
  if(-not $process.Start()){throw 'AutoCAD process did not start'}
  [IO.File]::WriteAllText((Join-Path $job 'process.json'),([ordered]@{pid=$process.Id;stage=$stage;startedAt=$process.StartTime.ToUniversalTime().ToString('o');executable=$start.FileName}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
  $null=$process.Handle;$finished=$process.WaitForExit($TimeoutSeconds*1000)
  if(-not $finished){$process.Kill();$process.WaitForExit()}
  foreach($name in @('response.json','output.dwg','output.dxf','native-status.txt')){if(Test-Path -LiteralPath (Join-Path $stage $name)){Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $job $name)}}
  $native=if(Test-Path -LiteralPath (Join-Path $job 'native-status.txt')){[IO.File]::ReadAllText((Join-Path $job 'native-status.txt'))}else{''}
  $watch.Stop()
  [IO.File]::WriteAllText((Join-Path $job 'host.json'),([ordered]@{backend='tangent-gui';exitCode=$process.ExitCode;timedOut=(-not $finished);elapsedMs=$watch.ElapsedMilliseconds;stage=$stage;nativeKernelLoaded=$native.Contains('tel_kernal.arx');pluginSHA256=(Get-FileHash -LiteralPath (Join-Path $stage 'CadAgent.dll')).Hash}|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
  if(-not $finished){throw ('TIMEOUT_STATE_UNKNOWN: owned GUI process stopped; inspect '+$stage)}
  if(-not (Test-Path -LiteralPath (Join-Path $job 'response.json'))){throw ('TANGENT_HOST_NO_RESPONSE: native initialization or script failed; inspect '+$stage)}
} finally {
  $cleanupErrors=New-Object 'Collections.Generic.List[string]'
  if($process){
    try{
      if(-not $process.HasExited){$process.Kill();$process.WaitForExit()}
      foreach($name in @('response.json','output.dwg','output.dxf','native-status.txt')){if(Test-Path -LiteralPath (Join-Path $stage $name)){Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $job $name)}}
    }catch{$cleanupErrors.Add($_.Exception.Message)}finally{$process.Dispose()}
  }
  if($locked){
    try{
      try{Restore-CadTrust $vars $hadTrust $previous $trusted}catch{$cleanupErrors.Add($_.Exception.Message)}
      try{if($tipChanged -and $tipKey){$currentTip=(Get-Item -LiteralPath $tipKey).GetValue('StartUp',$null);if($currentTip -eq 0){if($tipWasPresent){Set-ItemProperty -LiteralPath $tipKey -Name StartUp -Type DWord -Value $tipPrevious}else{Remove-ItemProperty -LiteralPath $tipKey -Name StartUp}}elseif($currentTip -ne $tipPrevious){throw 'TIP_RESTORE_CONFLICT: external tip preference changes preserved'}}}catch{$cleanupErrors.Add($_.Exception.Message)}
      [IO.File]::WriteAllText((Join-Path $job 'cleanup.json'),([ordered]@{ok=($cleanupErrors.Count -eq 0);errors=@($cleanupErrors);tipWasTemporarilySuppressed=$tipChanged;originalTipRestored=($cleanupErrors.Count -eq 0)}|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
    }finally{$mutex.ReleaseMutex()}
    if($cleanupErrors.Count){throw ($cleanupErrors -join '; ')}
  }
  $mutex.Dispose()
}
