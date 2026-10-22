// Real MCP and real local design adapters over explicit synthetic conditions.
// No model-generated interpretation, native CAD, independent project or professional acceptance.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {conditionsIntakeFixture} from './helpers/conditions-intake.mjs';import {outsideProject} from '../src/local-paths.mjs';import {hashFile} from '../src/drawings.mjs';
assert.ok(process.argv[2],'Supply a fresh private evidence directory');const root=outsideProject(path.resolve(process.argv[2]));await fs.mkdir(root);
const uuid=()=>crypto.randomUUID(),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;},read=async f=>JSON.parse(await fs.readFile(f,'utf8')),report={ok:false,newNativeCad:false,newAiClient:false,semanticAcceptance:false,professionalApproval:false,cases:[]};
for(const kind of ['ordinary-lighting','office-space-planning']){
 const folder=path.join(root,kind);await fs.mkdir(folder);const data=path.join(folder,'data'),runs=path.join(data,'runs'),client=new Client({name:'scope-execution-guard',version:'1'});let calls=0;
 const connect=ro=>client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp-server.mjs')],env:{...process.env,CADBRIDGE_DATA_HOME:data,CADAGENT_ALLOWED_ROOT:folder,CADBRIDGE_READ_ONLY:ro?'1':'0'},stderr:'pipe'}));
 const call=async(action,args,negative=false)=>{calls++;await fs.appendFile(folder+'/calls.ndjson',JSON.stringify({action,args})+'\n');const raw=await client.callTool({name:'cad_'+action,arguments:args},{timeout:180000}),text=raw.content.find(c=>c.type==='text').text;let result;try{result=JSON.parse(text);}catch(e){if(!negative||!raw.isError)throw e;result={ok:false,error:{message:text}};}await fs.appendFile(folder+'/calls.ndjson',JSON.stringify({result})+'\n');if(!negative)ok(result);return result;};
 try{
  await connect(false);
  const execute=async(action,args)=>{
   if(action==='engineering_intake'&&args.action==='freeze'){
    const text=await fs.readFile(folder+'/requirements.txt','utf8'),blocks=await call('project_documents',{action:'source_blocks',set:args.documents,limit:100});assert.ok(text.length<=4000);assert.equal(blocks.nextOffset,null);
    const plan=await call('engineering_intake',{action:'review_scope',requestId:uuid(),documents:args.documents,workItems:[{id:'DESIGN',description:'Implement the explicitly declared synthetic development design requirements',disposition:'candidate',taskKind:kind,reason:'Known mechanical test commission; no semantic or standards certification.',evidence:[{documentId:'MAIN',quote:text}],dependsOn:[]}],sourceCoverage:blocks.items.map(b=>({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:'mapped',targetIds:['workItems/0'],reason:'Explicit synthetic source is retained in this development work item.'}))});
    args={...args,scope:{review:plan.review,workItemId:'DESIGN'}};
   }
   return call(action,args);
  };
  const f=await conditionsIntakeFixture(kind,{root:folder,runs,execute}),draft=await f.draft(await f.cover(f.parameters));assert.equal(draft.ready,true);const adopted=await f.commit(draft),task=adopted.task,identity={jobId:task.jobId,expectedProjectId:task.project.id,expectedTaskSHA256:task.taskSHA256};assert.equal(task.executionScope.eligible,true);
  const manifest=await read(path.join(runs,task.jobId,'manifest.json'));assert.deepEqual(manifest.scope,task.executionScope.selection);
  const next=await call('engineering_task',{action:'next_step',...identity});assert.equal(next.phase,'design');const designQ={...next.next.arguments,requestId:uuid()},designed=await call('engineering_task',designQ);assert.ok(designed.current.modelSHA256);assert.equal((designed.current.audit??designed.current.checks).failed,0);assert.equal(designed.executionScope.eligible,true);
  await fs.writeFile(folder+'/requirements-r2.txt',(await fs.readFile(folder+'/requirements.txt','utf8'))+'\nRecheck this development design against the new document revision before proceeding.');
  await call('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:[{...f.document,file:'requirements-r2.txt',versionLabel:'R2',expectedRawSHA256:await hashFile(folder+'/requirements-r2.txt')}]});
  const before=(await fs.readdir(path.join(runs,task.jobId))).sort(),denied=await call('engineering_task',{...designQ,requestId:uuid()},true);assert.equal(denied.ok,false);assert.match(denied.error.message,/TASK_SCOPE_EXECUTION_BLOCKED/);assert.deepEqual((await fs.readdir(path.join(runs,task.jobId))).sort(),before);
  if(kind==='ordinary-lighting'){const direct=await call('design_project',{action:'design',jobId:designed.current.jobId,expectedRevision:0},true);assert.equal(direct.ok,false);assert.match(direct.error.message,/TASK_SCOPE_EXECUTION_BLOCKED/);}
  const replay=await call('engineering_task',designQ);assert.equal(replay.execution.replayed,true);assert.equal(replay.executionScope.eligible,false);
  await client.close();await connect(true);const fresh=await call('engineering_task',{action:'status',...identity}),blocked=await call('engineering_task',{action:'next_step',...identity});assert.equal(fresh.current.modelSHA256,designed.current.modelSHA256);assert.equal(fresh.executionScope.eligible,false);assert.equal(blocked.phase,'blocked');assert.equal(blocked.next,null);assert.ok(blocked.issues.some(i=>i.code==='SCOPE_EXECUTION_BLOCKED'));
  const readonlyDenied=await call('engineering_task',{...designQ,requestId:uuid()},true);assert.equal(readonlyDenied.ok,false);
  const ids=await fs.readdir(runs);assert.ok(ids.filter(s=>s.startsWith('job-')).every(s=>/^job-(docset|docpolicy|scopereview|intake|intakedraft|task|design|spaceplan|docreview)-/.test(s)),'No native CAD jobs may be created');
  report.cases.push({kind,calls,task:identity,scope:manifest.scope,modelSHA256:designed.current.modelSHA256,checksFailed:0,freshReadonlyVerified:true,newOperationBlocked:true,oldReceiptReplayed:true,sourceChangeInvalidated:true,newNativeCad:false,newAiClient:false});await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');
 }catch(e){report.error=e.stack;await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');throw e;}finally{await client.close().catch(()=>{});}
}
report.ok=true;await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
