// Source text composition is an explicit interpretation, never a room-use or
// standard classification. Suggestions alone do not change the room schedule.
export const architecturalTextKey=e=>(e.instancePath||[e.handle]).map(h=>h.toUpperCase()).join('/');
export const normalizeArchitecturalText=v=>String(v??'').replace(/\\P/g,' ').replace(/\\[A-Za-z][^;]*;/g,'').replace(/[{}]/g,'').replace(/\s/g,'');
const finite=p=>Array.isArray(p)&&p.length>=2&&p.every(Number.isFinite);
export function labelAnchor(e){const b=e.bounds;if(b&&finite(b.min)&&finite(b.max)&&b.max[0]>=b.min[0]&&b.max[1]>=b.min[1])return [(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2];return finite(e.position)?e.position.slice(0,2):undefined;}
const basis=(e,name)=>e['definition_'+name]??e[name];
function worldVector(e,name,index){
 let v=basis(e,name);if(!finite(v)||v.length!==3)return;
 const parents=(e.instancePath||[e.handle]).slice(0,-1);
 for(let i=parents.length-1;i>=0;i--){const p=index.get(parents.slice(0,i+1).join('/').toUpperCase());if(!p||p.type!=='INSERT')return;const x=basis(p,'basisX'),y=basis(p,'basisY'),z=basis(p,'basisZ');if(![x,y,z].every(a=>finite(a)&&a.length===3))return;v=v.map((_,n)=>x[n]*v[0]+y[n]*v[1]+z[n]*v[2]);}
 return v;
}
function textMetrics(e,index){
 if(e.type!=='TEXT'||!finite(e.position)||!e.bounds||!finite(e.bounds.min)||!finite(e.bounds.max))return;
 const x=worldVector(e,'basisX',index),y=worldVector(e,'basisY',index);if(!x||!y||!(x[0]>0&&y[1]>0)||Math.hypot(x[1],x[2])>1e-6*x[0]||Math.hypot(y[0],y[2])>1e-6*y[1])return;
 const height=y[1];if(!(height>0)||e.bounds.max[0]<e.bounds.min[0]||e.bounds.max[1]<e.bounds.min[1])return;
 return {height,baseline:e.position[1],elevation:e.position[2]??0,left:e.bounds.min[0],right:e.bounds.max[0]};
}
function adjacent(a,b,index){
 if(a.layer?.toUpperCase()!==b.layer?.toUpperCase()||architecturalTextKey(a).split('/').slice(0,-1).join('/')!==architecturalTextKey(b).split('/').slice(0,-1).join('/'))return false;
 const x=textMetrics(a,index),y=textMetrics(b,index);if(!x||!y)return false;const h=Math.min(x.height,y.height),gap=y.left-x.right;
 return Math.max(x.height,y.height)<=2*h&&Math.abs(x.baseline-y.baseline)<=.15*h&&Math.abs(x.elevation-y.elevation)<=.001&&b.position[0]>a.position[0]&&gap>=-.25*h&&gap<=.5*h;
}
const member=e=>({instancePath:e.instancePath||[e.handle],text:e.text,position:e.position,bounds:e.bounds});
export function composeArchitecturalLabel(paths,labels,rows){
 const index=new Map(rows.map(e=>[architecturalTextKey(e),e])),members=paths.map(p=>{const matches=labels.filter(e=>architecturalTextKey(e)===p.map(h=>h.toUpperCase()).join('/'));return matches.length===1?matches[0]:undefined;});
 if(members.some(e=>!e)||new Set(paths.map(p=>p.map(h=>h.toUpperCase()).join('/'))).size!==paths.length)return {ok:false,reason:'Source text members must exist exactly once on the declared label layers'};
 if(members.length<2||members.some((e,i)=>i&&!adjacent(members[i-1],e,index)))return {ok:false,reason:'Only ordered, adjacent horizontal TEXT in one source block and layer is supported; transformed bases, baseline, height, elevation and bounded gaps must agree'};
 const bounds={min:[Math.min(...members.map(e=>e.bounds.min[0])),Math.min(...members.map(e=>e.bounds.min[1]))],max:[Math.max(...members.map(e=>e.bounds.max[0])),Math.max(...members.map(e=>e.bounds.max[1]))]};
 return {ok:true,label:{...members[0],text:members.map(e=>e.text).join(''),bounds},members:members.map(member),interpretation:'Explicit source-fragment concatenation, screened by geometry; not semantic or architectural approval'};
}
export function inspectArchitecturalText(rows,labels,{ignoredLabels=[],expectedRooms=[]}={}){
 if(labels.length>1000)return {complete:false,sourceLabelCount:labels.length,budget:1000,suggestedAssemblies:[],retainedIgnoredText:[]};
 const index=new Map(rows.map(e=>[architecturalTextKey(e),e])),out=new Map(),incoming=new Map();
 for(const a of labels)for(const b of labels)if(a!==b&&adjacent(a,b,index)){const k=architecturalTextKey(a),v=architecturalTextKey(b);out.set(k,[...(out.get(k)||[]),b]);incoming.set(v,[...(incoming.get(v)||[]),a]);}
 const next=e=>{const matches=out.get(architecturalTextKey(e))||[];return matches.length===1&&incoming.get(architecturalTextKey(matches[0]))?.length===1?matches[0]:undefined;},previous=new Set(labels.flatMap(e=>next(e)?[architecturalTextKey(next(e))]:[])),chains=[];
 for(const e of labels.filter(e=>!previous.has(architecturalTextKey(e)))){const chain=[e];let n;while((n=next(chain.at(-1)))&&chain.length<=1000)chain.push(n);chains.push(chain);}
 const ignored=new Map(ignoredLabels.map(i=>[i.instancePath.map(h=>h.toUpperCase()).join('/'),i.reason])),roomMembers=new Map();for(const r of expectedRooms)for(const label of [r,...(r.aliases||[])])for(const p of label.labelInstancePaths||[label.labelInstancePath].filter(Boolean))roomMembers.set(p.map(h=>h.toUpperCase()).join('/'),r.id);
 const describe=chain=>{const points=chain.map(labelAnchor).filter(Boolean);return {text:chain.map(e=>e.text).join(''),members:chain.map(member),anchor:points.length?[points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length]:undefined};};
 const suggestedAssemblies=chains.filter(c=>c.length>1&&c.length<=20).map(c=>({...describe(c),automaticallyApplied:false,relatedRooms:[...new Set(c.flatMap(e=>roomMembers.has(architecturalTextKey(e))?[roomMembers.get(architecturalTextKey(e))]:[]))]}));
 const retainedIgnoredText=chains.filter(c=>c.some(e=>ignored.has(architecturalTextKey(e)))).map(c=>{const d=describe(c);return {...d,excludedMembers:c.filter(e=>ignored.has(architecturalTextKey(e))).map(e=>({instancePath:e.instancePath||[e.handle],reason:ignored.get(architecturalTextKey(e))})),potentialProjectCondition:/[≥≤><=]|净面积|兼用|兼避难|窗台|[0-9]+\s*(?:平米|㎡|mm|米|m2|m²|床)/i.test(d.text),disposition:'Retained for explicit requirement/applicability review; spatial exclusion does not discard source text'};});
 return {complete:true,sourceLabelCount:labels.length,budget:1000,sourceLabels:labels.map(e=>({...member(e),excluded:ignored.has(architecturalTextKey(e))})),suggestedAssemblies,retainedIgnoredText,ambiguousAdjacencyCount:labels.filter(e=>(out.get(architecturalTextKey(e))?.length||0)>1||(incoming.get(architecturalTextKey(e))?.length||0)>1).length,scope:'Horizontal single-line TEXT only; adjacency proposals do not infer room use, binding requirements, standards, or project-wide completeness'};
}
