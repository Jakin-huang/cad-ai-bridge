import crypto from 'node:crypto';
import {z} from 'zod';
import {applyFunctionalIntake,functionalIntakeSchema} from './engineering-functional-intake.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),sha=z.string().regex(/^[a-f0-9]{64}$/i);
export const conditionKey=z.string().regex(/^(project_context|routingConditions|electrical|lightingEnvironment|glareAssessment|room:[A-Za-z][A-Za-z0-9_-]{0,63}|luminaire:[A-Za-z][A-Za-z0-9_-]{0,63}|standard:[A-Za-z][A-Za-z0-9_-]{0,63})$/);
const witness=z.array(z.strictObject({sourceId:id,quote:z.string().min(5).max(2000)})).min(1).max(10);
export const carryForwardSchema=z.strictObject({key:conditionKey,expectedValueSHA256:sha,reason:z.string().min(20).max(1000),evidence:witness});
export const briefRevisionSchema=z.strictObject({changeId:z.uuid(),sourceId:id,supersededSourceId:id,priorInputSHA256:sha,requiredConditionKeys:z.array(conditionKey).min(1).max(300)});
export const carriedConditionsSchema=z.array(carryForwardSchema.extend({changeId:z.uuid(),status:z.literal('interpreted')})).max(300);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const sourceValueDigest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export const briefTextSHA256=text=>crypto.createHash('sha256').update(text,'utf8').digest('hex');
const refs=v=>!v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(refs):Object.entries(v).flatMap(([k,x])=>k==='sourceId'?[x]:k==='sourceIds'?x:refs(x));
const values=v=>!v||typeof v!=='object'?v:Array.isArray(v)?v.map(values):Object.fromEntries(Object.entries(v).filter(([k])=>!['sourceId','sourceIds','status'].includes(k)).map(([k,x])=>[k,values(x)]));
function rebind(v,oldId,newId){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(x=>rebind(x,oldId,newId));return;}const touched=v.sourceId===oldId||v.sourceIds?.includes(oldId);if(v.sourceId===oldId)v.sourceId=newId;if(v.sourceIds)v.sourceIds=[...new Set(v.sourceIds.map(x=>x===oldId?newId:x))];if(touched&&v.status==='documented')v.status='interpreted';for(const [k,x]of Object.entries(v))if(!['sourceId','sourceIds'].includes(k))rebind(x,oldId,newId);}

export function conditionBundles(p){
 const out=[{key:'project_context',value:{projectId:p.projectId,title:p.title,scope:p.scope,designDate:p.designDate,discipline:p.discipline},sourceIds:[],rebind:()=>{}}];
 for(const r of p.rooms)out.push({key:'room:'+r.id,value:{name:r.name,polygon:r.polygon,doors:r.doors,obstacles:r.obstacles,heightM:r.heightM,workplaneM:r.workplaneM,geometryStatus:r.geometryStatus},sourceIds:r.sourceIds,rebind:(a,b)=>{r.sourceIds=[...new Set(r.sourceIds.map(x=>x===a?b:x))];}});
 for(const key of ['electrical','lightingEnvironment','glareAssessment','routingConditions'])if(p[key])out.push({key,value:values(p[key]),sourceIds:refs(p[key]),rebind:(a,b)=>rebind(p[key],a,b)});
 for(const f of p.luminaires)out.push({key:'luminaire:'+f.id,value:values(f),sourceIds:[f.sourceId],rebind:(a,b)=>rebind(f,a,b)});
 for(const s of p.standards)out.push({key:'standard:'+s.id,value:values(s),sourceIds:[s.sourceId],unsupported:true});
 return out.map(b=>({...b,valueSHA256:sourceValueDigest(b.value)}));
}

