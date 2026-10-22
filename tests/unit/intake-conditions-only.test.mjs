import test from 'node:test';
import {conditionsIntakeFixture as fixture} from '../helpers/conditions-intake.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {hashFile} from '../../src/drawings.mjs';

// These are mechanical development cases. The test supplies interpretations;
// source quotation and successful design do not establish AI understanding.
const uuid=()=>crypto.randomUUID();
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
const logical=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceIds','evidenceQuote','status'].includes(k)));
for(const kind of ['ordinary-lighting','office-space-planning'])test(kind+': original requirements create a design without prefilled requirements or room program',async()=>{
 const f=await fixture(kind);assert.equal(f.inspection.intakeMode,'conditions_only');
 const bytes=await fs.readFile(path.join(f.root,'conditions.json'),'utf8');assert.equal(bytes.includes('"requirements"'),false);assert.equal(bytes.includes('"program"'),false);
 const snapshot=JSON.parse(await fs.readFile(path.join(f.runs,f.frozen.baseline.jobId,'baseline.json'),'utf8'));
 assert.deepEqual(kind==='ordinary-lighting'?snapshot.requirements:snapshot.program,[]);
 const incomplete=ok(await f.draft(f.parameters));assert.equal(incomplete.ready,false);assert.ok(incomplete.sourceCoverage.unreviewed>0);
 assert.equal(ok(await f.commit(incomplete)).committed,false);
 const complete=ok(await f.draft(await f.cover(f.parameters)));assert.equal(complete.ready,true,JSON.stringify(complete));
 const adopted=ok(await f.commit(complete));assert.equal(adopted.committed,true);
 const task=adopted.task,stored=JSON.parse(await fs.readFile(path.join(f.runs,task.current.jobId,'input-0.json'),'utf8'));
 assert.equal(stored.intakeMode,undefined);if(kind==='ordinary-lighting')assert.equal(stored.requirements.find(r=>r.rule==='target_lux').value,450);
 if(kind==='office-space-planning'){assert.deepEqual(stored.program.map(logical),f.original.program.map(logical));assert.deepEqual(stored.shell.rect,f.original.shell.rect);assert.equal(stored.parameters.status,'assumed');}else{assert.deepEqual(stored.rooms[0].polygon,f.original.rooms[0].polygon);assert.equal(stored.luminaires[0].photometry,'assumed');}
 const designed=ok(await f.execute('engineering_task',{action:'invoke',jobId:task.jobId,expectedProjectId:task.project.id,expectedTaskSHA256:task.taskSHA256,requestId:uuid(),operation:'design',parameters:{expectedRevision:0,expectedInputSHA256:complete.inputSHA256,...(kind==='office-space-planning'?{budget:{maxNodes:50000,maxMilliseconds:10000,maxPlans:1}}:{})}}));
 assert.equal(designed.current.status,'designed');assert.ok(designed.current.modelSHA256);assert.equal(designed.current.documentEvidence.sourceCoverage.complete,true);
 assert.equal(f.native(),0);assert.equal(await fs.readFile(path.join(f.root,'conditions.json'),'utf8'),bytes);
});
for(const kind of ['ordinary-lighting','office-space-planning'])test(kind+': conditions-only admission retains physical validation and forbids prefilled answers',async()=>{
 const f=await fixture(kind),variants=kind==='ordinary-lighting'?[{...f.conditions,requirements:f.original.requirements},{...f.conditions,rooms:f.original.rooms},{...f.conditions,electrical:{...f.conditions.electrical,sourceIds:['MISSING']}}]:[{...f.conditions,program:f.original.program},{...f.conditions,relations:f.original.relations},{...f.conditions,shell:{...f.conditions.shell,entry:{...f.conditions.shell.entry,offsetMm:0}}}];
 for(const value of variants){await fs.writeFile(path.join(f.root,'invalid.json'),JSON.stringify(value));const r=await f.execute('engineering_intake',{action:'inspect_baseline',kind,baselineFile:'invalid.json'});assert.equal(r.ok,false);}
 const caps=ok(await f.execute('engineering_intake',{action:'capabilities',kind,section:'conditions'}));assert.equal(caps.profiles[0].baselineSchema.properties.intakeMode.const,'conditions_only');assert.equal(f.native(),0);
});
test('conditions-only lighting keeps missing and contradictory requirements blocked, and document replacement invalidates a ready draft',async()=>{
 const f=await fixture('ordinary-lighting'),p=structuredClone(f.parameters);p.requirements=p.requirements.filter(r=>r.rule!=='max_drop');p.requirements.find(r=>r.rule==='target_lux').values=[450,650];
 const d=ok(await f.draft(await f.cover(p)));assert.equal(d.ready,false);assert.ok(d.blockers.some(b=>b.code==='INTAKE_REQUIREMENT_OMITTED'));assert.ok(d.blockers.some(b=>b.code==='INTAKE_REQUIREMENT_CONFLICT'));assert.equal(ok(await f.commit(d)).committed,false);
 const ready=ok(await f.draft(await f.cover(f.parameters)));assert.equal(ready.ready,true);
 await fs.appendFile(path.join(f.root,'requirements.txt'),'\nNew unresolved customer requirement.');
 ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:[{...f.document,versionLabel:'R2',expectedRawSHA256:await hashFile(path.join(f.root,'requirements.txt'))}]}));
 const stale=await f.commit(ready);assert.equal(stale.ok,false);assert.match(stale.error.message,/DOCUMENT_SET_STALE/);
 assert.equal((await fs.readdir(f.runs)).filter(n=>n.startsWith('job-task-')).length,0);assert.equal(f.native(),0);
});
