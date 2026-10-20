import fs from 'node:fs/promises';
import {boundForTransport} from './results.mjs';
import {failure} from './errors.mjs';
export async function toolResponse(action,args,raw,{readFile=fs.readFile}={}){
 const original=raw;
 try{
  if(action==='workflow'&&args.response==='summary'){
   const {query,snapshot,children,groups,summary,...rest}=raw;
   raw={...rest,summary:summary?{changed:summary.changed,created:summary.created,removed:summary.removed,skippedCount:summary.skipped?.length}:undefined,snapshot:snapshot?{documentId:snapshot.documentId,revision:snapshot.revision,units:snapshot.units}:undefined,details:{jobId:raw.jobRoot?.split(/[\\/]/).at(-1),tool:'cad_read_result',kinds:query?['entities']:[]}};
  }
  const result=boundForTransport(raw),content=[{type:'text',text:JSON.stringify(result)}];
  if(action==='export'&&args.format==='png'&&result.ok&&result.exported.bytes<=4*1024*1024)content.push({type:'image',mimeType:'image/png',data:(await readFile(result.exported.file)).toString('base64')});
  if(action==='workflow')for(const file of(result.files||[]).filter(f=>['before-png','after-png','png'].includes(f.kind)&&f.bytes<=4*1024*1024).slice(-2))content.push({type:'image',mimeType:'image/png',data:(await readFile(file.file)).toString('base64')});
  return {content,isError:!result.ok};
 }catch(error){
  const result={...failure(error,{stage:'presentation',jobRoot:original.jobRoot,hostStarted:true,mutationCommitted:original.mutationCommitted,drawingSaved:original.drawingSaved}),outcome:original.outcome,drawing:original.drawing,drawingSha256:original.drawingSha256,files:original.files,details:{jobId:original.jobRoot?.split(/[\\/]/).at(-1),tool:'cad_get_job'},safeToRetry:false};
  return{content:[{type:'text',text:JSON.stringify(result)}],isError:true};
 }
}
