// Declared development geometry, not the dimensions of any public project.
import {spaceTestInput,planningBrief} from './space-input.mjs';
import crypto from 'node:crypto';
export function frontageInput({tolerance=0,related=true,entrySide='west'}={}){
 const p=spaceTestInput();p.title='等开间关系-声明条件开发验证';p.projectId='FRONTAGE_QA';
 const vertical=['north','south'].includes(entrySide);p.shell={...p.shell,rect:{min:[500,-300],max:vertical?[6500,8900]:[9700,5700]},entry:{side:entrySide,offsetMm:1000,clearWidthMm:1000},windows:[],keepouts:[],description:'Declared development shell; no physical dimensions copied or inferred from public reference layouts'};
 p.parameters={...p.parameters,corridorMinMm:2000,corridorMaxMm:2000,maxUnassignedAreaM2:3};
 p.program=[9,11.7,14.43].map((preferredAreaM2,i)=>({...p.program[0],id:'ROOM_'+(i+1),name:'待布置房间'+(i+1),activity:'unfurnished',occupants:0,minAreaM2:8,maxAreaM2:16,preferredAreaM2,minFrontageMm:2000,minDepthMm:3000,minWindowMm:0,maxEntryRouteMm:20000}));
 p.relations=related?[['EQ12','ROOM_1','ROOM_2'],['EQ23','ROOM_2','ROOM_3']].map(([id,a,b])=>({id,a,b,kind:'max_frontage_difference',valueMm:tolerance,sourceIds:['BRIEF'],status:'interpreted',evidenceQuote:'placeholder'})):[];
 p.sources.find(s=>s.id==='SHELL').sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');return planningBrief(p);
}
export function frontageRevisionInput(initial,revised,reason){
 const sourceId='BRIEF_R1',rebind=x=>({...x,sourceIds:[...x.sourceIds.filter(id=>id!=='BRIEF'),sourceId]});
 return {...revised,sources:[...initial.sources.map(s=>s.id==='BRIEF'?{...s,supersededBy:sourceId}:s),{id:sourceId,role:'brief',sha256:crypto.createHash('sha256').update(revised.brief).digest('hex'),description:reason,derivedFromFinalDrawing:false}],program:revised.program.map(rebind),relations:revised.relations.map(rebind),parameters:rebind(revised.parameters),shell:rebind(revised.shell),missingInputs:revised.missingInputs.map(rebind)};
}
