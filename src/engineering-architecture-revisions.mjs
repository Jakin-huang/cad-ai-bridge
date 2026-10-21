import {z} from 'zod';
import {architecturalPackRef} from './architectural-contracts.mjs';
import {conditionBundles,sourceValueDigest} from './engineering-source-revisions.mjs';
import {sourceSpaceLabels} from './space-labels.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),sha=z.string().regex(/^[a-f0-9]{64}$/i);
export const architecturalChangesSchema=z.array(z.strictObject({changeId:z.uuid(),priorRevision:z.number().int().nonnegative(),priorInputSHA256:sha,sourceId:id,supersededSourceId:id,pack:architecturalPackRef,rooms:z.array(z.strictObject({roomId:id,fromConditionSHA256:sha,toConditionSHA256:sha,boundaryChanged:z.boolean(),entriesChanged:z.boolean()})).min(1).max(100)})).min(1).max(100);
const same=(a,b)=>sourceValueDigest(a)===sourceValueDigest(b);
const references=v=>!v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(references):Object.entries(v).flatMap(([k,x])=>k==='sourceId'?[x]:k==='sourceIds'?x:references(x));
const labels=r=>(r.sourceSpaceLabels||[]).map(l=>({id:l.id,name:l.name,relationship:l.relationship}));
export function replaceProjectArchitecture(input,pack,{changeId,priorRevision,priorInputSHA256,supersededSourceId,packRef,description}){
 const p=structuredClone(input),old=p.sources.find(s=>s.id===supersededSourceId);
 if(old?.role!=='architecture'||old.supersededBy)throw Error('ARCHITECTURE_SOURCE_NOT_CURRENT');
 if(p.sources.some(s=>s.id===pack.sourceId)||old.sha256.toLowerCase()===pack.sourceSHA256)throw Error('ARCHITECTURE_SOURCE_ID_OR_CONTENT_UNCHANGED');
 if(!pack.coverage.geometryComplete||pack.rooms.some(r=>!r.entries?.length))throw Error('ARCHITECTURE_REVISION_REQUIRES_OBSERVED_BOUNDARIES_AND_ENTRIES');
 if(p.rooms.length!==pack.rooms.length||p.rooms.some(r=>!pack.rooms.some(n=>n.id===r.id&&n.name===r.name)))throw Error('ARCHITECTURE_REVISION_SCHEDULE_CHANGE_UNSUPPORTED');
 const dependent=[...p.requirements,...p.standards,...p.luminaires,p.electrical,p.lightingEnvironment,p.glareAssessment,...p.rooms.flatMap(r=>[r.standardSpace,...(r.secondaryUseAssessments||[])])];
 if(references(dependent).includes(old.id))throw Error('ARCHITECTURE_NON_GEOMETRIC_DEPENDENCY_REQUIRES_NEW_AUTHORITY');
 const before=conditionBundles(p),changes=[];
 for(const r of p.rooms){const n=pack.rooms.find(n=>n.id===r.id),additional=sourceSpaceLabels(n,pack.sourceId);
  if(!same(labels(r),additional.map(l=>({id:l.id,name:l.name,relationship:l.relationship}))))throw Error('ARCHITECTURE_REVISION_USE_LABEL_CHANGE_UNSUPPORTED');
  const boundaryChanged=!same(r.polygon,n.polygon),entriesChanged=!same(r.doors,n.entries.map(e=>e.position));
  r.polygon=structuredClone(n.polygon);r.doors=n.entries.map(e=>[...e.position]);r.geometryStatus='issued';r.sourceIds=[...new Set([...r.sourceIds.filter(s=>s!==old.id),pack.sourceId])];
  if(additional.length)r.sourceSpaceLabels=additional;else delete r.sourceSpaceLabels;
  changes.push({roomId:r.id,fromConditionSHA256:before.find(b=>b.key==='room:'+r.id).valueSHA256,toConditionSHA256:conditionBundles(p).find(b=>b.key==='room:'+r.id).valueSHA256,boundaryChanged,entriesChanged});
 }
 p.architecture=structuredClone(pack.architecture);old.supersededBy=pack.sourceId;
 p.sources.push({id:pack.sourceId,role:'architecture',sha256:pack.sourceSHA256,description,derivedFromFinalDrawing:pack.sourceOrigin!=='declared_architecture',supersedes:old.id});
 const change={changeId,priorRevision,priorInputSHA256,sourceId:pack.sourceId,supersededSourceId:old.id,pack:structuredClone(packRef),rooms:changes};
 p.architecturalChanges=[...(p.architecturalChanges||[]),change];
 // Keep every old warning; source anchor positions do not certify entry semantics.
 const existing=new Set(p.missingInputs.map(m=>m.id));for(const [i,issue]of pack.issues.filter(i=>i.severity==='review').entries()){let noteId='ARCH_CHANGE_'+(p.architecturalChanges.length)+'_'+i;if(existing.has(noteId))throw Error('ARCHITECTURE_REVIEW_NOTE_ID_CONFLICT');existing.add(noteId);p.missingInputs.push({id:noteId,description:issue.message,severity:'review',sourceIds:[pack.sourceId]});}
 return {input:p,change,impact:{changedBoundaries:changes.filter(r=>r.boundaryChanged).map(r=>r.roomId),changedEntries:changes.filter(r=>r.entriesChanged).map(r=>r.roomId),recomputedScope:p.rooms.map(r=>r.id),scope:'Entire declared scope is invalidated; boundaries and declared entry anchors replaced, other frozen conditions unchanged; no selective native edit or architectural approval'}};
}

export function architecturalRevisionIssues(p){
 const issues=[],add=(code,message,refs=[])=>issues.push({code,severity:'blocking',message,refs}),changes=p.architecturalChanges||[];
 if(!changes.length)return issues;
 const bundles=conditionBundles(p),latest=changes.at(-1),source=p.sources.find(s=>s.id===latest.sourceId);
 if(source?.role!=='architecture'||source.supersededBy||source.supersedes!==latest.supersededSourceId)add('ARCHITECTURE_REVISION_SOURCE_INVALID','Latest architectural revision must be active in the source chain');
 const seen=new Set();for(const c of changes){if(seen.has(c.changeId))add('ARCHITECTURE_REVISION_DUPLICATE','Repeated architecture change identity');seen.add(c.changeId);if(new Set(c.rooms.map(r=>r.roomId)).size!==p.rooms.length||c.rooms.length!==p.rooms.length)add('ARCHITECTURE_REVISION_ROOM_COVERAGE','Every room must be represented exactly once');const s=p.sources.find(s=>s.id===c.sourceId);if(s?.role!=='architecture'||s.supersedes!==c.supersededSourceId)add('ARCHITECTURE_REVISION_CHAIN_INVALID','Architecture change and source chain disagree');}
 for(const room of p.rooms){let prior;for(const c of changes){const r=c.rooms.find(r=>r.roomId===room.id);if(!r){add('ARCHITECTURE_REVISION_ROOM_MISSING','Missing room in architecture change',[room.id]);continue;}if(prior&&prior!==r.fromConditionSHA256)add('ARCHITECTURE_REVISION_VALUE_CHAIN','Room change chain is broken',[room.id]);prior=r.toConditionSHA256;}if(prior!==bundles.find(b=>b.key==='room:'+room.id)?.valueSHA256)add('ARCHITECTURE_REVISION_VALUE_CHANGED','Room geometry/retained dimensions differ from the recorded source revision',[room.id]);}
 return issues;
}
