// Join explicitly selected source LINE entities. Never snap endpoints or close gaps.
const key=p=>p.map(h=>h.toUpperCase()).join('/');
const point=p=>Array.isArray(p)&&p.length>=2&&p.length<=3&&p.every(Number.isFinite);
const pointKey=p=>JSON.stringify([p[0],p[1],p[2]??0]);
export function assembleBoundaryGroup(rows,group,layers){
 const fail=reason=>({ok:false,reason});
 const paths=group.instancePaths.map(key);
 if(paths.length<3||paths.length>200||new Set(paths).size!==paths.length)return fail('A boundary group requires 3–200 distinct source segments');
 const edges=[];
 for(const path of paths){
  const matches=rows.filter(e=>key(e.instancePath??[e.handle])===path);
  if(matches.length!==1)return fail('Boundary source segment is missing or ambiguous: '+path);
  const e=matches[0];
  if(e.type!=='LINE'||!layers.some(l=>l.toUpperCase()===e.layer?.toUpperCase())||!point(e.start)||!point(e.end))return fail('Boundary group requires finite LINE segments on declared boundary layers: '+path);
  const a=pointKey(e.start),b=pointKey(e.end);
  if(a===b)return fail('Boundary group contains a zero-length segment: '+path);
  edges.push({path,a,b,start:[...e.start],end:[...e.end]});
 }
 const adjacency=new Map();
 for(const [i,e]of edges.entries())for(const k of [e.a,e.b]){if(!adjacency.has(k))adjacency.set(k,[]);adjacency.get(k).push(i);}
 if([...adjacency.values()].some(v=>v.length!==2))return fail('Boundary endpoints must form an exact closed cycle; gaps and branches are not repaired');
 const used=new Set(),vertices=[],ordered=[];let at=edges[0].a;
 for(let count=0;count<edges.length;count++){
  const i=adjacency.get(at).find(i=>!used.has(i));
  if(i===undefined)return fail('Boundary group contains disconnected cycles');
  const e=edges[i],forward=e.a===at;vertices.push(forward?e.start:e.end);ordered.push(e.path.split('/'));used.add(i);at=forward?e.b:e.a;
 }
 if(at!==edges[0].a)return fail('Boundary group is not closed');
 return {ok:true,vertices,instancePaths:ordered};
}
