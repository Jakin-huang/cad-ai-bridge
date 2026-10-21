import {mapBoundedWork} from './bounded-work.mjs';
import crypto from 'node:crypto';
export const assessmentLimits=Object.freeze({rooms:100,luminaires:1000,points:10000,partitionRooms:10,partitionLuminaires:100,partitionPoints:1000,maxConcurrentRooms:4,maxMinutes:60});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function planLightingAssessment(model,{maxConcurrentRooms=1}={}){
 if(!Number.isInteger(maxConcurrentRooms)||maxConcurrentRooms<1||maxConcurrentRooms>assessmentLimits.maxConcurrentRooms)throw Error('LIGHTING_ASSESSMENT_CONCURRENCY_INVALID');
 const ids=new Set(model.input.rooms.map(r=>r.id));if(ids.size!==model.input.rooms.length||!ids.size||model.devices.some(d=>!ids.has(d.roomId))||new Set(model.devices.map(d=>d.id)).size!==model.devices.length||model.roomCalculations.length!==ids.size||new Set(model.roomCalculations.map(r=>r.roomId)).size!==ids.size)throw Error('LIGHTING_ASSESSMENT_COVERAGE_INVALID');
 const metrics=model.input.rooms.map(r=>{const calc=model.roomCalculations.find(c=>c.roomId===r.id),lamps=model.devices.filter(d=>d.roomId===r.id),points=calc?.photometry?.points;if(!points?.length||!lamps.length||points.some(p=>!Array.isArray(p.positionM)||p.positionM.length!==3||p.positionM.some(v=>!Number.isFinite(v))))throw Error('LIGHTING_ASSESSMENT_ROOM_GRID_REQUIRED: '+r.id);return {roomId:r.id,luminaires:lamps.length,points:points.length,observers:model.input.glareAssessment?4:0};});
 const totals=metrics.reduce((s,r)=>({rooms:s.rooms+1,luminaires:s.luminaires+r.luminaires,points:s.points+r.points,observers:s.observers+r.observers}),{rooms:0,luminaires:0,points:0,observers:0});
 if(totals.rooms>assessmentLimits.rooms||totals.luminaires>assessmentLimits.luminaires||totals.points>assessmentLimits.points)throw Error('LIGHTING_ASSESSMENT_BUDGET: project exceeds 100 rooms, 1000 luminaires or 10000 points; no grid truncation');
 const partitions=[];for(const r of metrics){if(r.luminaires>assessmentLimits.partitionLuminaires||r.points>assessmentLimits.partitionPoints)throw Error('LIGHTING_ASSESSMENT_ROOM_BUDGET: '+r.roomId+' exceeds 100 luminaires or 1000 points; one room is never split or sampled');let p=partitions.at(-1);if(!p||p.roomIds.length===assessmentLimits.partitionRooms||p.luminaires+r.luminaires>assessmentLimits.partitionLuminaires||p.points+r.points>assessmentLimits.partitionPoints){p={id:'P'+String(partitions.length+1).padStart(2,'0'),roomIds:[],luminaires:0,points:0,observers:0};partitions.push(p);}p.roomIds.push(r.roomId);p.luminaires+=r.luminaires;p.points+=r.points;p.observers+=r.observers;}
 const plan={schemaVersion:1,method:'independent_closed_rooms_bounded_parallel',modelSHA256:digest(model),limits:assessmentLimits,maxConcurrentRooms,totals,metrics,partitions};return {...plan,sha256:digest(plan)};
}
export function assessmentDeadline({deadlineMs,maxMinutes=20}={}){if(!Number.isFinite(maxMinutes)||maxMinutes<=0||maxMinutes>assessmentLimits.maxMinutes||deadlineMs!==undefined&&!Number.isFinite(deadlineMs))throw Error('LIGHTING_ASSESSMENT_TIME_BUDGET_INVALID');return Math.min(deadlineMs??Infinity,Date.now()+maxMinutes*60000);}
export function assertAssessmentActive({deadlineMs,signal}={}){if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:Error('LIGHTING_ASSESSMENT_CANCELLED');if(deadlineMs!==undefined&&Date.now()>=deadlineMs)throw Error('LIGHTING_ASSESSMENT_TIME_BUDGET');}
// Domain adapter: only its budget/error vocabulary is lighting-specific.
export function mapAssessmentRooms(items,concurrency,task){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>assessmentLimits.maxConcurrentRooms)throw Error('LIGHTING_ASSESSMENT_CONCURRENCY_INVALID');
 return mapBoundedWork(items,{concurrency,maxConcurrency:assessmentLimits.maxConcurrentRooms},task);
}
const rawUgrRoom=r=>({...r,observers:r.observers.map(({result,...observer})=>observer)});
export function partitionRecord(report,p){const illuminance=report.rooms.filter(r=>p.roomIds.includes(r.roomId)).map(({summary,...room})=>room),ugr=report.ugr?.rooms.filter(r=>p.roomIds.includes(r.roomId)).map(rawUgrRoom);return {id:p.id,roomIds:p.roomIds,modelSHA256:report.modelSHA256,illuminanceSHA256:digest(illuminance),...(ugr?{ugrSHA256:digest(ugr)}:{}),complete:illuminance.length===p.roomIds.length&&(!report.ugr||ugr.length===p.roomIds.length)};}
export function auditAssessmentPlan(model,report){
 const legacy=model.input.rooms.length<=10&&model.devices.length<=100&&model.roomCalculations.reduce((s,r)=>s+(r.photometry?.points.length??0),0)<=1000;
 if(!report.assessmentPlan)return report.schemaVersion!==2&&legacy;
 try{const expected=planLightingAssessment(model,{maxConcurrentRooms:report.assessmentPlan.maxConcurrentRooms});return report.schemaVersion===2&&JSON.stringify(report.assessmentPlan)===JSON.stringify(expected)&&Array.isArray(report.partitionRecords)&&report.partitionRecords.length===expected.partitions.length&&expected.partitions.every((p,i)=>{const record=partitionRecord(report,p);return record.complete&&JSON.stringify(report.partitionRecords[i])===JSON.stringify(record);});}catch{return false;}
}
