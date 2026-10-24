import {z} from 'zod';import {scopeWhenSchema,validateScopeConditions,scopeApplicability} from './scope-applicability.mjs';import {dependencyDigest as digest} from './task-dependencies.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const standardFactDefinitionSchema=z.strictObject({id,type:z.enum(['boolean','number','text']),unit:z.string().min(1).max(40).refine(s=>s.trim()===s).optional(),description:z.string().min(10).max(1000)});
export {scopeWhenSchema as standardWhenSchema};
export function validateStandardConditions(classes,definitions=[]){validateScopeConditions(classes,definitions.map(d=>({...d,value:null,status:'unresolved'})));}
export function standardCondition(rule,definitions,context){
 if(!rule.when)return {state:'active',conditional:false,conditions:[]};
 const ids=new Set(rule.when.conditions.map(c=>c.factId)),facts=definitions.filter(d=>ids.has(d.id)).map(d=>context?.facts.find(f=>f.id===d.id)??{...d,value:null,status:'unresolved'});
 try{validateScopeConditions([{when:rule.when}],facts);for(const f of facts){const d=definitions.find(d=>d.id===f.id);if(f.type!==d.type||f.unit!==d.unit)throw Error('STANDARD_FACT_DEFINITION_MISMATCH');}return scopeApplicability({facts},{when:rule.when});}catch(error){return {state:'unknown',conditional:true,conditions:[],invalidFact:true,reason:error.message};}
}
export function auditStandardConditions(basis){
 if(!basis?.conditionalBasis)return !(basis?.conditionDecisions?.length||basis?.rooms?.some(r=>r.when||r.useAssessments?.some(u=>u.rule.when)));
 try{const {context,definitions}=basis.conditionalBasis;if(context.state==='scope_bound'){const {factsSHA256,...body}=context;if(digest(body)!==factsSHA256)return false;}else return false;
  const expected=[];for(const room of basis.rooms){const uses=room.useAssessments??[{labelId:room.roomId,rule:room}];for(const u of uses)if(u.rule.when)expected.push({roomId:room.roomId,labelId:u.labelId,classId:u.rule.id,when:u.rule.when});}
  if(expected.length!==basis.conditionDecisions.length)return false;return expected.every(e=>{const matches=basis.conditionDecisions.filter(d=>d.roomId===e.roomId&&d.labelId===e.labelId&&d.classId===e.classId);if(matches.length!==1)return false;const {roomId,labelId,classId,when,...actual}=matches[0],computed=standardCondition({when},definitions,context);return digest(when)===digest(e.when)&&computed.state==='active'&&digest(computed)===digest(actual);});
 }catch{return false;}
}
export function standardApplicabilitySummary(basis){
 if(!basis?.conditionalBasis)return undefined;const {context}=basis.conditionalBasis,decisions=basis.conditionDecisions??[];
 return {profileId:basis.profileId,profileSHA256:basis.profileSHA256,context:{state:context.state,scope:context.scope,documents:context.documents,factsSHA256:context.factsSHA256},counts:Object.fromEntries(['active','inactive','unknown'].map(state=>[state,decisions.filter(d=>d.state===state).length])),totalDecisions:decisions.length,decisions:decisions.slice(0,10).map(d=>({roomId:d.roomId,labelId:d.labelId,classId:d.classId,state:d.state,invalidFact:d.invalidFact??false,factIds:[...new Set(d.when.conditions.map(c=>c.factId))]})),decisionsTruncated:decisions.length>10,details:{action:'data',section:'standard_conditions',requiresTaskIdentity:true},professionalApproval:false,semanticCoverageAccepted:false};
}
