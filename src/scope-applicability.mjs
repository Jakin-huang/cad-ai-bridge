// Source interpretations are caller supplied. This evaluator checks typed logic;
// it cannot establish the truth or legal authority of an interpreted site fact.
import {z} from 'zod';
import {dependencyDigest as digest} from './task-dependencies.mjs';
import {sourceFactObservationFields,validateSourceFactAgreement} from './source-fact-observations.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const scopeEvidenceSchema=z.array(z.strictObject({documentId:id,quote:z.string().min(5).max(4000).refine(s=>s.trim().length>=5)})).min(1).max(20);
const unit=z.string().min(1).max(40).refine(s=>s.trim()===s);
export const scopeFactSchema=z.strictObject({id,type:z.enum(['boolean','number','text']),value:z.union([z.boolean(),z.number().finite(),z.string().min(1).max(1000),z.null()]),unit:unit.optional(),status:z.enum(['interpreted','assumed','unresolved']),reason:z.string().min(10).max(2000),evidence:scopeEvidenceSchema,...sourceFactObservationFields(scopeEvidenceSchema)}).superRefine((f,ctx)=>{if(f.observations&&Buffer.byteLength(JSON.stringify(f))>160*1024)ctx.addIssue({code:'custom',message:'FACT_OBSERVATION_ITEM_BUDGET: keep the complete fact readable in one bounded evidence page'});});
export const scopeWhenSchema=z.strictObject({mode:z.enum(['all','any']),conditions:z.array(z.strictObject({factId:id,operator:z.enum(['eq','ne','gt','gte','lt','lte']),value:z.union([z.boolean(),z.number().finite(),z.string().min(1).max(1000)]),unit:unit.optional()})).min(1).max(50)});
export const scopeInactiveDependencySchema=z.strictObject({workItemId:id,reason:z.string().min(10).max(2000),evidence:scopeEvidenceSchema});
export function validateScopeConditions(items,facts=[]){
 const byId=new Map(facts.map(f=>[f.id,f]));if(byId.size!==facts.length)throw Error('SCOPE_FACT_ID_DUPLICATE');
 for(const f of facts){
  if(f.status==='unresolved'&&f.value!==null||f.status==='interpreted'&&f.value===null)throw Error('SCOPE_FACT_STATUS_VALUE_MISMATCH');
  if(f.value!==null&&typeof f.value!==({boolean:'boolean',number:'number',text:'string'}[f.type]))throw Error('SCOPE_FACT_TYPE_MISMATCH');
  if(f.type==='number'?!f.unit:!!f.unit)throw Error('SCOPE_FACT_UNIT_REQUIRED_OR_FORBIDDEN');
  validateSourceFactAgreement(f);
 }
 for(const item of items){
  if(item.disposition==='context'&&(item.when||item.allowInactiveDependencies?.length))throw Error('SCOPE_CONTEXT_CANNOT_PLAN_WORK');
  for(const c of item.when?.conditions??[]){
   const fact=byId.get(c.factId);if(!fact)throw Error('SCOPE_CONDITION_FACT_UNKNOWN');
   if(typeof c.value!==({boolean:'boolean',number:'number',text:'string'}[fact.type]))throw Error('SCOPE_CONDITION_TYPE_MISMATCH');
   if(c.unit!==fact.unit)throw Error('SCOPE_CONDITION_UNIT_MISMATCH');
   if(!['eq','ne'].includes(c.operator)&&fact.type!=='number')throw Error('SCOPE_CONDITION_ORDER_REQUIRES_NUMBER');
  }
  const seen=new Set();for(const edge of item.allowInactiveDependencies??[]){
   if(seen.has(edge.workItemId)||!item.dependsOn.includes(edge.workItemId)||!items.find(i=>i.id===edge.workItemId)?.when)throw Error('SCOPE_INACTIVE_DEPENDENCY_INVALID');seen.add(edge.workItemId);
  }
 }
}
export function scopeApplicability(record,item){
 if(!item.when)return {state:'active',conditional:false,conditions:[]};
 const conditions=item.when.conditions.map(c=>{
  const f=record.facts?.find(f=>f.id===c.factId);if(!f)throw Error('SCOPE_CONDITION_FACT_UNKNOWN');
  const agreement=validateSourceFactAgreement(f),extra=agreement?{observationAgreement:agreement}:{};
  if(f.status!=='interpreted'||f.value===null)return {...c,state:'unknown',factStatus:f.status,...extra,reason:'Assumed or unresolved facts do not determine applicability'};
  const a=f.value,b=c.value,matched={eq:()=>a===b,ne:()=>a!==b,gt:()=>a>b,gte:()=>a>=b,lt:()=>a<b,lte:()=>a<=b}[c.operator]();
  return {...c,state:matched?'active':'inactive',factStatus:f.status,...extra};
 });
 const states=conditions.map(c=>c.state),state=item.when.mode==='all'?(states.includes('inactive')?'inactive':states.includes('unknown')?'unknown':'active'):(states.includes('active')?'active':states.includes('unknown')?'unknown':'inactive');
 return {state,conditional:true,mode:item.when.mode,conditions};
}
export function scopeInactivePin(record,parent,item){
 const edge=parent.allowInactiveDependencies?.find(e=>e.workItemId===item.id);
 if(!edge||scopeApplicability(record,item).state!=='inactive')return undefined;
 return {workItemId:item.id,exemption:'inactive',applicabilitySHA256:digest({documents:record.documents,when:item.when,facts:record.facts,edge})};
}
