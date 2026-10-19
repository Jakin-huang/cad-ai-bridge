param([Parameter(Mandatory=$true)][string]$Plugin,[int]$ExpectedPid=0)
$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CadBridgeAttachProcess { [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); }
'@
$resolvedPlugin=(Resolve-Path -LiteralPath $Plugin).Path
if($resolvedPlugin -match '[\r\n"]' -or [IO.Path]::GetExtension($resolvedPlugin) -ne '.dll'){throw 'Invalid verified plugin path'}
$application=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.1')
$actualProcess=[uint32]0;[CadBridgeAttachProcess]::GetWindowThreadProcessId([IntPtr]$application.HWND,[ref]$actualProcess) | Out-Null
if($ExpectedPid -ne 0 -and $actualProcess -ne $ExpectedPid){throw 'SESSION_AUTOMATION_TARGET_MISMATCH: active COM application belongs to another AutoCAD process'}
if(-not $application.GetAcadState().IsQuiescent){throw 'SESSION_BUSY: finish the current interactive command first'}
$document=$application.ActiveDocument;$previous=[string]$document.GetVariable('TRUSTEDPATHS');$directory=Split-Path -Parent $resolvedPlugin;$owned=if($previous){$previous+';'+$directory}else{$directory}
try{
 $document.SetVariable('TRUSTEDPATHS',$owned)
 $document.SendCommand('_.NETLOAD'+"`n"+'"'+$resolvedPlugin+'"'+"`n")
 $document.SendCommand("CADBRIDGESESSIONSTART`n")
}finally{
 $current=[string]$document.GetVariable('TRUSTEDPATHS')
 if($current -eq $owned -or $current -eq $previous){$document.SetVariable('TRUSTEDPATHS',$previous)}else{throw 'TRUST_RESTORE_CONFLICT: external trust-path changes were preserved'}
}
[ordered]@{ok=$true;pid=$actualProcess;plugin=$resolvedPlugin;trustRestored=$true} | ConvertTo-Json -Compress
