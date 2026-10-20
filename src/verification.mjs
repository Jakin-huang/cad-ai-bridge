// Verification is evidence, not an alias for successful execution. A legacy
// result without explicit proofs remains unknown even when result.ok is true.
export const verificationStates=Object.freeze(['passed','partial','failed','unknown','not_applicable']);
export function verificationReport({write=false,execution,source,saved,reopened,geometry,preservation,render,delivery,visualRequested=false}={}){
 const levels={};
 const add=(name,fact,required,scope)=>{
  const status=fact?.status??'unknown';
  if(!verificationStates.includes(status))throw Error('INVALID_VERIFICATION_STATUS: '+status);
  levels[name]={status,required,scope,...fact};
 };
 const na={status:'not_applicable'};
 add('execution',execution,true,'Requested operations, independently of later verification or export failure');
 add('source',source,true,'Original file identity at capture and completion; external changes are reported without attributing their cause');
 add('saved',write?saved:na,write,'Saved DWG bytes match the recorded SHA-256');
 add('reopened',write?reopened:na,write,'Independent CAD capture reads the exact saved DWG SHA-256');
 add('geometry',write?geometry:na,write,'Implemented operation-specific postconditions; pending checks prevent complete verification');
 add('preservation',write?preservation:na,write,'Unselected DXF ENTITIES/BLOCKS records; tables, dictionaries and opaque vendor internals are outside this proof');
 add('render',render??na,Boolean(render),'Export bytes and declared physical plot checks; not typography or engineering approval');
 add('visualReview',visualRequested?{status:'unknown',reason:'Requires independent visual review; producing an image does not establish readable or compliant output'}:na,false,'Fonts, clipping, legibility and engineering presentation');
 add('delivery',delivery,true,'Requested deliverables exist and their recorded hashes match');
 const required=Object.entries(levels).filter(([,v])=>v.required);
 const requiredSatisfied=required.every(([,v])=>v.status==='passed'||v.status==='not_applicable');
 const status=required.some(([,v])=>v.status==='failed')?'failed':Object.values(levels).some(v=>v.status==='partial'||v.status==='unknown')?'partial':requiredSatisfied?'passed':'unknown';
 return {schemaVersion:1,status,requiredSatisfied,levels,pending:Object.entries(levels).filter(([,v])=>['unknown','partial'].includes(v.status)).map(([level,v])=>({level,required:v.required,reason:v.reason,pending:v.pending})),acceptance:{externalUser:false,freshMachine:false,competitiveSuperiority:false},notProven:['Complete CAD database semantics','External usability and productivity','Competitive superiority']};
}
export function legacyVerification(result){
 return result.verification??{schemaVersion:1,status:'unknown',requiredSatisfied:false,reason:'This record contains no tiered verification proof; execution success is not independent evidence',legacyExecutionOk:result.ok===true};
}
export function compactVerification(value){
 if(!value)return value;
 const pending=(list,max)=>Array.isArray(list)?list.slice(0,max):list;
 return {...value,pending:pending(value.pending,10),pendingCount:value.pending?.length,levels:value.levels?Object.fromEntries(Object.entries(value.levels).map(([key,level])=>[key,{...level,pending:pending(level.pending,10),pendingCount:level.pending?.length}])):undefined};
}
