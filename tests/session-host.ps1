param([Parameter(Mandatory=$true)][string]$Drawing,[Parameter(Mandatory=$true)][string]$SessionHome,[Parameter(Mandatory=$true)][string]$Report,[string]$CadRoot)
$ErrorActionPreference='Stop'
if(-not $CadRoot){$CadRoot=(Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'cadbridge.local.json') | ConvertFrom-Json).cadRoot}
$stage=Join-Path ([IO.Path]::GetTempPath()) ('CadBridgeSessionQA-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $Drawing -Destination (Join-Path $stage 'input.dwg')
$plugin=Join-Path (Split-Path -Parent $PSScriptRoot) 'plugin\bin\CadAgent.dll'
Copy-Item -LiteralPath $plugin -Destination (Join-Path $stage 'CadAgent.dll')
function Literal([string]$text){return '"'+$text.Replace('\','/').Replace('"','\"')+'"'}
$lines=@('(setq cbSessionTrust (getvar "TRUSTEDPATHS"))',('(setvar "TRUSTEDPATHS" (strcat cbSessionTrust ";" '+(Literal $stage)+'))'),('(command "_.NETLOAD" '+(Literal (Join-Path $stage 'CadAgent.dll'))+')'),'(setvar "TRUSTEDPATHS" cbSessionTrust)','CADBRIDGESESSIONSTART','')
$script=Join-Path $stage 'start.scr';[IO.File]::WriteAllText($script,($lines -join "`n"),[Text.Encoding]::ASCII)
$start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=Join-Path $CadRoot 'acad.exe';$start.UseShellExecute=$false;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.Environment['__COMPAT_LAYER']='RunAsInvoker';$start.Environment['CADBRIDGE_SESSION_HOME']=$SessionHome
foreach($argument in @((Join-Path $stage 'input.dwg'),'/p','<<未命名配置>>','/nologo','/b',$script)){$start.ArgumentList.Add($argument)}
$process=[Diagnostics.Process]::Start($start)
[ordered]@{pid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o');stage=$stage;drawing=(Join-Path $stage 'input.dwg');sourceSHA256=(Get-FileHash -LiteralPath $Drawing).Hash;pluginSHA256=(Get-FileHash -LiteralPath $plugin).Hash} | ConvertTo-Json | Set-Content -LiteralPath $Report -Encoding utf8
