import {z} from 'zod';
import crypto from 'node:crypto';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const coordinate=z.number().finite().min(-1e8).max(1e8);
const point=z.tuple([coordinate,coordinate]);
const basis={sourceIds:z.array(id).min(1).max(20),status:z.enum(['documented','interpreted','assumed']),description:z.string().min(20).max(1000)};
const region=z.strictObject({id,min:point,max:point,...basis}).refine(r=>r.max.every((n,i)=>n-r.min[i]>=1),'Routing rectangles must have positive extent of at least 1 mm');
export const routingConditionsSchema=z.strictObject({
 mode:z.literal('declared_rectilinear_regions'),
 allowedRegions:z.array(region).min(1).max(200),
 exclusions:z.array(region).max(300),
 clearanceMm:z.number().min(1).max(5000),
 ...basis
}).superRefine((p,c)=>{const regions=[...p.allowedRegions,...p.exclusions];if(new Set(regions.map(r=>r.id)).size!==regions.length)c.addIssue({code:'custom',message:'Routing region IDs must be unique'});});
export const routingDigest=p=>crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex');
export function routingAssumptionsPreserved(before,after){
 if(!before)return true;if(!after)return false;
 if(before.status==='assumed'&&after.status!=='assumed')return false;
 return ['allowedRegions','exclusions'].every(k=>before[k].every(r=>r.status!=='assumed'||after[k].find(n=>n.id===r.id)?.status==='assumed'));
}
export function routingAuthority(q){const all=[q,...q.allowedRegions,...q.exclusions];return all.some(r=>r.status==='assumed')?'assumed':all.some(r=>r.status==='interpreted')?'interpreted':'declared';}
export function routingConditionIssues(p){
 if(!p.routingConditions)return [];
 const q=p.routingConditions,sources=new Map(p.sources.map(s=>[s.id,s])),issues=[];
 for(const r of [q,...q.allowedRegions,...q.exclusions])for(const id of r.sourceIds)if(!sources.has(id)||sources.get(id).supersededBy)issues.push({code:'ROUTING_SOURCE_NOT_CURRENT',severity:'blocking',message:'Routing conditions require an existing current source: '+id,refs:[id]});
 issues.push({code:'ROUTING_INSTALLATION_REVIEW',severity:'review',message:'Declared planar allowed areas and exclusion clearances only. Source semantics, ceiling elevations, wall penetrations, vertical lengths, conduit capacity, switch wiring and installation/protection coordination remain pending.',refs:q.sourceIds});
 return issues;
}

const eps=1e-6,round=n=>Math.round(n*1e6)/1e6;
const key=p=>p.map(round).join(',');
const within=(p,r)=>p.every((n,i)=>n>=r.min[i]-eps&&n<=r.max[i]+eps);
const strictlyWithin=(p,r)=>p.every((n,i)=>n>r.min[i]+eps&&n<r.max[i]-eps);
function permits(a,b,allowed,blocked){
 const axis=Math.abs(a[0]-b[0])<=eps?1:Math.abs(a[1]-b[1])<=eps?0:-1;if(axis<0)return false;
 const other=1-axis,lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
 if(blocked.some(r=>a[other]>r.min[other]+eps&&a[other]<r.max[other]-eps&&Math.min(hi,r.max[axis])-Math.max(lo,r.min[axis])>eps))return false;
 const intervals=allowed.filter(r=>a[other]>=r.min[other]-eps&&a[other]<=r.max[other]+eps).map(r=>[Math.max(lo,r.min[axis]),Math.min(hi,r.max[axis])]).filter(([l,h])=>h>=l-eps).sort((a,b)=>a[0]-b[0]);
 let covered=lo;for(const [l,h]of intervals){if(l>covered+eps)return false;covered=Math.max(covered,h);if(covered>=hi-eps)return true;}return false;
}
class MinHeap{
 items=[];
 push(item){const a=this.items;let i=a.length;a.push(item);while(i){const parent=(i-1)>>1;if(a[parent][0]<=item[0])break;a[i]=a[parent];i=parent;}a[i]=item;}
 pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&a[child+1][0]<a[child][0])child++;if(a[child][0]>=last[0])break;a[i]=a[child];i=child;}a[i]=last;}return first;}
 get length(){return this.items.length;}
}

