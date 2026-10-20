import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {dataHome} from './local-paths.mjs';
import {hashFile} from './drawings.mjs';
import {requestedLightingUses,intersectUseRules,sharedUseMethod} from './lighting-use-assessment.mjs';
const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),sha=z.string().regex(/^[a-f0-9]{64}$/i),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uses=z.array(z.enum(['office','duty','teaching','corridor','pantry','clinical','unknown'])).min(1).max(7);
const witness=z.strictObject({id,sourceId:id,locator:z.string().min(1).max(150),pdfPage:z.number().int().positive(),pixelSHA256:sha,transcriptionMethod:z.literal('visual_transcription_cross_checked'),reviewer:z.string().min(1).max(150),crossCheckFile:z.string().min(1).max(2000),crossCheckSHA256:sha});
export const lightingRuleProfileSchema=z.strictObject({schemaVersion:z.literal(1),id,createdAt:z.string(),manifestSHA256:sha,sourceScope:z.literal('inspected_edition_subset_not_professional_applicability'),sources:z.array(z.strictObject({id,code:z.string().min(1).max(128),edition:z.string().min(1).max(100),effectiveFrom:day,effectiveUntil:day.optional(),file:z.string().min(1).max(2000),sha256:sha,url:z.string().min(1).max(2000),publicationStatus:z.enum(['mandatory_code','design_standard']),noticePdfPage:z.number().int().positive(),noticePixelSHA256:sha})).min(1).max(20),tables:z.array(witness).min(1).max(100),classes:z.array(z.strictObject({id,label:z.string().min(1).max(150),allowedUses:uses,tableIds:z.array(id).min(2).max(10),minimumLux:z.number().positive().max(10000),minimumUniformity:z.number().positive().max(1),maximumUgr:z.number().positive().max(100).nullable(),minimumRa:z.number().min(0).max(100),workplaneM:z.number().min(0).max(2),maximumLpd:z.number().positive().max(100),recommendedLpdTarget:z.number().positive().max(100).optional(),lpdBasis:z.literal('mandatory_current_unadjusted_base'),classificationNote:z.string().min(1).max(1000)})).min(1).max(100),professionalApproval:z.literal(false)}).superRefine((p,ctx)=>{
 for(const [name,list]of [['source',p.sources],['table',p.tables],['class',p.classes]])if(new Set(list.map(x=>x.id)).size!==list.length)ctx.addIssue({code:'custom',message:'Duplicate '+name});
 for(const table of p.tables)if(!p.sources.some(s=>s.id===table.sourceId))ctx.addIssue({code:'custom',message:'Unknown table source'});
 for(const c of p.classes)if(c.tableIds.some(id=>!p.tables.some(t=>t.id===id)))ctx.addIssue({code:'custom',message:'Unknown class table'});
});
const configured=()=>process.env.CADBRIDGE_ENGINEERING_LIGHTING_RULES||path.join(dataHome(),'engineering-lighting-rules.json');
export async function readLightingRuleProfile({file=configured()}={}){
 if((await fs.stat(file)).size>4*1024*1024)throw Error('LIGHTING_STANDARD_PROFILE_TOO_LARGE');
 const bytes=await fs.readFile(file),profile=lightingRuleProfileSchema.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
 for(const source of profile.sources)if(await hashFile(source.file).catch(()=>null)!==source.sha256.toLowerCase())throw Error('LIGHTING_STANDARD_SOURCE_CHANGED: '+source.id);
 for(const table of profile.tables)if(await hashFile(table.crossCheckFile).catch(()=>null)!==table.crossCheckSHA256.toLowerCase())throw Error('LIGHTING_TABLE_WITNESS_CHANGED: '+table.id);
 return {profile,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
export async function lightingBasisSummary(options){
 let loaded;try{loaded=await readLightingRuleProfile(options);}catch(error){if(error.code==='ENOENT')return {ok:true,configured:false,professionalApproval:false};throw error;}
 const {profile,sha256}=loaded;return {ok:true,configured:true,profileId:profile.id,profileSHA256:sha256,sourceScope:profile.sourceScope,sources:profile.sources.map(({id,code,edition,effectiveFrom,effectiveUntil,sha256,publicationStatus,url})=>({id,code,edition,effectiveFrom,effectiveUntil,sha256,publicationStatus,url})),classes:profile.classes,tables:profile.tables.map(({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod})=>({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod})),scope:'Imported visually inspected standard subset. No source paths or full text. Classification, current legal/project applicability and professional sign-off remain separate.',professionalApproval:false};
}
const normalized=s=>s.toUpperCase().replace(/\s/g,'').replace(/[—–－]/g,'-');
export async function resolveLightingStandards(input,options){
 if(!input.lightingStandards)return undefined;
 let loaded;try{loaded=await readLightingRuleProfile(options);}catch(error){if(error.code==='ENOENT')throw Error('LIGHTING_STANDARD_PROFILE_MISSING');throw error;}
 const {profile,sha256}=loaded;if(profile.id!==input.lightingStandards.profileId||sha256!==input.lightingStandards.expectedProfileSHA256.toLowerCase())throw Error('LIGHTING_STANDARD_PROFILE_CHANGED');
 const issues=[],add=(code,message,refs=[])=>issues.push({code,severity:'blocking',message,refs}),sourceBindings=[];
 for(const source of profile.sources){
  const declared=input.standards.filter(s=>normalized(s.code)===normalized(source.code)&&s.edition===source.edition);
  if(declared.length!==1){add('LIGHTING_STANDARD_DECLARATION_MISSING','Exactly one selected standard edition must be declared: '+source.code);continue;}
  const std=declared[0],document=input.sources.find(s=>s.id===std.sourceId);
  if(document?.role!=='standard'||document.sha256.toLowerCase()!==source.sha256.toLowerCase()||std.effectiveFrom!==source.effectiveFrom||std.effectiveUntil!==source.effectiveUntil)add('LIGHTING_STANDARD_DECLARATION_MISMATCH','Source or implementation dates do not match the imported standard',[std.id]);
  if(input.designDate<source.effectiveFrom||source.effectiveUntil&&input.designDate>=source.effectiveUntil)add('LIGHTING_STANDARD_OUTSIDE_DESIGN_DATE','Selected edition is outside the declared design date',[std.id]);
  sourceBindings.push({id:source.id,standardId:std.id,sourceId:std.sourceId,code:source.code,edition:source.edition,sourceSHA256:source.sha256,effectiveFrom:source.effectiveFrom,effectiveUntil:source.effectiveUntil,publicationStatus:source.publicationStatus,noticePdfPage:source.noticePdfPage,url:source.url});
 }
 const rooms=[];
 for(const room of input.rooms){
  const uses=requestedLightingUses(room),records=[];
  for(const use of uses){const classification=use.classification,rule=profile.classes.find(c=>c.id===classification?.classId),refs=[room.id,...(use.relationship==='secondary_use'?[use.labelId]:[])];
   if(!classification||!rule){add('LIGHTING_SPACE_CLASS_UNRESOLVED','Every declared use requires an explicit source-linked standard class',refs);continue;}
   if(!rule.allowedUses.includes(use.use)){add('LIGHTING_SPACE_CLASS_CONFLICT','Declared use conflicts with the selected standard-space class',[...refs,rule.id]);continue;}
   if(Math.abs(use.workplaneM-rule.workplaneM)>1e-6||Math.abs(room.workplaneM-rule.workplaneM)>1e-6)add('LIGHTING_REFERENCE_PLANE_CONFLICT','The shared room/use workplane differs from selected standard '+rule.workplaneM+'m; no silent plane substitution',[...refs,rule.id]);
   const upper=input.requirements.find(r=>r.rule==='max_avg_lux'&&r.roomIds.includes(room.id));if(upper&&upper.value<rule.minimumLux)add('LIGHTING_STANDARD_LUX_RANGE_CONFLICT','Project upper illuminance bound is below a declared-use standard minimum',[...refs,rule.id]);
   records.push({...use,rule,tableEvidence:profile.tables.filter(t=>rule.tableIds.includes(t.id)).map(({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod})=>({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod}))});
  }
  if(records.length!==uses.length)continue;const primary=records[0];
  if(uses.length===1)rooms.push({...primary.rule,roomId:room.id,classification:primary.classification,tableEvidence:primary.tableEvidence});
  else{const tableIds=[...new Set(records.flatMap(r=>r.rule.tableIds))],composite={...primary.rule,...intersectUseRules(records.map(r=>r.rule)),roomId:room.id,classification:primary.classification,label:records.map(r=>r.rule.label).join(' + ')+' (用途交集)',aggregation:sharedUseMethod,useClassIds:records.map(r=>r.rule.id),useAssessments:records,tableIds,tableEvidence:profile.tables.filter(t=>tableIds.includes(t.id)).map(({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod})=>({id,sourceId,locator,pdfPage,pixelSHA256,transcriptionMethod})),classificationNote:'Computed intersection of all explicit same-condition uses; individual classifications and applicability remain subject to professional review'};delete composite.recommendedLpdTarget;rooms.push(composite);}
 }
 if(!input.photometricDesign)add('LIGHTING_POINT_MODEL_REQUIRED','Standard-bound design needs the declared direct-point mode; flux estimates cannot stand in for uniformity');
 return {schemaVersion:1,profileId:profile.id,profileSHA256:sha256,manifestSHA256:profile.manifestSHA256,sourceScope:profile.sourceScope,sources:sourceBindings,rooms,issues,sourceIntegrity:true,lpdAdjustments:'Conservative unadjusted base limit; no automatic small-room or illuminance-step uplift',pending:['Selected classification and project/current standard applicability require professional confirmation','Direct-point precheck is not total reflected-light/UGR or installed lighting compliance','Nominal Ra and other product fields require independent product evidence; standard subset is not full code coverage'],professionalApproval:false};
}
