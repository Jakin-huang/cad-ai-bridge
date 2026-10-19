param([string]$ClientHome=(Join-Path ([Environment]::GetFolderPath('UserProfile')) '.workbuddy'),[string]$RenderTo,[string]$PreviewReport)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'user-onboarding.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$project=Split-Path -Parent $PSScriptRoot
$script:worker=$null;$script:log=$null;$script:report=$null
$form=New-Object Windows.Forms.Form
$form.Text='CAD AI Bridge · 开始使用';$form.ClientSize=New-Object Drawing.Size(720,570)
$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$form.AutoScaleMode='Dpi';$form.BackColor=[Drawing.Color]::White
function Label($Text,$X,$Y,$W,$H){$c=New-Object Windows.Forms.Label;$c.Text=$Text;$c.SetBounds($X,$Y,$W,$H);$form.Controls.Add($c);return $c}
function Button($Text,$X,$Y,$W){$c=New-Object Windows.Forms.Button;$c.Text=$Text;$c.SetBounds($X,$Y,$W,36);$form.Controls.Add($c);return $c}
$heading=Label '让 AI 使用你已有的 CAD' 28 22 650 40
$heading.Font=New-Object Drawing.Font('Microsoft YaHei UI',19,[Drawing.FontStyle]::Bold)
$intro=Label '需已正常安装 AutoCAD 2022 和 WorkBuddy，天正电气 V8 可选。' 30 70 660 28
$caption=Label '图纸文件夹' 30 112 650 25
$folder=New-Object Windows.Forms.TextBox;$folder.SetBounds(30,142,536,30);$folder.Text=Get-CadBridgeInitialWorkspace $project $ClientHome;$form.Controls.Add($folder)
$browse=Button '选择文件夹…' 580 139 110
$hint=Label '选择你存放图纸的文件夹；以后会自动沿用，可随时在这里更换。' 30 181 660 25
$hint.ForeColor=[Drawing.Color]::DimGray
$connect=Button '接入 WorkBuddy' 30 221 190
$connect.BackColor=[Drawing.Color]::FromArgb(31,92,220);$connect.ForeColor=[Drawing.Color]::White;$connect.FlatStyle='Flat'
$help=Button '一页图文说明' 236 221 144
$progress=New-Object Windows.Forms.ProgressBar;$progress.SetBounds(30,278,660,7);$progress.Style='Marquee';$progress.Visible=$false;$form.Controls.Add($progress)
$status=Label '选好文件夹后，点击“接入 WorkBuddy”。' 30 302 660 34
$status.Font=New-Object Drawing.Font('Microsoft YaHei UI',11,[Drawing.FontStyle]::Bold)
$next=Label '程序自动准备运行环境、检查 CAD 并安装连接器和 Skill。无需填写密钥、修改配置或安装开发工具。' 30 344 660 96
$copy=Button '复制第一条任务' 30 457 170;$copy.Enabled=$false
$logs=Button '查看日志' 218 457 112;$logs.Enabled=$false
$foot=Label '接入不会修改原图纸。请保留整个解压目录，移动后重新接入。' 30 517 660 35
$foot.ForeColor=[Drawing.Color]::DimGray
$example='使用 CAD AI Bridge 检查连接，在毫米制新图中画两条长3000毫米、间隔1000毫米的水平线，并写“测试”。把文字替换为“CAD AI Bridge”，保存后重开核对，生成按对象类型和图层分组的CSV及PNG预览，返回实际DWG和交付文件链接。'
$browse.Add_Click({
  $picker=New-Object Windows.Forms.FolderBrowserDialog
  try{$picker.Description='选择已有图纸所在的文件夹，也可以新建文件夹';$picker.ShowNewFolderButton=$true;if(Test-Path -LiteralPath $folder.Text -PathType Container){$picker.SelectedPath=$folder.Text};if($picker.ShowDialog($form) -eq 'OK'){$folder.Text=$picker.SelectedPath}}finally{$picker.Dispose()}
})
$help.Add_Click({try{Start-Process -FilePath (Join-Path $project '使用说明.html')}catch{$status.Text='无法打开说明，请双击根目录的“使用说明.html”。'}})
$copy.Add_Click({try{[Windows.Forms.Clipboard]::SetText($example);$copy.Text='已复制，请粘贴到任务'}catch{$status.Text='剪贴板暂不可用，请从图文说明中复制示例任务。'}})
$logs.Add_Click({if($script:log -and (Test-Path -LiteralPath $script:log)){Start-Process -FilePath 'notepad.exe' -ArgumentList ('"'+$script:log+'"')}})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=400
function Finish-Setup($result){
  $progress.Visible=$false;$connect.Enabled=$true;$browse.Enabled=$true;$folder.Enabled=$true
  $status.Text=$result.title;$next.Text=$result.next;$logs.Enabled=($script:log -and (Test-Path -LiteralPath $script:log))
  if($result.ok){$status.ForeColor=[Drawing.Color]::FromArgb(20,116,74);$connect.Text='重新接入 / 更换目录';$copy.Enabled=$true}
  else{$status.ForeColor=[Drawing.Color]::FromArgb(174,47,40);$connect.Text='重新接入';$copy.Enabled=$false}
}
$timer.Add_Tick({
  if($script:worker -and $script:worker.HasExited){
    $timer.Stop()
    try{if(-not (Test-Path -LiteralPath $script:report)){throw 'No result report'};$result=[IO.File]::ReadAllText($script:report,[Text.Encoding]::UTF8) | ConvertFrom-Json;Finish-Setup $result}
    catch{$failure=Get-CadBridgeFailureText '';Finish-Setup ([pscustomobject]@{ok=$false;title=$failure.title;next=$failure.next})}
    finally{$script:worker.Dispose();$script:worker=$null}
  }
})
$connect.Add_Click({
  try{
    if([string]::IsNullOrWhiteSpace($folder.Text) -or -not [IO.Path]::IsPathRooted($folder.Text)){throw 'WORKSPACE_INVALID'}
    $directory=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CADBridge\logs'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $id='user-setup-'+[guid]::NewGuid().ToString('N')
    $script:log=Join-Path $directory ($id+'.log');$script:report=Join-Path $directory ($id+'.json')
    $requestFile=Join-Path $directory ($id+'-request.json')
    $request=@{project=$project;workspace=$folder.Text;clientHome=$ClientHome;log=$script:log;report=$script:report}
    [IO.File]::WriteAllText($requestFile,($request | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    $shell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'user-setup-worker.ps1')+'" -RequestFile "'+$requestFile+'"'
    $script:worker=Start-Process -FilePath $shell -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $connect.Enabled=$false;$browse.Enabled=$false;$folder.Enabled=$false;$copy.Enabled=$false;$logs.Enabled=$false
    $progress.Visible=$true;$status.ForeColor=[Drawing.Color]::FromArgb(31,92,220);$status.Text='正在准备接入，请稍候…'
    $next.Text='正在检查运行环境和 CAD，并配置连接器及 Skill。首次解压运行时可能需要几分钟，请保留此窗口。';$timer.Start()
  }catch{$failure=Get-CadBridgeFailureText $_.Exception.Message;Finish-Setup ([pscustomobject]@{ok=$false;title=$failure.title;next=$failure.next})}
})
$form.Add_FormClosing({param($sender,$eventArgs)if($script:worker){$eventArgs.Cancel=$true;$status.Text='接入正在进行，请等待完成后关闭窗口。'}})
$previous=Get-CadBridgePreviousResult $project $ClientHome
if($previous){$script:log=$previous.log;Finish-Setup $previous}
try{
  if($RenderTo){
    if($PreviewReport){$preview=[IO.File]::ReadAllText($PreviewReport,[Text.Encoding]::UTF8) | ConvertFrom-Json;$script:log=$preview.log;Finish-Setup $preview}
    # Maintainer-only native control rendering: does not click or run installation.
    $form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-10000,-10000);$form.Show();$form.Refresh();[Windows.Forms.Application]::DoEvents()
    $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
    try{$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$bitmap.Save([IO.Path]::GetFullPath($RenderTo),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
  }else{[Windows.Forms.Application]::Run($form)}
}finally{$timer.Dispose();$form.Dispose()}