// The graph is derived from input regions and terminals, never a final drawing.
// Limits bound CPU/memory; exhaustion is distinct from disconnected geometry.
export function compileDeclaredRouter(conditions,terminals,{maxNodes=20000,maxSearchWork=2000000}={}){
 const q=routingConditionsSchema.parse(conditions),allowed=q.allowedRegions,blocked=q.exclusions.map(r=>({...r,min:r.min.map(n=>n-q.clearanceMm),max:r.max.map(n=>n+q.clearanceMm)}));
 const values=[0,1].map(axis=>[...new Set([...terminals.map(p=>round(p[axis])),...allowed.flatMap(r=>[round(r.min[axis]),round(r.max[axis])]),...blocked.flatMap(r=>[round(r.min[axis]),round(r.max[axis])])])].sort((a,b)=>a-b));
 if(values[0].length*values[1].length>maxNodes)throw Error('ROUTING_GRID_BUDGET: declared geometry exceeds rectilinear grid budget; no infeasibility claim');
 const nodes=[],indices=new Map(),valid=p=>allowed.some(r=>within(p,r))&&!blocked.some(r=>strictlyWithin(p,r));
 for(const x of values[0])for(const y of values[1])if(valid([x,y])){indices.set(key([x,y]),nodes.length);nodes.push([x,y]);}
 for(const t of terminals)if(!indices.has(key(t)))throw Error('ROUTING_TERMINAL_OUTSIDE_ALLOWED: '+key(t));
 const adjacency=nodes.map(()=>[]),connect=(a,b)=>{const i=indices.get(key(a)),j=indices.get(key(b));if(i===undefined||j===undefined||!permits(a,b,allowed,blocked))return;const distance=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);adjacency[i].push([j,distance]);adjacency[j].push([i,distance]);};
 for(let x=0;x<values[0].length;x++)for(let y=0;y<values[1].length;y++){const p=[values[0][x],values[1][y]];if(x)connect(p,[values[0][x-1],p[1]]);if(y)connect(p,[p[0],values[1][y-1]]);}
 const cache=new Map();let work=0;
 function tree(start){
  if(cache.has(start)){const value=cache.get(start);cache.delete(start);cache.set(start,value);return value;}
  const distances=new Float64Array(nodes.length).fill(Infinity),parents=new Int32Array(nodes.length).fill(-1),heap=new MinHeap();distances[start]=0;heap.push([0,start]);
  while(heap.length){const [distance,i]=heap.pop();if(distance!==distances[i])continue;if(++work>maxSearchWork)throw Error('ROUTING_SEARCH_BUDGET: path search budget exhausted; no infeasibility claim');for(const [j,length]of adjacency[i]){const next=distance+length;if(next<distances[j]){distances[j]=next;parents[j]=i;heap.push([next,j]);}}}
  const value={distances,parents};cache.set(start,value);if(cache.size>8)cache.delete(cache.keys().next().value);return value;
 }
 function pathBetween(a,b){
  const start=indices.get(key(a)),end=indices.get(key(b));if(start===undefined||end===undefined)throw Error('ROUTING_TERMINAL_NOT_REGISTERED');if(start===end)return [nodes[start]];
  const {distances,parents}=tree(start);if(!Number.isFinite(distances[end]))throw Error('ROUTING_NO_DECLARED_PATH: '+key(a)+' -> '+key(b)+'; no path in the declared planar region union');
  const route=[];for(let i=end;i!==-1;i=parents[i]){route.push(nodes[i]);if(i===start)break;}route.reverse();const simplified=[];for(const p of route){while(simplified.length>1){const a=simplified.at(-2),b=simplified.at(-1),u=[b[0]-a[0],b[1]-a[1]],v=[p[0]-b[0],p[1]-b[1]];if(u[0]*v[1]-u[1]*v[0]!==0||u[0]*v[0]+u[1]*v[1]<=0)break;simplified.pop();}simplified.push(p);}return simplified;
 }
 return {basis:{mode:q.mode,conditionsSHA256:routingDigest(q),sourceIds:q.sourceIds,clearanceMm:q.clearanceMm,gridNodes:nodes.length,maxNodes,maxSearchWork,scope:'Shortest rectilinear links in declared planar regions; fixed device visit order, conservative full-circuit-current length. Not 3D installation, switching or protection approval.'},route(selected,door,electrical){
  const sorted=[...selected].sort((a,b)=>Math.hypot(a.position[0]-door[0],a.position[1]-door[1])-Math.hypot(b.position[0]-door[0],b.position[1]-door[1]));
  const vertices=[[...electrical.panelPosition]];let last=electrical.panelPosition;for(const d of sorted){vertices.push(...pathBetween(last,d.position).slice(1));last=d.position;}
  return vertices.map(p=>p.map(round));
 }};
}
