// Mechanical assembly of a client's explicit plan, never use/value inference.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {engineeringRevisionSchema} from './engineering-revision-contracts.mjs';
import {engineeringInputSchema,inspectEngineeringInput} from './engineering-contracts.mjs';
import {engineeringDigest} from './engineering-design.mjs';
import {inspectBriefSource} from './engineering-brief-source.mjs';
import {loadPlanningHandoff} from './space-planning-handoff.mjs';
import {dependencyDigest} from './task-dependencies.mjs';
import {previewLightingSpaceScope,reviseLightingSpaceScope} from './lighting-space-revisions.mjs';
import {jobDirectory,jobJson} from './jobs.mjs';import {hashFile} from './drawings.mjs';
import {revisionRequirementReview,revisionRequirementReviewPage,revisionDraftBase} from './engineering-proposal-review.mjs';
const same=(a,b)=>dependencyDigest(a??null)===dependencyDigest(b??null),short=(...v)=>dependencyDigest(v).slice(0,24),copy=v=>structuredClone(v);
function quoted(text,record){if(!text.includes(record.quote))throw Error('REVISION_PLAN_QUOTE_NOT_IN_BRIEF');return record;}
function rebind(v,ids){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(x=>rebind(x,ids));return;}let changed=false;if(v.sourceId&&ids[v.sourceId]){v.sourceId=ids[v.sourceId];changed=true;}if(v.sourceIds){changed=v.sourceIds.some(s=>ids[s])||changed;v.sourceIds=[...new Set(v.sourceIds.map(s=>ids[s]??s))];}if(changed&&v.status==='documented')v.status='interpreted';if(changed&&v.classification==='documented')v.classification='interpreted';for(const[k,x]of Object.entries(v))if(!['sources','sourceId','sourceIds'].includes(k))rebind(x,ids);}
export async function compileRevisionPlan(before,q,{runs,inputRoot}){
 if(!before.spaceProgram)throw Error('REVISION_PLAN_SHARED_BASE_REQUIRED');
 const brief=await inspectBriefSource(q.briefFile,{inputRoot});if(brief.textSHA256!==q.expectedBriefSHA256.toLowerCase())throw Error('REVISION_PLAN_BRIEF_CHANGED');
 const prior=before.spaceProgram;if(q.spacePack.jobId!==prior.pack.jobId||q.spacePack.revision<prior.pack.revision)throw Error('REVISION_PLAN_PRODUCER_OR_VERSION_CHANGED');
 const {pack,current}=await loadPlanningHandoff(q.spacePack,{runs,expectedProjectId:prior.expectedProjectId});if(!current)throw Error('SHARED_SOURCE_SUPERSEDED');
 const oldBriefs=before.sources.filter(s=>s.role==='brief'&&!s.supersededBy&&s.sha256.toLowerCase()===crypto.createHash('sha256').update(before.brief).digest('hex'));if(oldBriefs.length!==1)throw Error('REVISION_PLAN_SINGLE_BRIEF_REQUIRED');
 const oldBrief=oldBriefs[0],briefId='B_'+q.requestId.replaceAll('-',''),spaceId='S_'+q.requestId.replaceAll('-','');if(before.sources.some(s=>[briefId,spaceId].includes(s.id)))throw Error('REVISION_PLAN_SOURCE_ID_EXISTS');
 quoted(brief.text,q.sourceEvidence);quoted(brief.text,q.carryForward);
 const selected=new Set(q.rooms.map(r=>r.roomId)),removed=new Set(q.removedRooms.map(r=>r.roomId)),expectedRemoved=before.rooms.filter(r=>!selected.has(r.id)).map(r=>r.id);
 if(selected.size!==q.rooms.length||removed.size!==q.removedRooms.length||!same([...removed].sort(),expectedRemoved.sort()))throw Error('REVISION_PLAN_EXPLICIT_SCOPE_REMOVALS_REQUIRED');
 const evidence=new Map(),sourceIds={[oldBrief.id]:briefId,[prior.sourceId]:spaceId},p=copy(before),missing=[];
 for(const key of ['spaceProgramChanges','architecturalChanges','briefRevision','sourceCarryForwards','functionalIntake'])delete p[key];
 p.brief=brief.text;p.sources=p.sources.map(s=>s.id===oldBrief.id?{...s,supersededBy:briefId}:s.id===prior.sourceId?{...s,supersededBy:spaceId}:s);
 p.sources.push({id:briefId,role:'brief',sha256:brief.textSHA256,description:q.sourceEvidence.reason,derivedFromFinalDrawing:oldBrief.derivedFromFinalDrawing,supersedes:oldBrief.id},{id:spaceId,role:'architecture',sha256:q.spacePack.sha256,description:'Explicit client-selected current upstream design proposal; authority pending',derivedFromFinalDrawing:pack.derivedFromFinalDrawing,supersedes:prior.sourceId});
 const generatedId=(prefix,...v)=>prefix+'_'+short(q.requestId,...v),boundEvidence=r=>({sourceId:briefId,quote:r.quote}),markMissing=(id,description,r)=>{missing.push({id,description,severity:'blocking',sourceIds:[briefId]});evidence.set('missing_input:'+id,r);};
 p.rooms=[];p.requirements=[];p.architecture=copy(pack.context);const bindings=[];
 for(const r of q.rooms){
  quoted(brief.text,r);const source=before.rooms.find(a=>a.id===r.fromRoomId),space=pack.spaces.find(a=>a.id===r.roomId);if(!source||!space)throw Error('REVISION_PLAN_SOURCE_OR_TARGET_ROOM_MISSING');
  if(source.sourceSpaceLabels?.length||source.secondaryUseAssessments?.length)throw Error('REVISION_PLAN_ALIASES_REQUIRE_COMPLETE_AUTHORITY_INTERFACE');
  const room={...copy(source),id:r.roomId,name:space.name,use:r.use,polygon:copy(space.polygon),doors:copy(space.entries),geometryStatus:'inferred'};
  if(r.conditions){quoted(brief.text,r.conditions);for(const k of ['heightM','workplaneM','obstacles'])if(r.conditions[k]!==undefined)room[k]=copy(r.conditions[k]);}
  if(r.use!==source.use)delete room.standardSpace;
  if(r.classification){quoted(brief.text,r.classification);room.standardSpace={classId:r.classification.classId,classification:source.standardSpace?.classification==='assumed'?'assumed':'interpreted',sourceIds:[briefId],reason:r.classification.reason};}
  if(p.lightingStandards&&!room.standardSpace)markMissing(generatedId('CLASS',r.roomId),'Explicit standard classification remains unresolved for '+r.roomId,r);
  room.sourceIds=[...new Set([...room.sourceIds,briefId,spaceId])];p.rooms.push(room);evidence.set('room:'+room.id,r);
  bindings.push({roomId:r.roomId,use:r.use,programSHA256:dependencyDigest(space.function),quote:space.function.evidenceQuote,reason:r.reason,status:'interpreted'});
  const overrides=new Map(r.requirements.map(o=>[o.rule,o])),unresolved=new Map(r.unresolvedRules.map(o=>[o.rule,o]));if(overrides.size!==r.requirements.length||unresolved.size!==r.unresolvedRules.length||[...unresolved.keys()].some(k=>overrides.has(k)))throw Error('REVISION_PLAN_RULE_DISPOSITIONS_CONFLICT');
  for(const o of [...r.requirements,...r.unresolvedRules])quoted(brief.text,o);
  const sourceRequirements=before.requirements.filter(a=>a.roomIds.includes(source.id)),rules=[...new Set([...sourceRequirements.map(a=>a.rule),...overrides.keys()])];
  for(const rule of rules){if(unresolved.has(rule))continue;const original=sourceRequirements.filter(a=>a.rule===rule),override=overrides.get(rule),values=override?override.values:original.map(a=>a.value);
   for(const [i,value]of values.entries()){const old=original[Math.min(i,original.length-1)],preserve=old&&source.id===r.roomId&&old.roomIds.length===1&&i<original.length,id=preserve?old.id:generatedId('R',r.roomId,rule,i);if(old?.status==='assumed'&&override?.status&&override.status!=='assumed')throw Error('REVISION_PLAN_ASSUMPTION_UPGRADE');p.requirements.push({id,rule,value,roomIds:[r.roomId],sourceIds:old?.sourceIds?copy(old.sourceIds):[briefId],rationale:override?.reason??r.reason,status:old?.status==='assumed'?'assumed':override?.status??(old?.status==='documented'?'interpreted':old?.status??'interpreted')});evidence.set('requirement:'+id,override??r);}
  }
  for(const o of r.unresolvedRules)markMissing(generatedId('RULE',r.roomId,o.rule),'Unresolved '+o.rule+' for '+r.roomId+': '+o.reason,o);
  if(r.use==='unknown')markMissing(generatedId('USE',r.roomId),'Room function explicitly unresolved: '+r.reason,r);
 }
 for(const r of q.removedRooms){quoted(brief.text,r);evidence.set('room:'+r.roomId,r);for(const req of before.requirements.filter(a=>a.roomIds.includes(r.roomId)))if(req.roomIds.every(id=>removed.has(id)))evidence.set('requirement:'+req.id,r);}
 for(const key of ['lightingEnvironment','glareAssessment'])if(before[key])p[key].rooms=q.rooms.map(r=>{const original=before[key].rooms.find(a=>a.roomId===r.fromRoomId);if(!original)throw Error('REVISION_PLAN_QUALITY_SOURCE_MISSING');return {...copy(original),roomId:r.roomId};});
 const scopes=new Map(q.standardScopes.map(s=>[s.standardId+'/'+s.clauseId,s])),clauseKeys=p.standards.flatMap(s=>s.clauses.map(c=>s.id+'/'+c.id));if(scopes.size!==q.standardScopes.length||scopes.size!==clauseKeys.length||clauseKeys.some(k=>!scopes.has(k)))throw Error('REVISION_PLAN_EXPLICIT_STANDARD_SCOPES_REQUIRED');
 for(const s of p.standards)for(const c of s.clauses){const mapped=scopes.get(s.id+'/'+c.id);quoted(brief.text,mapped);c.roomIds=mapped.roomIds;evidence.set('standard:'+s.id,mapped);}
 const resolved=new Set(q.resolvedMissingInputs.map(r=>r.id));if(resolved.size!==q.resolvedMissingInputs.length||q.resolvedMissingInputs.some(r=>!before.missingInputs.some(m=>m.id===r.id)))throw Error('REVISION_PLAN_MISSING_INPUT_UNKNOWN');for(const r of q.resolvedMissingInputs){quoted(brief.text,r);evidence.set('missing_input:'+r.id,r);}p.missingInputs=[...p.missingInputs.filter(m=>!resolved.has(m.id)),...missing];
 rebind(p,sourceIds);p.spaceProgram={pack:q.spacePack,expectedProjectId:prior.expectedProjectId,sourceId:spaceId,rooms:bindings};
 const project=engineeringInputSchema.parse(p),preview=await previewLightingSpaceScope(before,project,{runs}),decisions=preview.decisions.map(d=>{const record=d.key.startsWith('source:')?q.sourceEvidence:evidence.get(d.key)??q.carryForward;return {key:d.key,disposition:d.disposition,previousSHA256:d.previousSHA256,nextSHA256:d.nextSHA256,reason:record.reason,evidence:boundEvidence(record)};});
 // Prospective history makes intake see the real source chain, but nothing is
 // published until apply chooses this exact immutable draft.
 const planned=await reviseLightingSpaceScope(before,{project,decisions,reason:q.sourceEvidence.reason,requestId:q.requestId,expectedRevision:q.expectedRevision,expectedInputSHA256:q.expectedInputSHA256},{runs}),intake=inspectEngineeringInput(planned.input);
 return {project,decisions,intake:{ok:intake.ok,issues:intake.issues},impact:planned.impact,brief:{rawSHA256:brief.rawSHA256,textSHA256:brief.textSHA256},scope:'Explicit client scope/use/reuse/rule decisions; technical assembly only. Global conditions retained under quoted authorization, aliases and unrepresented authority changes require complete interface. No semantic or professional certification.'};
}
export function createEngineeringRevisionManager({runs,engineering,getInputRoot}){
 const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
 async function current(jobId){const dir=await jobDirectory(runs,jobId),state=await jobJson(dir,'engineering.json'),input=await jobJson(dir,'input-'+state.revision+'.json');if(engineeringDigest(input)!==state.inputSHA256)throw Error('ENGINEERING_INPUT_CHANGED');await engineering.run({action:'status',jobId});return {dir,state,input};}
 const summary=d=>({status:d.intake.ok?'prepared':'blocked',baseRevision:d.request.expectedRevision,baseInputSHA256:d.request.expectedInputSHA256,rooms:d.project.rooms.map(r=>({roomId:r.id,use:r.use})),removed:d.impact.removed,added:d.impact.added,usesChanged:d.impact.usesChanged,conditions:d.decisions.length,requirementsReview:revisionRequirementReview(d).summary,blocking:d.intake.issues.filter(i=>i.severity==='blocking'),reviewCodes:[...new Set(d.intake.issues.filter(i=>i.severity==='review').map(i=>i.code))],professionalApproval:false});
 async function loadDraft(ref){const dir=await jobDirectory(runs,ref.jobId),file=path.join(dir,'scope-plan-'+ref.draftId+'.json');if(await hashFile(file)!==ref.sha256.toLowerCase())throw Error('REVISION_DRAFT_CHANGED');const d=await read(file);if(d.request.jobId!==ref.jobId||d.request.requestId!==ref.draftId)throw Error('REVISION_DRAFT_IDENTITY_CHANGED');return {dir,file,d};}
 async function run(raw){const q=engineeringRevisionSchema.parse(raw);if(q.action==='draft'){
  const {dir,state,input}=await current(q.jobId);if(state.revision!==q.expectedRevision||state.inputSHA256!==q.expectedInputSHA256.toLowerCase())throw Error('REVISION_PLAN_BASE_CHANGED');if(['delivering','delivery_unconfirmed','quality_assessing'].includes(state.status))throw Error('REVISION_PLAN_ACTIVE_OPERATION');
  const file=path.join(dir,'scope-plan-'+q.requestId+'.json'),existing=await read(file).catch(e=>{if(e.code!=='ENOENT')throw e;});if(existing){if(existing.requestSHA256!==dependencyDigest(q))throw Error('REVISION_PLAN_REQUEST_CONFLICT');return {ok:true,replayed:true,draft:{jobId:q.jobId,draftId:q.requestId,sha256:await hashFile(file)},...summary(existing)};}
  const compiled=await compileRevisionPlan(input,q,{runs,inputRoot:await getInputRoot()}),draft={schemaVersion:1,request:q,requestSHA256:dependencyDigest(q),...compiled};await fs.writeFile(file,JSON.stringify(draft,null,2)+'\n',{flag:'wx'});return {ok:true,draft:{jobId:q.jobId,draftId:q.requestId,sha256:await hashFile(file)},...summary(draft)};
 }
 const {dir,d}=await loadDraft(q.draft);if(q.action==='read'){const {state}=await current(q.draft.jobId),base=revisionDraftBase(d,state);if(q.section==='summary')return {ok:true,draft:q.draft,base,...summary(d)};if(q.section==='requirements')return {ok:true,draft:q.draft,base,...revisionRequirementReviewPage(d,{offset:q.offset,limit:q.limit}),professionalApproval:false};const values=q.section==='conditions'?d.decisions:[d.project],items=values.slice(q.offset,q.offset+q.limit);return {ok:true,draft:q.draft,base,section:q.section,offset:q.offset,total:values.length,items,hasMore:q.offset+items.length<values.length,nextOffset:q.offset+items.length,professionalApproval:false};}
 const receipt=path.join(dir,'scope-plan-applied-'+q.requestId+'.json'),prior=await read(receipt).catch(e=>{if(e.code!=='ENOENT')throw e;});if(prior){if(prior.requestSHA256!==dependencyDigest(q))throw Error('REVISION_PLAN_REQUEST_CONFLICT');return {...prior.result,replayed:true,current:await engineering.run({action:'status',jobId:q.draft.jobId})};}
 const base=await current(q.draft.jobId),delegate={action:'revise_space_scope',jobId:q.draft.jobId,requestId:q.requestId,expectedRevision:d.request.expectedRevision,expectedInputSHA256:d.request.expectedInputSHA256,project:d.project,decisions:d.decisions,reason:d.request.sourceEvidence.reason};
 // Only the existing source-revision journal may resume this exact apply.
 const journalFile=path.join(dir,'space-scope-update-'+q.requestId+'.json'),journal=await read(journalFile).catch(e=>{if(e.code!=='ENOENT')throw e;});if((base.state.revision!==delegate.expectedRevision||base.state.inputSHA256!==delegate.expectedInputSHA256.toLowerCase())&&!journal)throw Error('REVISION_PLAN_BASE_CHANGED');
 const applied=await engineering.run(delegate);if(!applied.ok)return applied;const proof=await read(journalFile);if(proof.payloadSHA256!==engineeringDigest(delegate)||proof.status!=='committed')throw Error('REVISION_PLAN_APPLY_UNCONFIRMED');const result={ok:true,draft:q.draft,requestId:q.requestId,revision:proof.nextState.revision,inputSHA256:proof.nextState.inputSHA256,status:proof.nextState.status,rooms:proof.nextInput.rooms.length,professionalApproval:false};await fs.writeFile(receipt,JSON.stringify({schemaVersion:1,requestSHA256:dependencyDigest(q),delegateSHA256:proof.payloadSHA256,result},null,2)+'\n',{flag:'wx'});return {...result,current:applied};
 }
 return {run};
}
