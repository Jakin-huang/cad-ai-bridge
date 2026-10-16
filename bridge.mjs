import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {schemas} from './src/contracts.mjs';
import {loadConfig} from './src/config.mjs';
import {snapshotDrawing,hashFile} from './src/drawings.mjs';
import {summarize,readResultPage} from './src/results.mjs';
export const root=path.dirname(fileURLToPath(import.meta.url));
const settings=await loadConfig();
const allowedRoot=await fs.realpath(settings.workspace);
export {schemas} from './src/contracts.mjs';
export {hashFile} from './src/drawings.mjs';
let queue=Promise.resolve();
let bootstrapDrawing;
export function execute(action,args={}){
 const work=queue.then(()=>run(action,args));queue=work.catch(()=>{});return work;
}
async function run(action,args){
 if(!schemas[action])throw new Error('Unsupported action');
 const parsed=schemas[action].parse(args);
 if(action==='read_result')return readResultPage(path.join(root,'runs'),parsed);
 await fs.mkdir(path.join(root,'runs'),{recursive:true});
 const job=await fs.mkdtemp(path.join(root,'runs','job-'));
 let inputSha256;
 if(parsed.drawing){
   inputSha256=await snapshotDrawing(parsed.drawing,[allowedRoot,path.join(root,'runs')],job,parsed.expectedSha256);
 }
 const {drawing,expectedSha256,host:requestedHost,detail,...payload}=parsed;
 const request={...payload,action};
 if(action==='create_test_drawing'){request.requestId=crypto.randomUUID();request.units='mm';}
 const encoded=JSON.stringify(request);if(Buffer.byteLength(encoded)>1024*1024)throw new Error('Request exceeds 1 MiB');
 await fs.writeFile(path.join(job,'request.json'),encoded);
 const backend=action==='native_status'?'tangent':requestedHost||'core';
 if(backend==='tangent'&&(!settings.tangentRoot||!settings.tangentProfile))throw new Error('TANGENT_NOT_CONFIGURED: run cadbridge setup and select Tangent V8.');
 if(backend==='tangent'){
  if(!bootstrapDrawing){const seed=await run('create_test_drawing',{});if(!seed.ok)throw Error('BOOTSTRAP_FAILED');bootstrapDrawing=seed.drawing;}
  await fs.copyFile(bootstrapDrawing,path.join(job,'bootstrap.dwg'),fs.constants.COPYFILE_EXCL);
 }
 const powershell=settings.powershell;
 const argsForHost=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,backend==='tangent'?'run-gui.ps1':'run-core.ps1'),'-JobRoot',job,'-CadRoot',settings.cadRoot,'-ProductKey',settings.productKey];
 if(backend==='tangent')argsForHost.push('-TangentRoot',settings.tangentRoot,'-Profile',settings.tangentProfile);
 else argsForHost.push('-Language',settings.language);
 const started=performance.now();
 const host=await new Promise((resolve,reject)=>{
   const child=spawn(powershell,argsForHost,{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';
   child.stdout.on('data',b=>{stdout=(stdout+b).slice(-32768);});
   child.stderr.on('data',b=>{stderr=(stderr+b).slice(-32768);});
   child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
 await fs.writeFile(path.join(job,'launcher.json'),JSON.stringify(host,null,2));
 if(host.code!==0)throw new Error(`HOST_FAILED: ${job}\n${host.stderr}`);
 const response=JSON.parse((await fs.readFile(path.join(job,'response.json'),'utf8')).replace(/^\uFEFF/,''));
 const result={...response,backend,jobRoot:job,elapsedMs:Math.round(performance.now()-started),inputSha256};
 if(action==='audit_drawing'&&response.ok&&response.auditDxfExported)result.dxf=path.join(job,'output.dxf');
 if(backend==='tangent')result.nativeHost=JSON.parse(await fs.readFile(path.join(job,'host.json'),'utf8'));
 if((response.ok||response.drawingSaved)&&['create_test_drawing','prepare_project','repair_copy','apply'].includes(action)){
   result.drawing=path.join(job,'output.dwg');result.drawingSha256=await hashFile(result.drawing);
   try{await fs.access(path.join(job,'output.dxf'));result.dxf=path.join(job,'output.dxf');}catch{}
 }
 if(action==='takeoff'&&result.snapshot){
   const s=result.snapshot;const groups={};
   for(const d of s.devices){const key=`${d.blockName}|${d.attributes.MODEL||''}`;groups[key]=(groups[key]||0)+1;}
   result.takeoff={deviceCount:s.deviceCount,routeCount:s.routeCount,routeLengthMm:s.routeLengthMm,groups,coverage:s.coverage};
 }
 await fs.writeFile(path.join(job,'result.json'),JSON.stringify(result,null,2));
 if(action==='audit_drawing'&&result.audit&&detail!=='full'){
  const {inserts,definitions,texts,...rest}=result.audit;
  return {...result,audit:{...rest,insertCount:inserts.length,definitionCount:definitions.length,textCount:texts.length},details:{jobId:path.basename(job),tool:'cad_read_result',kinds:['inserts','definitions','texts']}};
 }
 return ['tangent_inspect','tangent_takeoff'].includes(action)&&detail!=='full'?summarize(result):result;
}
