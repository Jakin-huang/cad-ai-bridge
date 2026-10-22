// Read the persisted CAD scene, not the drawing generator or its point index.
export function auditInstallationPlans(model){
 if(!model.installation||!model.scene)return [];
 const checks=[],close=(a,b)=>Math.abs(a-b)<1e-5;
 for(const c of model.installation.circuits){
  const pages=model.sheets.filter(s=>s.id.startsWith('E08-')&&s.installationPlan?.circuitId===c.circuitId),coords=new Map();let ok=pages.length>0;
  const wanted=new Set();for(const r of c.runs)for(let i=1;i<r.vertices.length;i++){const a=r.vertices[i-1].slice(0,2),b=r.vertices[i].slice(0,2);if(JSON.stringify(a)!==JSON.stringify(b))wanted.add([JSON.stringify(a),JSON.stringify(b)].sort().join('|'));}
  const entities=s=>model.scene.entities.filter(e=>(e.position??e.points?.[0])?.[0]>=s.region.min[0]&&(e.position??e.points?.[0])?.[0]<=s.region.max[0]);
  for(const s of pages){
   const meta=s.installationPlan,es=entities(s),inverse=p=>[0,1].map(i=>(p[i]-(i===0?s.origin[0]:0)-meta.offset[i])/meta.scale),actual=es.filter(e=>e.kind==='line'&&e.layer==='E-INSTALL-PATH');
   ok&&=Number.isFinite(meta.scale)&&meta.scale>0&&actual.length===wanted.size;
   const world=p=>inverse(p).map((v,i)=>v+meta.worldMin[i]);
   for(const key of wanted){const [a,b]=key.split('|').map(JSON.parse);ok&&=actual.some(e=>{const ps=e.points.map(world);return [ps,[...ps].reverse()].some(pair=>pair.every((p,i)=>p.every((v,k)=>close(v,[a,b][i][k]))));});}
   const refs=es.filter(e=>e.kind==='line'&&e.layer==='E-INSTALL-REF'),labels=es.filter(e=>e.kind==='text'&&/^V\d+  X=/.test(e.text));ok&&=refs.length===labels.length*12;
   for(const e of labels){const match=/^(V\d+)  X=([-\d.]+) Y=([-\d.]+)$/.exec(e.text);if(!match){ok=false;continue;}ok&&=!coords.has(match[1]);coords.set(match[1],[Number(match[2]),Number(match[3])]);const xy=coords.get(match[1]),a=xy.map((v,i)=>(v-meta.worldMin[i])*meta.scale+meta.offset[i]+(i===0?s.origin[0]:0)),b=[s.origin[0]+23500,e.position[1]];
    for(let part=0;part<12;part++){const endpoints=[2*part/23,(2*part+1)/23].map(t=>a.map((v,i)=>v+t*(b[i]-v)));ok&&=refs.some(l=>l.points.every((p,i)=>p.slice(0,2).every((v,k)=>Math.abs(v-endpoints[i][k])<Math.max(.01,.00051*meta.scale))));}
   }
  }
  const ci=model.installation.circuits.indexOf(c),label='Q'+String(ci+1).padStart(2,'0');
  const pathPages=model.sheets.filter(s=>s.id.startsWith('E09-'+label+'-')),rows=pathPages.flatMap(s=>entities(s).filter(e=>e.kind==='text').map(e=>e.text)),used=new Set();
  for(const r of c.runs){const tokens=rows.filter(t=>t.startsWith(r.id+' | ')).flatMap(t=>t.slice((r.id+' | ').length).split(' > '));ok&&=tokens.length===r.vertices.length;for(const [i,token]of tokens.entries()){const [id,z]=token.split('@'),xy=coords.get(id);used.add(id);ok&&=!!xy&&!!r.vertices[i]&&[...xy,Number(z)].every((v,k)=>Math.abs(v-r.vertices[i][k])<.00051);}}
  ok&&=coords.size===used.size&&rows.filter(t=>/^W\d+ \| /.test(t)).every(t=>c.runs.some(r=>t.startsWith(r.id+' | ')));
  checks.push({id:'installation_plan_'+c.circuitId,ok,detail:'Every projected segment, located coordinate leader and full XYZ run sequence reconciles with the persisted electrical graph',refs:[]});
 }
 return checks;
}
