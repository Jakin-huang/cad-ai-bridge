import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {schemas} from './contracts.mjs';
import {loadConfig,projectRoot as root} from './config.mjs';
import {diagnose} from './diagnostics.mjs';
import {snapshotDrawing,hashFile} from './drawings.mjs';
import {summarize,readResultPage} from './results.mjs';
import {getJob} from './jobs.mjs';
import {failure} from './errors.mjs';
import {atomicJson} from './files.mjs';
import {verifyPlugin} from './setup.mjs';
const writes=new Set(['create_drawing','create_test_drawing','prepare_project','repair_copy','apply']);
export async function launchHost(exe,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout=(stdout+b).slice(-32768);});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-32768);});
  child.once('error',error=>{error.hostStarted=false;reject(error);});child.once('close',code=>resolve({code,stdout,stderr}));
 });
}
async function runtimeSettings(){const settings=await loadConfig();await verifyPlugin();return settings;}
export function createExecutor({getSettings=runtimeSettings,launch=launchHost,runs=path.join(root,'runs')}={}){
 let queue=Promise.resolve(),bootstrap;
 async function execute(action,args={}){
  let parsed;try{if(!schemas[action])throw Error('INVALID_ACTION: unsupported action');parsed=schemas[action].parse(args);}catch(error){return failure(error);}
  // Evidence reads remain responsive while a CAD job is in flight.
  try{
   if(action==='doctor')return await diagnose(parsed);
   if(action==='read_result')return await readResultPage(runs,parsed);
   if(action==='get_job')return await getJob(runs,parsed);
  }catch(error){return failure(error,{stage:'result'});}
  const enqueued=performance.now(),work=queue.then(()=>run(action,parsed,enqueued));queue=work.catch(()=>{});return work;
 }
 async function run(action,parsed,enqueued){
  const started=performance.now(),timings={queueMs:Math.round(started-enqueued)};
  let job,task,stage='configuration',hostStarted=false,response,settings,inputSha256,host,bootstrapLaunches=0;
  const mark=async phase=>{stage=phase;if(task){task.phase=phase;task.updatedAt=new Date().toISOString();await atomicJson(path.join(job,'task.json'),task);}};
  try{
   let t=performance.now();settings=await getSettings();const allowedRoot=await fs.realpath(settings.workspace);timings.configurationMs=Math.round(performance.now()-t);
   const backend=action==='native_status'?'tangent':parsed.host||'core';
   if(backend==='tangent'&&(!settings.tangentRoot||!settings.tangentProfile))throw Error('TANGENT_NOT_CONFIGURED: run cadbridge setup and select Tangent V8.');
   await fs.mkdir(runs,{recursive:true});job=await fs.mkdtemp(path.join(runs,'job-'));
   const {drawing,expectedSha256,host:requestedHost,detail,...payload}=parsed,request={...payload,action};
   if(['create_test_drawing','create_drawing'].includes(action)){request.requestId=crypto.randomUUID();request.units='mm';}
   task={jobId:path.basename(job),action,requestId:request.requestId,backend,ownerPid:process.pid,status:'preparing',startedAt:new Date().toISOString()};await mark('snapshot');
   t=performance.now();if(drawing)inputSha256=await snapshotDrawing(drawing,[allowedRoot,runs],job,expectedSha256);timings.snapshotMs=Math.round(performance.now()-t);
   const encoded=JSON.stringify(request);if(Buffer.byteLength(encoded)>1024*1024)throw Error('REQUEST_TOO_LARGE: request exceeds 1 MiB');
   await fs.writeFile(path.join(job,'request.json'),encoded);
   t=performance.now();
   if(backend==='tangent'){
    const key=JSON.stringify([settings.cadRoot,settings.language,settings.productKey,await hashFile(path.join(root,'plugin/bin/CadAgent.dll'))]);
    if(bootstrap?.key!==key||await hashFile(bootstrap.drawing).catch(()=>null)!==bootstrap.sha256){
     const seed=await run('create_test_drawing',{},performance.now());bootstrapLaunches=seed.metrics?.hostLaunches||0;if(!seed.ok)throw Error('BOOTSTRAP_FAILED: '+seed.error.message);bootstrap={key,drawing:seed.drawing,sha256:seed.drawingSha256};
    }
    await fs.copyFile(bootstrap.drawing,path.join(job,'bootstrap.dwg'),fs.constants.COPYFILE_EXCL);
   }
   timings.bootstrapMs=Math.round(performance.now()-t);
   const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,backend==='tangent'?'run-gui.ps1':'run-core.ps1'),'-JobRoot',job,'-CadRoot',settings.cadRoot,'-ProductKey',settings.productKey];
   if(backend==='tangent')args.push('-TangentRoot',settings.tangentRoot,'-Profile',settings.tangentProfile);else args.push('-Language',settings.language);
   task.status='running';await mark('launch');hostStarted=true;t=performance.now();
   host=await launch(settings.powershell,args);timings.hostMs=Math.round(performance.now()-t);await atomicJson(path.join(job,'launcher.json'),host);
   await mark('response');
   try{response=JSON.parse((await fs.readFile(path.join(job,'response.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){if(host.code===0)throw Error('HOST_NO_RESPONSE: '+error.message);}
   if(!response)throw Error((/TIMEOUT_STATE_UNKNOWN/.test(host.stderr)?'TIMEOUT_STATE_UNKNOWN':'HOST_FAILED')+': '+host.stderr);
   // Preserve plugin evidence even if host cleanup failed after saving.
   let result={...response,backend,jobRoot:job,elapsedMs:timings.hostMs,inputSha256};
   if(host.code!==0)result={...result,ok:false,error:result.error||{code:'HOST_CLEANUP_FAILED',message:host.stderr},hostError:{code:host.code,message:host.stderr}};
   if(backend==='tangent')try{result.nativeHost=JSON.parse((await fs.readFile(path.join(job,'host.json'),'utf8')).replace(/^\uFEFF/,''));}catch{}
   await mark('outputs');t=performance.now();
   if((response.ok||response.drawingSaved)&&writes.has(action)){
    const file=path.join(job,'output.dwg');
    try{result.drawingSha256=await hashFile(file);result.drawing=file;result.drawingSaved=true;}catch(error){result.ok=false;result.error={code:'SAVED_OUTPUT_UNAVAILABLE',message:error.message};}
   }
   if((action==='audit_drawing'&&response.auditDxfExported)||(result.drawing&&response.ok)){try{if((await fs.stat(path.join(job,'output.dxf'))).isFile())result.dxf=path.join(job,'output.dxf');}catch{}}
   timings.outputsMs=Math.round(performance.now()-t);
   if(action==='takeoff'&&result.snapshot){const s=result.snapshot,groups={};for(const d of s.devices){const key=`${d.blockName}|${d.attributes.MODEL||''}`;groups[key]=(groups[key]||0)+1;}result.takeoff={deviceCount:s.deviceCount,routeCount:s.routeCount,routeLengthMm:s.routeLengthMm,groups,coverage:s.coverage};}
   result.outcome=result.drawingSaved?'saved':response.mutationCommitted?'modified_not_saved':writes.has(action)?response.ok?'modified':'not_applied':'read_only';result.safeToRetry=false;
   if(result.error)result.error={...result.error,stage:response.failureStage||stage,next:'调用 cad_get_job 查看已有结果；写入失败或保存状态不明时不要自动重放。'};
   return await finish(result);
  }catch(error){return await finish(failure(error,{stage,jobRoot:job,hostStarted:error.hostStarted??hostStarted,mutationCommitted:response?.mutationCommitted,drawingSaved:response?.drawingSaved}));}
  async function finish(result){
   timings.totalMs=Math.round(performance.now()-started);result.metrics={...timings,discoveryCacheHit:settings?.discoveryCacheHit??false,hostLaunches:(hostStarted?1:0)+bootstrapLaunches,hostPhases:response?.timings};
   if(job){
    task.status=result.ok?'completed':'failed';task.outcome=result.outcome;task.updatedAt=new Date().toISOString();result.details??={jobId:path.basename(job),tool:'cad_get_job'};
    try{await atomicJson(path.join(job,'result.json'),result);await atomicJson(path.join(job,'task.json'),task);}catch(error){result.ok=false;result.evidenceError=error.message;}
   }
   if(action==='audit_drawing'&&result.audit&&parsed.detail!=='full'){
    const {inserts,definitions,texts,...rest}=result.audit;return{...result,audit:{...rest,insertCount:inserts.length,definitionCount:definitions.length,textCount:texts.length},details:{jobId:path.basename(job),tool:'cad_read_result',kinds:['inserts','definitions','texts']}};
   }
   return ['tangent_inspect','tangent_takeoff'].includes(action)&&parsed.detail!=='full'?summarize(result):result;
  }
 }
 return execute;
}
