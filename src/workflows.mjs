import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJson,csvCell} from './files.mjs';
import {hashFile} from './drawings.mjs';
import {failure} from './errors.mjs';
import {matchesRow} from './query-index.mjs';
import {readDxf,unchangedRecords} from './dxf-audit.mjs';
import {verifyGeometry} from './geometry-checks.mjs';
import {verificationReport} from './verification.mjs';

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
 const box=bounds.reduce((v,b)=>[Math.min(v[0],b.min[0]),Math.min(v[1],b.min[1]),Math.max(v[2],b.max[0]),Math.max(v[3],b.max[1])],[Infinity,Infinity,-Infinity,-Infinity]),min=[box[0],box[1],0],max=[box[2],box[3],0];
 const margin=Math.max(max[0]-min[0],max[1]-min[1],100)*.15;return {min:[min[0]-margin,min[1]-margin,0],max:[max[0]+margin,max[1]+margin,0],mode:'intersects'};
}
export async function runWorkflow(execute,runs,args){
 args={...args,preview:args.preview??!args.delivery?.exports?.some(item=>item.format==='png')};
 const started=performance.now();
 const {response:transportResponse,...semanticArgs}=args;const fingerprint=digest(semanticArgs),job=path.join(runs,'job-workflow-'+args.requestId),jobId=path.basename(job);
 await fs.mkdir(runs,{recursive:true});
 try{await fs.mkdir(job);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let request;try{request=JSON.parse(await fs.readFile(path.join(job,'request.json'),'utf8'));}catch{return {ok:false,jobRoot:job,error:{code:'WORKFLOW_IN_PROGRESS',message:'Workflow journal is being prepared. Read this job; do not submit a new write UUID.'},safeToRetry:false};}
  if(request.fingerprint!==fingerprint)return {ok:false,jobRoot:job,error:{code:'REQUEST_ID_CONFLICT',message:'Workflow UUID already belongs to a different request.'},safeToRetry:false};
  try{const result=JSON.parse(await fs.readFile(path.join(job,'result.json'),'utf8'));for(const file of result.files||[])if(await hashFile(file.file)!==file.sha256)throw Error('WORKFLOW_OUTPUT_CHANGED: retained output was modified');return {...result,replayed:true,historicalResult:true,inputStillMatches:await hashFile(args.drawing).then(hash=>hash===result.inputSha256,()=>false)};}
  catch(error){if(error.code!=='ENOENT')return {...failure(error),jobRoot:job,safeToRetry:false};return {ok:false,jobRoot:job,error:{code:'WORKFLOW_IN_PROGRESS',message:'Existing workflow has no final result. Use cad_get_job to inspect its journal; writing again is not authorized by this state.'},safeToRetry:false};}
 }
 const children=[],files=[],warnings=[],proofs={};let saved,stage='prepare',before,workingDrawing,mutationAttempted=false;
 await atomicJson(path.join(job,'request.json'),{fingerprint,...args});
 const task={jobId,action:'workflow',requestId:args.requestId,status:'running',phase:stage,startedAt:new Date().toISOString(),ownerPid:process.pid};
 const mark=async phase=>{stage=phase;task.phase=phase;task.updatedAt=new Date().toISOString();await atomicJson(path.join(job,'task.json'),task);};
 const call=async(action,input)=>{await mark(action);const value=await execute(action,input);children.push({action,ok:value.ok,jobRoot:value.jobRoot,error:value.error,drawing:value.drawing,drawingSaved:value.drawingSaved,hostLaunches:value.metrics?.hostLaunches||0,elapsedMs:value.metrics?.totalMs});await atomicJson(path.join(job,'children.json'),children);task.children=children.slice(-20).map(({action,ok,jobRoot,drawingSaved})=>({action,ok,jobRoot,drawingSaved}));task.childCount=children.length;await mark(action);return value;};
 const retain=async(file,kind)=>{const record={kind,file,sha256:await hashFile(file),bytes:(await fs.stat(file)).size};files.push(record);task.files=files;if(kind==='dwg')task.outcome='saved_pending_verification';await mark(stage);return record;};
 async function query(drawing,filter={},scope,exportDxf=false){const result=requireResult(await call('scan',{drawing,host:args.host,filter,scope,limit:100000,detail:'full',exportDxf}));if(result.query.truncated||result.query.errors?.length)throw Error('WORKFLOW_QUERY_INCOMPLETE: capture exceeded its budget or has read errors; no complete totals or verified edits are claimed');return result;}
 function excludeRow(row){const e=args.exclude;if(!e)return false;return e.layers.some(v=>v.toUpperCase()===row.layer?.toUpperCase())||e.handles.some(v=>v.toUpperCase()===row.handle.toUpperCase())||e.blockNames.some(v=>v.toUpperCase()===row.blockName?.toUpperCase())||e.regions.some(region=>matchesRow(row,{region}));}
 async function csvDelivery(rows,groupBy=['type','layer','blockName'],attributeTags=[]){const groups=aggregateEntities(rows,groupBy,attributeTags),summary=path.join(job,'summary.csv'),detail=path.join(job,'entities.csv');await fs.writeFile(summary,'\uFEFF'+[[...groupBy,...attributeTags.map(t=>'attribute:'+t),'count','lengthDrawingUnits','lengthEntityCount','lengthUnavailableCount'],...groups.map(g=>[...g.values,g.count,g.lengthDrawingUnits,g.lengthEntityCount,g.count-g.lengthEntityCount])].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');await fs.writeFile(detail,'\uFEFF'+[['handle','instancePath','type','layer','blockName','text','lengthDrawingUnits','attributes'],...rows.map(r=>[r.handle,JSON.stringify(r.instancePath||[]),r.type,r.layer,r.blockName,r.text,r.length,JSON.stringify(r.attributes||{})])].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');await retain(summary,'summary-csv');await retain(detail,'detail-csv');return groups;}
 async function exportsDelivery(drawing,items,previewRows){
  const prepared=items.map(item=>{const padded=item.format==='png'&&!item.region&&(item.layout||'Model')==='Model'&&previewRows?.length&&previewRows.every(r=>r.bounds)?reviewRegion(previewRows):undefined;return {...item,region:item.region||padded,automaticPreviewPadding:Boolean(padded)};}),outputs=[];
  const batch=items.length>1?await call('export_many',{drawing,host:args.host,items:prepared.map(({automaticPreviewPadding,...item})=>item)}):undefined;
  for(const item of prepared){
   const result=batch?(batch.exports?.find(e=>e.name===item.name)??{ok:false,error:batch.error,jobRoot:batch.jobRoot}):await call('export',{drawing,host:args.host,format:item.format,layout:item.layout,region:item.region,plot:item.plot});
   if(result.ok){const file=path.join(job,item.name+'.'+item.format);await fs.copyFile(result.exported.file,file,fs.constants.COPYFILE_EXCL);await retain(file,item.format);outputs.push({name:item.name,ok:true,exported:{...result.exported,file,automaticPreviewPadding:item.automaticPreviewPadding}});}else outputs.push({name:item.name,ok:false,error:result.error,jobRoot:result.jobRoot||batch?.jobRoot});
  }return outputs;
 }
 async function finish(result){
  const metrics={totalMs:Math.round(performance.now()-started),hostLaunches:children.reduce((n,c)=>n+(c.hostLaunches||0),0),childCalls:children.length};
  const record={...result,jobRoot:job,requestId:args.requestId,workflow:args.plan.type,children,files,warnings,metrics,safeToRetry:false,details:{jobId,tool:'cad_get_job'}};
  try{
  const sourceNow=await hashFile(args.drawing).catch(()=>undefined),input=before?.inputSha256;
  const mismatched=[];for(const file of files)if(await hashFile(file.file).catch(()=>undefined)!==file.sha256)mismatched.push(file.kind);
  const write=Boolean(mutationAttempted),exports=record.exports||[],visualRequested=files.some(f=>['png','pdf','before-png','after-png'].includes(f.kind));
  record.verification=verificationReport({write,execution:proofs.execution??{status:children.some(c=>!c.ok)?'failed':before?'passed':'unknown'},source:{status:!input||!sourceNow?'unknown':sourceNow===input?'passed':'failed',expectedSha256:input,actualSha256:sourceNow},saved:saved?{status:mismatched.includes('dwg')?'failed':'passed',sha256:saved.drawingSha256}:undefined,reopened:proofs.reopened,geometry:proofs.geometry,preservation:proofs.preservation,render:visualRequested||exports.length?{status:exports.some(e=>!e.ok)||warnings.some(w=>w.stage?.includes('preview'))?'partial':'passed',files:files.filter(f=>['png','pdf','before-png','after-png'].includes(f.kind)).map(f=>({kind:f.kind,sha256:f.sha256}))}:undefined,delivery:{status:!record.ok||mismatched.length?'failed':'passed',mismatched},visualRequested});
  const manifest=path.join(job,'delivery.json');await atomicJson(manifest,{schemaVersion:2,ok:record.ok,workflow:record.workflow,outcome:record.outcome,sourceSha256:record.inputSha256,drawing:record.drawing,coverage:record.coverage,verification:record.verification,review:record.review,metrics,files:[...files],pending:['External-user acceptance, fresh-machine installation and manual productivity comparison are not established by this job.']});record.delivery={manifest,files:files.map(({kind,file,bytes})=>({kind,file,bytes})),verificationPassed:record.verification.requiredSatisfied,verificationScope:'Declared machine-checkable postconditions only; see verification.levels and pending',coverage:record.coverage};
  task.status=record.ok?'completed':'failed';task.updatedAt=new Date().toISOString();task.outcome=record.outcome;await atomicJson(path.join(job,'task.json'),task);await atomicJson(path.join(job,'result.json'),record);return record;
  }catch(error){return {...record,ok:false,error:{code:'WORKFLOW_JOURNAL_FAILED',stage:'journal',message:error.message,next:'保留已返回的DWG和摘要；日志未完整写入，不要重放修改。'},previousError:record.error,evidenceComplete:false,safeToRetry:false};}
 }
 try{
  const isWrite=!['takeoff','export_batch'].includes(args.plan.type);
  if(isWrite&&args.scope&&(args.scope.layout!=='Model'||args.scope.includeNested))throw Error('WORKFLOW_WRITE_SCOPE_UNSUPPORTED: edits require model-space roots');
  before=await query(args.drawing,isWrite?{}:args.filter,args.scope,isWrite);
  if(isWrite&&!before.dxf)throw Error('PRESERVATION_UNAVAILABLE: before-write DXF evidence could not be captured; no edit attempted');
  // Freeze one input for all reads, edits and exports, including batch exports.
  workingDrawing=path.join(job,'input.dwg');await fs.copyFile(path.join(before.jobRoot,'input.dwg'),workingDrawing,fs.constants.COPYFILE_EXCL);
  if(await hashFile(workingDrawing)!==before.inputSha256)throw Error('INPUT_DIGEST_MISMATCH: frozen workflow input differs from query');
  const candidates=before.query.entities.filter(row=>matchesRow(row,args.filter)),rows=candidates.filter(row=>!excludeRow(row)),coverage={scope:before.query.scope,units:before.snapshot.units,matched:rows.length,captured:before.query.entities.length,excludedCount:candidates.length-rows.length,truncated:false,filter:args.filter,exclusionRules:args.exclude,quantityMeaning:'Drawing occurrences, not procurement quantities or inferred systems',lengthMeaning:'Only entities with a world-space length field contribute; missing or definition-only lengths are not converted into world quantities',excluded:'Xref contents are excluded. Legends/repeated views remain included unless explicitly filtered or excluded.'};
  await atomicJson(path.join(job,'before.json'),before);
  if(args.plan.type==='takeoff'){
   const groups=await csvDelivery(rows,args.plan.groupBy,args.plan.attributeTags);return await finish({ok:true,outcome:'read_only',inputSha256:before.inputSha256,coverage,statistics:{entityCount:rows.length,groupCount:groups.length,entitiesWithoutWorldLength:rows.filter(r=>!Number.isFinite(r.length)).length},groups,query:{...before.query,entities:rows,returned:rows.length,total:rows.length},snapshot:before.snapshot});
  }
  if(args.plan.type==='export_batch'){
   const outputs=await exportsDelivery(workingDrawing,args.plan.items);
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
  if(!operations.length){let statistics;if(args.delivery?.csv){const delivered=before.query.entities.filter(r=>!excludeRow(r)),groups=await csvDelivery(delivered);statistics={entityCount:delivered.length,groupCount:groups.length,scope:'All captured model-space roots after exclusions'};}const exports=args.delivery?.exports?await exportsDelivery(workingDrawing,args.delivery.exports,before.query.entities):undefined;await retain(workingDrawing,'dwg');return await finish({ok:!exports?.some(r=>!r.ok),outcome:'read_only',drawing:workingDrawing,drawingSha256:before.inputSha256,coverage,exports,statistics,inputSha256:before.inputSha256,summary:{changed:0,created:0,removed:0,skipped},message:'No changes required. Frozen source copy and requested read-only delivery retained.'});}
  const region=reviewRegion(rows,args.reviewRegion||args.filter.region);
  if(args.preview&&region){const image=await call('export',{drawing:workingDrawing,host:args.host,format:'png',layout:'Model',region});if(image.ok)await retain(image.exported.file,'before-png');else warnings.push({stage:'before-preview',error:image.error});}
  let managed=before;
  if(!before.snapshot.documentId){managed=requireResult(await call('prepare_project',{drawing:workingDrawing,expectedSha256:before.inputSha256,requestId:crypto.randomUUID(),units:'mm',host:args.host}));workingDrawing=managed.drawing;}
  mutationAttempted=true;const edited=await call('edit',{drawing:workingDrawing,expectedSha256:managed.drawingSha256||before.inputSha256,documentId:managed.snapshot.documentId,expectedRevision:managed.snapshot.revision,requestId:args.requestId,units:'mm',host:args.host,operations});
  proofs.execution={status:edited.ok?'passed':'failed'};
  if(edited.drawingSaved){saved=edited;await retain(edited.drawing,'dwg');if(edited.dxf)await retain(edited.dxf,'dxf');}requireResult(edited);
  const reviewHandles=new Set([...rows.map(row=>row.handle),...(edited.changes||[]).flatMap(change=>change.created||[])].map(h=>h.toUpperCase())),after=await query(edited.drawing,{},undefined,true),allAfter=after.query.entities,afterRows=allAfter.filter(r=>reviewHandles.has(r.handle.toUpperCase()));
  proofs.reopened={status:after.inputSha256===edited.drawingSha256?'passed':'failed',expectedSha256:edited.drawingSha256,actualSha256:after.inputSha256};
  if(after.inputSha256!==edited.drawingSha256)throw Error('READBACK_OUTPUT_CHANGED: reopened output differs from the saved drawing digest');if(after.dxf)await retain(after.dxf,'readback-dxf');
  after.query={...after.query,entities:afterRows,total:afterRows.length,returned:afterRows.length,scope:'Selected model-space roots plus reported new roots; preservation is checked separately against DXF entity and block records.'};
  await atomicJson(path.join(job,'after.json'),after);
  const difference=drawingDifference(rows,afterRows);
  // Verify persisted requested values, not just a successful host response.
  await mark('verify_geometry');const geometry=verifyGeometry(rows,allAfter,operations,edited.changes,after.query),geometryFile=path.join(job,'geometry-checks.json');proofs.geometry={status:!geometry.ok?'failed':geometry.pending.length?'partial':'passed',checks:geometry.checks.length,pending:geometry.pending};await atomicJson(geometryFile,geometry);await retain(geometryFile,'geometry-json');if(!geometry.ok)throw Error('GEOMETRY_POSTCONDITION_FAILED: saved planar geometry differs from the requested edit');
  if(!before.dxf||!after.dxf)throw Error('PRESERVATION_UNVERIFIED: before/fresh-reopened DXF evidence is unavailable');
  await mark('verify_preservation');const protectedAudit=unchangedRecords(await readDxf(before.dxf),await readDxf(after.dxf),{excludedHandles:operations.flatMap(op=>[...(op.handles||[]),...(op.handle?[op.handle]:[])]),protectExistingBlockMembership:true});
  const oldRootHandles=new Set(before.query.entities.map(r=>r.handle.toUpperCase())),reportedCreated=new Set((edited.changes||[]).flatMap(c=>c.created||[]).map(h=>h.toUpperCase()));for(const row of allAfter)if(!oldRootHandles.has(row.handle.toUpperCase())&&!reportedCreated.has(row.handle.toUpperCase()))protectedAudit.differences.push({handle:row.handle,kind:'unreported-new-model-root'});protectedAudit.ok=protectedAudit.differences.length===0;
  proofs.preservation={status:protectedAudit.ok?'passed':'failed',compared:protectedAudit.compared,differences:protectedAudit.differences.length};
  const auditFile=path.join(job,'preservation.json');await atomicJson(auditFile,{...protectedAudit,geometry,scope:'Unselected ENTITIES and BLOCKS DXF records including attributes, with documented dimension-name and overall viewport normalization. Tables, dictionaries and opaque vendor internals are not a full database proof.'});await retain(auditFile,'preservation-json');if(!protectedAudit.ok)throw Error('PRESERVATION_FAILED: protected DXF entity/block records changed');
  if(args.preview&&region){const image=await call('export',{drawing:edited.drawing,host:args.host,format:'png',layout:'Model',region});if(image.ok)await retain(image.exported.file,'after-png');else warnings.push({stage:'after-preview',error:image.error});}
  const diffFile=path.join(job,'changes.json');await atomicJson(diffFile,difference);await retain(diffFile,'changes-json');
  let deliveryStatistics,deliveryExports;if(args.delivery?.csv){const deliveryRows=allAfter.filter(r=>!excludeRow(r)),groups=await csvDelivery(deliveryRows);deliveryStatistics={entityCount:deliveryRows.length,groupCount:groups.length,scope:'All captured model-space roots after exclusions, not just edited selection'};}if(args.delivery?.exports)deliveryExports=await exportsDelivery(edited.drawing,args.delivery.exports,allAfter);
  const deliveryOk=!deliveryExports?.some(r=>!r.ok);return await finish({ok:deliveryOk,...(!deliveryOk?{error:{code:'PARTIAL_EXPORT_FAILURE',message:'DWG is saved and verified; failed delivery exports must be retried read-only.'}}:{}),outcome:'saved',drawing:edited.drawing,drawingSha256:edited.drawingSha256,drawingSaved:true,mutationCommitted:true,inputSha256:before.inputSha256,coverage,statistics:deliveryStatistics,exports:deliveryExports,summary:{changed:difference.changed.length,created:difference.created.length,removed:difference.removed.length,skipped},snapshot:after.snapshot,query:after.query,review:{region,verifiedBy:'fresh CAD readback',differenceFile:diffFile,preservationFile:auditFile,protectedRecords:protectedAudit.compared,geometryChecks:geometry.checks.length,pendingGeometry:geometry.pending}});
 }catch(error){return await finish({...failure(error),error:{code:error.child?.error?.code||error.message.split(':')[0],message:error.message,stage},outcome:saved?'saved':error.child?.outcome||(mutationAttempted?'unconfirmed':'not_applied'),drawingSaved:Boolean(saved),drawing:saved?.drawing,drawingSha256:saved?.drawingSha256,mutationCommitted:saved?.mutationCommitted??error.child?.mutationCommitted??(mutationAttempted?undefined:false),inputSha256:before?.inputSha256});}
}
