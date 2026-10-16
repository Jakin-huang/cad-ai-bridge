import {tag,curveLength} from './dxf-audit.mjs';
const near=(a,b)=>a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<1e-5);
const pt=e=>[Number(tag(e,10,0)),Number(tag(e,20,0)),Number(tag(e,30,0))];
function points(entity){const ps=[];for(const [code,value]of entity.pairs){if(code===10)ps.push([Number(value),0,0]);else if(code===20)ps.at(-1)[1]=Number(value);}return ps;}
function matchPrimitive(p,e){
 if(p.layer!==tag(e,8,'0'))return false;
 if(p.kind==='text')return e.type==='TEXT'&&p.text===tag(e,1)&&near(p.position,pt(e))&&Math.abs(p.height-Number(tag(e,40)))<1e-6&&Math.abs(p.rotationRadians-Number(tag(e,50,0))*Math.PI/180)<1e-6;
 if(p.kind==='circle')return e.type==='CIRCLE'&&near(p.position,pt(e))&&Math.abs(p.radius-Number(tag(e,40)))<1e-6;
 return e.type==='LWPOLYLINE'&&Number(Boolean(p.closed))===(Number(tag(e,70,0))&1)&&points(e).length===p.points.length&&p.points.every((v,i)=>near(v,points(e)[i]));
}
export function verifySchoolReadback(model,snapshot,dxf){
 const checks=[],check=(name,ok,detail)=>checks.push({name,ok,...(detail===undefined?{}:{detail})}),byId=new Map(snapshot.devices.map(d=>[d.id,d]));
 check('DWG fresh process device count',snapshot.deviceCount===model.devices.length);
 check('DWG fresh process route count',snapshot.routeCount===model.routes.length);
 check('DWG persisted identity/position/model/number/circuit',model.devices.every(d=>{const a=byId.get(d.id);return a&&a.blockName===d.blockName&&near(a.position,d.position)&&Object.entries(d.attributes).every(([k,v])=>a.attributes[k]===v);}));
 check('DWG endpoint and numbering validation',snapshot.issues.length===0,snapshot.issues);
 const routeIndex=new Map(snapshot.routes.map(r=>[r.id,r]));
 check('DWG persisted routes and lengths',model.routes.every(w=>{const a=routeIndex.get(w.id);return a&&a.circuitId===w.circuitId&&a.from===w.from&&a.to===w.to&&a.vertices.length===w.vertices.length&&a.vertices.every((v,i)=>near(v,w.vertices[i]))&&Math.abs(a.lengthMm-w.lengthMm)<1e-4;}));
 const inserts=dxf.roots.filter(e=>e.type==='INSERT'),byNumber=new Map(inserts.map(e=>[dxf.attributes.get(e.handle)?.DEVICE_ID,e]));
 check('Independent DXF device attributes and positions',inserts.length===model.devices.length&&model.devices.every(d=>{const a=byNumber.get(d.attributes.DEVICE_ID),attrs=a&&dxf.attributes.get(a.handle);return a&&tag(a,2)===d.blockName&&tag(a,8)===d.layer&&near(pt(a),d.position)&&Object.entries(d.attributes).every(([k,v])=>attrs[k]===v);}));
 const handles=new Set(snapshot.routes.map(r=>r.handle.toUpperCase())),lines=dxf.roots.filter(e=>handles.has(e.handle));
 const byHandle=new Map(lines.map(l=>[l.handle,l]));
 check('Independent DXF route geometry, layers and lengths',lines.length===model.routes.length&&model.routes.every(w=>{const a=routeIndex.get(w.id),l=a&&byHandle.get(a.handle.toUpperCase()),ps=l&&points(l);return l&&tag(l,8)===w.layer&&ps.length===w.vertices.length&&ps.every((v,i)=>near(v,w.vertices[i]))&&Math.abs(curveLength(l)-w.lengthMm)<1e-5;}));
 const unmatched=dxf.roots.filter(e=>!['INSERT'].includes(e.type)&&!handles.has(e.handle));
 let matched=0;for(const p of model.scene.entities){const i=unmatched.findIndex(e=>matchPrimitive(p,e));if(i<0)break;unmatched.splice(i,1);matched++;}
 check('Independent DXF all static sheet geometry and text',matched===model.scene.entities.length&&unmatched.length===0,{expected:model.scene.entities.length,matched,unexpected:unmatched.length});
 let geometryMatched=0;for(const symbol of model.scene.symbols){const block=dxf.records.find(e=>e.section==='BLOCKS'&&e.type==='BLOCK'&&tag(e,2)===symbol.name);if(!block)continue;const start=dxf.records.indexOf(block),end=dxf.records.findIndex((e,i)=>i>start&&e.type==='ENDBLK');const geometry=dxf.records.slice(start+1,end).filter(e=>e.type!=='ATTDEF');for(const p of symbol.geometry){const i=geometry.findIndex(e=>matchPrimitive(p,e));if(i>=0){geometry.splice(i,1);geometryMatched++;}}}
 check('Independent DXF original symbol geometry',geometryMatched===model.scene.symbols.reduce((n,s)=>n+s.geometry.length,0));
 if(model.scene.view){const active=dxf.records.find(e=>e.type==='VPORT'&&tag(e,2)==='*Active'),v=model.scene.view;check('Saved DWG initial view opens the first sheet',Boolean(active)&&near([Number(tag(active,12)),Number(tag(active,22)),0],v.center)&&Number(tag(active,40))>=v.height-1e-4&&Number(tag(active,40))*Number(tag(active,41))>=v.width-1e-4);}
 if(model.scene.views)check('Saved DWG named views locate every sheet',model.scene.views.every(v=>{const a=dxf.records.find(e=>e.type==='VIEW'&&tag(e,2)===v.name);return a&&near(pt(a),v.center)&&Math.abs(Number(tag(a,40))-v.height)<1e-5&&Math.abs(Number(tag(a,41))-v.width)<1e-5;}));
 return {ok:checks.every(c=>c.ok),checks};
}
