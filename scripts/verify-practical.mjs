import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {localPath,projectPath} from '../src/local-paths.mjs';
import {atomicJson} from '../src/files.mjs';
import {loadConfig} from '../src/config.mjs';
import {listSessions} from '../src/sessions.mjs';

const resume=process.argv.indexOf('--resume'),runRoot=resume>=0?path.resolve(process.argv[resume+1]):localPath('artifacts','practical-run-'+new Date().toISOString().replace(/[:.]/g,'-'));
if(!runRoot.startsWith(localPath('artifacts')+path.sep))throw Error('Resume must use a local artifacts run directory');
await fs.mkdir(runRoot,{recursive:true});
const reportFile=path.join(runRoot,'progress.json'),state=resume>=0?JSON.parse(await fs.readFile(reportFile,'utf8')):{startedAt:new Date().toISOString(),status:'running',steps:[],scope:'v2.0 implementation and current-machine automated acceptance; external users and fresh Windows are not simulated.'};state.status='running';delete state.error;
async function run(name,args,exe=process.execPath){
 if(state.steps.some(item=>item.name===name&&item.status==='passed')){console.log('RETAIN '+name);return;}
 const attempt=state.steps.filter(item=>item.name===name).length+1,item={name,attempt,status:'running',startedAt:new Date().toISOString(),log:path.join(runRoot,name+'-'+attempt+'.log')};state.steps.push(item);await atomicJson(reportFile,state);console.log('START '+name);const start=performance.now();
 const result=await new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:projectPath(''),windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;if(!name.startsWith('unit'))process.stdout.write(data);});child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});child.once('error',reject);child.once(name==='start-session'?'exit':'close',code=>{if(name==='start-session'){child.stdout.destroy();child.stderr.destroy();}resolve({code,stdout,stderr});});});
 await fs.writeFile(item.log,result.stdout+'\n'+result.stderr);item.elapsedMs=Math.round(performance.now()-start);item.status=result.code===0?'passed':'failed';item.exitCode=result.code;item.completedAt=new Date().toISOString();await atomicJson(reportFile,state);if(result.code!==0)throw Error(name+' failed; see '+item.log);console.log('DONE '+name+' '+item.elapsedMs+'ms');return result;
}
const settings=await loadConfig(),sessionRoot=localPath('artifacts','session-qa'),hostFile=path.join(sessionRoot,'host.json');
await fs.mkdir(sessionRoot,{recursive:true});
// Freeze genuine saved UUID branches before any latest-report files are replaced.
const legacy=[];
for(const [file,editing] of [['editing-legacy-upgrade-report.json',false],['preview4-editing-upgrade-report.json',true]]){
 try{const prior=JSON.parse(await fs.readFile(localPath('artifacts',file),'utf8')),saved=prior.result;if(!saved?.drawing)continue;const wrapper=path.join(runRoot,editing?'legacy-editing.json':'legacy-electrical.json');await atomicJson(wrapper,{originCheckedAt:prior.checkedAt,originPluginSHA256:prior.pluginSHA256,results:{[editing?'moved':'applied']:saved}});legacy.push({wrapper,editing});}catch(error){if(error.code!=='ENOENT')throw error;}
}
try{
 await run('unit',['--test','--test-reporter=tap','tests/unit/*.test.mjs']);
 await run('static',['scripts/check-release.mjs','--static']);
 await run('workflows',['tests/workflows-integration.mjs']);
 await run('practical-v06',['tests/practical-v06-integration.mjs']);
 await run('v2-core',['tests/v2-integration.mjs']);
 await run('batch-export-performance',['tests/batch-export-performance.mjs']);
 await run('pdf-physical',['tests/plot-pdf-physical.py',localPath('artifacts','practical-v06-report.json'),localPath('artifacts','plot-pdf-physical-report.json')],process.env.CADBRIDGE_PYTHON||'python');
 if(!['sessions','query-scope'].every(name=>state.steps.some(item=>item.name===name&&item.status==='passed'))){
 // Start a fresh owned instance so tests never depend on the user's current CAD.
 try{await run('stop-prior-session',['-NoProfile','-File','tests/stop-session-host.ps1','-Report',hostFile],settings.powershell);}catch(error){if(await fs.access(hostFile).then(()=>true,()=>false))throw error;}
 const seed=JSON.parse(await fs.readFile(localPath('artifacts','workflows-report.json'),'utf8')).results.seed.drawing;
 await run('start-session',['-NoProfile','-File','tests/session-host.ps1','-Drawing',seed,'-SessionHome',sessionRoot,'-Report',hostFile,'-CadRoot',settings.cadRoot],settings.powershell);
 const host=JSON.parse((await fs.readFile(hostFile,'utf8')).replace(/^\uFEFF/,'')),deadline=Date.now()+120000;let ready=false;
 while(Date.now()<deadline){if((await listSessions(sessionRoot)).some(session=>session.pid===host.pid)){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}if(!ready)throw Error('Owned session did not become ready; inspect '+hostFile);
 await run('sessions',['tests/session-integration.mjs']);
 await run('query-scope',['tests/query-scope-integration.mjs']);
 await run('stop-session',['-NoProfile','-File','tests/stop-session-host.ps1','-Report',hostFile],settings.powershell);
 }else console.log('RETAIN completed session and scope acceptance; no live CAD instance is needed');
 for(const [name,args] of [
  ['cad',['tests/integration.mjs']],['editing',['tests/editing-integration.mjs']],['tangent',['tests/tangent-integration.mjs']],['editing-tangent',['tests/editing-integration.mjs','--tangent']],['native-trays',['tests/native-tangent.mjs']],['result-pages',['tests/mcp-results.mjs']],['scene',['tests/school-mcp.mjs']],['protocol-recovery',['tests/maintenance-mcp.mjs']]
 ])await run(name,args);
 for(const item of legacy)await run(item.editing?'legacy-editing':'legacy-electrical',['tests/legacy-upgrade.mjs',item.wrapper,...(item.editing?['--editing']:[])]);
 await run('client-setup',['bin/cadbridge.mjs','setup','--client','workbuddy','--skip-build']);
 await run('installed-client',['tests/workbuddy-installed.mjs',path.join(os.homedir(),'.workbuddy')]);
 await run('release-check',['scripts/check-release.mjs']);
 state.status='passed';state.completedAt=new Date().toISOString();await atomicJson(reportFile,state);await atomicJson(localPath('artifacts','practical-latest.json'),{reportFile,...state});console.log(JSON.stringify({ok:true,reportFile,steps:state.steps.length}));
}catch(error){state.status='failed';state.error=error.stack;state.completedAt=new Date().toISOString();await atomicJson(reportFile,state);try{await run('cleanup-session',['-NoProfile','-File','tests/stop-session-host.ps1','-Report',hostFile],settings.powershell);}catch{}throw error;}
