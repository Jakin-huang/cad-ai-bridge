param([Parameter(Mandatory=$true)][int]$ExpectedPid,[Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$Seed)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CadQueryWindow { [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid); }
'@
$app=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application.24.1');$ownerPid=[uint32]0
[CadQueryWindow]::GetWindowThreadProcessId([IntPtr]$app.HWND,[ref]$ownerPid) | Out-Null
if($ownerPid -ne $ExpectedPid){throw 'Fixture creation is limited to the owned CAD QA process'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$suffix=[Guid]::NewGuid().ToString('N').Substring(0,8);$base=Join-Path $OutputDirectory ('base-'+$suffix+'.dwg');Copy-Item -LiteralPath $Seed -Destination $base
$document=$app.Documents.Open($base,$false);$document.SetVariable('INSUNITS',4)
$xref=Join-Path $OutputDirectory ('xref-'+$suffix+'.dwg');Copy-Item -LiteralPath $document.FullName -Destination $xref
$child=$document.Blocks.Add([double[]]@(0,0,0),('QA_CHILD_'+$suffix));$childLine=$child.AddLine([double[]]@(0,0,0),[double[]]@(100,0,0));$childLine.Layer='GEOM'
$parent=$document.Blocks.Add([double[]]@(0,0,0),('QA_PARENT_'+$suffix));$nested=$parent.InsertBlock([double[]]@(10,20,0),$child.Name,2,2,1,0)
$first=$document.ModelSpace.InsertBlock([double[]]@(5000,1000,0),$parent.Name,1,1,1,([Math]::PI/2))
$second=$document.ModelSpace.InsertBlock([double[]]@(6000,1000,0),$parent.Name,1,1,1,([Math]::PI/2))
$reference=$document.ModelSpace.AttachExternalReference($xref,('QA_XREF_'+$suffix),[double[]]@(10000,0,0),1,1,1,0,$false)
$paperLayout=$null;foreach($layout in $document.Layouts){if(-not $layout.ModelType){$paperLayout=$layout;break}}
if(-not $paperLayout){throw 'Synthetic drawing has no paper layout'}
$paperLine=$paperLayout.Block.AddLine([double[]]@(10,10,0),[double[]]@(30,10,0))
$variable=$document.ModelSpace.AddLightWeightPolyline([double[]]@(300,0,400,0,400,100));$variable.SetWidth(0,0,50);$variable.SetWidth(1,50,100)
$drawing=Join-Path $OutputDirectory ('nested-'+$suffix+'.dwg');$document.SaveAs($drawing)
$document.SetVariable('INSUNITS',6);$meters=Join-Path $OutputDirectory ('meters-'+$suffix+'.dwg');$document.SaveAs($meters)
[ordered]@{ok=$true;drawing=$drawing;meters=$meters;xref=$xref;firstHandle=$first.Handle;secondHandle=$second.Handle;nestedHandle=$nested.Handle;lineHandle=$childLine.Handle;variableHandle=$variable.Handle;xrefHandle=$reference.Handle;paperLayout=$paperLayout.Name;paperHandle=$paperLine.Handle;parentName=$parent.Name;childName=$child.Name} | ConvertTo-Json -Compress
