import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {StringDecoder} from 'node:string_decoder';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {projectRoot} from './config.mjs';
import {atomicJson} from './files.mjs';
import {isWithin,hashFile} from './drawings.mjs';
import {failure} from './errors.mjs';
export function sessionHome(){return process.env.CADBRIDGE_SESSION_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'CADBridge','sessions');}
export async function listSessions(root=sessionHome()){
 let names;try{names=await fs.readdir(root);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const sessions=[];for(const name of names){if(!/^[a-f0-9-]{36}\.json$/i.test(name))continue;try{const file=await fs.realpath(path.join(root,name));if(!isWithin(await fs.realpath(root),file))continue;const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.schemaVersion!==1||!Number.isSafeInteger(value.pid)||!/^cadbridge-\d+-[a-f0-9]{32}$/.test(value.pipe)||value.sessionId+'.json'!==name||!/^\w{64}$/.test(value.token))continue;process.kill(value.pid,0);sessions.push(value);}catch{}}
 return sessions;
}
export function dispatchSessionCommand(descriptor,input){
 return new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./session-dispatch.ps1',import.meta.url)),'-ExpectedPid',String(descriptor.pid),'-RequestId',input.requestId],{windowsHide:true,timeout:20000,maxBuffer:65536},(error,stdout,stderr)=>error?reject(Error('SESSION_DISPATCH_FAILED: '+stderr)):resolve(stdout)));
}
export function sessionRequest(descriptor,input,{timeout=60000,dispatch=dispatchSessionCommand}={}){
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection('\\\\.\\pipe\\'+descriptor.pipe),decoder=new StringDecoder('utf8');let text='',settled=false,dispatched=false;
  const done=(error,value)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(value);};
  socket.setTimeout(timeout,()=>done(Error('SESSION_STATE_UNKNOWN: response timeout; inspect the existing request journal before writing again')));
  socket.once('error',error=>done(error));socket.once('end',()=>{if(!settled)done(Error('SESSION_STATE_UNKNOWN: pipe disconnected before a final response'));});
  socket.once('connect',()=>socket.write(JSON.stringify({...input,sessionId:descriptor.sessionId,token:descriptor.token,expiresAt:new Date(Date.now()+45000).toISOString()})+'\n'));
  socket.on('data',bytes=>{text+=decoder.write(bytes);if(Buffer.byteLength(text)>16*1024*1024)return done(Error('SESSION_REPLY_TOO_LARGE: narrow the query'));let end;while((end=text.indexOf('\n'))>=0){let message;try{message=JSON.parse(text.slice(0,end));}catch(error){return done(error);}text=text.slice(end+1);if(message.eventType==='dispatch'){if(dispatched||input.action!=='edit'||message.pid!==descriptor.pid||message.requestId!==input.requestId||message.command!=='CADBRIDGESESSIONEXEC')return done(Error('SESSION_DISPATCH_INVALID: unexpected command acknowledgement'));dispatched=true;dispatch(descriptor,input).catch(error=>done(error));}else return done(null,message);}});
 });
}
export async function executeSession(args,{getSettings,root=sessionHome(),request=sessionRequest,plugin=path.join(projectRoot,'plugin','bin','CadAgent.dll')}={}){
 if(args.action==='status')args={action:'list'};
 let observed;
 try{
  if(args.action==='cancel'){
   const resultFile=path.join(root,'jobs',args.sessionId,args.requestId,'result.json');try{const result=JSON.parse(await fs.readFile(resultFile,'utf8'));return {ok:true,cancelled:false,alreadyCompleted:true,outcome:result.outcome,drawingSaved:result.drawingSaved,next:'Read the existing result with recover; a completed edit is not undone by cancellation.'};}catch(error){if(error.code!=='ENOENT')throw error;}
   await atomicJson(path.join(root,'cancel',args.sessionId,args.requestId+'.json'),{requestedAt:new Date().toISOString()});return {ok:true,cancellationRequested:true,cancellationConfirmed:false,next:'Recover the original request. Queued edits and pre-commit transactions can cancel; an already committed edit remains saved.'};
  }
  if(args.action==='connect'){
   if(process.env.CADBRIDGE_READ_ONLY==='1')throw Error('READ_ONLY: attaching a plugin is disabled; use an already connected session');
   await getSettings();
   const connected=(await listSessions(root)).filter(s=>!args.pid||s.pid===args.pid);
   if(connected.length===1){const session=connected[0];if(await hashFile(session.pluginPath)!==await hashFile(plugin))throw Error('SESSION_PLUGIN_MISMATCH: restart this AutoCAD instance to load the current bridge plugin');const probe=await request(session,{action:'context'});if(!probe.ok)return probe;const{token,pipe,...info}=session;return {ok:true,session:info,reusedConnection:true,next:'Read current context before selecting objects or editing.'};}
   const attached=await new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./session-connect.ps1',import.meta.url)),'-Plugin',plugin,...(args.pid?['-ExpectedPid',String(args.pid)]:[])],{windowsHide:true,timeout:30000,maxBuffer:65536},(error,stdout,stderr)=>{if(error)return reject(Error('SESSION_ATTACH_FAILED: '+stderr));try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch(error){reject(error);}}));
   const deadline=Date.now()+20000;while(Date.now()<deadline){const session=(await listSessions(root)).find(item=>item.pid===attached.pid);if(session){if(await hashFile(session.pluginPath)!==await hashFile(plugin))throw Error('SESSION_PLUGIN_MISMATCH: restart this AutoCAD instance to load the current bridge plugin');const{token,pipe,...info}=session;return {ok:true,session:info,next:'Read current context before selecting objects or editing.'};}await new Promise(resolve=>setTimeout(resolve,250));}throw Error('SESSION_ATTACH_FAILED: plugin did not publish a session descriptor; inspect CAD startup or an older loaded plugin');
  }
  if(args.action==='recover'){
   const owned=await fs.realpath(path.join(root,'jobs')),job=await fs.realpath(path.join(owned,args.sessionId,args.requestId));if(!isWithin(owned,job))throw Error('SESSION_OUTPUT_INVALID: journal escapes session outputs');
   try{const file=await fs.realpath(path.join(job,'result.json'));if(!isWithin(job,file))throw Error('SESSION_OUTPUT_INVALID: result escapes request journal');let result=JSON.parse(await fs.readFile(file,'utf8'));try{const bridgeFile=await fs.realpath(path.join(job,'bridge-result.json'));if(!isWithin(job,bridgeFile))throw Error('SESSION_OUTPUT_INVALID: bridge journal escapes request');const stored=JSON.parse(await fs.readFile(bridgeFile,'utf8'));if(stored.nativeRecordSha256!==await hashFile(file))throw Error('SESSION_RECORD_CHANGED: native result changed after bridge receipt');result=stored;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(result.drawingSaved&&result.drawing){const output=await fs.realpath(result.drawing);if(!isWithin(job,output))throw Error('SESSION_OUTPUT_INVALID: drawing escapes request');const hash=await hashFile(output);if(result.drawingSha256&&result.drawingSha256!==hash)throw Error('SESSION_OUTPUT_CHANGED: saved drawing was modified after completion');result={...result,drawingSha256:hash,integrityBasis:result.drawingSha256?'verified-against-recorded-output':'recovered-current-bytes'};}return {...result,recovered:true,historicalResult:true,safeToRetry:false};}
   catch(error){if(error.code!=='ENOENT')throw error;return {ok:false,outcome:'unconfirmed',error:{code:'SESSION_STATE_UNKNOWN',message:'No final result exists. Do not repeat the write until the document and retained outputs have been inspected.'},safeToRetry:false};}
  }
  const sessions=await listSessions(root);
  if(args.action==='list')return {ok:true,sessions:sessions.map(({token,pipe,...publicInfo})=>publicInfo),next:'Load the verified AutoCAD plugin and start CADBRIDGESESSIONSTART in an interactive AutoCAD 2022 instance. Existing file workflows do not need a running CAD session.'};
  const target=sessions.find(item=>item.sessionId===args.sessionId);if(!target)throw Error('SESSION_NOT_FOUND: selected AutoCAD session is unavailable');
  const context=await request(target,{action:'context'});if(!context.ok)return context;
  if(args.action==='context')return context;
  if(context.context.documentId!==args.documentId)throw Error('SESSION_DOCUMENT_MISMATCH: active document changed');
  const settings=await getSettings(),drawing=context.context.name;
  if(path.isAbsolute(drawing)){
   const file=await fs.realpath(drawing),roots=await Promise.all([settings.workspace,settings.runs,await fs.realpath(path.join(root,'jobs')).catch(()=>undefined)].filter(Boolean).map(dir=>fs.realpath(dir)));
   if(!roots.some(dir=>isWithin(dir,file)))throw Error('SESSION_OUTSIDE_WORKSPACE: active drawing is outside the selected workspace and owned task outputs');
  }else if(!args.allowUnsaved)throw Error('SESSION_UNSAVED_SCOPE_REQUIRED: explicitly select allowUnsaved for a document without a saved workspace path');
  if(process.env.CADBRIDGE_READ_ONLY==='1'&&args.action==='edit')throw Error('READ_ONLY: session editing is disabled');
  const result=observed=await request(target,args);
  // An unexpected outer native failure can include journal I/O after a commit.
  // Only the durable outcome establishes whether a transaction was applied.
  if(!result.ok&&result.error?.code==='SESSION_ERROR'&&!result.outcome){result.mutationCommitted=undefined;result.outcome='unconfirmed';}
  if(result.drawingSaved&&result.drawing){const owned=await fs.realpath(path.join(root,'jobs',target.sessionId,args.requestId)),output=await fs.realpath(result.drawing);if(!isWithin(owned,output))throw Error('SESSION_OUTPUT_INVALID: output is outside the request journal');result.drawingSha256=await hashFile(output);const nativeRecordSha256=await hashFile(path.join(owned,'result.json')),bridgeFile=path.join(owned,'bridge-result.json');try{const record=JSON.parse(await fs.readFile(bridgeFile,'utf8'));if(record.drawingSha256!==result.drawingSha256)throw Error('SESSION_OUTPUT_CHANGED: saved drawing was modified after completion');if(record.nativeRecordSha256!==nativeRecordSha256)throw Error('SESSION_RECORD_CHANGED: native result changed after bridge receipt');}catch(error){if(error.code!=='ENOENT')throw error;await atomicJson(bridgeFile,{...result,nativeRecordSha256});}}
  return result;
 }catch(error){return {...failure(error),...(observed?{mutationCommitted:observed.mutationCommitted,drawingSaved:observed.drawingSaved,drawing:observed.drawing,drawingSha256:observed.drawingSha256,outcome:observed.outcome}:{}),safeToRetry:false};}
}
