import crypto from 'node:crypto';
import {dependencyDigest} from './task-dependencies.mjs';
import {loadPlanningHandoff} from './space-planning-handoff.mjs';
import {verifyLightingSpaceProgram} from './lighting-space-program.mjs';
import {spaceScopeReplacement,spaceScopeConditions,spaceScopeDelta,verifySpaceScopeDecisions} from './space-scope-decisions.mjs';
const same=(a,b)=>dependencyDigest(a??null)===dependencyDigest(b??null),textSHA=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const history=['spaceProgramChanges','architecturalChanges','briefRevision','sourceCarryForwards'];
function noAssumptionUpgrade(a,b,at){
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return;
 if(a.status==='assumed'&&b.status!==undefined&&b.status!=='assumed'||a.classification==='assumed'&&b.classification!==undefined&&b.classification!=='assumed')throw Error('SPACE_REVISION_ASSUMPTION_UPGRADE: '+at);
 if(Array.isArray(a)&&Array.isArray(b)){for(const x of a){const id=x?.id??x?.roomId;if(id!==undefined)noAssumptionUpgrade(x,b.find(y=>(y?.id??y?.roomId)===id),at+'/'+id);}return;}
 for(const k of Object.keys(a))if(!['sources',...history].includes(k))noAssumptionUpgrade(a[k],b[k],at+'/'+k);
}
function checkSources(before,after,binding){
 const oldBriefs=before.sources.filter(s=>s.role==='brief'&&!s.supersededBy&&s.sha256.toLowerCase()===textSHA(before.brief));if(oldBriefs.length!==1)throw Error('SPACE_REVISION_SINGLE_CURRENT_BRIEF_REQUIRED');
 const oldBrief=oldBriefs[0],newBriefs=after.sources.filter(s=>s.role==='brief'&&!s.supersededBy&&s.supersedes===oldBrief.id&&s.sha256.toLowerCase()===textSHA(after.brief));if(newBriefs.length!==1||after.brief===before.brief)throw Error('SPACE_REVISION_NEW_BRIEF_REQUIRED');
 const newBrief=newBriefs[0],oldArchitecture=before.sources.find(s=>s.id===before.spaceProgram.sourceId),newArchitecture=after.sources.find(s=>s.id===binding.sourceId);
 if(!oldArchitecture||oldArchitecture.supersededBy||newArchitecture?.role!=='architecture'||newArchitecture.supersedes!==oldArchitecture.id||newArchitecture.sha256.toLowerCase()!==binding.pack.sha256.toLowerCase())throw Error('SPACE_REVISION_ARCHITECTURE_CHAIN_REQUIRED');
 if(before.sources.some(s=>[newBrief.id,newArchitecture.id].includes(s.id)))throw Error('SPACE_REVISION_NEW_SOURCE_IDS_REQUIRED');
 for(const source of before.sources){const next=after.sources.find(s=>s.id===source.id),expected=source.id===oldBrief.id?{...source,supersededBy:newBrief.id}:source.id===oldArchitecture.id?{...source,supersededBy:newArchitecture.id}:source;if(!same(next,expected))throw Error('SPACE_REVISION_SOURCE_HISTORY_CHANGED: '+source.id);}
 if(newBrief.derivedFromFinalDrawing!==oldBrief.derivedFromFinalDrawing)throw Error('SPACE_REVISION_BRIEF_ROLE_DOWNGRADE');
 for(const source of after.sources.filter(s=>!before.sources.some(a=>a.id===s.id))){if([newBrief.id,newArchitecture.id].includes(source.id))continue;if(['architecture','brief'].includes(source.role)||source.supersedes||source.supersededBy)throw Error('SPACE_REVISION_UNRECORDED_SOURCE_AUTHORITY: '+source.id);}
 if(after.sources.filter(s=>s.role==='brief'&&!s.supersededBy).some(s=>s.id!==newBrief.id))throw Error('SPACE_REVISION_AMBIGUOUS_CURRENT_BRIEF');
 return {oldBrief,newBrief};
}
// Callers parse the full project contract before this function. Complete
// conditions are proposed explicitly; geometry is independently bound upstream.
async function prepareRevision(before,project,{runs,requireCurrent=true}={}){
 if(!before.spaceProgram||!project.spaceProgram)throw Error('SPACE_REVISION_SHARED_BINDING_REQUIRED');
 const proposed=structuredClone(project),binding=proposed.spaceProgram,prior=before.spaceProgram;
 if(proposed.projectId!==before.projectId||proposed.discipline!==before.discipline||binding.expectedProjectId!==prior.expectedProjectId||binding.pack.jobId!==prior.pack.jobId)throw Error('SPACE_REVISION_PROJECT_OR_PRODUCER_CHANGED');
 if(binding.pack.revision<prior.pack.revision)throw Error('SPACE_REVISION_UPSTREAM_REVERSED');
 for(const key of history)if(proposed[key]!==undefined&&!same(proposed[key],before[key]))throw Error('SPACE_REVISION_HISTORY_IMPORT_OR_EDIT: '+key);
 const {oldBrief,newBrief}=checkSources(before,proposed,binding);
 const origin=await loadPlanningHandoff(binding.pack,{runs,expectedProjectId:binding.expectedProjectId});if(requireCurrent&&!origin.current)throw Error('SHARED_SOURCE_SUPERSEDED');
 // The quoted decision ledger authorizes this revision, never implicit reuse
 // of old carry-forwards. Old proof objects remain in the prior input file.
 for(const key of history)delete proposed[key];if(before.architecturalChanges)proposed.architecturalChanges=structuredClone(before.architecturalChanges);
 noAssumptionUpgrade(before,proposed,'project');
 // Check the new producer binding before asking for condition dispositions.
 await verifyLightingSpaceProgram(proposed,{runs,requireCurrent});
 return {proposed,binding,prior,oldBrief,newBrief};
}
export async function previewLightingSpaceScope(before,project,options){
 const {proposed,newBrief}=await prepareRevision(before,project,options),a=new Map(spaceScopeConditions(before).map(r=>[r.key,r.value])),b=new Map(spaceScopeConditions(proposed).map(r=>[r.key,r.value]));
 return {proposalSHA256:dependencyDigest(spaceScopeReplacement(proposed)),sourceId:newBrief.id,decisions:spaceScopeDelta(before,proposed).map(r=>({...r,previousValue:a.get(r.key)??null,proposedValue:b.get(r.key)??null,evidenceRequired:true})),scope:'Read-only preview; no decisions, design or new input revision published. Supply explicit reasons and literal new-brief quotes for every decision.',professionalApproval:false};
}
export async function reviseLightingSpaceScope(before,q,options={}){
 const {proposed,binding,prior,oldBrief,newBrief}=await prepareRevision(before,q.project,options),{runs,requireCurrent=true}=options;
 const delta=verifySpaceScopeDecisions(before,proposed,q.decisions,newBrief.id),authority={sourceId:newBrief.id,supersededSourceId:oldBrief.id,previousBriefSHA256:textSHA(before.brief),nextBriefSHA256:textSHA(proposed.brief),replacementSHA256:dependencyDigest(spaceScopeReplacement(proposed)),reason:q.reason,decisions:q.decisions};
 const record={mode:'scope_revision',changeId:q.requestId,priorRevision:q.expectedRevision,priorInputSHA256:q.expectedInputSHA256,sourceId:binding.sourceId,supersededSourceId:prior.sourceId,from:prior,to:binding,authority};
 proposed.spaceProgramChanges=[...(before.spaceProgramChanges??[]),record];
 await verifyLightingSpaceProgram(proposed,{runs,requireCurrent});
 const oldIds=new Set(before.rooms.map(r=>r.id)),newIds=new Set(proposed.rooms.map(r=>r.id)),impact={added:[...newIds].filter(id=>!oldIds.has(id)),removed:[...oldIds].filter(id=>!newIds.has(id)),usesChanged:proposed.rooms.filter(r=>oldIds.has(r.id)&&before.rooms.find(a=>a.id===r.id).use!==r.use).map(r=>({roomId:r.id,from:before.rooms.find(a=>a.id===r.id).use,to:r.use})),conditions:delta,recomputedScope:[...newIds],scope:'Complete explicit brief/space/condition revision; all selected rooms, quality, delivery and review invalidated. Literal quote/digest integrity is not semantic or professional acceptance.'};
 return {input:proposed,impact,record};
}
export async function verifyLightingScopeRevision(before,after,record,{runs}){
 const replay=await reviseLightingSpaceScope(before,{project:spaceScopeReplacement(after),requestId:record.changeId,expectedRevision:record.priorRevision,expectedInputSHA256:record.priorInputSHA256,reason:record.authority.reason,decisions:record.authority.decisions},{runs,requireCurrent:false});
 if(!same(replay.record,record)||!same(replay.input,after))throw Error('SPACE_REVISION_SNAPSHOT_CHANGED');
 return replay.impact;
}
