param([string]$CadRoot)
$ErrorActionPreference='Stop'
if(-not $CadRoot){throw 'Use cadbridge setup to detect CAD, or provide -CadRoot explicitly'}
$bin=Join-Path $PSScriptRoot 'plugin\bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
$sources=@(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'plugin') -Filter '*.cs' | Select-Object -ExpandProperty FullName)
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:library /platform:x64 /optimize+ "/out:$bin\CadAgent.dll" /reference:System.Core.dll /reference:System.Web.Extensions.dll "/reference:$CadRoot\accoremgd.dll" "/reference:$CadRoot\acdbmgd.dll" @sources
if($LASTEXITCODE -ne 0){throw 'Plugin compilation failed'}
$sourceDigests=@(foreach($source in $sources){[ordered]@{file=(Split-Path $source -Leaf);sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash}})
[ordered]@{target='AutoCAD 2022 x64, CLR4 / .NET Framework 4.8';version='0.2.0';dll=(Join-Path $bin 'CadAgent.dll');sha256=(Get-FileHash -LiteralPath (Join-Path $bin 'CadAgent.dll') -Algorithm SHA256).Hash;sourceDigests=$sourceDigests} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $bin 'build.json') -Encoding utf8
