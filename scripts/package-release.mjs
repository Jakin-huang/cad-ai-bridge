import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,publicFiles} from './public-files.mjs';
import {dependencyFiles} from './package-dependencies.mjs';
const check=spawnSync(process.execPath,[path.join(root,'scripts/check-release.mjs')],{stdio:'inherit',windowsHide:true});
if(check.status!==0)throw Error('Release checks failed');
if(process.platform!=='win32')throw Error('Build this verified AutoCAD preview package on Windows');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const release=JSON.parse(await fs.readFile(path.join(root,'release.json'),'utf8'));
if(release.compatibilityVersion!==pkg.version||release.tag!=='v'+release.version||release.channel!=='preview')throw Error('Release identity does not match compatibility version');
const frozen=process.argv.includes('--frozen');
function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||String(result.error));return result.stdout.trim();}
let source;
if(frozen){
 if(git(['status','--porcelain','--untracked-files=all']))throw Error('Frozen releases require a clean committed source tree');
 const commit=git(['rev-parse','HEAD']);if(git(['rev-parse',release.tag+'^{commit}'])!==commit)throw Error('Frozen tag must point to HEAD');
 source={commit,tree:git(['rev-parse','HEAD^{tree}']),tag:release.tag,clean:true};
}
const userPackage=process.argv.includes('--user');
const name=pkg.name+'-'+release.version+(userPackage?'-windows-x64':'-windows-developer-x64');
const dist=path.join(root,'dist');await fs.mkdir(dist,{recursive:true});
const archive=path.join(dist,name+(frozen?'':'-'+new Date().toISOString().replace(/[:.]/g,'-'))+'.zip');
if(await fs.access(archive).then(()=>true,()=>false))throw Error('Release archive already exists; never overwrite a frozen artifact');
// Unique staging directories avoid deleting or overwriting unrelated content.
const stage=await fs.mkdtemp(path.join(dist,'stage-')),folder=path.join(stage,name);await fs.mkdir(folder);
const files=[...await publicFiles(),'plugin/bin/CadAgent.dll',...await dependencyFiles()];
if(frozen){
 const tracked=new Set(git(['ls-files','-z']).split('\0').filter(Boolean));
 const allowed=new Set(await publicFiles());
 for(const file of allowed)if(!tracked.has(file))throw Error('Untracked public source in frozen release: '+file);
 for(const file of tracked)if(!allowed.has(file))throw Error('Tracked file outside public allowlist: '+file);
 const audit=spawnSync(process.execPath,[path.join(root,'scripts/audit-public.mjs')],{stdio:'inherit',windowsHide:true});
 if(audit.status!==0)throw Error('Public source/history audit failed');
}
const manifest={name:pkg.name,version:pkg.version,kind:'Windows developer preview',requirements:['Windows x64','Node.js >=22.19','PowerShell >=7','AutoCAD 2022 locally installed and normally licensed','.NET Framework 4.8','Optional Tangent Electrical T20 V8.0','School PDF workflow: Python with reportlab/pypdf and local SimHei font; CADBRIDGE_PYTHON selects Python'],containsVendorRuntime:false,containsNodeRuntime:false,files:[]};
manifest.release=release;manifest.frozen=frozen;if(source)manifest.source=source;
manifest.containsNodeDependencies=true;manifest.setup='setup.cmd reuses compatible runtimes or extracts SHA-256-pinned portable ZIPs without administrator rights; matching plugin and locked dependencies are reused.';
if(userPackage){
 const cache=path.join(root,'artifacts/runtime-downloads');
 const preparation=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/ensure-runtimes.ps1'),'-DownloadOnly'],{stdio:'inherit',windowsHide:true,env:{...process.env,CADBRIDGE_RUNTIME_CACHE:cache}});
 if(preparation.status!==0)throw Error('Portable runtime preparation failed');
 const assets=JSON.parse(await fs.readFile(path.join(root,'scripts/runtime-assets.json'),'utf8'));
 for(const [kind,asset]of Object.entries(assets)){
  const bytes=await fs.readFile(path.join(cache,asset.file));const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(sha256!==asset.sha256)throw Error('Runtime digest mismatch: '+kind);
  const file='runtime-archives/'+asset.file;await fs.mkdir(path.join(folder,'runtime-archives'),{recursive:true});await fs.writeFile(path.join(folder,file),bytes);
  manifest.files.push({file,bytes:bytes.length,sha256});
 }
 manifest.kind='Windows user preview';manifest.containsNodeRuntime=true;manifest.containsPowerShellRuntime=true;
 manifest.runtimeAssets=assets;manifest.offlineSetup=true;
 manifest.requirements=manifest.requirements.filter(requirement=>!requirement.startsWith('Node.js')&&!requirement.startsWith('PowerShell'));
}
for(const file of files){const bytes=await fs.readFile(path.join(root,file));const target=path.join(folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);manifest.files.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
const build=JSON.parse((await fs.readFile(path.join(root,'plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,''));
// Build metadata shipped publicly contains no development machine paths.
const publicBuild={target:build.target,version:build.version,dll:'CadAgent.dll',sha256:build.sha256,sourceDigests:build.sourceDigests};
await fs.writeFile(path.join(folder,'plugin/bin/build.json'),JSON.stringify(publicBuild,null,2));
manifest.files.push({file:'plugin/bin/build.json',sha256:crypto.createHash('sha256').update(JSON.stringify(publicBuild,null,2)).digest('hex')});
await fs.writeFile(path.join(folder,'release-manifest.json'),JSON.stringify(manifest,null,2));
const script='$ErrorActionPreference="Stop"; Compress-Archive -LiteralPath $env:CADBRIDGE_PACKAGE_FOLDER -DestinationPath $env:CADBRIDGE_PACKAGE_ZIP -CompressionLevel Optimal';
const zipped=spawnSync('pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,CADBRIDGE_PACKAGE_FOLDER:folder,CADBRIDGE_PACKAGE_ZIP:archive}});
if(zipped.status!==0)throw Error(zipped.stderr||String(zipped.error));
const sha256=crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');await fs.writeFile(archive+'.sha256',sha256+'  '+path.basename(archive)+'\n');
console.log(JSON.stringify({ok:true,archive,sha256,files:manifest.files.length,stagingFolder:folder}));
