import crypto from 'node:crypto';
import {z} from 'zod';
import {sharedUseMethod} from './lighting-use-assessment.mjs';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const evidence=z.array(z.strictObject({sourceId:id,quote:z.string().min(5).max(2000)})).min(1).max(10);
const interpretation=z.strictObject({use:z.enum(['office','duty','teaching','corridor','pantry']),classId:id,reason:z.string().min(20).max(1000),evidence});
export const functionalIntakeSchema=z.array(z.strictObject({roomId:id,primary:interpretation.optional(),secondaryUses:z.array(interpretation.extend({labelId:id})).max(20).optional(),unresolved:z.array(z.strictObject({labelId:id,reason:z.string().min(20).max(1000),evidence})).max(20).optional()})).min(1).max(100).superRefine((records,ctx)=>{
 if(new Set(records.map(r=>r.roomId)).size!==records.length)ctx.addIssue({code:'custom',message:'Duplicate functional-intake room'});
 for(const r of records){const labels=[...(r.primary?[r.roomId]:[]),...(r.secondaryUses||[]).map(a=>a.labelId),...(r.unresolved||[]).map(a=>a.labelId)];if(!labels.length||new Set(labels).size!==labels.length)ctx.addIssue({code:'custom',message:'Empty, duplicate or both resolved/unresolved function '+r.roomId});}
});
const sourceIds=a=>[...new Set(a.evidence.map(e=>e.sourceId))];
const classification=a=>({classId:a.classId,classification:'interpreted',sourceIds:sourceIds(a),reason:a.reason});
const secondary=(room,a)=>({labelId:a.labelId,use:a.use,workplaneM:room.workplaneM,standardSpace:classification(a),method:sharedUseMethod,sourceIds:sourceIds(a),status:'interpreted',description:a.reason});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function functionalIntakeIssues(input){
 const issues=[],add=(code,message,refs)=>issues.push({code,severity:'blocking',message,refs});
 if(input.functionalIntake?.some(r=>r.primary||r.secondaryUses?.length)&&!input.lightingStandards)add('FUNCTIONAL_STANDARD_PROFILE_REQUIRED','Resolved function classes need an explicitly bound lighting rule profile',[]);
 for(const record of input.functionalIntake||[]){
  const room=input.rooms.find(r=>r.id===record.roomId);if(!room){add('FUNCTIONAL_ROOM_UNKNOWN','Functional interpretation identifies an unknown room',[record.roomId]);continue;}
  for(const a of [...(record.primary?[{...record.primary,labelId:room.id}]:[]),...(record.secondaryUses||[]),...(record.unresolved||[])]){
   if(a.labelId!==room.id&&!(room.sourceSpaceLabels||[]).some(l=>l.id===a.labelId&&l.relationship==='secondary_use'))add('FUNCTIONAL_LABEL_UNKNOWN','Only a primary room or a retained secondary-use label can be interpreted',[room.id,a.labelId]);
   for(const e of a.evidence){const source=input.sources.find(s=>s.id===e.sourceId),sha=crypto.createHash('sha256').update(input.brief,'utf8').digest('hex');if(source?.role!=='brief'||source.supersededBy||source.sha256.toLowerCase()!==sha||!input.brief.includes(e.quote))add('FUNCTIONAL_TEXT_EVIDENCE_INVALID','Quote must occur literally in the unchanged UTF-8 project brief with its registered source SHA; it does not certify semantic correctness',[room.id,a.labelId,e.sourceId]);}
  }
  if(record.primary&&(room.use!==record.primary.use||!same(room.standardSpace,classification(record.primary))))add('FUNCTIONAL_PRIMARY_MISMATCH','Persisted primary interpretation differs from the applied room use/classification',[room.id]);
  for(const a of record.secondaryUses||[])if(!same(room.secondaryUseAssessments?.find(x=>x.labelId===a.labelId),secondary(room,a)))add('FUNCTIONAL_SECONDARY_MISMATCH','Persisted secondary interpretation differs from the applied assessment',[room.id,a.labelId]);
  for(const a of record.unresolved||[])add('FUNCTIONAL_INTAKE_UNRESOLVED',a.reason,[room.id,a.labelId]);
 }
 return issues;
}

// Only explicitly empty functional slots are editable. Geometry, sources,
// products, workplanes, observations, limits and existing classifications stay.
export function applyFunctionalIntake(seed,raw){
 if(raw===undefined)return seed;
 const records=functionalIntakeSchema.parse(raw);if(seed.functionalIntake)throw Error('FUNCTIONAL_INTAKE_ALREADY_BOUND');
 const next=structuredClone(seed);next.functionalIntake=records;
 for(const record of records){
  const room=next.rooms.find(r=>r.id===record.roomId);if(!room)throw Error('FUNCTIONAL_ROOM_UNKNOWN');
  if(record.primary){if(room.use!=='unknown'||room.standardSpace)throw Error('FUNCTIONAL_PRIMARY_ALREADY_BOUND');room.use=record.primary.use;room.standardSpace=classification(record.primary);}
  for(const a of record.secondaryUses||[]){if(!(room.sourceSpaceLabels||[]).some(l=>l.id===a.labelId&&l.relationship==='secondary_use'))throw Error('FUNCTIONAL_LABEL_UNKNOWN');if(room.secondaryUseAssessments?.some(x=>x.labelId===a.labelId))throw Error('FUNCTIONAL_SECONDARY_ALREADY_BOUND');room.secondaryUseAssessments=[...(room.secondaryUseAssessments||[]),secondary(room,a)];}
  for(const a of record.unresolved||[]){if(a.labelId===room.id?(room.use!=='unknown'||room.standardSpace):room.secondaryUseAssessments?.some(x=>x.labelId===a.labelId))throw Error('FUNCTIONAL_UNRESOLVED_ALREADY_BOUND');}
 }
 const invalid=functionalIntakeIssues(next).filter(i=>i.code!=='FUNCTIONAL_INTAKE_UNRESOLVED');if(invalid.length)throw Error(invalid[0].code+': '+invalid[0].message);
 return next;
}