export function replaceProjectBrief(input,{changeId,sourceId,supersededSourceId,text,location,description,priorInputSHA256}){
 const p=structuredClone(input),old=p.sources.find(s=>s.id===supersededSourceId);if(!old||old.role!=='brief'||old.supersededBy||old.sha256.toLowerCase()!==briefTextSHA256(p.brief))throw Error('BRIEF_SOURCE_NOT_CURRENT');
 if(p.sources.some(s=>s.id===sourceId))throw Error('BRIEF_SOURCE_ID_EXISTS');if(briefTextSHA256(text)===old.sha256.toLowerCase())throw Error('BRIEF_NO_CONTENT_CHANGE');
 const retired=new Set([...p.sources.filter(s=>s.supersededBy).map(s=>s.id),old.id]),bundles=conditionBundles(p).filter(b=>b.key==='project_context'||b.sourceIds.some(id=>retired.has(id))),removedRequirements=p.requirements.filter(r=>r.sourceIds.some(id=>retired.has(id))).map(r=>r.id),invalidatedUses=[];
 p.requirements=p.requirements.filter(r=>!removedRequirements.includes(r.id));
 for(const r of p.rooms){const primary=r.sourceIds.some(id=>retired.has(id))||r.standardSpace?.sourceIds.some(id=>retired.has(id))||(p.functionalIntake||[]).some(f=>f.roomId===r.id&&f.primary),secondary=(r.secondaryUseAssessments||[]).filter(a=>a.sourceIds.some(id=>retired.has(id))||a.standardSpace.sourceIds.some(id=>retired.has(id))).map(a=>a.labelId);if(primary){r.use='unknown';delete r.standardSpace;}if(secondary.length){r.secondaryUseAssessments=r.secondaryUseAssessments.filter(a=>!secondary.includes(a.labelId));if(!r.secondaryUseAssessments.length)delete r.secondaryUseAssessments;}if(primary||secondary.length)invalidatedUses.push({roomId:r.id,primary,secondary});}
 delete p.functionalIntake;delete p.sourceCarryForwards;old.supersededBy=sourceId;p.sources.push({id:sourceId,role:'brief',sha256:briefTextSHA256(text),description,location,derivedFromFinalDrawing:old.derivedFromFinalDrawing,supersedes:old.id});p.brief=text;
 p.briefRevision={changeId,sourceId,supersededSourceId:old.id,priorInputSHA256,requiredConditionKeys:bundles.map(b=>b.key)};
 return {input:p,impact:{removedRequirements,invalidatedUses,requiredConditions:bundles.map(({key,valueSHA256,unsupported})=>({key,valueSHA256,unsupported:!!unsupported})),preservedMissingInputs:p.missingInputs.map(m=>({id:m.id,severity:m.severity,sourceIds:m.sourceIds})),scope:'Dependency-based conservative invalidation; free-text semantic conflicts are not automatically certified'}};
}

export function reconcileProjectBrief(input,{requirements,functionalIntake,carryForwards=[]}){
 const p=structuredClone(input),change=p.briefRevision;if(!change)throw Error('BRIEF_REVISION_REQUIRED');
 if(!requirements.length&&!functionalIntake?.length&&!carryForwards.length)throw Error('BRIEF_RECONCILIATION_EMPTY');
 for(const q of requirements){if(p.requirements.some(r=>r.id===q.id))throw Error('BRIEF_REQUIREMENT_ALREADY_BOUND');if(!q.sourceIds.includes(change.sourceId))throw Error('BRIEF_REQUIREMENT_NEW_SOURCE_REQUIRED');p.requirements.push(q);}
 const bundles=conditionBundles(p),carried=p.sourceCarryForwards||[];
 for(const record of carryForwards){if(record.evidence.some(e=>e.sourceId!==change.sourceId||!p.brief.includes(e.quote)))throw Error('SOURCE_CARRY_EVIDENCE_INVALID');const b=bundles.find(x=>x.key===record.key);if(!change.requiredConditionKeys.includes(record.key)||!b||b.unsupported)throw Error('BRIEF_CONDITION_RECONFIRM_UNSUPPORTED');if(carried.some(c=>c.key===record.key))throw Error('BRIEF_CONDITION_ALREADY_BOUND');if(b.valueSHA256!==record.expectedValueSHA256.toLowerCase())throw Error('BRIEF_CONDITION_VALUE_CHANGED');for(const source of p.sources.filter(s=>s.supersededBy))b.rebind(source.id,change.sourceId);carried.push({...record,changeId:change.changeId,status:'interpreted'});}
 if(carried.length)p.sourceCarryForwards=carried;
 if(functionalIntake?.length){const previous=p.functionalIntake||[];delete p.functionalIntake;const applied=applyFunctionalIntake(p,functionalIntake),merged=new Map(previous.map(r=>[r.roomId,structuredClone(r)]));for(const r of functionalIntake){const old=merged.get(r.roomId)||{roomId:r.roomId},labels=new Set([...(r.primary?[r.roomId]:[]),...(r.secondaryUses||[]).map(a=>a.labelId),...(r.unresolved||[]).map(a=>a.labelId)]);if(r.primary)old.primary=r.primary;old.secondaryUses=[...(old.secondaryUses||[]),...(r.secondaryUses||[])];old.unresolved=[...(old.unresolved||[]).filter(a=>!labels.has(a.labelId)),...(r.unresolved||[])];merged.set(r.roomId,old);}applied.functionalIntake=functionalIntakeSchema.parse([...merged.values()]);return applied;}
 return p;
}

export function carriedConditionMatches(p,key,originalSHA,currentSHA){
 if(originalSHA.toLowerCase()===currentSHA)return true;
 if(!key.startsWith('room:'))return false;
 let sha=originalSHA.toLowerCase();for(const c of p.architecturalChanges||[]){const r=c.rooms.find(r=>r.roomId===key.slice(5));if(r?.fromConditionSHA256===sha)sha=r.toConditionSHA256;}
 return sha===currentSHA;
}

