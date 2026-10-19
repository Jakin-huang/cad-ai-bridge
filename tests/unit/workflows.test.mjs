import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {schemas} from '../../src/contracts.mjs';
import {runWorkflow,replacementText,aggregateEntities,drawingDifference} from '../../src/workflows.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {capabilities} from '../../src/capabilities.mjs';

const uuid=()=>crypto.randomUUID();
async function fixture(t,{truncated=false,exportFailure=false,editFailure=false,readbackFailure=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-workflow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const runs=path.join(root,'runs');await fs.mkdir(runs);const drawing=path.join(root,'source.dwg');
 const initial={units:'Millimeters',documentId:uuid(),revision:0,entities:[{handle:'A',type:'TEXT',layer:'TEXT',text:'OLD $1 OLD',bounds:{min:[0,0,0],max:[100,100,0]}},{handle:'B',type:'INSERT',layer:'BLOCK',blockName:'DEVICE',attributes:{MODEL:'=BAD'},position:[0,0,0]},{handle:'C',type:'LINE',layer:'LINE',start:[0,0,0],end:[100,0,0],length:100}]};await fs.writeFile(drawing,JSON.stringify(initial));const sourceSha=await hashFile(drawing),calls=[];
 const execute=async(action,args)=>{
  calls.push({action,args});const job=await fs.mkdtemp(path.join(runs,'job-child-')),data=JSON.parse(await fs.readFile(args.drawing,'utf8'));await fs.copyFile(args.drawing,path.join(job,'input.dwg'));const inputSha256=await hashFile(args.drawing),snapshot={units:data.units,documentId:data.documentId,revision:data.revision};
  if(action==='query_entities'){
   if(readbackFailure&&data.revision>0)return {ok:false,error:{code:'READBACK_FAILED',message:'injected'},jobRoot:job};
   const rows=data.entities.filter(row=>(!args.filter.handles||args.filter.handles.includes(row.handle))&&(!args.filter.types||args.filter.types.includes(row.type)));
   return {ok:true,inputSha256,jobRoot:job,snapshot,query:{entities:rows,total:rows.length,returned:rows.length,truncated,errors:[],scope:'mock roots'}};
  }
  if(action==='edit'){
   if(editFailure)return {ok:false,error:{code:'LAYER_LOCKED',message:'injected'},jobRoot:job};
   for(const op of args.operations)for(const row of data.entities.filter(e=>op.handles?.includes(e.handle))){if(op.type==='set_text')row.text=op.text;if(op.type==='set_attributes')Object.assign(row.attributes,op.attributes);if(op.type==='set_layer')row.layer=op.layer;}
   data.revision++;const output=path.join(job,'output.dwg');await fs.writeFile(output,JSON.stringify(data));return {ok:true,jobRoot:job,drawing:output,drawingSha256:await hashFile(output),drawingSaved:true,mutationCommitted:true,changes:[],snapshot:{...snapshot,revision:data.revision}};
  }
  if(action==='export'){if(exportFailure)return {ok:false,error:{code:'PLOT_FAILED',message:'injected'},jobRoot:job};const file=path.join(job,'output.'+args.format);await fs.writeFile(file,'test export');return {ok:true,jobRoot:job,exported:{file,format:args.format,bytes:11,sha256:await hashFile(file)}};}
  throw Error('Unexpected '+action);
 };
 const request=plan=>schemas.workflow.parse({drawing,requestId:uuid(),preview:false,plan});return {root,runs,drawing,sourceSha,calls,execute,request};
}
test('capabilities are usable without a CAD configuration and distinguish unverified environments',()=>{const c=capabilities();assert.equal(c.product,'CAD AI Bridge');assert.equal(c.execution.currentUserDocument,true);assert.equal(c.execution.sessionStatus,'experimental');assert.equal(c.acceptance.freshWindows,false);assert.equal(c.acceptance.externalUserTrial,false);});
test('replacement treats search and dollar values literally, and supports exact/case modes',()=>{
 assert.equal(replacementText('A.* A.*',{search:'A.*',replacement:'$&',match:'contains',caseSensitive:true}),'$& $&');assert.equal(replacementText('Old',{search:'old',replacement:'NEW',match:'exact',caseSensitive:false}),'NEW');assert.equal(replacementText('OTHER',{search:'old',replacement:'NEW',match:'exact',caseSensitive:false}),undefined);
});
test('aggregation keeps missing attributes and delimiter-containing values distinct; diff is property-order invariant',()=>{
 const groups=aggregateEntities([{type:'INSERT',attributes:{M:'A|B'}},{type:'INSERT',attributes:{M:'A',N:'B'}},{type:'INSERT',attributes:{m:'A|B'}}],['type'],['M','N']);assert.equal(groups.length,2);assert.equal(groups.find(g=>g.values[1]==='A|B').count,2);assert.equal(drawingDifference([{handle:'A',type:'TEXT'}],[{type:'TEXT',handle:'A'}]).changed.length,0);
});
test('text workflow freezes input, independently reads saved values and replays without new CAD calls',async t=>{
 const f=await fixture(t),request=f.request({type:'replace_text',search:'OLD',replacement:'NEW',match:'contains'});request.filter={types:['TEXT']};const result=await runWorkflow(f.execute,f.runs,request);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.summary.changed,1);assert.equal(result.query.entities[0].text,'NEW $1 NEW');assert.equal(await hashFile(f.drawing),f.sourceSha);const count=f.calls.length,replay=await runWorkflow(f.execute,f.runs,request);assert.equal(replay.replayed,true);assert.equal(f.calls.length,count);assert.equal(replay.drawingSha256,result.drawingSha256);
 const conflict=await runWorkflow(f.execute,f.runs,{...request,plan:{...request.plan,replacement:'OTHER'}});assert.equal(conflict.error.code,'REQUEST_ID_CONFLICT');
 await fs.appendFile(result.drawing,'changed');assert.equal((await runWorkflow(f.execute,f.runs,request)).error.code,'WORKFLOW_OUTPUT_CHANGED');
});
test('takeoff emits matching detail/summary CSV with formula protection and no mutation',async t=>{
 const f=await fixture(t),result=await runWorkflow(f.execute,f.runs,f.request({type:'takeoff',attributeTags:['MODEL']}));assert.equal(result.ok,true);assert.equal(result.statistics.entityCount,3);assert.equal(result.groups.reduce((n,g)=>n+g.count,0),3);const csv=await fs.readFile(result.files.find(file=>file.kind==='summary-csv').file,'utf8');assert.ok(csv.includes("'=BAD"));assert.ok(!f.calls.some(call=>call.action==='edit'));assert.equal(await hashFile(f.drawing),f.sourceSha);
});
test('incomplete query fails before exports, statistics or writes',async t=>{
 const f=await fixture(t,{truncated:true}),result=await runWorkflow(f.execute,f.runs,f.request({type:'takeoff'}));assert.equal(result.ok,false);assert.equal(result.error.code,'WORKFLOW_QUERY_INCOMPLETE');assert.equal(result.files.length,0);assert.equal(f.calls.length,1);
});
test('failed readback preserves the saved DWG and never retries the edit',async t=>{
 const f=await fixture(t,{readbackFailure:true}),result=await runWorkflow(f.execute,f.runs,f.request({type:'replace_text',search:'OLD $1 OLD',replacement:'NEW'}));assert.equal(result.ok,false);assert.equal(result.drawingSaved,true);assert.equal(result.outcome,'saved');assert.equal(await hashFile(result.drawing),result.drawingSha256);assert.equal(f.calls.filter(c=>c.action==='edit').length,1);
});
test('organize rejects mixed attribute selections; edit operations cannot escape the selected scope',async t=>{
 const f=await fixture(t);assert.equal((await runWorkflow(f.execute,f.runs,f.request({type:'organize',attributes:{MODEL:'NEW'}}))).error.code,'ENTITY_TYPE_UNSUPPORTED');const args=f.request({type:'edit',operations:[{type:'erase',handles:['B']}]});args.filter={types:['TEXT']};assert.equal((await runWorkflow(f.execute,f.runs,args)).error.code,'WORKFLOW_SCOPE_MISMATCH');assert.ok(!f.calls.some(c=>c.action==='edit'));
});
test('batch export reports per-item failures and preserves independent successful results',async t=>{
 const f=await fixture(t,{exportFailure:true}),result=await runWorkflow(f.execute,f.runs,f.request({type:'export_batch',items:[{name:'a',format:'pdf'},{name:'b',format:'png'}]}));assert.equal(result.ok,false);assert.equal(result.error.code,'PARTIAL_EXPORT_FAILURE');assert.equal(result.exports.length,2);assert.equal(f.calls.filter(c=>c.action==='export').length,2);assert.equal(await hashFile(f.drawing),f.sourceSha);
});
test('workflow schema rejects native operations, injected paths and ambiguous output names',()=>{
 const base={drawing:'drawing.dwg',requestId:uuid()};assert.equal(schemas.workflow.safeParse({...base,plan:{type:'export_batch',items:[{name:'../escape',format:'pdf'}]}}).success,false);assert.equal(schemas.workflow.safeParse({...base,plan:{type:'export_batch',items:[{name:'a',format:'pdf'},{name:'A',format:'pdf'}]}}).success,false);assert.equal(schemas.workflow.safeParse({...base,plan:{type:'organize'}}).success,false);assert.equal(schemas.workflow.safeParse({...base,plan:{type:'edit',operations:[{type:'create_native_tray',fromPoint:[0,0,0],toPoint:[3000,0,0],width:400,height:150}]}}).success,false);
});
