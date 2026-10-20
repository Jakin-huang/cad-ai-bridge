$ErrorActionPreference='Stop'
try{
  . (Join-Path $PSScriptRoot 'ensure-runtimes.ps1')
  $centerRuntimes=Ensure-Runtimes
  $env:CADAGENT_POWERSHELL=$centerRuntimes.powershell
  $entry=Join-Path $RuntimeProject 'bin\cadbridge.mjs'
  Start-Process -FilePath $centerRuntimes.node -ArgumentList ('"'+$entry+'" center --open') -WorkingDirectory $RuntimeProject -WindowStyle Hidden | Out-Null
}catch{
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show('任务中心未能启动。请先完整解压用户包并完成“开始使用”，再重试。'+[Environment]::NewLine+$_.Exception.Message,'CAD AI Bridge · 任务中心') | Out-Null
  exit 1
}
