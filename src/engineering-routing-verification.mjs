import crypto from 'node:crypto';

// Independent verification: split every persisted segment at every region
// boundary, then test endpoints and each open interval. No router/grid reuse.
export function auditDeclaredRoutes(m){
 const q=m.input.routingConditions,checks=[],add=(id,ok,detail,refs=[])=>checks.push({id,ok,detail,refs});
 if(!q){if(m.routingBasis)add('routing_unrequested',false,'A routing basis cannot exist without declared input conditions');return checks;}
 const digest=crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex'),sources=new Map(m.input.sources.map(s=>[s.id,s])),eps=1e-6;
 add('routing_source_basis',m.routingBasis?.mode===q.mode&&m.routingBasis?.conditionsSHA256===digest&&m.routingBasis?.clearanceMm===q.clearanceMm&&JSON.stringify(m.routingBasis?.sourceIds)===JSON.stringify(q.sourceIds)&&[q,...q.allowedRegions,...q.exclusions].every(r=>r.sourceIds.every(id=>sources.has(id)&&!sources.get(id).supersededBy)),'Routing conditions and their current sources match the persisted model basis',q.sourceIds);
 add('routing_circuit_coverage',m.routes.length===m.circuits.length&&new Set(m.routes.map(r=>r.circuitId)).size===m.circuits.length&&m.routes.every(r=>m.circuits.some(c=>c.id===r.circuitId)),'Every circuit has exactly one independently checked route');
 const blocked=q.exclusions.map(r=>({min:r.min.map(x=>x-q.clearanceMm),max:r.max.map(x=>x+q.clearanceMm)})),regions=[...q.allowedRegions,...blocked];
 const permitted=p=>q.allowedRegions.some(r=>p.every((n,i)=>n>=r.min[i]-eps&&n<=r.max[i]+eps))&&!blocked.some(r=>p.every((n,i)=>n>r.min[i]+eps&&n<r.max[i]-eps));
 const onSegment=(p,a,b)=>Math.abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))<=eps*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1]))&&p.every((n,i)=>n>=Math.min(a[i],b[i])-eps&&n<=Math.max(a[i],b[i])+eps);
 const segmentAllowed=(a,b)=>{
  if(Math.abs(a[0]-b[0])>eps&&Math.abs(a[1]-b[1])>eps)return false;
  const cuts=[0,1];for(const r of regions)for(const axis of [0,1])if(Math.abs(b[axis]-a[axis])>eps)for(const v of [r.min[axis],r.max[axis]]){const t=(v-a[axis])/(b[axis]-a[axis]);if(t>0&&t<1)cuts.push(t);}
  cuts.sort((a,b)=>a-b);const points=[...cuts,...cuts.slice(1).map((t,i)=>(t+cuts[i])/2)];return points.every(t=>permitted([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]));
 };
 for(const route of m.routes){
  const ps=route.vertices,c=m.circuits.find(c=>c.id===route.circuitId),ds=c?.deviceIds.map(id=>m.devices.find(d=>d.id===id)),finite=Array.isArray(ps)&&ps.length>0&&ps.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
  add('routing_regions_'+route.circuitId,finite&&ps.every(permitted)&&ps.slice(1).every((b,i)=>segmentAllowed(ps[i],b)),'Every complete segment stays in declared allowed-region union and outside clearance-expanded exclusions',[route.circuitId]);
  add('routing_terminals_'+route.circuitId,finite&&!!c&&Math.hypot(ps[0][0]-m.input.electrical.panelPosition[0],ps[0][1]-m.input.electrical.panelPosition[1])<=eps&&ds.every(d=>d&&ps.some(p=>Math.hypot(p[0]-d.position[0],p[1]-d.position[1])<=eps)||d&&ps.slice(1).some((b,i)=>onSegment(d.position,ps[i],b))),'Continuous route starts at the declared panel and reaches every assigned physical lamp',[route.circuitId]);
 }
 const notes=m.scene.entities.filter(e=>e.kind==='text').map(e=>e.text).join('');
 add('drawing_routing_scope',notes.includes('路径条件：按声明允许区域及禁入区生成正交路径')&&notes.includes('避让 '+q.clearanceMm+'mm')&&notes.includes('立体敷设、穿墙、管线容量及控制接线待审'),'CAD notes expose planar route scope and the declared clearance');
 return checks;
}
