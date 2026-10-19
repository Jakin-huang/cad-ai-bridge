param([string]$LabRoot='C:\BridgeLab')
# Runs from the VM's ordinary Startup folder under its independent standard user.
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$serial=New-Object IO.Ports.SerialPort('COM1',115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$serial.Open();$serial.WriteLine('BRIDGE_VM_BEGIN '+[DateTime]::UtcNow.ToString('o'))
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=New-Object Security.Principal.WindowsPrincipal($identity)
$report=[ordered]@{ok=$false;checkedAt=$null;nonce=(Get-Content -LiteralPath (Join-Path $LabRoot 'nonce.txt') -Raw).Trim();scope='Fresh Windows guest and actual independent standard account; no licensed CAD/WorkBuddy installed';identity=$identity.Name;userSid=$identity.User.Value;groups=@($identity.Groups|ForEach-Object {$_.Value});elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);checks=@();error=$null;protocol=$null}
$out=Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'BridgeAcceptance'
New-Item -ItemType Directory -Path $out -Force | Out-Null
function Run-Recorded([string]$Executable,[string[]]$Arguments,[string]$Name){
 $preference=$ErrorActionPreference;$ErrorActionPreference='Continue'
 & $Executable @Arguments *> (Join-Path $out ($Name+'.txt'))
 $code=$LASTEXITCODE;$ErrorActionPreference=$preference
 if($code -ne 0){throw ($Name+' failed ('+$code+'): '+(Get-Content -LiteralPath (Join-Path $out ($Name+'.txt')) -Raw))}
}
try{
 if($report.elevated -or $report.groups -contains 'S-1-5-32-544' -or $report.groups -notcontains 'S-1-5-32-545'){throw 'Expected an actual Users-only standard account, not a filtered administrator token'}
 $report.checks+='Actual independent standard-account token has Users membership and no Administrators SID'
 $version=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
 $report.os=[ordered]@{product=$version.ProductName;edition=$version.EditionID;build=$version.CurrentBuild;ubr=$version.UBR}
 $report.initialCommands=@(Get-Command node.exe,pwsh.exe -ErrorAction SilentlyContinue|Select-Object -ExpandProperty Source)
 if($report.initialCommands.Count -ne 0){throw 'Guest already contains Node or PowerShell 7'}
 $report.checks+='Fresh guest has neither Node nor PowerShell 7 on its initial PATH'
 $target=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'CAD Bridge Test'
 New-Item -ItemType Directory -Path $target | Out-Null
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $LabRoot 'package.zip'),$target)
 $package=(Get-ChildItem -LiteralPath $target -Directory|Select-Object -First 1).FullName
 Copy-Item -LiteralPath (Join-Path $LabRoot 'windows-guest-protocol.mjs') -Destination (Join-Path $package 'tests\windows-guest-protocol.mjs') -Force
 $env:PATH="$env:WINDIR\System32;$env:WINDIR;$env:WINDIR\System32\WindowsPowerShell\v1.0"
 $env:CADBRIDGE_OFFLINE='1';$env:CADBRIDGE_RUNTIME_ISOLATED='1'
 . (Join-Path $package 'scripts\ensure-runtimes.ps1')
 $runtime=Ensure-Runtimes
 $report.runtimes=$runtime;$report.checks+='Official bundled runtimes extract and execute offline in this standard user profile'
 Run-Recorded $runtime.node @((Join-Path $package 'scripts\verify-dependencies.mjs')) 'dependencies'
 $report.checks+='Locked Node dependencies load in the fresh guest without downloading'
 Run-Recorded (Join-Path $package 'cadbridge.cmd') @('help') 'cli'
 $report.checks+='One-click CLI works without Node or PowerShell 7 on PATH'
 $env:CADAGENT_POWERSHELL=$runtime.powershell
 $client=Join-Path $out 'missing-cad-client'
 $preference=$ErrorActionPreference;$ErrorActionPreference='Continue'
 & (Join-Path $package 'connect-workbuddy.cmd') --client-home $client *> (Join-Path $out 'missing-cad.txt')
 $code=$LASTEXITCODE;$ErrorActionPreference=$preference
 if($code -eq 0 -or (Test-Path -LiteralPath (Join-Path $client 'mcp.json')) -or (Get-Content -LiteralPath (Join-Path $out 'missing-cad.txt') -Raw) -notmatch 'CAD_NOT_SUPPORTED'){throw ('Missing-CAD setup did not stop safely: '+(Get-Content -LiteralPath (Join-Path $out 'missing-cad.txt') -Raw))}
 $report.checks+='Real setup entry reports missing AutoCAD and preserves client configuration'
 Run-Recorded $runtime.node @((Join-Path $package 'tests\windows-guest-protocol.mjs'),(Join-Path $out 'protocol.json')) 'protocol'
 $report.protocol=Get-Content -LiteralPath (Join-Path $out 'protocol.json') -Raw|ConvertFrom-Json
 $report.checks+=@($report.protocol.checks)
 $report.packageSHA256=(Get-FileHash -LiteralPath (Join-Path $LabRoot 'package.zip')).Hash.ToLowerInvariant()
 $report.ok=$true
}catch{$report.error=$_.Exception.ToString()}
finally{
 $report.checkedAt=[DateTime]::UtcNow.ToString('o')
 $json=$report|ConvertTo-Json -Depth 20
 $json|Set-Content -LiteralPath (Join-Path $out 'result.json') -Encoding UTF8
 $serial.WriteLine('BRIDGE_VM_RESULT '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
 $serial.WriteLine('BRIDGE_VM_END');$serial.Close()
 shutdown.exe /s /t 10
}
