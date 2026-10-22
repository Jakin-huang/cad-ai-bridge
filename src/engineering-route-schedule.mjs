import crypto from 'node:crypto';
const round=n=>Math.round(n*1e6)/1e6;
const micro=n=>Math.round(n*1e6);
const point=(axis,constant,value)=>axis===0?[value/1e6,constant/1e6]:[constant/1e6,value/1e6];
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function buildRouteSchedule(routes,circuits,conditionsSHA256,{maxComparisons=2000000,maxSegments=10000}={}){
 const legs=[],buckets=new Map(),circuitMap=new Map(circuits.map(c=>[c.id,c]));let comparisons=0;
 const step=()=>{if(++comparisons>maxComparisons)throw Error('ROUTE_SCHEDULE_WORK_BUDGET: segment accounting budget exceeded');};
 for(const route of routes){if(!circuitMap.has(route.circuitId))throw Error('ROUTE_SCHEDULE_CIRCUIT_MISSING');for(let index=1;index<route.vertices.length;index++){
  const a=route.vertices[index-1].map(micro),b=route.vertices[index].map(micro);if(a[0]===b[0]&&a[1]===b[1])continue;
  const axis=a[1]===b[1]?0:a[0]===b[0]?1:-1;if(axis<0)throw Error('ROUTE_SCHEDULE_NON_ORTHOGONAL');
  const leg={axis,constant:a[1-axis],lo:Math.min(a[axis],b[axis]),hi:Math.max(a[axis],b[axis]),routeId:route.id,circuitId:route.circuitId,legIndex:index-1},key=axis+':'+leg.constant;
  if(!buckets.has(key))buckets.set(key,{axis,constant:leg.constant,legs:[],cuts:new Set()});const bucket=buckets.get(key);bucket.legs.push(leg);bucket.cuts.add(leg.lo);bucket.cuts.add(leg.hi);legs.push(leg);
  if(legs.length>maxSegments)throw Error('ROUTE_SCHEDULE_LEG_BUDGET');
 }}
 const horizontal=legs.filter(l=>l.axis===0),vertical=legs.filter(l=>l.axis===1);
 for(const h of horizontal)for(const v of vertical){step();if(v.constant>=h.lo&&v.constant<=h.hi&&h.constant>=v.lo&&h.constant<=v.hi){buckets.get('0:'+h.constant).cuts.add(v.constant);buckets.get('1:'+v.constant).cuts.add(h.constant);}}
 const segments=[];
 for(const bucket of [...buckets.values()].sort((a,b)=>a.axis-b.axis||a.constant-b.constant)){
  const cuts=[...bucket.cuts].sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){
   const lo=cuts[i-1],hi=cuts[i],members=[];for(const leg of bucket.legs){step();if(leg.lo<=lo&&leg.hi>=hi)members.push({circuitId:leg.circuitId,routeId:leg.routeId,legIndex:leg.legIndex});}if(!members.length)continue;
   members.sort((a,b)=>a.circuitId.localeCompare(b.circuitId)||a.routeId.localeCompare(b.routeId)||a.legIndex-b.legIndex);
   const start=point(bucket.axis,bucket.constant,lo),end=point(bucket.axis,bucket.constant,hi),counts=new Map();for(const member of members)counts.set(member.circuitId,(counts.get(member.circuitId)||0)+1);
   segments.push({id:'RS_'+digest([start,end]).slice(0,16),label:'T'+String(segments.length+1).padStart(3,'0'),start,end,lengthM:round((hi-lo)/1e9),traversals:members.length,circuits:[...counts].map(([circuitId,passes])=>({circuitId,passes,conductors:circuitMap.get(circuitId).conductors,wireSectionMm2:circuitMap.get(circuitId).wireSectionMm2})),members});
   if(segments.length>maxSegments)throw Error('ROUTE_SCHEDULE_SEGMENT_BUDGET');
  }
 }
 const length=s=>Math.hypot(s.end[0]-s.start[0],s.end[1]-s.start[1])/1000,materials=new Map();
 for(const c of circuits){if(c.conductors!=='L+N+PE')throw Error('ROUTE_SCHEDULE_CONDUCTOR_BASIS_UNSUPPORTED');const key=String(c.wireSectionMm2);if(!materials.has(key))materials.set(key,{wireSectionMm2:c.wireSectionMm2,conductorsPerTraversal:3,planarConductorLengthM:0,extraConductorLengthM:0});const row=materials.get(key);row.planarConductorLengthM+=segments.reduce((n,s)=>n+length(s)*(s.circuits.find(x=>x.circuitId===c.id)?.passes??0)*3,0);row.extraConductorLengthM+=(c.estimatedLengthM-c.routeLengthM)*3;}
 return {schemaVersion:1,conditionsSHA256,segments,materials:[...materials.values()].sort((a,b)=>a.wireSectionMm2-b.wireSectionMm2).map(r=>({...r,planarConductorLengthM:round(r.planarConductorLengthM),extraConductorLengthM:round(r.extraConductorLengthM)})),summary:{segments:segments.length,sharedSegments:segments.filter(s=>s.circuits.length>1).length,uniquePlanarLengthM:round(segments.reduce((n,s)=>n+length(s),0)),planarTraversalLengthM:round(segments.reduce((n,s)=>n+length(s)*s.traversals,0)),maximumCoincidentCircuits:Math.max(0,...segments.map(s=>s.circuits.length)),maximumTraversals:Math.max(0,...segments.map(s=>s.traversals))},scope:'Planar route accounting only. Repeated traversals remain separate; crossings are not electrical junctions. Three base L/N/PE conductors per traversal; switching/vertical conductors, conduit selection/fill, joints and installation allowance authority remain pending.',professionalApproval:false};
}

export function routeScheduleRows(schedule){return [['segment','startXmm','startYmm','endXmm','endYmm','planarLengthM','traversals','circuitsAndPasses','baseSectionsMm2','scope'],...schedule.segments.map(s=>[s.label,...s.start,...s.end,s.lengthM,s.traversals,s.circuits.map(c=>c.circuitId+' x'+c.passes).join('; '),s.circuits.map(c=>c.circuitId+':'+c.wireSectionMm2).join('; '),schedule.scope])];}
