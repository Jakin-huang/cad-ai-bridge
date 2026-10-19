// Verify a final documentation repack against the functionally accepted candidate.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectRoot as root} from '../src/config.mjs';
const zip=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Supply the final user ZIP');
const accepted=JSON.parse(await fs.readFile(path.join(root,'artifacts/windows-user-package-report.json'),'utf8'));assert.equal(accepted.ok,true);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sha256=hash(await fs.readFile(zip));assert.equal((await fs.readFile(zip+'.sha256','utf8')).split(/\s+/)[0],sha256);
const destination=await fs.mkdtemp(path.join(root,'dist','user-verified-'));
function run(executable,args,env=process.env){const result=spawnSync(executable,args,{env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:path.basename(executable).toLowerCase()==='cmd.exe',timeout:180000,maxBuffer:8*1024*1024});assert.equal(result.status,0,result.stdout+'\n'+result.stderr+'\n'+String(result.error||''));return result.stdout;}
const powershell=process.env.CADAGENT_POWERSHELL||'pwsh.exe';
run(powershell,['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory($env:BRIDGE_FINAL_ZIP,$env:BRIDGE_FINAL_DEST)"],{...process.env,BRIDGE_FINAL_ZIP:zip,BRIDGE_FINAL_DEST:destination});
const folders=await fs.readdir(destination);assert.equal(folders.length,1);const folder=path.join(destination,folders[0]);
const manifest=JSON.parse(await fs.readFile(path.join(folder,'release-manifest.json'),'utf8'));assert.equal(manifest.offlineSetup,true);
for(const file of manifest.files)assert.equal(hash(await fs.readFile(path.join(folder,file.file))),file.sha256,file.file);
const maintenance=new Set(['scripts/verify-user-repack.mjs','scripts/package-release.mjs','scripts/public-files.mjs','scripts/check-release.mjs','scripts/summarize-maintenance.mjs','scripts/summarize-windows-user.mjs','scripts/prepare-clean-windows.mjs','scripts/prepare-clean-vm.mjs']);
const product=file=>!maintenance.has(file)&&(!/^(?:docs|tests|\.github)\//.test(file))&&(/\.(?:mjs|ps1|cmd|cs)$/.test(file)||/^(?:src|runtime-archives|node_modules|plugin|skills)\//.test(file)||['package.json','package-lock.json','scripts/runtime-assets.json'].includes(file));
const old=new Map(accepted.verifiedManifest.filter(entry=>product(entry.file)).map(entry=>[entry.file,entry.sha256]));
const current=new Map(manifest.files.filter(entry=>product(entry.file)).map(entry=>[entry.file,entry.sha256]));
assert.deepEqual(current,old,'Runtime/product files changed after acceptance; rerun the full package and dependency tests');
const home=path.join(destination,'isolated-client'),env={...process.env,CADBRIDGE_RUNTIME_HOME:accepted.isolatedRuntimes,CADBRIDGE_RUNTIME_ISOLATED:'1',CADBRIDGE_OFFLINE:'1',PATH:[path.join(process.env.WINDIR,'System32'),process.env.WINDIR,path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0')].join(';')};
for(const key of ['CADBRIDGE_CONFIG','CADBRIDGE_RUNTIME_CACHE','CADAGENT_POWERSHELL','CADAGENT_ALLOWED_ROOT','CADAGENT_CAD_ROOT'])delete env[key];
run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(folder,'connect-workbuddy.cmd')+'" --client-home "'+home+'""'],env);
const server=JSON.parse(await fs.readFile(path.join(home,'mcp.json'),'utf8')).mcpServers['cad-ai-bridge'];
const client=new Client({name:'final-user-package-verification',version:'0.2.0'});
try{
 await client.connect(new StdioClientTransport({command:server.command,args:server.args,env:{...process.env,...server.env},stderr:'pipe'}));
 assert.equal((await client.listTools()).tools.length,15);
 const doctor=JSON.parse((await client.callTool({name:'cad_doctor',arguments:{}})).content[0].text);assert.equal(doctor.ok,true);
}finally{await client.close();}
const report={ok:true,checkedAt:new Date().toISOString(),archive:zip,sha256,bytes:(await fs.stat(zip)).size,extracted:folder,verifiedFiles:manifest.files.length,matchingProductFiles:current.size,acceptedCandidateSHA256:accepted.packageSha256,checks:['ZIP sidecar and all extracted files match SHA-256 manifest','Every runtime, dependency, plugin, Skill and product entry is identical to the accepted candidate','Fresh isolated setup succeeds offline with minimal PATH','Generated MCP entry discovers 15 tools and diagnostic passes'],cleanWindowsVerified:false,separateStandardAccountVerified:false};
await fs.writeFile(path.join(root,'artifacts/windows-user-final-package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
