import {auditInstallationPlans} from './lighting-installation-plan-audit.mjs';
import crypto from 'node:crypto';

// Independent electrical check from persisted terminal edges: accumulate lamp
// currents on source paths, then sum I*R separately on phase and neutral. This
// does not call the generator or reuse its voltage-drop expression.
export function auditLightingInstallation(m){
 const q=m.input.installation,s=m.installation,checks=[],add=(id,ok,detail)=>checks.push({id,ok,detail,refs:[]});
 if(!q){if(s)add('installation_unrequested',false,'Unrequested installation model');return checks;}
 const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-5,e=m.input.electrical,totals={L:0,SL:0,N:0,PE:0};
 try{
  if(!s||!Array.isArray(s.circuits))throw Error('Missing installation model');
  const authority=[q,...q.rooms].some(r=>r.status==='assumed')?'assumed':[q,...q.rooms].some(r=>r.status==='interpreted')?'interpreted':'declared';
  add('installation_basis',s.schemaVersion===1&&s.topology===q.topology&&s.conditionsSHA256===digest(q)&&s.routingConditionsSHA256===digest(m.input.routingConditions)&&s.authority===authority&&s.professionalApproval===false,'Frozen installation and routing input; authority and review state preserved');
  add('installation_circuit_coverage',s.circuits.length===m.circuits.length&&new Set(s.circuits.map(c=>c.circuitId)).size===m.circuits.length&&m.circuits.every(c=>s.circuits.some(i=>i.circuitId===c.id)),'Every design circuit has exactly one installation graph');
  const routing=m.input.routingConditions,blocked=routing.exclusions.map(r=>({min:r.min.map(v=>v-routing.clearanceMm),max:r.max.map(v=>v+routing.clearanceMm)})),regions=[...routing.allowedRegions,...blocked];
  const pointAllowed=p=>routing.allowedRegions.some(r=>[0,1].every(i=>p[i]>=r.min[i]-1e-6&&p[i]<=r.max[i]+1e-6))&&!blocked.some(r=>[0,1].every(i=>p[i]>r.min[i]+1e-6&&p[i]<r.max[i]-1e-6));
  const segmentAllowed=(a,b)=>{if(a.filter((v,i)=>!near(v,b[i])).length>1)return false;const cuts=[0,1];for(const r of regions)for(let axis=0;axis<2;axis++)if(!near(a[axis],b[axis]))for(const v of [r.min[axis],r.max[axis]]){const t=(v-a[axis])/(b[axis]-a[axis]);if(t>0&&t<1)cuts.push(t);}cuts.sort((a,b)=>a-b);return [...cuts,...cuts.slice(1).map((t,i)=>(t+cuts[i])/2)].every(t=>pointAllowed(a.map((v,i)=>v+t*(b[i]-v))));};
  for(const c of s.circuits){
   const original=m.circuits.find(x=>x.id===c.circuitId),spec=q.rooms.find(r=>r.roomId===original?.roomId),control=m.controls.find(x=>x.circuitId===c.circuitId);if(!original||!spec||!control)throw Error('Unknown circuit/room/control');
   const lamps=original.deviceIds.map(id=>m.devices.find(d=>d.id===id)),nodes=new Map(c.nodes.map(n=>[n.id,n])),edges=[],adj=new Map(),amount={L:0,SL:0,N:0,PE:0};let geometry=nodes.size===c.nodes.length,structure=true;
   const expectedSources=[...new Set([...q.sourceIds,...spec.sourceIds])];
   add('installation_sources_'+c.circuitId,c.roomId===original.roomId&&c.controlId===control.id&&JSON.stringify(c.sourceIds)===JSON.stringify(expectedSources)&&expectedSources.every(id=>m.input.sources.some(s=>s.id===id&&!s.supersededBy&&!s.derivedFromFinalDrawing)),'Circuit installation sources are current and not derived final-drawing wiring');
   const pos=(id,kind,p,physicalId)=>{const n=nodes.get(id);return n?.kind===kind&&n.position.length===3&&n.position.every((v,i)=>near(v,p[i]))&&(!physicalId||n.physicalId===physicalId);};
   geometry&&=pos('P','panel',[...e.panelPosition,q.panelHeightM*1000],e.panelId)&&pos('J0','junction',[...spec.switchPosition,q.routingHeightM*1000])&&pos('S','switch',[...spec.switchPosition,spec.switchHeightM*1000],control.id);
   const sorted=[...lamps].sort((a,b)=>{const door=m.input.rooms.find(r=>r.id===c.roomId).doors[0];return Math.hypot(...a.position.map((v,i)=>v-door[i]))-Math.hypot(...b.position.map((v,i)=>v-door[i]));});
   for(const [i,d]of sorted.entries())geometry&&=pos('J'+(i+1),'junction',[...d.position,q.routingHeightM*1000])&&pos('D'+(i+1),'luminaire',[...d.position,d.mountingHeightM*1000],d.id);
   geometry&&=nodes.size===3+2*lamps.length;
   const expectedRuns=[['P','J0',['L:L:L','N:N:N','PE:PE:PE']],['J0','S',['L:L:LINE','SL:SL:LOAD','PE:PE:PE']]];
   for(let i=1;i<=lamps.length;i++)expectedRuns.push(['J'+(i-1),'J'+i,['SL:SL:SL','N:N:N','PE:PE:PE']],['J'+i,'D'+i,['SL:SL:L','N:N:N','PE:PE:PE']]);
   structure&&=c.runs.length===expectedRuns.length;
   function edge(a,b,resistance,role,runId){const id=edges.length;edges.push({a,b,resistance,role,runId});for(const [u,v]of [[a,b],[b,a]]){if(!adj.has(u))adj.set(u,[]);adj.get(u).push({node:v,edge:id});}}
   for(const [i,r]of c.runs.entries()){
    const expected=expectedRuns[i];structure&&=!!expected&&r.id==='W'+(i+1)&&r.from===expected[0]&&r.to===expected[1]&&JSON.stringify(r.conductors.map(w=>w.role+':'+w.fromTerminal+':'+w.toTerminal))===JSON.stringify(expected[2])&&r.wireSectionMm2===e.wireSectionMm2;
    const a=nodes.get(r.from),b=nodes.get(r.to),vs=r.vertices;if(!a||!b||!Array.isArray(vs)||!vs.length)throw Error('Missing endpoints');
    geometry&&=vs.every(v=>v.length===3&&v.every(Number.isFinite)&&v[2]>=0&&v[2]<=q.routingHeightM*1000+1e-5&&pointAllowed(v))&&vs[0].every((v,i)=>near(v,a.position[i]))&&vs.at(-1).every((v,i)=>near(v,b.position[i]))&&vs.slice(1).every((v,i)=>segmentAllowed(vs[i],v));
    const meters=vs.slice(1).reduce((sum,v,i)=>sum+Math.hypot(...v.map((x,k)=>x-vs[i][k])),0)/1000;geometry&&=near(r.lengthM,meters);
    for(const w of r.conductors){if(!(w.role in amount)){structure=false;continue;}amount[w.role]+=meters;edge(r.from+':'+w.fromTerminal,r.to+':'+w.toTerminal,e.copperOhmMm2PerM*meters/e.wireSectionMm2,w.role,r.id);}
   }
   add('installation_terminals_'+c.circuitId,structure&&c.switch.node==='S'&&c.switch.fromTerminal==='LINE'&&c.switch.toTerminal==='LOAD'&&c.switch.ratingA===spec.switchRatingA&&c.switch.ratedVoltage===spec.switchRatedVoltage,'Separate L/SL/N/PE terminals, one phase-only switch, explicit lamp/junction coverage and no automatic crossing junctions');
   add('installation_geometry_'+c.circuitId,geometry,'Source panel/switch/lamp elevations; every 3D centerline segment obeys declared planar regions and exclusions');
   const pathTo=(start,end)=>{const prev=new Map([[start,null]]),queue=[start];for(let i=0;i<queue.length;i++){const u=queue[i];if(u===end){const path=[];for(let n=end;prev.get(n);n=prev.get(n).from)path.push(prev.get(n).edge);return path;}for(const next of adj.get(u)||[])if(!prev.has(next.node)){prev.set(next.node,{from:u,edge:next.edge});queue.push(next.node);}}return null;};
   let isolation=pathTo('P:N','P:PE')===null&&pathTo('P:L','P:N')===null&&pathTo('P:L','P:PE')===null;
   for(let i=1;i<=lamps.length;i++)isolation&&=pathTo('P:L','D'+i+':L')===null&&pathTo('P:N','D'+i+':N')!==null&&pathTo('P:PE','D'+i+':PE')!==null;
   isolation&&=pathTo('P:PE','S:PE')!==null;
   edge('S:LINE','S:LOAD',0,'CONTACT','switch');
   const loads=[],current=new Map();for(const [i,d]of sorted.entries()){const phase=pathTo('P:L','D'+(i+1)+':L'),neutral=pathTo('P:N','D'+(i+1)+':N');if(!phase||!neutral)throw Error('Disconnected load');const amps=d.watts/(e.voltage*e.powerFactor);for(const idx of [...phase,...neutral])current.set(idx,(current.get(idx)||0)+amps);loads.push({d,phase,neutral});}
   add('installation_switch_function_'+c.circuitId,isolation&&loads.length===lamps.length,'OFF isolates every lamp phase while preserving N/PE; ON connects assigned lamps; no N/PE or supply short');
   add('installation_run_currents_'+c.circuitId,c.runs.every(r=>near(r.loadA,Math.max(0,...edges.flatMap((e,i)=>e.runId===r.id?[current.get(i)||0]:[])))),'Each run load matches independently accumulated branch currents');
   const totalA=lamps.reduce((sum,d)=>sum+d.watts/(e.voltage*e.powerFactor),0),expectedDrops=loads.map(({d,phase,neutral})=>({deviceId:d.id,volts:[...phase,...neutral].reduce((sum,idx)=>sum+edges[idx].resistance*current.get(idx),0)+2*e.copperOhmMm2PerM/e.wireSectionMm2*e.extraLengthM*totalA}));
   const maximum=Math.max(...expectedDrops.map(d=>d.volts/e.voltage*100)),limit=m.input.requirements.find(r=>r.rule==='max_drop'&&r.roomIds.includes(c.roomId)).value;
   add('installation_electrical_'+c.circuitId,near(c.currentA,totalA)&&totalA<=spec.switchRatingA&&e.voltage<=spec.switchRatedVoltage&&c.drops.length===lamps.length&&new Set(c.drops.map(d=>d.deviceId)).size===lamps.length&&expectedDrops.every(d=>{const stored=c.drops.find(x=>x.deviceId===d.deviceId);return stored&&near(stored.dropV,d.volts)&&near(stored.dropPercent,d.volts/e.voltage*100);})&&near(c.maximumDropPercent,maximum)&&maximum<=limit&&c.unlocatedAllowanceM===e.extraLengthM,'Independent per-edge current accumulation and phase/neutral I*R drop, including vertical switch loop and separate unlocated allowance, meet original limits');
   for(const role of Object.keys(amount))totals[role]+=amount[role];
   add('installation_quantities_'+c.circuitId,Object.keys(amount).every(role=>near(c.conductorLengthsM[role],amount[role]))&&near(c.physicalPathLengthM,c.runs.reduce((n,r)=>n+r.lengthM,0)),'L, switched phase, neutral and PE lengths reconcile with physical runs; unlocated allowance is not a measured quantity');
  }
  if(m.scene){const pages=m.sheets.filter(s=>s.id.startsWith('E07-')),expectedCount=s.circuits.reduce((n,c)=>n+Math.ceil(c.runs.length/13),0);let drawing=pages.length===expectedCount;for(const [ci,c]of s.circuits.entries()){const label='Q'+String(ci+1).padStart(2,'0');for(let offset=0;offset<c.runs.length;offset+=13){const page=m.sheets.find(s=>s.id==='E07-'+label+'-'+(offset/13+1));if(!page){drawing=false;continue;}const text=m.scene.entities.filter(e=>e.kind==='text'&&e.position[0]>=page.region.min[0]&&e.position[0]<=page.region.max[0]).map(e=>e.text).join('\n');drawing&&=text.includes(c.circuitId)&&text.includes(c.maximumDropPercent.toFixed(4)+'%')&&c.runs.slice(offset,offset+13).every(r=>text.includes(r.id+' | ')&&text.includes(r.lengthM.toFixed(3)+'m / '+r.wireSectionMm2+'mm2')&&r.conductors.every(w=>text.includes(w.role+': '+r.from+'.'+w.fromTerminal+' -> '+r.to+'.'+w.toTerminal)));}}add('installation_drawing',drawing,'Every installation circuit/run/terminal assignment and voltage-drop result is present on its E07 page');}
  checks.push(...auditInstallationPlans(m));
  add('installation_total_quantities',Object.keys(totals).every(role=>near(s.conductorLengthsM[role],totals[role])),'All circuit conductor quantities reconcile');
 }catch(error){add('installation_structure',false,error.message);}
 return checks;
}
