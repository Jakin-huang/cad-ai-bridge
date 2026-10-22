import crypto from 'node:crypto';
const round=n=>Math.round(n*1e6)/1e6;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function auditRouteSchedule(m){
 const s=m.routeSchedule;if(!s&&m.engineVersion!=='1.16.0')return [];
 const checks=[],add=(id,ok,detail)=>checks.push({id,ok,detail,refs:[]});
 try{
  if(!s||!Array.isArray(s.segments)||s.segments.length>10000)throw Error('Missing or oversized segment schedule');
  add('route_schedule_basis',s.schemaVersion===1&&s.conditionsSHA256===m.routingBasis?.conditionsSHA256&&s.professionalApproval===false,'Schedule is tied to current routing conditions and remains unapproved');
  const legs=[];for(const r of m.routes)for(let i=1;i<r.vertices.length;i++){const a=r.vertices[i-1].map(n=>Math.round(n*1e6)),b=r.vertices[i].map(n=>Math.round(n*1e6));if(same(a,b))continue;const axis=a[1]===b[1]?0:a[0]===b[0]?1:-1;if(axis<0)throw Error('Non-orthogonal source leg');legs.push({axis,k:a[1-axis],lo:Math.min(a[axis],b[axis]),hi:Math.max(a[axis],b[axis]),circuitId:r.circuitId,routeId:r.id,legIndex:i-1});}
  if(legs.length>10000)throw Error('Source leg budget');
  const seen=new Set(),coverage=new Map(legs.map(l=>[l.routeId+':'+l.legIndex,[]])),segmentGeometry=[],materials=new Map();let work=0,complete=true;
  for(const [index,row]of s.segments.entries()){
   const a=row.start.map(n=>Math.round(n*1e6)),b=row.end.map(n=>Math.round(n*1e6)),axis=a[1]===b[1]?0:a[0]===b[0]?1:-1;if(axis<0||a[axis]>=b[axis])throw Error('Invalid atomic segment');
   const lo=a[axis],hi=b[axis],k=a[1-axis],key=axis+':'+k+':'+lo+':'+hi;if(seen.has(key))throw Error('Duplicate atomic segment');seen.add(key);segmentGeometry.push({axis,k,lo,hi});
   if(row.id!=='RS_'+hash([row.start,row.end]).slice(0,16)||row.label!=='T'+String(index+1).padStart(3,'0')||row.lengthM!==round((hi-lo)/1e9))complete=false;
   const expected=[];for(const leg of legs){if(++work>2000000)throw Error('Verification comparison budget');
    if(leg.axis===axis&&leg.k===k){if(leg.lo>lo&&leg.lo<hi||leg.hi>lo&&leg.hi<hi)complete=false;if(leg.lo<=lo&&leg.hi>=hi)expected.push({circuitId:leg.circuitId,routeId:leg.routeId,legIndex:leg.legIndex});}
    else if(leg.axis!==axis&&leg.k>lo&&leg.k<hi&&k>=leg.lo&&k<=leg.hi)complete=false;
   }
   expected.sort((a,b)=>a.circuitId.localeCompare(b.circuitId)||a.routeId.localeCompare(b.routeId)||a.legIndex-b.legIndex);
   if(!expected.length||!same(row.members,expected)||row.traversals!==expected.length)complete=false;
   const counts=new Map();for(const ref of expected){coverage.get(ref.routeId+':'+ref.legIndex).push([lo,hi]);counts.set(ref.circuitId,(counts.get(ref.circuitId)||0)+1);}
   const expectedCircuits=[...counts].map(([circuitId,passes])=>{const c=m.circuits.find(c=>c.id===circuitId);return {circuitId,passes,conductors:c?.conductors,wireSectionMm2:c?.wireSectionMm2};});if(!same(row.circuits,expectedCircuits))complete=false;
  }
  for(const leg of legs){const spans=coverage.get(leg.routeId+':'+leg.legIndex).sort((a,b)=>a[0]-b[0]);let cursor=leg.lo;for(const [lo,hi]of spans){if(lo!==cursor)complete=false;cursor=hi;}if(cursor!==leg.hi)complete=false;}
  add('route_schedule_full_coverage',complete,'Every atomic interval and crossing is split; exact circuit/leg multiplicity reconstructs every original route without gaps, duplication or lost return runs');
  const unique=segmentGeometry.reduce((n,r)=>n+(r.hi-r.lo)/1e9,0),traversal=legs.reduce((n,r)=>n+(r.hi-r.lo)/1e9,0),summary={segments:s.segments.length,sharedSegments:s.segments.filter(r=>r.circuits.length>1).length,uniquePlanarLengthM:round(unique),planarTraversalLengthM:round(traversal),maximumCoincidentCircuits:Math.max(0,...s.segments.map(r=>r.circuits.length)),maximumTraversals:Math.max(0,...s.segments.map(r=>r.members.length))};
  add('route_schedule_totals',same(s.summary,summary),'Unique path length and per-circuit traversal length remain separate and independently reconcile');
  for(const c of m.circuits){const key=String(c.wireSectionMm2);if(!materials.has(key))materials.set(key,{wireSectionMm2:c.wireSectionMm2,conductorsPerTraversal:3,planarConductorLengthM:0,extraConductorLengthM:0});const item=materials.get(key);if(c.conductors!=='L+N+PE')throw Error('Unsupported conductor declaration');item.planarConductorLengthM+=legs.filter(l=>l.circuitId===c.id).reduce((n,l)=>n+(l.hi-l.lo)/1e9*3,0);item.extraConductorLengthM+=(c.estimatedLengthM-c.routeLengthM)*3;}
  const expectedMaterials=[...materials.values()].sort((a,b)=>a.wireSectionMm2-b.wireSectionMm2).map(v=>({...v,planarConductorLengthM:round(v.planarConductorLengthM),extraConductorLengthM:round(v.extraConductorLengthM)}));add('route_schedule_base_materials',same(s.materials,expectedMaterials),'Three declared base L/N/PE conductors per route traversal; planar and extra allowances separate, no control-wire or conduit quantity certification');
  if(m.scene){const sheets=m.sheets.filter(s=>s.id==='E06'||s.id.startsWith('E06-')),texts=m.scene.entities.filter(e=>e.kind==='text'&&sheets.some(s=>e.position[0]>=s.region.min[0]&&e.position[0]<=s.region.max[0])).map(e=>e.text),joined=texts.join('');add('drawing_route_schedule',sheets.length>0&&s.segments.every(r=>{const parts=texts.filter(t=>t.startsWith(r.label+' | ')||t.startsWith(r.label+' 续 |'));const actual=parts.map(t=>t.replace(r.label+' 续 | ','')).join(' '),expected=r.label+' | '+r.start.map(n=>n.toFixed(3)).join(',')+' -> '+r.end.map(n=>n.toFixed(3)).join(',')+' | '+r.lengthM.toFixed(3)+'m | '+r.traversals+'次 | '+r.circuits.map(c=>'Q'+String(m.circuits.findIndex(x=>x.id===c.circuitId)+1).padStart(2,'0')+'x'+c.passes).join(' ');return texts.filter(t=>t.startsWith(r.label+' | ')).length===1&&actual===expected;})&&m.circuits.every((c,i)=>joined.includes('Q'+String(i+1).padStart(2,'0')+'='+c.id))&&joined.includes('交叉点不代表电气连接')&&joined.includes('管槽容量及控制线待审'),'CAD schedule contains every segment once, circuit alias legend and explicit unapproved installation limits');}
 }catch(error){add('route_schedule_contract',false,error.message);}
 return checks;
}
