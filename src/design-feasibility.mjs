import crypto from 'node:crypto';
import {dependencyDigest} from './task-dependencies.mjs';

// Necessary conditions only. Call with a schema-parsed input. These optimistic
// bounds deliberately omit tighter layout/code constraints; absence of a
// conflict is never a feasibility, semantic or professional acceptance claim.
const rawDigest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const greater=(a,b)=>a-b>Math.max(1e-7,1e-9*Math.max(Math.abs(a),Math.abs(b)));
const operand=(target,value,sourceIds,status)=>({target,value,valueSHA256:dependencyDigest(value),sourceIds,...(status?{status}:{})});
const rule=(p,room,key)=>{
 const found=p.requirements.map((r,i)=>({r,i})).filter(({r})=>r.rule===key&&r.roomIds.includes(room.id));
 if(!found.length||found.some(({r})=>typeof r.value!=='number'||!Number.isFinite(r.value)||r.value<=0)||new Set(found.map(({r})=>r.value)).size!==1)return null;
 return {value:found[0].r.value,operands:found.map(({r,i})=>operand('requirements/'+i,r.value,r.sourceIds,r.status))};
};
function finish(kind,input,checks){
 const conflicts=checks.filter(c=>c.status==='conflict'),body={schemaVersion:1,kind,inputSHA256:kind==='ordinary-lighting'?rawDigest(input):dependencyDigest(input),status:conflicts.length?'declared_model_conflict':checks.some(c=>c.status==='no_conflict_found')?'no_necessary_conflict_found':'not_evaluated',checks,conflictCount:conflicts.length,readOnly:true,requirementsChanged:false,feasibilityProven:false,globalInfeasibilityProven:false,semanticAcceptance:false,engineeringAcceptance:false,professionalApproval:false,action:'Retain every supplied condition. Review the cited requirements, geometry or products and obtain source-backed changes; do not automatically relax, substitute or repeatedly retry an unchanged certified conflict.'};
 return {...body,reportSHA256:dependencyDigest(body)};
}
export function lightingFeasibility(input){
 if(input.photometricDesign||input.lightingEnvironment||input.glareAssessment)return finish('ordinary-lighting',input,[{id:'flux_power_bound',status:'not_evaluated',reason:'Flux-method bound does not apply to IES point, reflected-light or glare calculations. Existing photometric solvers and quality checks remain required.'}]);
 const checks=input.rooms.map(room=>{
  const target=rule(input,room,'target_lux'),cap=rule(input,room,'max_lpd'),base={id:'flux_power_bound/'+room.id,roomId:room.id,model:'declared_lumen_flux_estimate'};
  if(!target||!cap)return {...base,status:'not_evaluated',reason:'Missing, conflicting or invalid positive numeric target/LPD requirement; resolve input issues first.'};
  // Continuous power allocation across ALL source candidates is an upper bound
  // even for mixed fixtures. Integer counts, use restrictions, standard classes,
  // geometry and spacing can only reduce the attainable flux estimate.
  const candidates=input.luminaires.map((f,i)=>({fixtureId:f.id,maintainedLumensPerWatt:f.lumens*f.utilizationFactor*f.maintenanceFactor/f.watts,operand:operand('luminaires/'+i,{watts:f.watts,lumens:f.lumens,utilizationFactor:f.utilizationFactor,maintenanceFactor:f.maintenanceFactor},[f.sourceId],f.photometry)})),best=Math.max(...candidates.map(c=>c.maintainedLumensPerWatt)),upper=cap.value*best;
  if(!candidates.every(c=>Number.isFinite(c.maintainedLumensPerWatt)&&c.maintainedLumensPerWatt>0)||![upper,target.value/best,target.value/cap.value].every(v=>Number.isFinite(v)&&v>0))return {...base,status:'not_evaluated',reason:'Declared factors exceed reliable finite numeric bounds; no infeasibility conclusion.'};
  return {...base,status:greater(target.value,upper)?'conflict':'no_conflict_found',code:'LIGHTING_FLUX_POWER_BOUND',required:{value:target.value,unit:'lx'},optimisticUpperBound:{value:upper,unit:'lx'},gap:{value:Math.max(0,target.value-upper),unit:'lx'},formula:'E_est=sum(W_i * Phi_i/W_i * UF_i * MF_i)/A <= max_LPD * max(Phi_i*UF_i*MF_i/W_i)',operands:[...target.operands,...cap.operands,...candidates.map(c=>c.operand)],candidateEfficacies:candidates.map(({operand,...c})=>c),necessaryThresholds:{minimumLpdAtBestDeclaredEfficacy:{value:target.value/best,unit:'W/m2'},minimumMaintainedEfficacyAtDeclaredLpd:{value:target.value/cap.value,unit:'lm/W'}},scope:'Only the supplied flux-estimate model and declared product factors. All catalog candidates and continuous mixed power are allowed optimistically. No conclusion about actual IES/reflected/daylight illuminance, uniformity, UGR, code applicability or a feasible alternative. Thresholds are necessary bounds, not proposed revisions.'};
 });
 return finish('ordinary-lighting',input,checks);
}
export function planningFeasibility(input){
 const area=(input.shell.rect.max[0]-input.shell.rect.min[0])*(input.shell.rect.max[1]-input.shell.rect.min[1])/1e6,required=input.program.reduce((n,r)=>n+r.minAreaM2,0),windows=input.shell.windows.reduce((n,w)=>n+w.toMm-w.fromMm,0),requiredWindows=input.program.reduce((n,r)=>n+r.minWindowMm,0),unknown=input.shell.status==='unresolved'||input.program.some(r=>r.status==='unresolved');
 const check=(id,code,needed,available,unit,operands,formula,scope)=>({id,code,status:unknown?'not_evaluated':greater(needed,available)?'conflict':'no_conflict_found',...(unknown?{reason:'Shell or program conditions remain unresolved; numeric placeholders cannot establish a conflict.'}:{}),required:{value:needed,unit},optimisticUpperBound:{value:available,unit},gap:{value:Math.max(0,needed-available),unit},operands,formula,scope});
 return finish('office-space-planning',input,[
  check('program_shell_area','PLANNING_PROGRAM_AREA_BOUND',required,area,'m2',[operand('shell/rect',input.shell.rect,input.shell.sourceIds,input.shell.status),...input.program.map((r,i)=>operand('program/'+i+'/minAreaM2',r.minAreaM2,r.sourceIds,r.status))],'sum(minimum room areas) <= full shell rectangle area','Disjoint rooms within the one declared shell/floor. Entire gross rectangle is allowed optimistically; walls, circulation, keepouts, furniture and grid losses are not subtracted. No room layout or code compliance is proven.'),
  check('program_source_windows','PLANNING_WINDOW_FRONTAGE_BOUND',requiredWindows,windows,'mm',[operand('shell/windows',input.shell.windows,input.shell.sourceIds,input.shell.status),...input.program.map((r,i)=>operand('program/'+i+'/minWindowMm',r.minWindowMm,r.sourceIds,r.status))],'sum(minimum room window contact) <= sum(non-overlapping source facade window lengths)','Disjoint rectangular bays cannot share the same source window interval. All four facade sides are allowed optimistically even if the installed corridor family cannot reach them. No daylight or window-code acceptance is proven.')
 ]);
}
export function feasibilityIssues(report){return report.checks.filter(c=>c.status==='conflict').map(c=>({code:c.code,severity:'blocking',message:'Necessary declared-model constraint conflict; '+c.required.value+' '+c.required.unit+' required exceeds optimistic '+c.optimisticUpperBound.value+' '+c.optimisticUpperBound.unit,refs:c.operands.map(o=>o.target),diagnosticId:c.id,reportSHA256:report.reportSHA256}));}
