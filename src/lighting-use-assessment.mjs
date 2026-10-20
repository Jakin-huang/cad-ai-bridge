// A fixed shared lighting layout is checked against every explicitly declared
// use. This is not mode switching, dimming, or professional applicability approval.
export const sharedUseMethod='shared_layout_all_uses_same_conditions';
export function declaredRoomUses(room){return [...new Set([room.use,...(room.secondaryUseAssessments||[]).map(a=>a.use)])];}
export function requestedLightingUses(room){return [{labelId:room.id,relationship:'primary_use',use:room.use,workplaneM:room.workplaneM,classification:room.standardSpace,sourceIds:room.sourceIds,description:'Primary declared room use'},...(room.secondaryUseAssessments||[]).map(a=>({labelId:a.labelId,relationship:'secondary_use',use:a.use,workplaneM:a.workplaneM,classification:a.standardSpace,sourceIds:a.sourceIds,description:a.description,status:a.status,method:a.method}))];}
export function sharedUseInputIssues(input){
 const issues=[],add=(code,message,refs)=>issues.push({code,severity:'blocking',message,refs});
 for(const room of input.rooms){const labels=(room.sourceSpaceLabels||[]).filter(l=>l.relationship==='secondary_use'),assessments=room.secondaryUseAssessments||[];
  for(const label of labels)if(assessments.filter(a=>a.labelId===label.id).length!==1)add('SECONDARY_SPACE_USE_UNSUPPORTED','Physical space '+room.id+' needs exactly one explicit functional assessment for '+label.name,[room.id,label.id]);
  for(const a of assessments){
   if(!labels.some(l=>l.id===a.labelId))add('MULTI_USE_LABEL_REFERENCE_INVALID','Assessment must identify an additional source label declared as secondary_use',[room.id,a.labelId]);
   if(['clinical','unknown'].includes(a.use))add('MULTI_USE_REQUIRES_SPECIALIST','Unsupported clinical/unknown secondary use is not an ordinary-lighting assessment',[room.id,a.labelId]);
   if(!a.sourceIds.some(id=>input.sources.some(s=>s.id===id&&['brief','review_instruction'].includes(s.role))))add('MULTI_USE_FUNCTION_SOURCE_REQUIRED','Use interpretation needs an explicit project brief or review-instruction source; architectural text alone does not establish the function',[room.id,a.labelId]);
   if(Math.abs(a.workplaneM-room.workplaneM)>1e-6)add('MULTI_USE_WORKPLANE_CONFLICT','This method requires the same declared workplane for every use; multiple planes need separate assessments',[room.id,a.labelId]);
  }
  if(assessments.length&&(!input.lightingStandards||!input.photometricDesign||!input.lightingEnvironment||!input.glareAssessment))add('MULTI_USE_FULL_QUALITY_REQUIRED','Shared-use design requires source-bound classes, finite diffuse conditions and an explicitly requested UGR assessment',[room.id]);
 }
 return issues;
}
const limits=['minimumLux','minimumUniformity','maximumUgr','minimumRa','workplaneM','maximumLpd'];
export function intersectUseRules(rules){
 return {minimumLux:Math.max(...rules.map(r=>r.minimumLux)),minimumUniformity:Math.max(...rules.map(r=>r.minimumUniformity)),maximumUgr:rules.every(r=>Number.isFinite(r.maximumUgr))?Math.min(...rules.map(r=>r.maximumUgr)):null,minimumRa:Math.max(...rules.map(r=>r.minimumRa)),workplaneM:rules[0].workplaneM,maximumLpd:Math.min(...rules.map(r=>r.maximumLpd))};
}
const descriptor=d=>JSON.stringify({labelId:d.labelId,relationship:d.relationship,use:d.use,workplaneM:d.workplaneM,classification:d.classification?{classId:d.classification.classId,classification:d.classification.classification,reason:d.classification.reason,sourceIds:[...d.classification.sourceIds].sort()}:null,sourceIds:[...d.sourceIds].sort(),description:d.description,status:d.status,method:d.method});
export function auditSharedUseBasis(room,basis){
 if(!(room.secondaryUseAssessments?.length))return !(room.sourceSpaceLabels||[]).some(l=>l.relationship==='secondary_use');
 try{
  const expected=requestedLightingUses(room),records=basis?.useAssessments;if(basis?.aggregation!==sharedUseMethod||!Array.isArray(records)||records.length!==expected.length||new Set(records.map(r=>r.labelId)).size!==expected.length)return false;
  if(expected.some(e=>{const r=records.find(r=>r.labelId===e.labelId);return !r||descriptor(r)!==descriptor(e)||r.rule.id!==e.classification?.classId||!r.rule.allowedUses.includes(e.use)||Math.abs(r.rule.workplaneM-e.workplaneM)>1e-6||Math.abs(e.workplaneM-room.workplaneM)>1e-6;}))return false;
  const rules=expected.map(e=>records.find(r=>r.labelId===e.labelId).rule),intersection=intersectUseRules(rules),tableIds=[...new Set(rules.flatMap(r=>r.tableIds))].sort();
  return basis.id===rules[0].id&&limits.every(k=>basis[k]===intersection[k])&&JSON.stringify([...basis.tableIds].sort())===JSON.stringify(tableIds)&&JSON.stringify(basis.useClassIds)===JSON.stringify(rules.map(r=>r.id))&&tableIds.every(id=>basis.tableEvidence.some(t=>t.id===id));
 }catch{return false;}
}
