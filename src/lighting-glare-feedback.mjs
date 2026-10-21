// Trial ordering only. A previous eye background is not a transport prediction
// or a lower bound for a changed product/layout. Actual UGR remains mandatory.
import {engineeringDigest} from './engineering-design.mjs';
import {buildUgrReference} from './ugr-reference.mjs';
import {sumUgr} from './ugr.mjs';
import {qualityProfiles} from './radiance-presets.mjs';
export function predictLightingChoiceGlare(model,room,choice,baseline,{ugrMethod}={}){
 if(!baseline||!model.input.glareAssessment||!ugrMethod)return undefined;
 const unavailable=reason=>({available:false,reason,scope:'No inferred or substituted eye background; actual reference-UGR assessment required'});
 if(baseline.modelSHA256!==engineeringDigest(model)||baseline.ugr?.modelSHA256!==baseline.modelSHA256||baseline.ugr?.profileSHA256!==ugrMethod.sha256||ugrMethod.sha256!==model.input.glareAssessment.expectedProfileSHA256.toLowerCase()||baseline.ugr?.conditionsSHA256!==engineeringDigest(model.input.glareAssessment)||JSON.stringify(baseline.ugr?.settings)!==JSON.stringify(qualityProfiles.filter(p=>p.id!=='coarse')))return unavailable('prior_glare_identity_changed');
 const global=['fixed_settings','frozen_model','all_rooms','ugr_verified_method','ugr_fixed_settings','ugr_frozen_method_and_conditions','ugr_all_rooms'];
 if(!global.every(id=>baseline.audit?.checks.find(c=>c.id===id)?.ok))return unavailable('prior_global_quality_identity_unverified');
 const previous=baseline.ugr?.rooms.find(r=>r.roomId===room.id),condition=model.input.glareAssessment.rooms.find(r=>r.roomId===room.id),normative=model.lightingStandardEvidence?.rooms.find(r=>r.roomId===room.id),limit=Math.min(condition?.maximumUgr??NaN,normative?.maximumUgr??NaN);
 if(!previous||!condition||!Number.isFinite(limit)||limit<=0)return unavailable('prior_room_or_limit_unavailable');
 const height=model.input.requirements.find(q=>q.rule==='mounting_height'&&q.roomIds.includes(room.id))?.value,proxy={input:model.input,devices:choice.positions.map((position,i)=>({id:'L_'+room.id+'_'+String(i+1).padStart(3,'0'),roomId:room.id,fixture:choice.fixture,position,mountingHeightM:height}))};
 let reference;try{reference=buildUgrReference(proxy,room,condition,ugrMethod.profile,model.photometricEvidence);}catch(error){if(!/^(UGR_|LIGHTING_)/.test(error.message))throw error;return unavailable(error.message.split(':')[0]);}
 const observers=[];
 for(const c of reference.calculations){
  const old=previous.observers.find(o=>o.observer.id===c.observer.id);
  if(c.issues.length||!old||engineeringDigest(old.observer)!==engineeringDigest(c.observer)||!old.eyeLux)return unavailable('candidate_or_prior_observer_unavailable');
  const values=[old.eyeLux.direct,old.eyeLux.medium,old.eyeLux.fine];if(!values.every(v=>Number.isFinite(v)&&v>=0))return unavailable('prior_eye_values_invalid');
  const indirectEyeLux=Math.min(old.eyeLux.medium,old.eyeLux.fine)-old.eyeLux.direct;if(!(indirectEyeLux>0))return unavailable('prior_indirect_eye_background_unresolved');
  let predicted;try{predicted=sumUgr(c.sources,indirectEyeLux);}catch(error){if(!/^UGR_/.test(error.message))throw error;return unavailable(error.message.split(':')[0]);}observers.push({observerId:c.observer.id,measuredMinimumIndirectEyeLux:indirectEyeLux,predictedUgr:predicted.ugr,candidateSourceSum:predicted.sourceSum});
 }
 if(observers.length!==4)return unavailable('reference_observer_coverage_incomplete');
 return {available:true,maximum:Math.max(...observers.map(o=>o.predictedUgr)),limit,observers,measuredModelSHA256:baseline.modelSHA256,profileSHA256:ugrMethod.sha256,scope:'Previous frozen per-observer indirect background reused for trial ordering only. New source terms use the actual candidate geometry/IES; changed transport is uncalibrated and must be remeasured. No acceptance or infeasibility claim.'};
}
