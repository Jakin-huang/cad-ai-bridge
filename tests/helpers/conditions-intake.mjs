// Synthetic mechanical fixture; no customer data or independent AI acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';
import {engineeringTestInput} from './engineering-input.mjs';
import {spaceTestInput} from './space-input.mjs';
import {hashFile} from '../../src/drawings.mjs';
const uuid=()=>crypto.randomUUID();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
const logical=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceIds','evidenceQuote','status'].includes(k)));
const conditionsText='Retain the supplied geometry, physical dimensions, products and supply assumptions. These development conditions are not professional authority.';
export async function conditionsIntakeFixture(kind,{root:requestedRoot,runs:requestedRuns,execute:suppliedExecute}={}){
 const root=requestedRoot??await fs.mkdtemp(path.join(os.tmpdir(),'intake-conditions-')),runs=requestedRuns??path.join(root,'runs');await fs.mkdir(runs,{recursive:true});
 let native=0;const execute=suppliedExecute??createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{native++;throw Error('Intake must not launch CAD');}});
 const original=kind==='ordinary-lighting'?engineeringTestInput():spaceTestInput(),conditions=structuredClone(original);
 conditions.intakeMode='conditions_only';conditions.brief=conditionsText;conditions.standards=[];
 conditions.sources.find(s=>s.id==='BRIEF').sha256=hash(conditionsText);
 conditions.sources.find(s=>s.id==='BRIEF').description='Declared physical development conditions only; no interpreted design program.';
 let intent;
 if(kind==='ordinary-lighting'){
  delete conditions.requirements;conditions.scope='Selected declared source spaces; original project requirements must be interpreted separately.';
  for(const room of conditions.rooms)delete room.use;
  intent={roomUses:original.rooms.map(r=>({roomId:r.id,use:r.use})),requirements:original.requirements.map(r=>({roomIds:r.roomIds,rule:r.rule,values:[r.rule==='target_lux'?450:r.value]}))};
 }else{
  delete conditions.program;delete conditions.relations;
  conditions.parameters.evidenceQuote=conditionsText;
  intent={program:original.program.map(logical),relations:original.relations.map(logical)};
 }
 const requirementText=Object.values(intent).flat().map(r=>JSON.stringify(r)).join('\n'),text=conditionsText+'\n'+requirementText;
 await fs.writeFile(path.join(root,'conditions.json'),JSON.stringify(conditions));await fs.writeFile(path.join(root,'requirements.txt'),text);
 const project={id:uuid(),name:'Conditions without a prefilled answer',type:'development'},task={kind,title:'Interpret original requirements',objective:'Derive the logical requirements from the separate original document while preserving physical assumptions.'};
 const document={id:'MAIN',title:'Explicit development requirements',versionLabel:'R1',role:'requirements',file:'requirements.txt',expectedRawSHA256:await hashFile(path.join(root,'requirements.txt'))};
 const set=ok(await execute('project_documents',{action:'create',requestId:uuid(),projectId:project.id,documents:[document]})).set;
 const inspection=ok(await execute('engineering_intake',{action:'inspect_baseline',kind,baselineFile:'conditions.json'}));
 const frozen=ok(await execute('engineering_intake',{action:'freeze',requestId:uuid(),project,task,documents:set,baselineFile:'conditions.json',expectedRawSHA256:inspection.rawSHA256}));
 const decorate=row=>({...row,reason:'Explicit interpretation supplied by this mechanical development test.',evidence:[{documentId:'MAIN',quote:JSON.stringify(row)}]});
 const parameters={frozen:{expectedSHA256:frozen.frozenSHA256,reason:'Preserve all supplied physical conditions and assumption grades.',evidence:[{documentId:'MAIN',quote:conditionsText}]},documentDispositions:[{documentId:'MAIN',disposition:'used',reason:'Separate requirement document supplies the program and physical carry statement.'}],...(kind==='ordinary-lighting'?{briefDocumentId:'MAIN',roomUses:intent.roomUses.map(decorate),requirements:intent.requirements.map(decorate)}:{program:intent.program.map(decorate),relations:intent.relations.map(decorate)})};
 const draft=p=>execute('engineering_intake',{action:'draft',requestId:uuid(),baseline:frozen.baseline,parameters:p});
 const commit=d=>execute('engineering_intake',{action:'commit',requestId:uuid(),baseline:frozen.baseline,draft:d.draft,expectedInputSHA256:d.inputSHA256,reviewed:true});
 const blocks=ok(await execute('project_documents',{action:'source_blocks',set,limit:100})).items;
 async function cover(p){
  const d=ok(await draft(p)),record=JSON.parse(await fs.readFile(path.join(runs,d.draft.jobId,'draft.json'),'utf8'));
  return {...p,sourceCoverage:blocks.map(b=>{
   const matches=record.compiled.review.decisions.filter(d=>d.citations.some(c=>c.documentId===b.documentId&&(c.quote.includes(b.text)||b.text.includes(c.quote))));
   const disposition=matches.some(d=>d.disposition==='conflict')?'conflict':!matches.length||matches.some(d=>d.disposition==='unresolved')?'unresolved':'mapped';
   return {blockId:b.blockId,blockSHA256:b.blockSHA256,disposition,targetIds:matches.flatMap(d=>d.targetIds),reason:'Mechanical source coverage for the explicitly supplied interpretation; not a semantic certification.'};
  })};
 }
 return {root,runs,kind,original,conditions,document,project,set,inspection,frozen,parameters,execute,draft,commit,cover,native:()=>native};
}
