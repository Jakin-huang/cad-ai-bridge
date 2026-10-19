param([Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][Guid]$RequestId)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CadBridgeProcess { [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); }
'@
$application=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.1')
$actualProcess=[uint32]0;[CadBridgeProcess]::GetWindowThreadProcessId([IntPtr]$application.HWND,[ref]$actualProcess) | Out-Null
if($actualProcess -ne $ExpectedPid){throw 'SESSION_AUTOMATION_TARGET_MISMATCH: COM belongs to another AutoCAD instance. No command was sent.'}
if(-not $application.GetAcadState().IsQuiescent){throw 'SESSION_BUSY: finish the current interactive command before editing'}
# A fixed entry executes the already authenticated, document-bound native plan.
# No caller-supplied command, Lisp expression, file path or operation is inserted.
$application.ActiveDocument.SendCommand("CADBRIDGESESSIONEXEC`n"+$RequestId.ToString('D')+"`n")
