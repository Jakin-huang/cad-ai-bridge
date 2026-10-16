import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,publicFiles} from './public-files.mjs';
const check=spawnSync(process.execPath,[path.join(root,'scripts/check-release.mjs')],{stdio:'inherit',windowsHide:true});
if(check.status!==0)throw Error('Release checks failed');
if(process.platform!=='win32')throw Error('Build this verified AutoCAD preview package on Windows');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const name=pkg.name+'-'+pkg.version+'-windows-developer-preview';
const dist=path.join(root,'dist');await fs.mkdir(dist,{recursive:true});
// Unique staging directories avoid deleting or overwriting unrelated content.
const stage=await fs.mkdtemp(path.join(dist,'stage-')),folder=path.join(stage,name);await fs.mkdir(folder);
const files=[...await publicFiles(),'plugin/bin/CadAgent.dll'];
const manifest={name:pkg.name,version:pkg.version,kind:'Windows developer preview',requirements:['Windows x64','Node.js >=22.19','PowerShell >=7','AutoCAD 2022 locally installed and normally licensed','.NET Framework 4.8','Optional Tangent Electrical T20 V8.0','School PDF workflow: Python with reportlab/pypdf and local SimHei font; CADBRIDGE_PYTHON selects Python'],containsVendorRuntime:false,containsNodeRuntime:false,files:[]};
for(const file of files){const bytes=await fs.readFile(path.join(root,file));const target=path.join(folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);manifest.files.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
const build=JSON.parse((await fs.readFile(path.join(root,'plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,''));
// Build metadata shipped publicly contains no development machine paths.
const publicBuild={target:build.target,version:build.version,dll:'CadAgent.dll',sha256:build.sha256,sourceDigests:build.sourceDigests};
await fs.writeFile(path.join(folder,'plugin/bin/build.json'),JSON.stringify(publicBuild,null,2));
manifest.files.push({file:'plugin/bin/build.json',sha256:crypto.createHash('sha256').update(JSON.stringify(publicBuild,null,2)).digest('hex')});
await fs.writeFile(path.join(folder,'release-manifest.json'),JSON.stringify(manifest,null,2));
const archive=path.join(dist,name+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip');
const script='$ErrorActionPreference="Stop"; Compress-Archive -LiteralPath $env:CADBRIDGE_PACKAGE_FOLDER -DestinationPath $env:CADBRIDGE_PACKAGE_ZIP -CompressionLevel Optimal';
const zipped=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,CADBRIDGE_PACKAGE_FOLDER:folder,CADBRIDGE_PACKAGE_ZIP:archive}});
if(zipped.status!==0)throw Error(zipped.stderr||String(zipped.error));
const sha256=crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');await fs.writeFile(archive+'.sha256',sha256+'  '+path.basename(archive)+'\n');
console.log(JSON.stringify({ok:true,archive,sha256,files:manifest.files.length,stagingFolder:folder}));
