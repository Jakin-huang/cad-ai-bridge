// Controller-only synthetic data. Never a photometric acceptance reference.
import fs from 'node:fs/promises';
import path from 'node:path';
import {lightingFixture} from './lighting-input.mjs';
import {analyticIes} from './photometric-input.mjs';
import {hashFile} from '../../src/drawings.mjs';
import {engineeringDigest} from '../../src/engineering-design.mjs';
import {resolveEngineeringPhotometry} from '../../src/engineering-photometry.mjs';
import {resolveLightingStandards} from '../../src/lighting-standard-evidence.mjs';
import {auditLightingQuality,qualityProfiles} from '../../src/lighting-quality.mjs';
import {engineeringInputSchema} from '../../src/engineering-contracts.mjs';
export async function initialFixture(){
 const f=await lightingFixture(),p=f.input,file=p.luminaires[0].iesFile.file;await fs.writeFile(file,analyticIes({rows:[[500,500,0]]}).replace('1 2 0 0 0','1 2 .6 .4 0'));const sha=await hashFile(file);p.luminaires[0].iesFile.sha256=sha;p.sources.find(s=>s.id===p.luminaires[0].sourceId).sha256=sha;p.requirements.find(r=>r.rule==='max_lpd').value=3;p.photometricDesign.gridSpacingM=1;
 p.lightingEnvironment={model:'closed_diffuse_rooms',geometry:'ies_rectangular_opening',sourceIds:['BRIEF'],status:'assumed',description:'Controller-only assumed enclosure, not project evidence',rooms:p.rooms.map(r=>({roomId:r.id,enclosure:'closed_opaque',floorReflectance:.2,wallReflectance:.5,ceilingReflectance:.8,sourceIds:['BRIEF'],status:'assumed',description:'Synthetic controller surfaces, no physics validation'}))};
 const input=engineeringInputSchema.parse(p),context={input,revision:0,standardEvidence:[],photometricEvidence:await resolveEngineeringPhotometry(input,{inputRoot:f.root}),lightingStandardEvidence:await resolveLightingStandards(input,{file:f.profileFile})};return {...f,input,context};
}
export function controllerAssessment(outcome=true){let calls=0;return async(model,{folder,onProgress})=>{
 await fs.mkdir(folder);await onProgress?.({roomId:model.input.rooms[0].id,profile:'fine'});const pass=typeof outcome==='function'?outcome(++calls):outcome,value=pass?380:20;await fs.writeFile(path.join(folder,'controller-trace.txt'),'Controller fixture only; no optical calculation');await fs.writeFile(path.join(folder,'total-illuminance.csv'),'Controller fixture, not photometric evidence');
 const report={method:'controller_fixture_only',settings:qualityProfiles,modelSHA256:engineeringDigest(model),environmentSHA256:engineeringDigest(model.input.lightingEnvironment),runtime:{version:'Unit controller only, no Radiance execution'},artifacts:[{file:'controller-trace.txt',sha256:await hashFile(path.join(folder,'controller-trace.txt'))}],rooms:model.roomCalculations.map(c=>({roomId:c.roomId,condition:model.input.lightingEnvironment.rooms.find(r=>r.roomId===c.roomId),points:c.photometry.points.map(p=>p.positionM),profiles:{direct:c.photometry.points.map(()=>1),coarse:c.photometry.points.map(()=>value),medium:c.photometry.points.map(()=>value),fine:c.photometry.points.map(()=>value)}})),professionalApproval:false};report.audit=auditLightingQuality(model,report);report.passed=report.audit.ok;return report;
 };}
