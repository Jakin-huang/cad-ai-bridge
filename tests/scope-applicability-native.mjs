// Controller-driven native gate regression, not an Agent understanding test.
// All conditions are synthetic and explicitly supplied; no customer approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {conditionsIntakeFixture} from './helpers/conditions-intake.mjs';
import {outsideProject,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
import {loadScopeReview} from '../src/engineering-scope-intake.mjs';
import {loadDocumentSet} from '../src/project-document-store.mjs';
const root=outsideProject(path.resolve(process.argv[2]??''));assert.ok(process.argv[2]);
const resume=process.argv[3]==='resume';assert.ok(process.argv[3]===undefined||resume);
const workspace=root+'/workspace',data=root+'/data',runs=data+'/runs';if(!resume){await fs.mkdir(root);await fs.mkdir(workspace);await fs.mkdir(data);}
const uuid=()=>crypto.randomUUID(),save=(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2)+'\n',{flag:'wx'}),read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const c=new Client({name:'conditional-scope-native-regression',version:'1'}),report={ok:false,actualInstalledAiClient:false,controllerDrivenNative:true,syntheticNonPrivate:true,professionalApproval:false,independentProjectAcceptance:false,checks:[]};
const reportName=process.argv[4]??(resume?'native-gate-recovered-report.json':'native-gate-report.json');assert.match(reportName,/^[a-z0-9-]+\.json$/);const reportFile=root+'/'+reportName;
async function call(name,q,negative=false){const raw=await c.callTool({name,arguments:q},{timeout:1800000});await fs.appendFile(root+(resume?'/calls-resume.ndjson':'/calls.ndjson'),JSON.stringify({name,q,raw})+'\n');const r=JSON.parse(raw.content.find(t=>t.type==='text').text);if(!negative)assert.equal(r.ok,true,JSON.stringify(r));return r;}
const execute=(name,q)=>call('cad_'+name,q),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const title='条件义务本机闸门测试',scopeText='一个合成办公室的普通照明估算；仅形成待人工审核的测试草案。',note='全部条件来自合成开发资料，估算假设保持；不表示实际客户批准或专业合规。';
const conditionText=[title,scopeText,note,'只有收到本合成测试的继续执行确认，才准备普通照明设计；当前尚未给出确认值。'].join('\n');
try{
 await c.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_DATA_HOME:data,CADAGENT_ALLOWED_ROOT:workspace,CADBRIDGE_READ_ONLY:'0'},stderr:'pipe'}));
 let task,set,condition,mainDocument,oldScopeFile,oldScopeSHA;
 if(resume){
  const prior=await read(root+'/native-gate-report.json');assert.equal(prior.ok,false);assert.equal(prior.task.current.status,'prepared');assert.equal(prior.task.executionCount,0);assert.equal(prior.checks.length,3);
  report.priorHarnessFailureSHA256=await hashFile(root+'/native-gate-report.json');report.priorHarnessFailureRetained=true;report.checks.push(...prior.checks);report.unknownReview=prior.unknownReview;report.activeReview=prior.activeReview;
  report.priorReports=await Promise.all((await fs.readdir(root)).filter(f=>f.startsWith('native-gate-')&&f.endsWith('.json')).map(async file=>({file,sha256:await hashFile(root+'/'+file)})));
  task={jobId:prior.task.jobId,expectedProjectId:prior.task.project.id,expectedTaskSHA256:prior.task.taskSHA256};
  const active=await loadScopeReview(runs,prior.activeReview);set=active.documents;const docs=await loadDocumentSet(runs,set,{requireCurrent:true});
  const sourceDoc=(id,file)=>{const d=docs.version.documents.find(d=>d.id===id);return {id,title:d.title,role:d.role,versionLabel:d.versionLabel,file,expectedRawSHA256:d.rawSHA256};};condition=sourceDoc('CONDITION','condition.txt');mainDocument=sourceDoc('MAIN','requirements.txt');assert.equal(await hashFile(workspace+'/condition.txt'),condition.expectedRawSHA256);
  oldScopeFile=runs+'/'+prior.unknownReview.jobId+'/scope-review.json';await loadScopeReview(runs,prior.unknownReview);oldScopeSHA=await hashFile(oldScopeFile);
 }else{
 const f=await conditionsIntakeFixture('ordinary-lighting',{root:workspace,runs,execute}),main=await fs.readFile(workspace+'/requirements.txt','utf8');
 mainDocument=f.document;
 await fs.writeFile(workspace+'/condition.txt',conditionText,{flag:'wx'});
 condition={id:'CONDITION',title:'Synthetic execution condition',versionLabel:'1',role:'coordination',file:'condition.txt',expectedRawSHA256:await hashFile(workspace+'/condition.txt')};
 set=(await execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:[f.document,condition]})).set;
 async function scopeReview(value){
  const blocks=await execute('project_documents',{action:'source_blocks',set,limit:100});assert.equal(blocks.nextOffset,null);
  const currentCondition=await fs.readFile(workspace+'/condition.txt','utf8');
  return execute('engineering_intake',{action:'review_scope',requestId:uuid(),documents:set,facts:[{id:'PROCEED',type:'boolean',value,status:value===null?'unresolved':'interpreted',reason:'Declared synthetic execution trigger only; not an actual customer or professional approval.',evidence:[{documentId:'CONDITION',quote:value===null?conditionText:'本合成测试的最新执行确认：允许继续准备普通照明测试草案。'}]}],workItems:[{id:'LIGHT',description:'Only prepare the declared synthetic lighting design after its source trigger is known.',disposition:'candidate',taskKind:'ordinary-lighting',reason:'A source-bound mechanical gate trial, not independent understanding of a customer commission.',evidence:[{documentId:'MAIN',quote:main},{documentId:'CONDITION',quote:currentCondition}],when:{mode:'all',conditions:[{factId:'PROCEED',operator:'eq',value:true}]}}],sourceCoverage:blocks.items.map(b=>({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:'mapped',targetIds:['workItems/0'],reason:'Explicit synthetic obligation and trigger statements are retained with their original quotes.'}))});
 }
 const unknown=await scopeReview(null),beforeJobs=await fs.readdir(runs),freezeQ={action:'freeze',requirePresentation:true,project:f.project,task:{kind:'ordinary-lighting',title:'Conditional native regression',objective:'Verify unknown scope stops before CAD and a new source trigger can prepare a source-bound review draft.'},baselineFile:'conditions.json',expectedRawSHA256:f.inspection.rawSHA256};
 const denied=await call('cad_engineering_intake',{...freezeQ,requestId:uuid(),documents:set,scope:{review:unknown.review,workItemId:'LIGHT'}},true);
 check('Unknown trigger blocks baseline before task or CAD creation',denied.ok===false&&/SCOPE_PREPARATION_BLOCKED/.test(denied.error.message));assert.deepEqual(await fs.readdir(runs),beforeJobs);
 oldScopeFile=runs+'/'+unknown.review.jobId+'/scope-review.json';oldScopeSHA=await hashFile(oldScopeFile);report.unknownReview=unknown.review;
 await fs.appendFile(workspace+'/condition.txt','\n本合成测试的最新执行确认：允许继续准备普通照明测试草案。');condition={...condition,versionLabel:'2',expectedRawSHA256:await hashFile(workspace+'/condition.txt')};set=(await execute('project_documents',{action:'update',requestId:uuid(),set,documents:[f.document,condition]})).set;
 const active=await scopeReview(true);check('Explicit newer synthetic trigger activates candidate',active.candidates[0].canPrepareConditions===true);report.activeReview=active.review;
 const frozen=await execute('engineering_intake',{...freezeQ,requestId:uuid(),documents:set,scope:{review:active.review,workItemId:'LIGHT'}}),claim=text=>({text,reason:'Literal synthetic project declaration; not semantic or professional acceptance.',evidence:[{documentId:'CONDITION',quote:text}]});
 let parameters={...f.parameters,frozen:{...f.parameters.frozen,expectedSHA256:frozen.frozenSHA256},documentDispositions:[...f.parameters.documentDispositions,{documentId:'CONDITION',disposition:'used',reason:'Explicit synthetic title, scope, limitations and execution-trigger source.'}],presentation:{title:claim(title),scope:claim(scopeText),notes:[claim(note)],spaceIds:f.original.rooms.map(r=>r.id),reviewed:true}};
 const draftQ={action:'draft',requestId:uuid(),baseline:frozen.baseline,parameters};let draft=await execute('engineering_intake',draftQ);
 const coverage=[];let offset=0;while(true){const page=await execute('engineering_intake',{action:'read',baseline:frozen.baseline,draft:draft.draft,section:'source_coverage',offset,limit:100});for(const b of page.items){
   const trigger=b.documentId==='CONDITION'&&!b.literalCitationTargetIds.length;assert.ok(b.literalCitationTargetIds.length||trigger,'Unmapped physical/program source');coverage.push({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:trigger?'context':'mapped',targetIds:trigger?[]:b.literalCitationTargetIds,reason:trigger?'Execution trigger is preserved in the linked immutable scope review; not a physical design claim.':'Literal declarations supplied by this controller test, not independent semantic acceptance.'});
  }if(page.nextOffset===null)break;offset=page.nextOffset;}
 parameters={...parameters,sourceCoverage:coverage};draft=await execute('engineering_intake',{...draftQ,requestId:uuid(),previousDraft:draft.draft,parameters});check('Current source and presentation draft ready',draft.ready===true);
 const committed=await execute('engineering_intake',{action:'commit',requestId:uuid(),baseline:frozen.baseline,draft:draft.draft,expectedInputSHA256:draft.inputSHA256,reviewed:true});task={jobId:committed.task.jobId,expectedProjectId:committed.task.project.id,expectedTaskSHA256:committed.task.taskSHA256};
 }
 report.task=task;
 let status=await execute('engineering_task',{action:'status',...task});check('Formal task enforces active applicability',status.executionScope.eligible&&status.executionScope.applicability.state==='active');
 assert.equal(status.current.status,'prepared');assert.equal(status.executionCount,0,'Resume only before the first design/native operation');
 const next=await execute('engineering_task',{action:'next_step',...task});assert.equal(next.phase,'design');await execute('engineering_task',{...next.next.arguments,action:'invoke',...task,requestId:uuid()});
 status=await execute('engineering_task',{action:'status',...task});const modelSHA256=status.current.modelSHA256;report.modelSHA256=modelSHA256;
 await execute('engineering_task',{action:'invoke',...task,requestId:uuid(),operation:'deliver',parameters:{expectedModelSHA256:modelSHA256}});
 status=await execute('engineering_task',{action:'status',...task});check('Real CAD delivery independently saved and reopened',status.current.delivery?.verification?.ok===true);
 await execute('engineering_task',{action:'invoke',...task,requestId:uuid(),operation:'review_pdfs',parameters:{expectedModelSHA256:modelSHA256,expectedSourceSHA256:status.current.pdfReviewSourceSHA256}});
 status=await execute('engineering_task',{action:'status',...task});report.deliveryStatus=status;const binding=await read(runs+'/'+task.jobId+'/binding.json');report.jobId=binding.childJobId;report.kind='ordinary-lighting';
 const child=runs+'/'+binding.childJobId,childState=await read(child+'/engineering.json');report.nativeSteps=childState.nativeSteps;
 check('Current review PDFs exist under the source-bound active task',!!status.current.pdfReview&&status.executionScope.eligible);
 const protectedFiles=[];for(const file of ['input-0.json','model-0.json',...status.files.map(f=>path.relative(child,f.file))]){const target=path.resolve(child,file);protectedFiles.push({file:target,sha256:await hashFile(target)});}await save(root+'/protected-before.json',protectedFiles);
 // Superseding the trigger must stop further native work; preserve the issued history.
 await fs.appendFile(workspace+'/condition.txt','\n更新：本合成测试撤回继续执行确认，新的处理需另行解释。');condition={...condition,versionLabel:'3',expectedRawSHA256:await hashFile(workspace+'/condition.txt')};await execute('project_documents',{action:'update',requestId:uuid(),set,documents:[mainDocument,condition]});
 const stopped=await execute('engineering_task',{action:'status',...task});check('Superseded trigger invalidates the old task execution scope',stopped.executionScope.eligible===false);
 const filesBefore=await fs.readdir(runs+'/'+task.jobId),blocked=await call('cad_engineering_task',{action:'invoke',...task,requestId:uuid(),operation:'deliver',parameters:{expectedModelSHA256:modelSHA256}},true);check('Stale scope rejects invoke before a new receipt/native operation',blocked.ok===false&&/TASK_SCOPE_EXECUTION_BLOCKED/.test(blocked.error.message));assert.deepEqual(await fs.readdir(runs+'/'+task.jobId),filesBefore);
 for(const f of protectedFiles)assert.equal(await hashFile(f.file),f.sha256);assert.equal(await hashFile(oldScopeFile),oldScopeSHA);check('Unknown review and delivered history are byte-identical',true);
 report.currentTaskEligible=false;report.currentReason=stopped.executionScope.reason;report.localNativeGateSubsetAccepted=true;report.goalComplete=false;report.ok=true;await save(reportFile,report);console.log(JSON.stringify({ok:true,checks:report.checks.length,jobId:report.jobId,modelSHA256,controllerDrivenNative:true,currentTaskEligible:false}));
}catch(error){report.error=error.stack;await save(reportFile,report);throw error;}finally{await c.close().catch(()=>{});}
