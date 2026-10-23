// Procedural development shell and numeric assumptions, not a public project's plan.
import crypto from 'node:crypto';import {spaceTestInput,planningBrief} from './space-input.mjs';
export function directDoorInput({entrySide='west',widthMm=900,lockable=true,related=true}={}){
 const p=spaceTestInput(),vertical=['north','south'].includes(entrySide);p.projectId='DIRECT_DOOR_QA';p.title='房间间直接通行-公共能力开发验证';
 p.shell={...p.shell,rect:{min:[500,-300],max:vertical?[8500,14100]:[14900,7700]},entry:{side:entrySide,offsetMm:1000,clearWidthMm:1000},windows:[],keepouts:[],description:'Procedural development shell; public requirements do not establish these dimensions or any issued architecture'};
 p.parameters={...p.parameters,corridorMinMm:2000,corridorMaxMm:2000,maxUnassignedAreaM2:12};
 p.program=[['A',4,24],['B',2,24],['C',0,24]].map(([id,occupants,preferredAreaM2])=>({...p.program[0],id,name:'开发房间'+id,activity:occupants?'workstations':'unfurnished',occupants,minAreaM2:18,maxAreaM2:32,preferredAreaM2,minFrontageMm:3500,minDepthMm:5000,minWindowMm:0,maxEntryRouteMm:25000}));
 p.relations=related?[{id:'ACCESS_AB',a:'A',b:'B',kind:'direct_door',valueMm:widthMm,lockable,sourceIds:['BRIEF'],status:'interpreted',evidenceQuote:'placeholder'}]:[];
 p.sources.find(s=>s.id==='SHELL').sha256=crypto.createHash('sha256').update(JSON.stringify(p.shell)).digest('hex');return planningBrief(p);
}
