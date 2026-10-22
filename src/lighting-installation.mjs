import {z} from 'zod';
import crypto from 'node:crypto';
import {compileDeclaredRouter} from './engineering-routing.mjs';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const basis={sourceIds:z.array(id).min(1).max(20),status:z.enum(['documented','interpreted','assumed']),description:z.string().min(20).max(1000)};
export const lightingInstallationSchema=z.strictObject({
 topology:z.literal('ceiling_junction_single_pole'),
 routingHeightM:z.number().positive().max(20),panelHeightM:z.number().nonnegative().max(20),
 rooms:z.array(z.strictObject({roomId:id,switchPosition:z.tuple([z.number().finite().min(-1e8).max(1e8),z.number().finite().min(-1e8).max(1e8)]),switchHeightM:z.number().positive().max(5),switchRatingA:z.number().positive().max(100),switchRatedVoltage:z.number().positive().max(1000),...basis})).min(1).max(100),...basis
});
export const installationDigest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function installationAssumptionsPreserved(a,b){return !a||!!b&&!(a.status==='assumed'&&b.status!=='assumed')&&a.rooms.every(r=>r.status!=='assumed'||b.rooms.find(n=>n.roomId===r.roomId)?.status==='assumed');}
export function installationAuthority(q){return [q,...q.rooms].some(r=>r.status==='assumed')?'assumed':[q,...q.rooms].some(r=>r.status==='interpreted')?'interpreted':'declared';}
export function installationConditionIssues(p){
 const q=p.installation;if(!q)return [];
 const issues=[],add=(code,message,refs=[])=>issues.push({code,severity:'blocking',message,refs});
 if(!p.routingConditions)add('INSTALLATION_ROUTING_REQUIRED','Explicit planar routing permissions are required for installation design');
 if(q.rooms.length!==p.rooms.length||new Set(q.rooms.map(r=>r.roomId)).size!==p.rooms.length||q.rooms.some(r=>!p.rooms.some(s=>s.id===r.roomId)))add('INSTALLATION_ROOM_COVERAGE','Installation conditions must cover every room exactly once');
 if(q.panelHeightM>q.routingHeightM)add('INSTALLATION_PANEL_HEIGHT','Panel terminal height exceeds the declared routing plane');
 const within=(v,ps)=>{let inside=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a[1]>v[1])!==(b[1]>v[1])&&v[0]<(b[0]-a[0])*(v[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 for(const r of q.rooms){
  const room=p.rooms.find(s=>s.id===r.roomId);if(!room)continue;
  const mode=p.requirements.find(s=>s.rule==='control_mode'&&s.roomIds.includes(room.id))?.value,mount=p.requirements.find(s=>s.rule==='mounting_height'&&s.roomIds.includes(room.id))?.value;
  if(!['local','regional_manual'].includes(mode))add('INSTALLATION_CONTROL_UNSUPPORTED','Single-pole manual topology cannot implement '+mode,[room.id]);
  if(q.routingHeightM>room.heightM||q.routingHeightM<mount||r.switchHeightM>=q.routingHeightM)add('INSTALLATION_HEIGHT_CONFLICT','Routing plane, luminaire height, ceiling and switch height conflict',[room.id]);
  if(!within(r.switchPosition,room.polygon)||room.obstacles.some(o=>within(r.switchPosition,o)))add('INSTALLATION_SWITCH_LOCATION','Declared switch box must lie in its room clear of obstacles',[room.id]);
  if(r.switchRatedVoltage<p.electrical.voltage)add('INSTALLATION_SWITCH_VOLTAGE','Declared switch voltage rating is below the supply',[room.id]);
 }
 for(const item of [q,...q.rooms])for(const sourceId of item.sourceIds){const s=p.sources.find(s=>s.id===sourceId);if(!s||s.supersededBy||s.derivedFromFinalDrawing)add('INSTALLATION_SOURCE_NOT_CURRENT','Installation conditions require current non-reference sources',[sourceId]);}
 issues.push({code:'INSTALLATION_AUTHORITY_PENDING',severity:'review',message:'Declared ceiling junction / single-pole terminal topology. Switch LED/inrush suitability, physical box/gang capacity, conductor installation corrections, containment, penetrations and protection coordination require project evidence and professional review.',refs:q.sourceIds});
 return issues;
}
const round=n=>Math.round(n*1e6)/1e6;
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const clean=ps=>ps.filter((p,i)=>!i||distance(p,ps[i-1])>1e-8);
const length=ps=>ps.slice(1).reduce((sum,p,i)=>sum+distance(p,ps[i]),0)/1000;

// All connections are explicit terminals. Geometric crossings never create a
// junction. Each circuit has its own neutral and PE conductors in this model.
// The declared room switch position is a shared box location; each resulting
// circuit gets a separate pole. Physical gang/box capacity is not inferred.
export function compileLightingInstallation(p,devices){
 const q=p.installation;if(!q)return undefined;
 const issues=installationConditionIssues(p);if(issues.some(i=>i.severity==='blocking'))throw Error('INSTALLATION_CONDITIONS_INVALID: '+JSON.stringify(issues));
 const router=compileDeclaredRouter(p.routingConditions,[p.electrical.panelPosition,...q.rooms.map(r=>r.switchPosition),...devices.map(d=>d.position)]),height=q.routingHeightM*1000;
 function circuit(selected,roomId,circuitId='CANDIDATE',controlId='CANDIDATE_SWITCH'){
  const room=p.rooms.find(r=>r.id===roomId),spec=q.rooms.find(r=>r.roomId===roomId),e=p.electrical,door=room.doors[0],ordered=[...selected].sort((a,b)=>distance(a.position,door)-distance(b.position,door));
  const nodes=[],runs=[],addNode=(id,kind,position,physicalId)=>{const node={id,kind,position:position.map(round),...(physicalId?{physicalId}:{})};nodes.push(node);return node;};
  const panel=addNode('P','panel',[...e.panelPosition,q.panelHeightM*1000],e.panelId),box=addNode('J0','junction',[...spec.switchPosition,height]),sw=addNode('S','switch',[...spec.switchPosition,spec.switchHeightM*1000],controlId);
  function addRun(from,to,vertices,conductors,loadA){const ps=clean(vertices).map(v=>v.map(round)),run={id:'W'+(runs.length+1),from:from.id,to:to.id,vertices:ps,lengthM:round(length(ps)),wireSectionMm2:e.wireSectionMm2,conductors:conductors.map(([role,fromTerminal,toTerminal])=>({role,fromTerminal,toTerminal})),loadA:round(loadA)};runs.push(run);return run;}
  const current=selected.length*selected[0].watts/(e.voltage*e.powerFactor),horizontal=(a,b)=>router.pathBetween(a.position.slice(0,2),b.position.slice(0,2)).map(v=>[...v,height]);
  const feed=addRun(panel,box,[panel.position,...horizontal(panel,box)],[['L','L','L'],['N','N','N'],['PE','PE','PE']],current);
  const switchDrop=addRun(box,sw,[box.position,sw.position],[['L','L','LINE'],['SL','SL','LOAD'],['PE','PE','PE']],current);
  let last=box,weightedTrunks=0,maximumDropPercent=0;const drops=[];
  for(const [index,d]of ordered.entries()){
   const junction=addNode('J'+(index+1),'junction',[...d.position,height]),lamp=addNode('D'+(index+1),'luminaire',[...d.position,d.mountingHeightM*1000],d.id),lampA=d.watts/(e.voltage*e.powerFactor),downstreamA=(ordered.length-index)*lampA;
   const trunk=addRun(last,junction,horizontal(last,junction),[['SL','SL','SL'],['N','N','N'],['PE','PE','PE']],downstreamA);
   const drop=addRun(junction,lamp,[junction.position,lamp.position],[['SL','SL','L'],['N','N','N'],['PE','PE','PE']],lampA);weightedTrunks+=trunk.lengthM*downstreamA;
   // Equal-size L/N conductors; switch loop adds outgoing L + returning SL.
   // Existing unlocated allowance remains conservative at whole-circuit load.
   const dropV=2*e.copperOhmMm2PerM/e.wireSectionMm2*((feed.lengthM+switchDrop.lengthM+e.extraLengthM)*current+weightedTrunks+drop.lengthM*lampA);
   maximumDropPercent=Math.max(maximumDropPercent,dropV/e.voltage*100);
   drops.push({deviceId:d.id,dropV:round(dropV),dropPercent:round(dropV/e.voltage*100)});last=junction;
  }
  const conductorLengthsM=Object.fromEntries(['L','SL','N','PE'].map(role=>[role,round(runs.reduce((sum,r)=>sum+r.lengthM*r.conductors.filter(c=>c.role===role).length,0))]));
  return {circuitId,controlId,roomId,sourceIds:[...new Set([...q.sourceIds,...spec.sourceIds])],nodes,runs,switch:{node:'S',fromTerminal:'LINE',toTerminal:'LOAD',ratingA:spec.switchRatingA,ratedVoltage:spec.switchRatedVoltage},currentA:current,drops,maximumDropPercent,conductorLengthsM,unlocatedAllowanceM:e.extraLengthM,physicalPathLengthM:round(runs.reduce((n,r)=>n+r.lengthM,0)),scope:'Explicit circuit terminal graph and declared 3D centerlines. No automatic junction at crossings; original unlocated allowance retained separately. Not construction approval.'};
 }
 return {circuit};
}
export function buildLightingInstallation(p,circuits,devices,controls,compiler){
 if(!p.installation)return undefined;
 const designs=circuits.map(c=>compiler.circuit(c.deviceIds.map(id=>devices.find(d=>d.id===id)),c.roomId,c.id,controls.find(s=>s.circuitId===c.id).id));
 return {schemaVersion:1,topology:p.installation.topology,conditionsSHA256:installationDigest(p.installation),routingConditionsSHA256:installationDigest(p.routingConditions),authority:installationAuthority(p.installation),circuits:designs,conductorLengthsM:Object.fromEntries(['L','SL','N','PE'].map(role=>[role,round(designs.reduce((n,c)=>n+c.conductorLengthsM[role],0))])),professionalApproval:false};
}
