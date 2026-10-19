// Explicit local integration: requires licensed AutoCAD 2022. Never run by npm test.
// Usage: node tests/windows-user-package.mjs NEW-USER-PACKAGE.zip PREVIOUS-PACKAGE.zip
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectRoot as root} from '../src/config.mjs';
const [newZip,oldZip]=process.argv.slice(2);if(!newZip||!oldZip)throw Error('Supply new and previous ZIP paths');
const base=await fs.mkdtemp(path.join(root,'artifacts','普通用户 发行验收-'));
const checks=[],results={},startedAt=new Date().toISOString();
const isolatedRuntimes=path.join(os.tmpdir(),'cbrt-'+crypto.randomUUID().slice(0,8));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function run(executable,args,env=process.env){
 const result=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:path.basename(executable).toLowerCase()==='cmd.exe',env,maxBuffer:10*1024*1024,timeout:240000});
 if(result.status!==0)throw Error(path.basename(executable)+' failed: '+result.stdout+'\n'+result.stderr+'\n'+(result.error||''));
 return result.stdout;
}
const powershell=process.env.CADAGENT_POWERSHELL||'pwsh.exe';
const permissions=JSON.parse(run(powershell,['-NoProfile','-NonInteractive','-Command',"[ordered]@{elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator));machinePath=[Environment]::GetEnvironmentVariable('PATH','Machine');userPath=[Environment]::GetEnvironmentVariable('PATH','User')}|ConvertTo-Json -Compress"]));
assert.equal(permissions.elevated,false,'Run this acceptance from a non-elevated shell');checks.push('Windows process is not elevated');
async function extract(zip,label){
 const destination=path.join(base,label);await fs.mkdir(destination);
 run(powershell,['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory($env:BRIDGE_TEST_ZIP,$env:BRIDGE_TEST_DEST)"],{...process.env,BRIDGE_TEST_ZIP:path.resolve(zip),BRIDGE_TEST_DEST:destination});
 const entries=await fs.readdir(destination);assert.equal(entries.length,1);return path.join(destination,entries[0]);
}
function connect(folder,extra=[],env=process.env){
 const output=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(folder,'connect-workbuddy.cmd')+'" --client-home "'+home+'" '+extra.map(v=>'"'+v+'"').join(' ')+'"'],env);
 return output;
}
async function serverAt(){return JSON.parse(await fs.readFile(path.join(home,'mcp.json'),'utf8')).mcpServers['cad-ai-bridge'];}
async function smoke(server,write=false){
 const client=new Client({name:'windows-user-package-acceptance',version:'0.2.0'});
 try{
  await client.connect(new StdioClientTransport({command:server.command,args:server.args,env:{...process.env,...server.env},stderr:'pipe'}));
  assert.equal((await client.listTools()).tools.length,15);
  async function call(name,args={}){const reply=await client.callTool({name,arguments:args},undefined,{timeout:180000});const result=JSON.parse(reply.content[0].text);assert.equal(result.ok,true,JSON.stringify(result.error));return result;}
  const doctor=await call('cad_doctor');
  if(!write)return{doctor};
  const fixture=await call('cad_create_test_drawing',{adapter:'tangent-v8'});
  const applied=await call('electrical_apply',{drawing:fixture.drawing,expectedSha256:fixture.drawingSha256,documentId:fixture.snapshot.documentId,expectedRevision:fixture.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',adapter:'tangent-v8',operations:[
   {type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'L1',position:[0,0,0]},{id:'L2',position:[3000,0,0]}]},
   {type:'connect_route',id:'WL1-route',circuitId:'WL1',from:{id:'L1',port:'PWR'},to:{id:'L2',port:'PWR'},vertices:[[0,0,0],[3000,0,0]],wireSpec:{wireType:'BV',conductorSpec:'2x2.5'}},
   {type:'number_devices',ids:['L1','L2'],prefix:'L-',start:1,width:3}
  ]});
  const takeoff=await call('electrical_takeoff',{drawing:applied.drawing}),validation=await call('electrical_validate',{drawing:applied.drawing});
  assert.equal(takeoff.snapshot.devices.length,2);assert.equal(takeoff.snapshot.routes.length,1);assert.deepEqual(validation.snapshot.issues,[]);
  const native=await call('cad_native_status',{drawing:applied.drawing});assert.equal(native.nativeHost.nativeKernelLoaded,true);
  const cleanup=JSON.parse(await fs.readFile(path.join(native.jobRoot,'cleanup.json'),'utf8'));assert.equal(cleanup.ok,true);assert.equal(cleanup.originalTipRestored,true);
  assert.equal(hash(await fs.readFile(applied.drawing)),applied.drawingSha256);assert.equal(hash(await fs.readFile(fixture.drawing)),fixture.drawingSha256);
  return{doctor,fixture,applied,takeoff,validation,native};
 }finally{await client.close();}
}
const home=path.join(base,'隔离 WorkBuddy'),workspace=path.join(base,'用户图纸');
try{
 const oldFolder=await extract(oldZip,'旧版本'),newFolder=await extract(newZip,'新版本');
 const manifest=JSON.parse(await fs.readFile(path.join(newFolder,'release-manifest.json'),'utf8'));
 assert.equal(manifest.offlineSetup,true);
 for(const file of manifest.files)assert.equal(hash(await fs.readFile(path.join(newFolder,file.file))),file.sha256,file.file);
 checks.push('Freshly extracted user ZIP manifest verifies every source, dependency, plugin and runtime archive');
 await fs.mkdir(home);await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify({otherSetting:true,mcpServers:{unrelated:{command:'keep'}}}));await fs.writeFile(path.join(home,'.mcp.json'),'client-owned proxy');
 await fs.writeFile(path.join(base,'old-install.txt'),connect(oldFolder,['--workspace',workspace]));
 const oldServer=await serverAt(),oldSkill=await fs.readFile(path.join(home,'skills/cadbridge-electrical/SKILL.md'));
 checks.push('Previous release installs into isolated client without changing its other service or proxy');
 const env={...process.env,PATH:[path.join(process.env.WINDIR,'System32'),process.env.WINDIR,path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0')].join(';'),CADBRIDGE_RUNTIME_ISOLATED:'1',CADBRIDGE_OFFLINE:'1'};
 for(const key of ['CADBRIDGE_CONFIG','CADBRIDGE_RUNTIME_CACHE','CADAGENT_POWERSHELL','CADAGENT_ALLOWED_ROOT','CADAGENT_CAD_ROOT'])delete env[key];
 env.CADBRIDGE_RUNTIME_HOME=isolatedRuntimes;
 await fs.writeFile(path.join(base,'new-install.txt'),connect(newFolder,[],env));
 const newServer=await serverAt();assert.ok(newServer.command.startsWith(isolatedRuntimes+path.sep));assert.ok(newServer.env.CADAGENT_POWERSHELL.startsWith(isolatedRuntimes+path.sep));
 const config=JSON.parse(await fs.readFile(newServer.env.CADBRIDGE_CONFIG,'utf8'));assert.equal(config.workspace,workspace);assert.equal(await fs.readFile(path.join(home,'.mcp.json'),'utf8'),'client-owned proxy');
 checks.push('Offline upgrade with Node, PowerShell 7 and winget excluded extracts bundled runtimes without UAC');
 checks.push('Side-by-side upgrade inherits prior drawing workspace and preserves unrelated client settings');
 const cli=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'cadbridge.cmd')+'" help"'],env);assert.match(cli,/CAD AI Bridge/);checks.push('Packaged CLI works with Node and PowerShell 7 absent from PATH');
 results.upgraded=await smoke(newServer,true);checks.push('Packaged runtimes discover 15 tools, pass doctor, save two lights and reopen their route/numbering with no issues');checks.push('Packaged PowerShell loads native Tangent host and restores its user settings after exit');
 const savedHash=hash(await fs.readFile(results.upgraded.applied.drawing));
 // Repeat setup offline, then restore the original version from its transaction journal.
 await fs.writeFile(path.join(base,'repeat-install.txt'),connect(newFolder,[],env));assert.deepEqual(await serverAt(),newServer);checks.push('Repeat offline setup succeeds with exactly the same connector parameters');
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'restore-workbuddy.cmd')+'" --client-home "'+home+'""'],env);
 assert.deepEqual(await serverAt(),newServer); // immediate previous install is the same version
 // Reinstall the old configuration to model the original state, then test an actual upgrade rollback.
 await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify({otherSetting:true,mcpServers:{unrelated:{command:'keep'},'cad-ai-bridge':oldServer}}));
 await fs.writeFile(path.join(home,'skills/cadbridge-electrical/SKILL.md'),oldSkill);
 await fs.writeFile(path.join(base,'upgrade-for-rollback.txt'),connect(newFolder,[],env));
 const current=JSON.parse(await fs.readFile(path.join(home,'mcp.json'),'utf8'));current.mcpServers.addedLater={command:'also keep'};await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify(current));
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'restore-workbuddy.cmd')+'" --client-home "'+home+'""'],env);
 assert.deepEqual(await serverAt(),oldServer);assert.deepEqual(await fs.readFile(path.join(home,'skills/cadbridge-electrical/SKILL.md')),oldSkill);
 const restored=JSON.parse(await fs.readFile(path.join(home,'mcp.json'),'utf8'));assert.equal(restored.mcpServers.addedLater.command,'also keep');assert.equal(restored.mcpServers.unrelated.command,'keep');
 results.restored=await smoke(oldServer);assert.equal(hash(await fs.readFile(results.upgraded.applied.drawing)),savedHash);
 checks.push('Recovery command restores previous runnable release and Skill while retaining later services and new DWG');
 const permissionsAfter=JSON.parse(run(powershell,['-NoProfile','-NonInteractive','-Command',"[ordered]@{machinePath=[Environment]::GetEnvironmentVariable('PATH','Machine');userPath=[Environment]::GetEnvironmentVariable('PATH','User')}|ConvertTo-Json -Compress"]));
 assert.equal(permissionsAfter.machinePath,permissions.machinePath);assert.equal(permissionsAfter.userPath,permissions.userPath);checks.push('Machine and user PATH remain unchanged');
 const report={ok:true,startedAt,checkedAt:new Date().toISOString(),scope:'Existing Windows 10 x64, non-elevated process, isolated client and extracted package, minimal PATH and offline bootstrap; not a clean Windows or separate standard-account test',cleanWindowsVerified:false,separateStandardAccountVerified:false,elevated:false,package:path.resolve(newZip),packageSha256:hash(await fs.readFile(newZip)),manifestFiles:manifest.files.length,verifiedManifest:manifest.files,checks,base,isolatedRuntimes,results};
 await fs.writeFile(path.join(root,'artifacts/windows-user-package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks,base}));
}catch(error){await fs.writeFile(path.join(base,'failure.txt'),error.stack);throw error;}
