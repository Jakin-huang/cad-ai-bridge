import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';import {hashFile} from '../../src/drawings.mjs';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';import {spaceTestInput} from '../helpers/space-input.mjs';
import {auditDrawingPresentation,presentationParameters} from '../../src/drawing-presentation.mjs';
import {verifyDrawingPresentation} from '../../src/drawing-presentation-evidence.mjs';
import {loadDocumentSet} from '../../src/project-document-store.mjs';
const uuid=()=>crypto.randomUUID(),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
const scope='Only the explicitly listed rooms and installed task family are commissioned in this synthetic study.';
const note='All original missing conditions and assumed product values remain pending independent professional review.';
const carry='Retain every supplied geometric, physical, product, electrical, standard and pending-input value and grade.';
async function fixture(kind){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'drawing-presentation-')),runs=root+'/runs';await fs.mkdir(runs);let hosts=0;
 const execute=createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{hosts++;throw Error('Native forbidden in unit test');}});
 const input=kind==='ordinary-lighting'?engineeringTestInput():spaceTestInput(),title=kind==='ordinary-lighting'?'School Lighting Review':'Office Arrangement Review';
 const text='Project name: '+title+'.\n'+scope+'\n'+note+'\n'+carry;
 await fs.writeFile(root+'/main.txt',text);await fs.writeFile(root+'/eval.txt','Forbidden Evaluator Project');await fs.writeFile(root+'/base.json',JSON.stringify(input));
 const project={id:uuid(),name:'Generic presentation fixture',type:'explicit-task-kind'},task={kind,title:'Source-declared drawing text',objective:'Verify project title, descriptive scope and notes without changing physical conditions or upgrading assumptions.'};
 const docs=[{id:'MAIN',role:'requirements',title:'Original task',versionLabel:'R1',file:'main.txt',expectedRawSHA256:await hashFile(root+'/main.txt')},{id:'EVAL',role:'evaluation_only',title:'Excluded comparison',versionLabel:'R1',file:'eval.txt',expectedRawSHA256:await hashFile(root+'/eval.txt')}];
 const set=ok(await execute('project_documents',{action:'create',requestId:uuid(),projectId:project.id,coveragePolicy:'fields_only',documents:docs})).set;
 const frozen=ok(await execute('engineering_intake',{action:'freeze',requestId:uuid(),project,task,documents:set,baselineFile:'base.json',expectedRawSHA256:await hashFile(root+'/base.json')}));
 const evidence=[{documentId:'MAIN',quote:text}],reason='Explicit known developer fixture; not independent customer or semantic acceptance.';
 const common={frozen:{expectedSHA256:frozen.frozenSHA256,reason,evidence},documentDispositions:[{documentId:'MAIN',disposition:'used',reason}]};
 const logical=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceIds','evidenceQuote','status'].includes(k)));
 const parameters=kind==='ordinary-lighting'?{...common,briefDocumentId:'MAIN',roomUses:input.rooms.map(r=>({roomId:r.id,use:r.use,reason,evidence})),requirements:input.requirements.map(r=>({roomIds:r.roomIds,rule:r.rule,values:[r.value],reason,evidence}))}:{...common,program:input.program.map(r=>({...logical(r),reason,evidence})),relations:input.relations.map(r=>({...logical(r),reason,evidence}))};
 const claim=text=>({text,reason,evidence}),presentation={title:claim(title),scope:claim(scope),spaceIds:(input.rooms??input.program).map(r=>r.id),notes:[claim(note)],reviewed:true};
 const draft=(p=parameters,previousDraft)=>execute('engineering_intake',{action:'draft',requestId:uuid(),baseline:frozen.baseline,parameters:p,...(previousDraft?{previousDraft}:{})});
 const adopt=d=>execute('engineering_intake',{action:'commit',requestId:uuid(),baseline:frozen.baseline,draft:d.draft,expectedInputSHA256:d.inputSHA256,reviewed:true});
 return {root,runs,input,title,text,kind,execute,set,docs,frozen,parameters,presentation,draft,adopt,hosts:()=>hosts};
}
for(const kind of ['ordinary-lighting','office-space-planning'])test(kind+': shared source-text gate blocks missing declaration, preserves failed draft and all physical conditions, projects every sheet',async()=>{
 const f=await fixture(kind),bad=ok(await f.draft());assert.equal(bad.ready,false);assert.ok(bad.blockers.some(b=>b.code==='INTAKE_PRESENTATION_REQUIRED'));assert.equal(ok(await f.adopt(bad)).committed,false);
 const old=path.join(f.runs,bad.draft.jobId,'draft.json'),oldSHA=await hashFile(old),d=ok(await f.draft({...f.parameters,presentation:f.presentation},bad.draft));assert.equal(d.ready,true);
 const view=ok(await f.execute('engineering_intake',{action:'read',baseline:f.frozen.baseline,draft:d.draft,section:'presentation'}));assert.equal(view.items[0].reviewed,true);assert.equal(view.items[0].required,true);
 const r=ok(await f.adopt(d)),task={jobId:r.task.jobId,expectedProjectId:r.task.project.id,expectedTaskSHA256:r.task.taskSHA256},dir=path.join(f.runs,r.task.current.jobId),actual=JSON.parse(await fs.readFile(dir+'/input-0.json','utf8'));
 assert.equal(actual.title,f.title);if(kind==='ordinary-lighting')assert.equal(actual.scope,scope);
 for(const key of kind==='ordinary-lighting'?['architecture','luminaires','electrical','missingInputs','standards']:['shell','parameters','missingInputs','standards']){
  const stripRefs=x=>Array.isArray(x)?x.map(stripRefs):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['sourceId','sourceIds'].includes(k)).map(([k,v])=>[k,stripRefs(v)])):x;
  assert.deepEqual(stripRefs(actual[key]),stripRefs(f.input[key]));
 }
 await verifyDrawingPresentation(actual,{runs:f.runs,documents:f.set,requireCurrent:true});
 const design=ok(await f.execute('engineering_task',{action:'invoke',...task,requestId:uuid(),operation:'design',parameters:{expectedRevision:0,expectedInputSHA256:r.task.current.inputSHA256,...(kind==='office-space-planning'?{budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}:{})}}));
 assert.ok(design.current.modelSHA256);const model=JSON.parse(await fs.readFile(dir+'/model-0.json','utf8'));
 assert.ok(auditDrawingPresentation(model).every(c=>c.ok));
 for(const tamper of ['title','scope','note']){const changed=structuredClone(model);if(tamper==='title')changed.scene.entities.find(e=>e.kind==='text'&&e.text.includes(f.title)).text='Old placeholder';else{const target=tamper==='scope'?'项目范围（原文）：':'项目说明 1（原文）：';changed.scene.entities=changed.scene.entities.filter(e=>!(e.kind==='text'&&e.text.startsWith(target)));}assert.ok(auditDrawingPresentation(changed).some(c=>!c.ok),tamper);}
 assert.equal(await hashFile(old),oldSHA);assert.equal(f.hosts(),0);
 // Current source identity changes block reuse; historical evidence remains readable.
 ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:f.docs}));await assert.rejects(()=>verifyDrawingPresentation(actual,{runs:f.runs,requireCurrent:true}),/DOCUMENT_SET_STALE/);await verifyDrawingPresentation(actual,{runs:f.runs});
});
test('presentation rejects invented/project-evaluator text, unsupported source roles, malformed text and unrelated document sets',async()=>{
 const f=await fixture('ordinary-lighting');
 for(const modify of [p=>{p.title.text='Invented Name';},p=>{p.scope.text='An invented project scope without original evidence.';},p=>{p.notes[0].text='An invented instruction without original evidence.';},p=>{p.title.evidence=[{documentId:'EVAL',quote:'Forbidden Evaluator Project'}];},p=>{p.reviewed=false;},p=>{p.title.text='Bad\nName';}]){const p=structuredClone(f.presentation);modify(p);assert.equal((await f.draft({...f.parameters,presentation:p})).ok,false);}
 for(const ids of [['UNKNOWN'],[],['OFFICE','OFFICE']]){const p=structuredClone(f.presentation);p.spaceIds=ids;const r=await f.draft({...f.parameters,presentation:p});assert.ok(!r.ok||!r.ready);}
 const d=ok(await f.draft({...f.parameters,presentation:f.presentation})),raw=JSON.parse(await fs.readFile(path.join(f.runs,d.draft.jobId,'draft.json'),'utf8')).compiled.input;
 await assert.rejects(()=>verifyDrawingPresentation({...raw,title:'Stale title'},{runs:f.runs}),/PRESENTATION_TITLE_INPUT_MISMATCH/);
 await assert.rejects(()=>verifyDrawingPresentation(raw,{runs:f.runs,documents:{...f.set,sha256:'0'.repeat(64)}}),/PRESENTATION_DOCUMENT_SET_MISMATCH/);
 assert.equal((await loadDocumentSet(f.runs,f.set)).current,true);assert.equal(f.hosts(),0);
 assert.equal(presentationParameters.safeParse({...f.presentation,notes:[]}).success,false);
});