export function sourceRevisionIssues(p){
 const issues=[],add=(code,severity,message,refs=[])=>issues.push({code,severity,message,refs}),retired=new Set(p.sources.filter(s=>s.supersededBy).map(s=>s.id));
 for(const s of p.sources){if((s.supersededBy||s.supersedes)&&!['brief','architecture'].includes(s.role))add('SOURCE_REVISION_ROLE_UNSUPPORTED','blocking','Only task brief and explicitly recorded architecture supersession are supported',[s.id]);if(s.supersededBy&&!p.sources.some(n=>n.id===s.supersededBy&&n.supersedes===s.id)||s.supersedes&&!p.sources.some(o=>o.id===s.supersedes&&o.supersededBy===s.id))add('SOURCE_REVISION_CHAIN_INVALID','blocking','Source supersession links must be reciprocal',[s.id]);if(s.supersededBy&&p.sources.find(n=>n.id===s.supersededBy)?.role!==s.role)add('SOURCE_REVISION_ROLE_MISMATCH','blocking','Source successors must keep the same role',[s.id]);if(s.role==='architecture'&&s.supersedes&&!p.architecturalChanges?.some(c=>c.sourceId===s.id&&c.supersededSourceId===s.supersedes)&&!p.spaceProgramChanges?.some(c=>c.sourceId===s.id&&c.supersededSourceId===s.supersedes))add('ARCHITECTURE_REVISION_RECORD_REQUIRED','blocking','Architectural supersession needs a recorded source-bound geometry revision',[s.id]);const seen=new Set();let cursor=s;while(cursor?.supersededBy){if(seen.has(cursor.id)){add('SOURCE_REVISION_CHAIN_CYCLE','blocking','Source supersession cannot contain a cycle',[s.id]);break;}seen.add(cursor.id);cursor=p.sources.find(x=>x.id===cursor.supersededBy);}}
 const computational=[...p.requirements,...p.rooms,...p.luminaires,...p.standards,p.electrical,p.lightingEnvironment,p.glareAssessment,p.routingConditions];for(const ref of new Set(computational.flatMap(refs).filter(x=>retired.has(x))))add('SUPERSEDED_SOURCE_STILL_USED','blocking','Computational conditions still cite superseded source '+ref,[ref]);
 for(const note of p.missingInputs)if(note.sourceIds.some(x=>retired.has(x)))add('SUPERSEDED_SOURCE_NOTE_REVIEW','review','Retained prior-source note is historical and must not be treated as new task evidence',[note.id]);
 const revision=p.briefRevision,carried=p.sourceCarryForwards||[];if(!revision){if(carried.length)add('SOURCE_CARRY_WITHOUT_REVISION','blocking','Carry-forward evidence needs a source revision');return issues;}
 const source=p.sources.find(s=>s.id===revision.sourceId);if(source?.role!=='brief'||source.supersededBy||source.sha256.toLowerCase()!==briefTextSHA256(p.brief)||source.supersedes!==revision.supersededSourceId)add('BRIEF_REVISION_SOURCE_INVALID','blocking','Current brief must match the active source in the revision chain');
 if(new Set(revision.requiredConditionKeys).size!==revision.requiredConditionKeys.length||new Set(carried.map(c=>c.key)).size!==carried.length)add('SOURCE_CARRY_DUPLICATE','blocking','Every condition is reviewed exactly once');
 const bundles=conditionBundles(p);for(const c of carried){const b=bundles.find(x=>x.key===c.key);if(c.changeId!==revision.changeId||!revision.requiredConditionKeys.includes(c.key)||!b||b.unsupported||!carriedConditionMatches(p,c.key,c.expectedValueSHA256,b.valueSHA256))add('SOURCE_CARRY_VALUE_MISMATCH','blocking','Carried condition no longer matches its frozen value',[c.key]);for(const e of c.evidence)if(e.sourceId!==revision.sourceId||!p.brief.includes(e.quote))add('SOURCE_CARRY_EVIDENCE_INVALID','blocking','Carry decision must quote the active task brief literally',[c.key]);}
 for(const key of revision.requiredConditionKeys)if(!carried.some(c=>c.key===key))add('SOURCE_CONDITION_RECONFIRM_REQUIRED','blocking','New task needs explicit unchanged-condition confirmation or revised authoritative input: '+key,[key]);
 if(carried.length)add('SOURCE_CARRY_APPLICABILITY_REVIEW','review','Carried values remain interpretations; assumed surfaces/product/installation conditions are not upgraded to confirmed facts');
 return issues;
}
