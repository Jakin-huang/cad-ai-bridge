$ErrorActionPreference='Stop'
$cads=@()
$base='HKLM:\SOFTWARE\Autodesk\AutoCAD'
if(Test-Path -LiteralPath $base){foreach($release in Get-ChildItem -LiteralPath $base){foreach($product in Get-ChildItem -LiteralPath $release.PSPath -ErrorAction SilentlyContinue){
  $value=Get-ItemProperty -LiteralPath $product.PSPath -ErrorAction SilentlyContinue
  if($value.AcadLocation -and (Test-Path -LiteralPath (Join-Path $value.AcadLocation 'acad.exe'))){
    $key='Software\Autodesk\AutoCAD\'+$release.PSChildName+'\'+$product.PSChildName
    $profiles='HKCU:\'+$key+'\Profiles'
    $cads += [pscustomobject]@{root=$value.AcadLocation;release=$release.PSChildName;productKey=$key;product=$value.ProductName;localeId=$value.LocaleID;language=if($value.LocaleID -eq '804'){'zh-CN'}elseif($value.LocaleID -eq '409'){'en-US'}else{$null};verifiedTarget=($release.PSChildName -eq 'R24.1');profiles=@(if(Test-Path -LiteralPath $profiles){Get-ChildItem -LiteralPath $profiles|Select-Object -ExpandProperty PSChildName})}
  }
}}}
$tangent=@()
foreach($base in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')){
  foreach($item in Get-ItemProperty -Path ($base+'\*') -ErrorAction SilentlyContinue){if($item.DisplayName -like '*天正电气*' -and $item.InstallLocation){$tangent += [pscustomobject]@{root=$item.InstallLocation;product=$item.DisplayName;version=$item.DisplayVersion;r24ModulePresent=(Test-Path -LiteralPath (Join-Path $item.InstallLocation 'sys24x64\tel_kernal.arx'))}}}
}
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
[ordered]@{platform='win32';powershell=(Get-Process -Id $PID).Path;cads=$cads;tangent=$tangent;nodeRequired='>=22.19';hostModel='local licensed AutoCAD; user-provided Tangent installation'}|ConvertTo-Json -Depth 8 -Compress
