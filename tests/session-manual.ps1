param([Parameter(Mandatory=$true)][int]$ExpectedPid,[ValidateSet('text','select','undo','wrong-session-command','open-second','activate-first','close-second')][string]$Action,[string]$Handle,[string]$Text,[string]$Drawing)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CadSessionWindow { [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); }
'@
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.1')
$ownerPid=[uint32]0;[CadSessionWindow]::GetWindowThreadProcessId([IntPtr]$app.HWND,[ref]$ownerPid) | Out-Null
if($ownerPid -ne $ExpectedPid){throw 'Only the owned QA instance may be used by this test'}
$document=$app.ActiveDocument
if($Action -eq 'text'){$entity=$document.HandleToObject($Handle);$entity.TextString=$Text}
elseif($Action -eq 'select'){if($Handle -notmatch '^[A-Fa-f0-9]+$'){throw 'Invalid QA handle'};$document.SendCommand('(sssetfirst nil (ssadd (handent "'+$Handle+'")))'+"`n")}
elseif($Action -eq 'undo'){$document.SendCommand("_.UNDO`n1`n")}
elseif($Action -eq 'wrong-session-command'){$document.SendCommand("CADBRIDGESESSIONEXEC`n"+[Guid]::NewGuid().ToString('D')+"`n")}
elseif($Action -eq 'open-second'){$app.Documents.Open($Drawing,$false) | Out-Null}
elseif($Action -eq 'activate-first'){$app.Documents.Item(0).Activate()}
elseif($Action -eq 'close-second'){$document.Close($false)}
[ordered]@{ok=$true;action=$Action;pid=$ownerPid} | ConvertTo-Json -Compress
