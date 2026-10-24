// Typed agreement of caller-interpreted source statements. This does not read
// prose semantically or establish document authority, site truth or approval.
import {z} from 'zod';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const value=z.union([z.boolean(),z.number().finite(),z.string().min(1).max(1000),z.null()]);
const unit=z.string().min(1).max(40).refine(s=>s.trim()===s);
const reason=z.string().min(10).max(2000);
export function sourceFactObservationFields(evidence){
 return {
  observations:z.array(z.strictObject({id,value,unit:unit.optional(),status:z.enum(['interpreted','assumed','unresolved']),reason,evidence})).min(1).max(10).optional(),
  resolution:z.strictObject({selectedObservationIds:z.array(id).min(1).max(10),reason,evidence}).optional()
 };
}

export function sourceFactAgreement(fact){
 const observations=fact.observations;
 if(!observations){if(fact.resolution)throw Error('FACT_RESOLUTION_REQUIRES_OBSERVATIONS');return undefined;}
 if(!observations.length||new Set(observations.map(o=>o.id)).size!==observations.length)throw Error('FACT_OBSERVATION_ID_DUPLICATE_OR_EMPTY');
 for(const o of observations){
  if(o.status==='unresolved'&&o.value!==null||o.status==='interpreted'&&o.value===null)throw Error('FACT_OBSERVATION_STATUS_VALUE_MISMATCH');
  if(o.value!==null&&typeof o.value!==({boolean:'boolean',number:'number',text:'string'}[fact.type]))throw Error('FACT_OBSERVATION_TYPE_MISMATCH');
  if(o.unit!==fact.unit)throw Error('FACT_OBSERVATION_UNIT_MISMATCH');
 }
 let selected=observations;
 if(fact.resolution){
  const ids=fact.resolution.selectedObservationIds;
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!observations.some(o=>o.id===id)))throw Error('FACT_RESOLUTION_SELECTION_INVALID');
  selected=observations.filter(o=>ids.includes(o.id));
  if(selected.some(o=>o.status!=='interpreted'||o.value===null)||new Set(selected.map(o=>JSON.stringify(o.value))).size!==1)throw Error('FACT_RESOLUTION_SELECTION_NOT_CONFIRMED');
 }
 const known=selected.filter(o=>o.value!==null),distinct=new Set(known.map(o=>JSON.stringify(o.value)));
 let state,status,resolvedValue;
 if(fact.resolution){state='resolved';status='interpreted';resolvedValue=selected[0].value;}
 else if(distinct.size>1){state='conflict';status='unresolved';resolvedValue=null;}
 else if(selected.some(o=>o.status==='unresolved'||o.value===null)){state='unresolved';status='unresolved';resolvedValue=null;}
 else if(selected.some(o=>o.status==='assumed')){state='assumed';status='assumed';resolvedValue=selected[0].value;}
 else{state='unanimous';status='interpreted';resolvedValue=selected[0].value;}
 return {state,status,value:resolvedValue,observationCount:observations.length,selectedObservationIds:selected.map(o=>o.id),excludedObservationIds:observations.filter(o=>!selected.includes(o)).map(o=>o.id),authorityVerified:false,semanticCoverageAccepted:false,professionalApproval:false};
}

export function validateSourceFactAgreement(fact){
 const agreement=sourceFactAgreement(fact);
 if(agreement&&(agreement.status!==fact.status||agreement.value!==fact.value))throw Error('FACT_OBSERVATION_AGGREGATE_MISMATCH: '+fact.id);
 return agreement;
}
