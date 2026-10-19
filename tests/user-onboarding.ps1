param([Parameter(Mandatory=$true)][string]$Project,[Parameter(Mandatory=$true)][string]$TestRoot,[Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference='Stop'
. (Join-Path $Project 'scripts\user-onboarding.ps1')
$checks=@()
function Assert([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
Assert (-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) 'Run from a non-elevated process'
$Project=[IO.Path]::GetFullPath($Project);$TestRoot=[IO.Path]::GetFullPath($TestRoot)
[IO.Directory]::CreateDirectory($TestRoot) | Out-Null
$clientDirectory=Join-Path $TestRoot '隔离 WorkBuddy'
$workspace=Join-Path $TestRoot "图纸 空格与'单引号"
[IO.Directory]::CreateDirectory($clientDirectory) | Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $clientDirectory 'mcp.json'),'{"mcpServers":{"unrelated":{"command":"keep"}}}',$utf8)
[IO.File]::WriteAllText((Join-Path $clientDirectory '.mcp.json'),'client-owned proxy',$utf8)
function Run-Worker([string]$Folder,[string]$Name){
  $request=@{project=$Project;workspace=$Folder;clientHome=$clientDirectory;log=(Join-Path $TestRoot ($Name+'.log'));report=(Join-Path $TestRoot ($Name+'.json'))}
  $requestFile=Join-Path $TestRoot ($Name+'-request.json')
  [IO.File]::WriteAllText($requestFile,($request | ConvertTo-Json),$utf8)
  $shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Project 'scripts\user-setup-worker.ps1')+'" -RequestFile "'+$requestFile+'"'
  $process=Start-Process -FilePath $shell -ArgumentList $arguments -WindowStyle Hidden -PassThru
  try{if(-not $process.WaitForExit(180000)){throw 'User setup worker timed out'};$code=$process.ExitCode}finally{$process.Dispose()}
  $result=[IO.File]::ReadAllText($request.report,[Text.Encoding]::UTF8) | ConvertFrom-Json
  Assert (($code -eq 0) -eq [bool]$result.ok) 'Worker exit code and visible result disagree'
  return $result
}
$result=Run-Worker $workspace 'selected-folder'
Assert $result.ok ('Actual user setup failed: '+$result.title+'; '+$result.log)
Assert ($result.stage -eq 'prepared') 'Success must mean preparation, not client connection'
Assert ($result.next -match '首次.*信任' -and $result.next -match '连接器') 'First-trust and task instructions missing'
$checks+='Non-elevated real worker accepts Chinese, spaces and apostrophe paths and returns prepared status with client trust instructions'
Assert ((Get-CadBridgeInitialWorkspace $Project $clientDirectory) -eq $workspace) 'Selected workspace was not remembered'
Assert ($null -ne (Get-CadBridgePreviousResult $Project $clientDirectory)) 'Completed preparation cannot be reopened'
$checks+='Directory selection persists and a reopened launcher can show the verified prior preparation'
$savedClient=[IO.File]::ReadAllBytes((Join-Path $clientDirectory 'mcp.json'))
[IO.File]::AppendAllText((Join-Path $clientDirectory 'mcp.json'),' ',$utf8)
Assert ($null -eq (Get-CadBridgePreviousResult $Project $clientDirectory)) 'Manual configuration changes must invalidate cached success'
[IO.File]::WriteAllBytes((Join-Path $clientDirectory 'mcp.json'),$savedClient)
$checks+='A cached success is not reused after manual changes to the connector configuration'
$client=[IO.File]::ReadAllText((Join-Path $clientDirectory 'mcp.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
Assert ($client.mcpServers.unrelated.command -eq 'keep') 'Unrelated service changed'
Assert ([IO.File]::ReadAllText((Join-Path $clientDirectory '.mcp.json')) -eq 'client-owned proxy') 'Generated client proxy changed'
$checks+='User entry preserves unrelated services and the WorkBuddy-owned proxy'
$newWorkspace=Join-Path $TestRoot '更换后的 图纸'
$changed=Run-Worker $newWorkspace 'changed-folder'
Assert ($changed.ok -and (Get-CadBridgeInitialWorkspace $Project $clientDirectory) -eq $newWorkspace) 'Directory change failed'
$checks+='Changing the folder through the same worker updates the workspace without editing configuration'
$blocked=Join-Path $TestRoot 'not-a-folder';[IO.File]::WriteAllText($blocked,'file',$utf8)
$before=(Get-FileHash -LiteralPath (Join-Path $clientDirectory 'mcp.json')).Hash
$failed=Run-Worker $blocked 'invalid-folder'
Assert (-not $failed.ok -and $failed.title -eq '图纸文件夹不可用') 'Invalid folder does not show actionable Chinese error'
Assert ((Get-FileHash -LiteralPath (Join-Path $clientDirectory 'mcp.json')).Hash -eq $before) 'Invalid folder changed the connector'
$checks+='An invalid folder gives a Chinese recovery action and leaves the existing connector unchanged'
$invalid=Run-Worker 'relative-folder' 'relative-folder'
Assert (-not $invalid.ok -and $invalid.title -eq '图纸文件夹不可用') 'Relative workspace should not pass'
$checks+='Relative or empty folder input cannot trigger installation'
foreach($code in @('CAD_NOT_SUPPORTED','RUNTIME_HASH_MISMATCH','RUNTIME_DOWNLOAD_FAILED','DEPENDENCIES_OFFLINE_MISSING','CLIENT_CONFIG_INVALID','CLIENT_INSTALL_BUSY','INSTALL_DIRECTORY_READ_ONLY')){
  $message=Get-CadBridgeFailureText $code
  Assert ($message.title -match '[\u4e00-\u9fff]' -and $message.next -match '[\u4e00-\u9fff]') ('Untranslated error: '+$code)
}
$checks+='Missing CAD, corrupt/offline dependencies, network failure, conflicting configuration, concurrent install and read-only package have Chinese next actions'
$report=@{ok=$true;checkedAt=[DateTime]::UtcNow.ToString('o');checks=$checks;project=$Project;clientHome=$clientDirectory;workspace=$newWorkspace;successfulReport=(Join-Path $TestRoot 'changed-folder.json');failedReport=(Join-Path $TestRoot 'invalid-folder.json');scope='Actual user-setup worker on existing non-elevated Windows; no UI clicks, no clean Windows or separate account claim'}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ReportPath),($report | ConvertTo-Json -Depth 5),$utf8)
$report | ConvertTo-Json -Depth 5
