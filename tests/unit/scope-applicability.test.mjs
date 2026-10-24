import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createExecutor} from '../../src/runner.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {engineeringTestInput} from '../helpers/engineering-input.mjs';
import {scopeApplicability,validateScopeConditions} from '../../src/scope-applicability.mjs';
const uuid=()=>crypto.randomUUID(),ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r;};
const reason='Explicit development interpretation; it is not independent semantic or authority acceptance.';
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scope-conditions-')),runs=path.join(root,'runs');await fs.mkdir(runs);let native=0;
 const execute=createExecutor({runs,getSettings:async()=>({workspace:root}),launch:async()=>{native++;throw Error('No native operation authorized by this unit test');}}),project={id:uuid(),name:'Conditional development scope',type:'synthetic'},lines=['If the client requests fitout, prepare the space plan.','Prepare ordinary lighting; a separately unneeded fitout need not delay this design.','The client has not yet confirmed whether fitout is requested.'];
 await fs.writeFile(root+'/brief.txt',lines.join('\n'));await fs.writeFile(root+'/notes.txt','The client does not request fitout in the declared current scope.');await fs.writeFile(root+'/standard.txt','A published threshold does not establish an actual site measurement.');await fs.writeFile(root+'/reference.txt','An isolated final reference is not an input fact.');
 const documents=await Promise.all([['MAIN','brief.txt','requirements'],['SITE','notes.txt','coordination'],['STD','standard.txt','standard_excerpt'],['BG','standard.txt','background'],['EVAL','reference.txt','evaluation_only']].map(async([id,file,role])=>({id,file,role,title:id,versionLabel:'1',expectedRawSHA256:await hashFile(root+'/'+file)})));
 const set=ok(await execute('project_documents',{action:'create',requestId:uuid(),projectId:project.id,documents})).set,blocks=ok(await execute('project_documents',{action:'source_blocks',set,limit:100})).items;
 const fact={id:'FITOUT',type:'boolean',value:null,status:'unresolved',reason,evidence:[{documentId:'MAIN',quote:lines[2]}]},when={mode:'all',conditions:[{factId:'FITOUT',operator:'eq',value:true}]};
 const workItems=[{id:'SPACE',description:lines[0],disposition:'candidate',taskKind:'office-space-planning',reason,evidence:[{documentId:'MAIN',quote:lines[0]}],when},{id:'LIGHT',description:lines[1],disposition:'candidate',taskKind:'ordinary-lighting',reason,evidence:[{documentId:'MAIN',quote:lines[1]}],dependsOn:['SPACE'],allowInactiveDependencies:[{workItemId:'SPACE',reason,evidence:[{documentId:'MAIN',quote:lines[1]}]}]},{id:'MISSING',description:lines[2],disposition:'deferred',reason,evidence:[{documentId:'MAIN',quote:lines[2]}]},{id:'STATUS',description:'Current fitout instruction',disposition:'context',reason,evidence:[{documentId:'SITE',quote:'The client does not request fitout in the declared current scope.'}]}];
 // This fixture maps each original sentence to the work item citing its whole line.
 const q={action:'review_scope',requestId:uuid(),documents:set,facts:[fact],workItems,sourceCoverage:blocks.map(b=>({blockId:b.blockId,blockSHA256:b.blockSHA256,disposition:['MAIN','SITE'].includes(b.documentId)?'mapped':'context',targetIds:b.documentId==='MAIN'?['workItems/'+lines.findIndex(l=>l.includes(b.text))]:b.documentId==='SITE'?['workItems/3']:[],reason}))};
 const review=changes=>execute('engineering_intake',{...q,requestId:uuid(),...changes});
 async function freeze(view,kind='ordinary-lighting',workItemId='LIGHT'){
  await fs.writeFile(root+'/conditions.json',JSON.stringify(engineeringTestInput()));
  return execute('engineering_intake',{action:'freeze',requirePresentation:false,requestId:uuid(),project,task:{kind,title:'Conditional task',objective:'Check original source applicability before preparing a physical design baseline.'},documents:set,baselineFile:'conditions.json',expectedRawSHA256:await hashFile(root+'/conditions.json'),scope:{review:view.review,workItemId}});
 }
 return {root,runs,execute,project,documents,set,q,fact,when,review,freeze,native:()=>native};
}
test('unknown and assumed facts retain obligations and block preparation; known inactive needs explicit edge evidence',async()=>{
 const f=await fixture(),unknown=ok(await f.review());assert.equal(unknown.candidates[0].applicability.state,'unknown');assert.equal(unknown.candidates[0].canPrepareConditions,false);assert.equal(unknown.candidates[1].canPrepareConditions,false);assert.equal((await f.freeze(unknown)).ok,false);
 const assumed=ok(await f.review({facts:[{...f.fact,status:'assumed',value:false}]}));assert.equal(assumed.candidates[0].applicability.state,'unknown');assert.equal(assumed.candidates[1].canPrepareConditions,false);
 const facts=[{...f.fact,status:'interpreted',value:false,evidence:[{documentId:'SITE',quote:'The client does not request fitout in the declared current scope.'}]}],inactive=ok(await f.review({facts}));
 assert.equal(inactive.candidates[0].applicability.state,'inactive');assert.equal(inactive.candidates[0].executionStatus,'not_bound');assert.equal(inactive.candidates[0].canPrepareConditions,false);assert.equal(inactive.candidates[1].canPrepareConditions,true);assert.equal(inactive.wholeProjectAccepted,false);ok(await f.freeze(inactive));
 const workItems=structuredClone(f.q.workItems);delete workItems[1].allowInactiveDependencies;const strict=ok(await f.review({facts,workItems}));assert.equal(strict.candidates[1].canPrepareConditions,false);assert.match(strict.candidates[1].prerequisites[0].reason,/no explicit/);
 const active=ok(await f.review({facts:[{...f.fact,status:'interpreted',value:true}]}));assert.equal(active.candidates[0].canPrepareConditions,true);assert.equal(active.candidates[1].canPrepareConditions,false,'An active prerequisite still needs real delivered evidence');assert.equal(f.native(),0);
});
test('typed numeric predicates keep units and unknowns explicit, with all/any three-state logic',()=>{
 const facts=[{id:'HEIGHT',type:'number',value:3.2,unit:'m',status:'interpreted'},{id:'APPROVAL',type:'boolean',value:null,status:'unresolved'}],condition={factId:'HEIGHT',operator:'gte',value:3,unit:'m'},unknown={factId:'APPROVAL',operator:'eq',value:true},item={id:'A',disposition:'candidate',dependsOn:[],when:{mode:'all',conditions:[condition,unknown]}};
 validateScopeConditions([item],facts);assert.equal(scopeApplicability({facts},item).state,'unknown');item.when.mode='any';assert.equal(scopeApplicability({facts},item).state,'active');facts[0].value=2;item.when.mode='all';assert.equal(scopeApplicability({facts},item).state,'inactive');item.when.mode='any';assert.equal(scopeApplicability({facts},item).state,'unknown');
 for(const change of [()=>condition.unit='mm',()=>{condition.unit='m';condition.value='3';},()=>{condition.value=3;condition.factId='ABSENT';}]){change();assert.throws(()=>validateScopeConditions([item],facts),/SCOPE_CONDITION/);}
 const text={id:'TYPE',type:'text',value:'office',status:'interpreted'},work={id:'B',dependsOn:[],when:{mode:'all',conditions:[{factId:'TYPE',operator:'ne',value:'hospital'}]}};validateScopeConditions([work],[text]);assert.equal(scopeApplicability({facts:[text]},work).state,'active');work.when.conditions[0].operator='gt';assert.throws(()=>validateScopeConditions([work],[text]),/ORDER_REQUIRES_NUMBER/);
});
test('invalid facts, unrelated quotes, standard/background site claims and ambiguous dependency exemptions are rejected',async()=>{
 const f=await fixture(),variants=[{facts:[f.fact,f.fact]},{facts:[{...f.fact,status:'unresolved',value:false}]},{facts:[{...f.fact,status:'interpreted'}]},{facts:[{...f.fact,type:'number',value:2,status:'interpreted'}]},{facts:[{...f.fact,type:'boolean',value:2,status:'interpreted'}]},{facts:[{...f.fact,value:false,status:'interpreted',unit:'m'}]}];
 for(const role of ['STD','BG','EVAL'])variants.push({facts:[{...f.fact,value:false,status:'interpreted',evidence:[{documentId:role,quote:role==='EVAL'?'An isolated final reference is not an input fact.':'A published threshold does not establish an actual site measurement.'}]}]});
 variants.push({facts:[{...f.fact,evidence:[{documentId:'MAIN',quote:'This sentence does not occur in any original.'}]}]});
 for(const mutate of [w=>w[1].allowInactiveDependencies[0].workItemId='MISSING',w=>w[1].allowInactiveDependencies.push(w[1].allowInactiveDependencies[0]),w=>delete w[0].when,w=>w[3].when=f.when,w=>w[0].when.conditions[0].factId='UNKNOWN']){const workItems=structuredClone(f.q.workItems);mutate(workItems);variants.push({workItems});}
 for(const changes of variants)assert.equal((await f.review(changes)).ok,false,JSON.stringify(changes));assert.equal((await fs.readdir(f.runs)).some(n=>n.startsWith('job-scopereview-')),false);
});
test('fact and applicability pages are read-only; new interpretations never mutate old reviews; source changes stale prepared baselines',async()=>{
 const f=await fixture(),facts=[{...f.fact,status:'interpreted',value:false}],r=ok(await f.review({facts})),file=path.join(f.runs,r.review.jobId,'scope-review.json'),before=await hashFile(file),frozen=ok(await f.freeze(r));
 const page=ok(await f.execute('engineering_intake',{action:'read_scope_review',review:r.review,section:'facts',limit:1}));assert.equal(page.items[0].citations[0].documentId,'MAIN');assert.equal(page.items[0].status,'interpreted');
 const applicability=ok(await f.execute('engineering_intake',{action:'read_scope_review',review:r.review,section:'applicability',limit:1}));assert.equal(applicability.items[0].state,'inactive');assert.equal(applicability.nextOffset,1);
 ok(await f.review({facts:[{...f.fact,status:'interpreted',value:true}]}));assert.equal(await hashFile(file),before);assert.equal((await f.execute('engineering_intake',{action:'read_scope_review',review:r.review})).candidates[0].applicability.state,'inactive');
 await fs.appendFile(f.root+'/notes.txt','\nThe client now requests fitout; the earlier instruction is superseded.');ok(await f.execute('project_documents',{action:'update',requestId:uuid(),set:f.set,documents:await Promise.all(f.documents.map(async d=>d.id==='SITE'?{...d,versionLabel:'2',expectedRawSHA256:await hashFile(f.root+'/notes.txt')}:d))}));
 const status=ok(await f.execute('engineering_intake',{action:'status',baseline:frozen.baseline}));assert.equal(status.canCommit,false);assert.equal(status.documentsCurrent,false);assert.equal((await f.freeze(r)).ok,false);assert.equal(await hashFile(file),before);assert.equal(f.native(),0);
});
