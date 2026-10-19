# Shared non-UI onboarding operations. Windows PowerShell 5.1 compatible.
$env:PSModulePath=(Join-Path $PSHOME 'Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
function Get-CadBridgeStatePath([string]$Project,[string]$ClientHome){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$key=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($Project)+'|'+[IO.Path]::GetFullPath($ClientHome)).ToLowerInvariant()))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
  return (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('CADBridge\logs\last-'+$key+'.json'))
}
function Get-CadBridgePreviousResult([string]$Project,[string]$ClientHome){
  try{
    $result=[IO.File]::ReadAllText((Get-CadBridgeStatePath $Project $ClientHome),[Text.Encoding]::UTF8) | ConvertFrom-Json
    if(-not $result.ok -or $result.project -ne [IO.Path]::GetFullPath($Project) -or $result.clientHome -ne $ClientHome){return $null}
    foreach($entry in $result.configDigests){if((Get-FileHash -LiteralPath $entry.file -Algorithm SHA256).Hash -ne $entry.sha256){return $null}}
    if(@($result.configDigests).Count -ne 3 -or -not (Test-Path -LiteralPath $result.workspace -PathType Container)){return $null}
    $result.title='上次已完成本机接入准备，请在 WorkBuddy 中确认连接'
    return $result
  }catch{return $null}
}
function Get-CadBridgeInitialWorkspace([string]$Project,[string]$ClientHome){
  $config=Join-Path $Project 'cadbridge.local.json'
  try{
    if(-not (Test-Path -LiteralPath $config)){
      $client=[IO.File]::ReadAllText((Join-Path $ClientHome 'mcp.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
      $config=$client.mcpServers.'cad-ai-bridge'.env.CADBRIDGE_CONFIG
    }
    $stored=[IO.File]::ReadAllText($config,[Text.Encoding]::UTF8) | ConvertFrom-Json
    if($stored.workspace){return [IO.Path]::GetFullPath($stored.workspace)}
  }catch{}
  $documents=[Environment]::GetFolderPath('MyDocuments')
  if(-not $documents){$documents=[Environment]::GetFolderPath('UserProfile')}
  return (Join-Path $documents 'CAD图纸')
}
function Get-CadBridgeFailureText([string]$Detail){
  $rules=@(
    @('WORKSPACE_INVALID|WORKSPACE_UNWRITABLE','图纸文件夹不可用','请选择可写的本机图纸文件夹，再点“重新接入”。无需管理员权限。'),
    @('INSTALL_DIRECTORY_READ_ONLY','解压位置不可写','请把完整压缩包解压到自己的文件夹，再双击“开始使用.exe”。无需管理员权限。'),
    @('CAD_SELECTION_REQUIRED','检测到多个 CAD 安装','当前需要选择一个 AutoCAD 2022 安装。请把日志交给分享者确认安装位置。'),
    @('CAD_NOT_SUPPORTED|CAD_NOT_FOUND','未找到支持的 CAD','请先正常安装并启动一次 AutoCAD 2022，完成软件自身的首次使用设置，然后重新接入。本包不安装 CAD。'),
    @('PLATFORM_UNSUPPORTED','当前系统不受支持','本预览包仅支持 Windows x64，请在对应的电脑上使用。'),
    @('RUNTIME_HASH_MISMATCH|RUNTIME_ARCHIVE_INVALID|RUNTIME_INVALID|PLUGIN_DIGEST_MISMATCH','安装文件校验未通过','请重新获取并完整解压用户包后重试，不要继续使用损坏的文件。'),
    @('RUNTIME_OFFLINE_MISSING|DEPENDENCIES_OFFLINE_MISSING|NPM_MISSING','用户包内容不完整','请重新解压完整的 Windows 用户包，保留里面的所有文件，再点“开始使用.exe”。'),
    @('RUNTIME_DOWNLOAD_FAILED|DEPENDENCIES_FAILED','依赖准备未完成','请检查网络后重试，或重新解压完整的离线用户包。无需另外安装开发工具。'),
    @('CLIENT_INSTALL_BUSY','另一个接入或恢复正在运行','请等待另一个窗口完成后重试，不要同时重复运行接入。'),
    @('CLIENT_RESTORE_CONFLICT|CLIENT_INSTALL_CONFLICT|CLIENT_CONFIG_INVALID|CONFIG_INVALID|CLIENT_PATH_INVALID','已有配置需要确认','已保留现有内容。请点“查看日志”，把错误信息交给分享者处理，不要删除 WorkBuddy 的配置。'),
    @('PLUGIN_UNVERIFIED|PLUGIN_INCOMPATIBLE|PLUGIN_SOURCE_CHANGED|Command failed','项目插件未准备好','请使用完整用户包重试；若仍失败，请把日志交给分享者，无需自行编译。'),
    @('Access.*denied|UnauthorizedAccess|权限|拒绝访问','当前目录无写入权限','请换到自己的可写文件夹后重试。不要以管理员身份运行。')
  )
  foreach($rule in $rules){if($Detail -match $rule[0]){return [pscustomobject]@{title=$rule[1];next=$rule[2]}}}
  return [pscustomobject]@{title='接入未完成';next='请点“查看日志”获取错误信息。可先检查 CAD 是否正常可用、用户包是否完整，再重新接入；原图纸不会被本次接入修改。'}
}
function Invoke-CadBridgeUserSetup($Request){
  $project=[IO.Path]::GetFullPath($Request.project)
  $result=[ordered]@{ok=$false;stage='preparing';project=$project;clientHome=$Request.clientHome;workspace=$Request.workspace;log=$Request.log;checkedAt=[DateTime]::UtcNow.ToString('o')}
  try{
    if([string]::IsNullOrWhiteSpace($Request.workspace) -or -not [IO.Path]::IsPathRooted($Request.workspace)){throw 'WORKSPACE_INVALID'}
    $workspace=[IO.Path]::GetFullPath($Request.workspace)
    if($workspace -ne [IO.Path]::GetPathRoot($workspace)){$workspace=$workspace.TrimEnd('\','/')}
    try{
      [IO.Directory]::CreateDirectory($workspace) | Out-Null
      $probe=Join-Path $workspace ('.cadbridge-write-'+[guid]::NewGuid().ToString('N'))
      [IO.File]::WriteAllText($probe,'');[IO.File]::Delete($probe)
    }catch{throw 'WORKSPACE_UNWRITABLE'}
    $result.workspace=$workspace
    $shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    try{
      # Windows PowerShell treats redirected native stderr as ErrorRecord even on success.
      $ErrorActionPreference='Continue'
      & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $project 'scripts\setup-local.ps1') --client workbuddy --client-home $Request.clientHome --workspace $workspace 2>&1 | Out-File -LiteralPath $Request.log -Encoding utf8
      $setupExit=$LASTEXITCODE
    }finally{$ErrorActionPreference='Stop'}
    if($setupExit -ne 0){throw ('SETUP_FAILED: '+(Get-Content -LiteralPath $Request.log -Raw -Encoding UTF8))}
    $config=[IO.File]::ReadAllText((Join-Path $project 'cadbridge.local.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
    $client=[IO.File]::ReadAllText((Join-Path $Request.clientHome 'mcp.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
    if($config.workspace -ne $workspace -or $client.mcpServers.'cad-ai-bridge'.env.CADBRIDGE_CONFIG -ne (Join-Path $project 'cadbridge.local.json') -or -not (Test-Path -LiteralPath (Join-Path $Request.clientHome 'skills\cadbridge-electrical\SKILL.md'))){throw 'CLIENT_CONFIG_INVALID: setup verification did not match selected workspace'}
    $result.ok=$true;$result.stage='prepared';$result.title='本机环境检查通过，连接器和 Skill 已安装'
    $result.configDigests=@((Join-Path $project 'cadbridge.local.json'),(Join-Path $Request.clientHome 'mcp.json'),(Join-Path $Request.clientHome 'skills\cadbridge-electrical\SKILL.md')) | ForEach-Object {@{file=$_;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash}}
    $result.next='请打开 WorkBuddy → 专家·技能·连接器 → 连接器 → 右上角“自定义连接器”，找到 cad-ai-bridge 并完成首次“信任”。等待工具加载后，在新任务的“+ → 连接器”中确认已选用。'
  }catch{
    $detail=$_.Exception.Message
    Add-Content -LiteralPath $Request.log -Value $detail -Encoding UTF8
    $failure=Get-CadBridgeFailureText $detail
    $result.stage='failed';$result.title=$failure.title;$result.next=$failure.next
  }
  $json=$result | ConvertTo-Json -Depth 5
  $temporary=$Request.report+'.tmp-'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($temporary,$json,[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $Request.report -Force
  # Remember only an actual completed preparation; reopens verify configuration hashes.
  $state=Get-CadBridgeStatePath $project $Request.clientHome
  try{[IO.Directory]::CreateDirectory((Split-Path -Parent $state)) | Out-Null;[IO.File]::WriteAllText($state,$json,[Text.UTF8Encoding]::new($false))}catch{}
  return [pscustomobject]$result
}
