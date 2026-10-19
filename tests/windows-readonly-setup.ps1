param([string]$ReportPath)
$ErrorActionPreference='Stop'
$taskRoot=Join-Path ([IO.Path]::GetTempPath()) ('cb-readonly-'+[guid]::NewGuid().ToString('N'))
$projectRoot=Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Path (Join-Path $taskRoot 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\setup-local.ps1') -Destination (Join-Path $taskRoot 'scripts\setup-local.ps1')
$log=Join-Path ([IO.Path]::GetTempPath()) ('cb-readonly-log-'+[guid]::NewGuid().ToString('N')+'.txt')
$original=Get-Acl -LiteralPath $taskRoot
try{
  $restricted=Get-Acl -LiteralPath $taskRoot
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::Write,[Security.AccessControl.AccessControlType]::Deny)
  $restricted.AddAccessRule($rule)
  Set-Acl -LiteralPath $taskRoot -AclObject $restricted
  $ErrorActionPreference='Continue'
  & "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $taskRoot 'scripts\setup-local.ps1') *> $log
  $code=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  $text=Get-Content -LiteralPath $log -Raw
  if($code -eq 0 -or $text -notmatch 'INSTALL_DIRECTORY_READ_ONLY'){throw ('Read-only setup boundary failed: '+$text)}
  if(@(Get-ChildItem -LiteralPath $taskRoot -File).Count -ne 0){throw 'Setup wrote to the read-only directory'}
  $report=[ordered]@{ok=$true;checkedAt=[DateTime]::UtcNow.ToString('o');checks=@('Windows ACL denies installation-directory writes','Setup stops with actionable read-only error before runtime download or client changes');scope='Actual non-elevated Windows ACL boundary in disposable directory'}
  $json=$report|ConvertTo-Json -Depth 4
  if($ReportPath){$json|Set-Content -LiteralPath $ReportPath -Encoding UTF8}
  $json
}finally{
  Set-Acl -LiteralPath $taskRoot -AclObject $original
  # Only the freshly created child of the Windows temp directory is removed.
  if([IO.Path]::GetFullPath($taskRoot).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $taskRoot -Recurse -Force}
  Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
}
