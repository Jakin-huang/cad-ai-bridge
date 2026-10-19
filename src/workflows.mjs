import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson,csvCell} from './files.mjs';
import {hashFile} from './drawings.mjs';
import {failure} from './errors.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const requireResult=result=>{if(!result.ok){const error=Error((result.error?.code||'WORKFLOW_CHILD_FAILED')+': '+(result.error?.message||'CAD operation failed'));error.child=result;throw error;}return result;};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function drawingDifference(before,after){
 const previous=new Map(before.map(row=>[row.handle.toUpperCase(),row])),next=new Map(after.map(row=>[row.handle.toUpperCase(),row]));
 return {created:after.filter(row=>!previous.has(row.handle.toUpperCase())),removed:before.filter(row=>!next.has(row.handle.toUpperCase())),changed:after.filter(row=>previous.has(row.handle.toUpperCase())&&!same(previous.get(row.handle.toUpperCase()),row)).map(row=>({handle:row.handle,before:previous.get(row.handle.toUpperCase()),after:row}))};
}
export function aggregateEntities(entities,groupBy,attributeTags=[]){
 const groups=new Map();
 for(const row of entities){const values=groupBy.map(key=>row[key]??null).concat(attributeTags.map(tag=>Object.entries(row.attributes||{}).find(([key])=>key.toUpperCase()===tag.toUpperCase())?.[1]??null)),key=JSON.stringify(values);const current=groups.get(key)||{values,count:0,lengthDrawingUnits:0,lengthEntityCount:0};current.count++;if(Number.isFinite(row.length)){current.lengthDrawingUnits+=row.length;current.lengthEntityCount++;}groups.set(key,current);}
 return [...groups.values()].sort((a,b)=>JSON.stringify(a.values).localeCompare(JSON.stringify(b.values)));
}
export function replacementText(text,{search,replacement,match,caseSensitive}){
 if(typeof text!=='string')return undefined;
 if(match==='exact')return (caseSensitive?text===search:text.toLowerCase()===search.toLowerCase())?replacement:undefined;
 const escaped=search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,caseSensitive?'g':'gi');
 if(!pattern.test(text))return undefined;pattern.lastIndex=0;return text.replace(pattern,()=>replacement);
}
function reviewRegion(entities,requested){
 if(requested)return requested;const bounds=entities.map(e=>e.bounds).filter(Boolean);if(!bounds.length)return undefined;
 const min=[Math.min(...bounds.map(b=>b.min[0])),Math.min(...bounds.map(b=>b.min[1])),0],max=[Math.max(...bounds.map(b=>b.max[0])),Math.max(...bounds.map(b=>b.max[1])),0];
 const margin=Math.max(max[0]-min[0],max[1]-min[1],100)*.15;return {min:[min[0]-margin,min[1]-margin,0],max:[max[0]+margin,max[1]+margin,0],mode:'intersects'};
}
export async function runWorkflow(execute,runs,args){
 const fingerprint=digest(args),job=path.join(runs,'job-workflow-'+args.requestId),jobId=path.basename(job);
 await fs.mkdir(runs,{recursive:true});
 try{await fs.mkdir(job);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let request;try{request=JSON.parse(await fs.readFile(path.join(job,'request.json'),'utf8'));}catch{return {ok:false,jobRoot:job,error:{code:'WORKFLOW_IN_PROGRESS',message:'Workflow journal is being prepared. Read this job; do not submit a new write UUID.'},safeToRetry:false};}
  if(request.fingerprint!==fingerprint)return {ok:false,jobRoot:job,error:{code:'REQUEST_ID_CONFLICT',message:'Workflow UUID already belongs to a different request.'},safeToRetry:false};
  try{const result=JSON.parse(await fs.readFile(path.join(job,'result.json'),'utf8'));for(const file of result.files||[])if(await hashFile(file.file)!==file.sha256)throw Error('WORKFLOW_OUTPUT_CHANGED: retained output was modified');return {...result,replayed:true,historicalResult:true,inputStillMatches:await hashFile(args.drawing).then(hash=>hash===result.inputSha256,()=>false)};}
  catch(error){if(error.code!=='ENOENT')return {...failure(error),jobRoot:job,safeToRetry:false};return {ok:false,jobRoot:job,error:{code:'WORKFLOW_IN_PROGRESS',message:'Existing workflow has no final result. Use cad_get_job to inspect its journal; writing again is not authorized by this state.'},safeToRetry:false};}
 }
 const children=[],files=[],warnings=[];let saved,stage='prepare',before,workingDrawing,mutationAttempted=false;
 await atomicJson(path.join(job,'request.json'),{fingerprint,...args});
 const task={jobId,action:'workflow',requestId:args.requestId,status:'running',phase:stage,startedAt:new Date().toISOString(),ownerPid:process.pid};
 const mark=async phase=>{stage=phase;task.phase=phase;task.updatedAt=new Date().toISOString();await atomicJson(path.join(job,'task.json'),task);};
 const call=async(action,input)=>{await mark(action);const value=await execute(action,input);children.push({action,ok:value.ok,jobRoot:value.jobRoot,error:value.error,drawing:value.drawing,drawingSaved:value.drawingSaved});await atomicJson(path.join(job,'children.json'),children);task.children=children.slice(-20).map(({action,ok,jobRoot,drawingSaved})=>({action,ok,jobRoot,drawingSaved}));task.childCount=children.length;await mark(action);return value;};
 const retain=async(file,kind)=>{const record={kind,file,sha256:await hashFile(file),bytes:(await fs.stat(file)).size};files.push(record);task.files=files;if(kind==='dwg')task.outcome='saved_pending_verification';await mark(stage);return record;};
 async function query(drawing,filter={}){const result=requireResult(await call('query_entities',{drawing,host:args.host,filter,limit:5000}));if(result.query.truncated||result.query.errors?.length)throw Error('WORKFLOW_QUERY_INCOMPLETE: narrow the filter; incomplete query cannot establish totals or verified edits');return result;}
 async function finish(result){
  const record={...result,jobRoot:job,requestId:args.requestId,workflow:args.plan.type,children,files,warnings,safeToRetry:false,details:{jobId,tool:'cad_get_job'}};
  task.status=record.ok?'completed':'failed';task.updatedAt=new Date().toISOString();task.outcome=record.outcome;await atomicJson(path.join(job,'result.json'),record);await atomicJson(path.join(job,'task.json'),task);return record;
 }
 try{
  before=await query(args.drawing,args.filter);
  // Freeze one input for all reads, edits and exports, including batch exports.
  workingDrawing=path.join(job,'input.dwg');await fs.copyFile(path.join(before.jobRoot,'input.dwg'),workingDrawing,fs.constants.COPYFILE_EXCL);
  if(await hashFile(workingDrawing)!==before.inputSha256)throw Error('INPUT_DIGEST_MISMATCH: frozen workflow input differs from query');
  const rows=before.query.entities,coverage={scope:before.query.scope,units:before.snapshot.units,matched:before.query.total,truncated:false,filter:args.filter,excluded:'Nested contents and xref contents are not counted; legends/repeated views are included unless excluded by the filter.'};
  await atomicJson(path.join(job,'before.json'),before);
  if(args.plan.type==='takeoff'){
   const {groupBy,attributeTags}=args.plan,groups=aggregateEntities(rows,groupBy,attributeTags),csv=[...groupBy,...attributeTags.map(t=>'attribute:'+t),'count','lengthDrawingUnits','lengthEntityCount'];
   const summary=path.join(job,'summary.csv'),detail=path.join(job,'entities.csv');
   await fs.writeFile(summary,'\uFEFF'+[csv,...groups.map(g=>[...g.values,g.count,g.lengthDrawingUnits,g.lengthEntityCount])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
   await fs.writeFile(detail,'\uFEFF'+[['handle','type','layer','blockName','text','lengthDrawingUnits','attributes'],...rows.map(r=>[r.handle,r.type,r.layer,r.blockName,r.text,r.length,JSON.stringify(r.attributes||{})])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
   await retain(summary,'summary-csv');await retain(detail,'detail-csv');return await finish({ok:true,outcome:'read_only',inputSha256:before.inputSha256,coverage,statistics:{entityCount:rows.length,groupCount:groups.length},groups,query:before.query,snapshot:before.snapshot});
  }
  if(args.plan.type==='export_batch'){
   const outputs=[];for(const item of args.plan.items){const result=await call('export',{drawing:workingDrawing,host:args.host,format:item.format,layout:item.layout,region:item.region});if(result.ok){const file=path.join(job,item.name+'.'+item.format);await fs.copyFile(result.exported.file,file,fs.constants.COPYFILE_EXCL);await retain(file,item.format);outputs.push({name:item.name,ok:true,exported:{...result.exported,file}});}else outputs.push({name:item.name,ok:false,error:result.error,jobRoot:result.jobRoot});}
   return await finish({ok:outputs.every(r=>r.ok),outcome:'read_only',inputSha256:before.inputSha256,coverage,exports:outputs,...(outputs.some(r=>!r.ok)?{error:{code:'PARTIAL_EXPORT_FAILURE',message:'Successful exports are retained; rerun only failed export items with a new read-only request.'}}:{})});
  }
  if(before.snapshot.units!=='Millimeters')throw Error('UNITS_UNKNOWN: edit workflows currently require a declared millimeter drawing');
  let operations=[];const skipped=[];
  if(args.plan.type==='replace_text'){
   for(const row of rows){const text=replacementText(row.text,args.plan);if(text===undefined){skipped.push({handle:row.handle,reason:'not a matching TEXT/MTEXT'});continue;}if(text===row.text)continue;if(!['TEXT','MTEXT'].includes(row.type))throw Error('ENTITY_TYPE_UNSUPPORTED: text workflow requires TEXT/MTEXT');operations.push({type:'set_text',handles:[row.handle],text});}
   const groups=new Map();for(const op of operations){if(!groups.has(op.text))groups.set(op.text,[]);groups.get(op.text).push(...op.handles);}operations=[...groups].flatMap(([text,handles])=>Array.from({length:Math.ceil(handles.length/1000)},(_,i)=>({type:'set_text',text,handles:handles.slice(i*1000,(i+1)*1000)})));
  }else if(args.plan.type==='organize'){
   const handles=rows.map(r=>r.handle);if(args.plan.attributes&&rows.some(r=>r.type!=='INSERT'))throw Error('ENTITY_TYPE_UNSUPPORTED: attribute workflow requires an explicit INSERT filter');
   for(let i=0;i<handles.length;i+=1000){if(args.plan.attributes)operations.push({type:'set_attributes',handles:handles.slice(i,i+1000),attributes:args.plan.attributes});if(args.plan.layer)operations.push({type:'set_layer',handles:handles.slice(i,i+1000),layer:args.plan.layer});}
  }else operations=args.plan.operations;
  if(operations.length>100)throw Error('WORKFLOW_TOO_LARGE: narrow the task to at most 100 atomic operations');
  const selected=new Set(rows.map(row=>row.handle.toUpperCase()));
  for(const op of operations){if(op.ids||op.id)throw Error('MANAGED_OPERATION_REQUIRED: use dedicated electrical tools for managed identities');for(const handle of [...(op.handles||[]),...(op.handle?[op.handle]:[])])if(!selected.has(handle.toUpperCase()))throw Error('WORKFLOW_SCOPE_MISMATCH: operation targets an object outside the query selection');}
  if(!operations.length)return await finish({ok:true,outcome:'read_only',coverage,inputSha256:before.inputSha256,summary:{changed:0,created:0,removed:0,skipped},message:'No changes required.'});
  const region=reviewRegion(rows,args.reviewRegion||args.filter.region);
  if(args.preview&&region){const image=await call('export',{drawing:workingDrawing,host:args.host,format:'png',layout:'Model',region});if(image.ok)await retain(image.exported.file,'before-png');else warnings.push({stage:'before-preview',error:image.error});}
  let managed=before;
  if(!before.snapshot.documentId){managed=requireResult(await call('prepare_project',{drawing:workingDrawing,expectedSha256:before.inputSha256,requestId:crypto.randomUUID(),units:'mm',host:args.host}));workingDrawing=managed.drawing;}
  mutationAttempted=true;const edited=await call('edit',{drawing:workingDrawing,expectedSha256:managed.drawingSha256||before.inputSha256,documentId:managed.snapshot.documentId,expectedRevision:managed.snapshot.revision,requestId:args.requestId,units:'mm',host:args.host,operations});
  if(edited.drawingSaved){saved=edited;await retain(edited.drawing,'dwg');if(edited.dxf)await retain(edited.dxf,'dxf');}requireResult(edited);
  const reviewHandles=[...new Set([...rows.map(row=>row.handle),...(edited.changes||[]).flatMap(change=>change.created||[])])],afterRows=[];let after;
  for(let i=0;i<reviewHandles.length;i+=1000){after=await query(edited.drawing,{handles:reviewHandles.slice(i,i+1000)});afterRows.push(...after.query.entities);}
  after??=await query(edited.drawing,args.filter);after.query={...after.query,entities:afterRows,total:afterRows.length,returned:afterRows.length,scope:'Selected model-space roots plus model-space entities reported created by the edit. This is not a whole-drawing preservation audit.'};
  await atomicJson(path.join(job,'after.json'),after);
  const difference=drawingDifference(rows,afterRows);
  // Verify persisted requested values, not just a successful host response.
  const byHandle=new Map(after.query.entities.map(row=>[row.handle.toUpperCase(),row]));
  for(const op of operations)for(const handle of op.handles||[]){const row=byHandle.get(handle.toUpperCase());if(op.type==='set_text'&&row?.text!==op.text)throw Error('POSTCONDITION_FAILED: saved text differs from request');if(op.type==='set_layer'&&row?.layer!==op.layer)throw Error('POSTCONDITION_FAILED: saved layer differs from request');if(op.type==='set_attributes')for(const [tag,value] of Object.entries(op.attributes))if(Object.entries(row?.attributes||{}).find(([key])=>key.toUpperCase()===tag.toUpperCase())?.[1]!==value)throw Error('POSTCONDITION_FAILED: saved attribute differs from request');}
  if(args.preview&&region){const image=await call('export',{drawing:edited.drawing,host:args.host,format:'png',layout:'Model',region});if(image.ok)await retain(image.exported.file,'after-png');else warnings.push({stage:'after-preview',error:image.error});}
  const diffFile=path.join(job,'changes.json');await atomicJson(diffFile,difference);await retain(diffFile,'changes-json');
  return await finish({ok:true,outcome:'saved',drawing:edited.drawing,drawingSha256:edited.drawingSha256,drawingSaved:true,mutationCommitted:true,inputSha256:before.inputSha256,coverage,summary:{changed:difference.changed.length,created:difference.created.length,removed:difference.removed.length,skipped},snapshot:after.snapshot,query:after.query,review:{region,verifiedBy:'fresh CAD readback',differenceFile:diffFile}});
 }catch(error){return await finish({...failure(error),error:{code:error.child?.error?.code||error.message.split(':')[0],message:error.message,stage},outcome:saved?'saved':error.child?.outcome||(mutationAttempted?'unconfirmed':'not_applied'),drawingSaved:Boolean(saved),drawing:saved?.drawing,drawingSha256:saved?.drawingSha256,mutationCommitted:saved?.mutationCommitted??error.child?.mutationCommitted??(mutationAttempted?undefined:false),inputSha256:before?.inputSha256});}
}
