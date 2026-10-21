import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {z} from 'zod';
import {hashFile,isWithin} from './drawings.mjs';
import {dataHome} from './local-paths.mjs';
const digest=z.string().regex(/^[a-f0-9]{64}$/i);
export const radianceRuntimeSchema=z.strictObject({schemaVersion:z.literal(1),root:z.string().min(1).max(2000),version:z.string().min(1).max(200),tools:z.array(z.strictObject({file:z.enum(['ies2rad.exe','xform.exe','oconv.exe','rtrace.exe']),sha256:digest})).length(4),supportFiles:z.array(z.strictObject({file:z.string().regex(/^[A-Za-z0-9_+./-]+$/),sha256:digest})).min(1).max(1000)}).superRefine((p,c)=>{if(new Set(p.tools.map(t=>t.file)).size!==4||new Set(p.supportFiles.map(t=>t.file)).size!==p.supportFiles.length)c.addIssue({code:'custom',message:'Duplicate runtime file'});for(const f of p.supportFiles)if(f.file.split('/').some(v=>v==='..'||v===''||v==='.')||!f.file.startsWith('lib/'))c.addIssue({code:'custom',message:'Invalid runtime support path'});});
export async function readRadianceRuntime({file=process.env.CADBRIDGE_RADIANCE_RUNTIME||path.join(dataHome(),'radiance-runtime.json')}={}){
 let stat;try{stat=await fs.stat(file);}catch(error){if(error.code==='ENOENT')throw Error('RADIANCE_RUNTIME_NOT_CONFIGURED: register a trusted local runtime with scripts/register-radiance-runtime.mjs');throw error;}if(stat.size>1024*1024)throw Error('RADIANCE_PROFILE_TOO_LARGE');
 const bytes=await fs.readFile(file),profile=radianceRuntimeSchema.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))),root=await fs.realpath(profile.root);
 for(const record of [...profile.tools.map(t=>({...t,file:'bin/'+t.file})),...profile.supportFiles]){const target=await fs.realpath(path.join(root,record.file));if(!isWithin(root,target)||await hashFile(target)!==record.sha256.toLowerCase())throw Error('RADIANCE_RUNTIME_CHANGED: '+record.file);}
 return {...profile,root,profileFile:file,profileSHA256:await hashFile(file)};
}
// Fixed executable allowlist, no shell, local-only generated inputs. A timeout
// kills this child and is a failed assessment, never a reason to retry CAD creation.
export async function runRadiance(runtime,tool,args,{cwd,input,timeoutMs=120000,signal,spawnProcess=spawn}={}){
 if(!runtime.tools.some(t=>t.file===tool+'.exe'))throw Error('RADIANCE_TOOL_NOT_ALLOWED');
 if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:Error('LIGHTING_ASSESSMENT_CANCELLED');
 return new Promise((resolve,reject)=>{const command=path.join(runtime.root,'bin',tool+'.exe'),child=spawnProcess(command,args.map(String),{cwd,shell:false,windowsHide:true,env:{...process.env,RAYPATH:'.;'+path.join(runtime.root,'lib')}}),stdout=[],stderr=[];let size=0,errorSize=0,failure;
  const fail=e=>{if(failure)return;failure=e;clearTimeout(timer);child.kill();},timer=setTimeout(()=>fail(Error('RADIANCE_TIMEOUT: '+tool)),timeoutMs);
  child.on('error',fail);child.stdout.on('data',data=>{size+=data.length;if(size>64*1024*1024)fail(Error('RADIANCE_OUTPUT_LIMIT'));else stdout.push(data);});child.stderr.on('data',data=>{errorSize+=data.length;if(errorSize>1024*1024)fail(Error('RADIANCE_DIAGNOSTIC_LIMIT'));else stderr.push(data);});child.stdin.on('error',e=>{if(e.code!=='EPIPE')fail(e);});
  const abort=()=>fail(signal.reason instanceof Error?signal.reason:Error('LIGHTING_ASSESSMENT_CANCELLED'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure){reject(failure);return;}const diagnostics=Buffer.concat(stderr).toString('utf8');if(code!==0){reject(Error('RADIANCE_FAILED: '+tool+' '+code+' '+diagnostics.slice(0,2000)));return;}resolve({stdout:Buffer.concat(stdout),stderr:diagnostics,code});});child.stdin.end(input);
 });
}
