param([switch]$NoOpen,[string]$ReportFile)
$ErrorActionPreference='Stop'
try{
  . (Join-Path $PSScriptRoot 'ensure-runtimes.ps1')
  $centerRuntimes=Ensure-Runtimes
  $env:CADAGENT_POWERSHELL=$centerRuntimes.powershell
  $entry=Join-Path $RuntimeProject 'bin\cadbridge.mjs'
  $centerArguments='"'+$entry+'" center'
  if(-not $NoOpen){$centerArguments+=' --open'}
  $launch=@{FilePath=$centerRuntimes.node;ArgumentList=$centerArguments;WorkingDirectory=$RuntimeProject;WindowStyle='Hidden'}
  if($ReportFile){$report=[IO.Path]::GetFullPath($ReportFile);if(Test-Path -LiteralPath $report){throw 'Report file already exists'};$launch.RedirectStandardOutput=$report;$launch.RedirectStandardError=$report+'.stderr'}
  Start-Process @launch | Out-Null
}catch{
  if($NoOpen){Write-Error $_.Exception.Message;exit 1}
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show('任务中心未能启动。请先完整解压用户包并完成“开始使用”，再重试。'+[Environment]::NewLine+$_.Exception.Message,'CAD AI Bridge · 任务中心') | Out-Null
  exit 1
}
