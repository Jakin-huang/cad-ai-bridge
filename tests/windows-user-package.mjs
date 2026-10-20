import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
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
const base=await fs.mkdtemp(projectPath('artifacts','普通用户 发行验收-'));
const checks=[],results={},startedAt=new Date().toISOString();
const isolatedRuntimes=path.join(os.tmpdir(),'cbrt-'+crypto.randomUUID().slice(0,8));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function run(executable,args,env=process.env){
 const result=spawnSync(executable,args,{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:path.basename(executable).toLowerCase()==='cmd.exe',env,maxBuffer:10*1024*1024,timeout:240000});
 if(result.status!==0)throw Error(path.basename(executable)+' failed: '+result.stdout+'\n'+result.stderr+'\n'+(result.error||''));
 return result.stdout;
}
const powershell=process.env.CADAGENT_POWERSHELL||'pwsh.exe';
const permissions=parseLocalJSON(run(powershell,['-NoProfile','-NonInteractive','-Command',"[ordered]@{elevated=([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator));machinePath=[Environment]::GetEnvironmentVariable('PATH','Machine');userPath=[Environment]::GetEnvironmentVariable('PATH','User')}|ConvertTo-Json -Compress"]));
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
async function serverAt(){return parseLocalJSON(await fs.readFile(path.join(home,'mcp.json'),'utf8')).mcpServers['cad-ai-bridge'];}
async function skillTree(folder){const files={};async function walk(dir,relative=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){assert.equal(e.isSymbolicLink(),false);const name=relative?relative+'/'+e.name:e.name;if(e.isDirectory())await walk(path.join(dir,e.name),name);else files[name]=hash(await fs.readFile(path.join(dir,e.name)));}}await walk(folder);return files;}
async function smoke(server,write=false,expectedTools=24){
 const client=new Client({name:'windows-user-package-acceptance',version:'0.2.0'});
 try{
  await client.connect(new StdioClientTransport({command:server.command,args:server.args,env:{...process.env,...server.env},stderr:'pipe'}));
  const discovered=(await client.listTools()).tools.length;
  if(expectedTools===null)assert.ok([15,18,21,22,24].includes(discovered));else assert.equal(discovered,expectedTools);
  async function call(name,args={}){const reply=await client.callTool({name,arguments:args},{timeout:180000});const result=parseLocalJSON(reply.content[0].text);assert.equal(result.ok,true,JSON.stringify(result.error));return result;}
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
  const capabilities=await call('cad_capabilities');assert.ok(capabilities.workflows.includes('takeoff'));
  const generic=await call('cad_workflow',{drawing:applied.drawing,requestId:crypto.randomUUID(),filter:{types:['INSERT']},plan:{type:'takeoff',groupBy:['type','blockName']},preview:false});assert.equal(generic.statistics.entityCount,2);assert.equal(generic.files.length,2);for(const file of generic.files)assert.equal(hash(await fs.readFile(file.file)),file.sha256);
  const scan=await call('cad_scan_drawing',{drawing:applied.drawing});assert.equal(scan.query.retainedEntityCount,3);const indexed=await call('cad_read_result',{jobId:path.basename(scan.jobRoot),kind:'entities',filter:{types:['INSERT']},fields:['type','blockName'],limit:100});assert.equal(indexed.total,2);assert.equal(indexed.items.length,2);
  const native=await call('cad_native_status',{drawing:applied.drawing});assert.equal(native.nativeHost.nativeKernelLoaded,true);
  const cleanup=parseLocalJSON(await fs.readFile(path.join(native.jobRoot,'cleanup.json'),'utf8'));assert.equal(cleanup.ok,true);assert.equal(cleanup.originalTipRestored,true);
  const query=await call('cad_query_entities',{drawing:applied.drawing,filter:{ids:['L1']}});assert.equal(query.query.entities.length,1);
  const edited=await call('cad_edit',{drawing:applied.drawing,expectedSha256:applied.drawingSha256,documentId:applied.snapshot.documentId,expectedRevision:applied.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'move_devices',ids:['L1','L2'],delta:[0,500,0]}]});assert.equal(edited.snapshot.routeLengthMm,3000);assert.deepEqual(edited.snapshot.issues,[]);
  const preview=await call('cad_export',{drawing:edited.drawing,format:'png'});assert.ok(preview.exported.bytes>1000);
  const engineeringPdf=await call('cad_export',{drawing:edited.drawing,format:'pdf',plot:{paper:'A3',orientation:'landscape',scale:'fixed',denominator:100,style:'monochrome.ctb'},region:{min:[-500,-1000,0],max:[4000,2000,0]}});assert.equal(engineeringPdf.exported.verification.requestedPaperVerified,true);
  const nativeRequest=(drawing,operations)=>({drawing:drawing.drawing,expectedSha256:drawing.drawingSha256,documentId:drawing.snapshot.documentId,expectedRevision:drawing.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations});
  const nativeCreated=await call('cad_edit',nativeRequest(fixture,[
   {type:'create_native_tray',fromPoint:[3000,0,0],toPoint:[0,0,0],width:400,height:150},
   {type:'create_native_tray',fromPoint:[0,5000,0],toPoint:[0,8000,0],width:400,height:150},
   {type:'create_native_tray',fromPoint:[10000,0,0],toPoint:[13000,3000,0],width:400,height:150}
  ]));
  const tray=nativeCreated.query.entities.filter(e=>e.type==='TCH_CABLETRY').at(-1);assert.equal(tray.native.model,'C-01-15-4');assert.equal(nativeCreated.nativeHost.completedByProtocol,true);
  const nativeLabeled=await call('cad_edit',nativeRequest(nativeCreated,[{type:'add_native_tray_label',handle:tray.handle,position:[11000,2200,0],landingPoint:[12000,2200,0]}]));
  const nativeQuery=await call('cad_query_entities',{drawing:nativeLabeled.drawing,host:'tangent',filter:{types:['TCH_CABLETRY','TCH_CABLEDIM']}});
  assert.equal(nativeQuery.query.entities.length,4);assert.ok(nativeQuery.query.entities.find(e=>e.type==='TCH_CABLEDIM').native.targetHandles.includes(tray.handle));
  const lengths=nativeQuery.query.entities.filter(e=>e.type==='TCH_CABLETRY').map(e=>e.length).sort((a,b)=>a-b);assert.ok(Math.abs(lengths[0]-3000)<1e-5&&Math.abs(lengths[1]-3000)<1e-5&&Math.abs(lengths[2]-Math.hypot(3000,3000))<1e-5);
  const nativePreview=await call('cad_export',{drawing:nativeLabeled.drawing,host:'tangent',format:'png'});assert.ok(nativePreview.exported.bytes>1000);
  assert.equal(hash(await fs.readFile(applied.drawing)),applied.drawingSha256);assert.equal(hash(await fs.readFile(fixture.drawing)),fixture.drawingSha256);
  return{doctor,fixture,applied,takeoff,validation,capabilities,generic,scan,indexed,engineeringPdf,native,query,edited,preview,nativeTrays:{created:nativeCreated,labeled:nativeLabeled,query:nativeQuery,preview:nativePreview}};
 }finally{await client.close();}
}
const home=path.join(base,'隔离 WorkBuddy'),workspace=path.join(base,'用户图纸');
try{
 const oldFolder=await extract(oldZip,'旧版本'),newFolder=await extract(newZip,'新版本');
 const manifest=parseLocalJSON(await fs.readFile(path.join(newFolder,'release-manifest.json'),'utf8'));
 assert.equal(manifest.offlineSetup,true);
 for(const file of manifest.files)assert.equal(hash(await fs.readFile(path.join(newFolder,file.file))),file.sha256,file.file);
 checks.push('Freshly extracted user ZIP manifest verifies every source, dependency, plugin and runtime archive');
 await fs.mkdir(home);await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify({otherSetting:true,mcpServers:{unrelated:{command:'keep'}}}));await fs.writeFile(path.join(home,'.mcp.json'),'client-owned proxy');
 await fs.writeFile(path.join(base,'old-install.txt'),connect(oldFolder,['--workspace',workspace]));
 const oldServer=await serverAt(),oldSkill=await fs.readFile(path.join(home,'skills/cadbridge-electrical/SKILL.md'));
 const skillFolder=path.join(home,'skills/cadbridge-electrical'),oldSkillFolder=path.join(base,'previous-complete-skill');
 const oldSkillTree=await skillTree(skillFolder);await fs.cp(skillFolder,oldSkillFolder,{recursive:true});
 checks.push('Previous release installs into isolated client without changing its other service or proxy');
 const env={...process.env,PATH:[path.join(process.env.WINDIR,'System32'),process.env.WINDIR,path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0')].join(';'),CADBRIDGE_RUNTIME_ISOLATED:'1',CADBRIDGE_OFFLINE:'1'};
 for(const key of ['CADBRIDGE_CONFIG','CADBRIDGE_RUNTIME_CACHE','CADAGENT_POWERSHELL','CADAGENT_ALLOWED_ROOT','CADAGENT_CAD_ROOT'])delete env[key];
 env.CADBRIDGE_RUNTIME_HOME=isolatedRuntimes;
 await fs.writeFile(path.join(base,'new-install.txt'),connect(newFolder,[],env));
 const newServer=await serverAt();assert.ok(newServer.command.startsWith(isolatedRuntimes+path.sep));assert.ok(newServer.env.CADAGENT_POWERSHELL.startsWith(isolatedRuntimes+path.sep));
 assert.deepEqual(await skillTree(skillFolder),await skillTree(path.join(newFolder,'skills/cadbridge-electrical')));
 const config=parseLocalJSON(await fs.readFile(newServer.env.CADBRIDGE_CONFIG,'utf8'));assert.equal(config.workspace,workspace);assert.equal(await fs.readFile(path.join(home,'.mcp.json'),'utf8'),'client-owned proxy');
 checks.push('Offline upgrade with Node, PowerShell 7 and winget excluded extracts bundled runtimes without UAC');
 checks.push('Side-by-side upgrade inherits prior drawing workspace and preserves unrelated client settings');
 const cli=run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'cadbridge.cmd')+'" help"'],env);assert.match(cli,/CAD AI Bridge/);checks.push('Packaged CLI works with Node and PowerShell 7 absent from PATH');
 results.upgraded=await smoke(newServer,true);checks.push('Packaged runtimes discover 24 tools, pass doctor, save two lights and reopen their route/numbering with no issues');checks.push('Packaged PowerShell loads native Tangent host and restores its user settings after exit');
 checks.push('Packaged indexed scan/paging, connected-device edit and actual PNG/A3 fixed-scale CTB PDF exports pass');
 checks.push('Packaged capability discovery and generic takeoff produce two verified CSV files from actual saved CAD entities');
 checks.push('Bundled Node resolves the installed native catalog; real native tray and associated label persist after reopen and actual PNG plotting');
 const savedHash=hash(await fs.readFile(results.upgraded.applied.drawing));
 // Repeat setup offline, then restore the original version from its transaction journal.
 await fs.writeFile(path.join(base,'repeat-install.txt'),connect(newFolder,[],env));assert.deepEqual(await serverAt(),newServer);checks.push('Repeat offline setup succeeds with exactly the same connector parameters');
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'restore-workbuddy.cmd')+'" --client-home "'+home+'""'],env);
 assert.deepEqual(await serverAt(),newServer); // immediate previous install is the same version
 // Reinstall the old configuration to model the original state, then test an actual upgrade rollback.
 await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify({otherSetting:true,mcpServers:{unrelated:{command:'keep'},'cad-ai-bridge':oldServer}}));
 const heldSkill=path.join(base,'new-skill-before-recovery');
 assert.ok(path.resolve(skillFolder).startsWith(path.resolve(base)+path.sep)&&path.resolve(heldSkill).startsWith(path.resolve(base)+path.sep));
 await fs.rename(skillFolder,heldSkill);await fs.cp(oldSkillFolder,skillFolder,{recursive:true});
 await fs.writeFile(path.join(base,'upgrade-for-rollback.txt'),connect(newFolder,[],env));
 const current=parseLocalJSON(await fs.readFile(path.join(home,'mcp.json'),'utf8'));current.mcpServers.addedLater={command:'also keep'};await fs.writeFile(path.join(home,'mcp.json'),JSON.stringify(current));
 run(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(newFolder,'restore-workbuddy.cmd')+'" --client-home "'+home+'""'],env);
 assert.deepEqual(await serverAt(),oldServer);assert.deepEqual(await fs.readFile(path.join(home,'skills/cadbridge-electrical/SKILL.md')),oldSkill);
 assert.deepEqual(await skillTree(skillFolder),oldSkillTree);
 const restored=parseLocalJSON(await fs.readFile(path.join(home,'mcp.json'),'utf8'));assert.equal(restored.mcpServers.addedLater.command,'also keep');assert.equal(restored.mcpServers.unrelated.command,'keep');
 results.restored=await smoke(oldServer,false,null);assert.equal(hash(await fs.readFile(results.upgraded.applied.drawing)),savedHash);
 checks.push('Recovery command restores previous runnable release and Skill while retaining later services and new DWG');
 const permissionsAfter=parseLocalJSON(run(powershell,['-NoProfile','-NonInteractive','-Command',"[ordered]@{machinePath=[Environment]::GetEnvironmentVariable('PATH','Machine');userPath=[Environment]::GetEnvironmentVariable('PATH','User')}|ConvertTo-Json -Compress"]));
 assert.equal(permissionsAfter.machinePath,permissions.machinePath);assert.equal(permissionsAfter.userPath,permissions.userPath);checks.push('Machine and user PATH remain unchanged');
 const report={ok:true,startedAt,checkedAt:new Date().toISOString(),scope:'Existing Windows 10 x64, non-elevated process, isolated client and extracted package, minimal PATH and offline bootstrap; not a clean Windows or separate standard-account test',cleanWindowsVerified:false,separateStandardAccountVerified:false,elevated:false,package:path.resolve(newZip),packageSha256:hash(await fs.readFile(newZip)),manifestFiles:manifest.files.length,verifiedManifest:manifest.files,checks,base,isolatedRuntimes,results};
 await fs.writeFile(projectPath('artifacts/windows-user-package-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks,base}));
}catch(error){await fs.writeFile(path.join(base,'failure.txt'),error.stack);throw error;}
