import {tag} from './dxf-audit.mjs';

export function blockIndex(dxf){
 const blocks=new Map();let current;
 for(const e of dxf.records.filter(e=>e.section==='BLOCKS')){
  if(e.type==='BLOCK'){current={name:tag(e,2),handle:e.handle,origin:[+tag(e,10,0),+tag(e,20,0)],entities:[]};blocks.set(current.name,current);}
  else if(e.type==='ENDBLK')current=null;else if(current)current.entities.push(e);
 }
 return blocks;
}
const identity=[1,0,0,1,0,0];
const xy=(m,p)=>[m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5],0];
const compose=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],...xy(a,b.slice(4)).slice(0,2)];
const at=(e,code=10)=>[+tag(e,code,0),+tag(e,code+10,0)];
const clean=s=>s.replace(/%%[uUoO]/g,'').replace(/%%[dD]/g,'°').replace(/%%[pP]/g,'±').replace(/%%[cC]/g,'Φ');
function bulgePoints(ps,closed,size,tolerance){
 const points=[];for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];points.push(a.p);if(!a.b||!closed&&i===ps.length-1)continue;
 const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],len=Math.hypot(dx,dy),r=len*(1+a.b*a.b)/(4*Math.abs(a.b)),h=len*(1-a.b*a.b)/(4*a.b),o=[(a.p[0]+b.p[0])/2-dy/len*h,(a.p[1]+b.p[1])/2+dx/len*h],start=Math.atan2(a.p[1]-o[1],a.p[0]-o[0]),angle=4*Math.atan(a.b),step=2*Math.acos(Math.max(-1,1-tolerance/(r*size))),count=Math.max(2,Math.ceil(Math.abs(angle)/Math.min(Math.PI/8,step)));
 if(count>990)throw Error('Bulge exceeds scene bound');for(let j=1;j<count;j++)points.push([o[0]+r*Math.cos(start+angle*j/count),o[1]+r*Math.sin(start+angle*j/count)]);
 }return points;
}
function triangulate(input){
 const ps=input.filter((p,i)=>!i||Math.hypot(p[0]-input[i-1][0],p[1]-input[i-1][1])>1e-9);if(ps.length>2&&Math.hypot(ps[0][0]-ps.at(-1)[0],ps[0][1]-ps.at(-1)[1])<1e-9)ps.pop();
 if(ps.length<3)throw Error('Degenerate solid boundary');
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const area=ps.reduce((s,p,i)=>s+p[0]*ps[(i+1)%ps.length][1]-p[1]*ps[(i+1)%ps.length][0],0);if(area<0)ps.reverse();
 const remaining=[...ps.keys()],out=[];let guard=0;
 while(remaining.length>3){let found=false;for(let i=0;i<remaining.length;i++){
  const ia=remaining[(i+remaining.length-1)%remaining.length],ib=remaining[i],ic=remaining[(i+1)%remaining.length],a=ps[ia],b=ps[ib],c=ps[ic];
  if(cross(a,b,c)<=1e-12)continue;
  if(remaining.some(j=>![ia,ib,ic].includes(j)&&cross(a,b,ps[j])>=-1e-10&&cross(b,c,ps[j])>=-1e-10&&cross(c,a,ps[j])>=-1e-10))continue;
  out.push([a,b,c]);remaining.splice(i,1);found=true;break;
 }if(!found||++guard>10000)throw Error('Unsupported non-simple solid boundary');}
 out.push(remaining.map(i=>ps[i]));return out;
}
// Fixed curve chord error is recorded in every local profile. No unknown geometry is silently dropped.
export function flattenBlock(blocks,name,{scale=1,rotation=0,tolerance=0.05}={}){
 const geometry=[],evidence=[],ignored=[];const c=Math.cos(rotation),s=Math.sin(rotation);
 const emit=(p,e)=>{geometry.push(p);evidence.push({handle:e.handle,type:e.type});};
 function visit(n,m,stack){
  if(stack.includes(n)||stack.length>24)throw Error('Cyclic or too-deep library block: '+n);
  const b=blocks.get(n);if(!b)throw Error('Missing library block: '+n);
  m=compose(m,[1,0,0,1,-b.origin[0],-b.origin[1]]);
  for(const e of b.entities){
   if(+tag(e,60,0)===1){ignored.push({handle:e.handle,reason:'invisible'});continue;}
   const p=at(e),size=Math.hypot(m[0],m[1]),poly=(points,closed=false,width=0)=>emit({kind:'polyline',layer:'0',points:points.map(v=>xy(m,v)),closed,...(width?{width:width*size}:{})},e);
   const curve=(center,u,v,start,end,closed)=>{const r=Math.max(Math.hypot(...u),Math.hypot(...v))*size,step=r>tolerance?2*Math.acos(1-tolerance/r):Math.PI/8,count=Math.max(8,Math.ceil(Math.abs(end-start)/Math.min(Math.PI/8,step)));if(count>990)throw Error('Curve subdivision exceeds scene bound');poly(Array.from({length:count+(closed?0:1)},(_,i)=>{const a=start+(end-start)*i/count;return [center[0]+u[0]*Math.cos(a)+v[0]*Math.sin(a),center[1]+u[1]*Math.cos(a)+v[1]*Math.sin(a)];}),closed);};
   if(e.type==='INSERT'){
    const a=+tag(e,50,0)*Math.PI/180,sx=+tag(e,41,1),sy=+tag(e,42,1),normal=+tag(e,230,1);if(![1,-1].includes(normal))throw Error('Unsupported insert extrusion');
    visit(tag(e,2),compose(compose(m,[normal,0,0,1,0,0]),[sx*Math.cos(a),sx*Math.sin(a),-sy*Math.sin(a),sy*Math.cos(a),...p]),[...stack,n]);
   }else if(e.type==='LINE')poly([p,at(e,11)]);
   else if(e.type==='CIRCLE'||e.type==='ARC'){
    const r=+tag(e,40);if(e.type==='CIRCLE'&&Math.abs(Math.hypot(m[0],m[1])-Math.hypot(m[2],m[3]))<1e-8)emit({kind:'circle',layer:'0',position:xy(m,p),radius:r*size},e);
    else{const a=+tag(e,50,0)*Math.PI/180;let z=e.type==='CIRCLE'?a+2*Math.PI:+tag(e,51)*Math.PI/180;while(z<=a)z+=2*Math.PI;curve(p,[r,0],[0,r],a,z,e.type==='CIRCLE');}
   }else if(e.type==='ELLIPSE'){
    const u=at(e,11),ratio=+tag(e,40);curve(p,u,[-u[1]*ratio,u[0]*ratio],+tag(e,41,0),+tag(e,42,2*Math.PI),Math.abs(+tag(e,42)-+tag(e,41)-2*Math.PI)<1e-8);
   }else if(e.type==='LWPOLYLINE'){
    const ps=[];let v;for(const [code,value]of e.pairs){if(code===10){v={p:[+value,0],b:0};ps.push(v);}else if(code===20&&v)v.p[1]=+value;else if(code===42&&v)v.b=+value;}
    const closed=(+tag(e,70,0)&1)!==0;poly(bulgePoints(ps,closed,size,tolerance),closed,+tag(e,43,0));
   }else if(e.type==='TEXT'||e.type==='ATTDEF'||e.type==='ATTRIB'){
    if(e.type!=='TEXT'&&(+tag(e,70,0)&1)){ignored.push({handle:e.handle,reason:'invisible attribute'});continue;}
    const value=clean(tag(e,1,''));if(!value.trim())continue;if(e.type!=='TEXT'&&['REMARK','备注'].includes(value)){ignored.push({handle:e.handle,reason:'unassigned remark attribute'});continue;}
    emit({kind:'text',layer:'0',position:xy(m,p),height:+tag(e,40)*size,widthFactor:+tag(e,41,1),text:value,rotationRadians:Math.atan2(m[1],m[0])+(+tag(e,50,0))*Math.PI/180},e);
   }else if(e.type==='SOLID'){
    const pts=[at(e,10),at(e,11),at(e,13),at(e,12)];for(const triangle of triangulate(pts))emit({kind:'solid',layer:'0',points:triangle.map(p=>xy(m,p))},e);
   }else if(e.type==='HATCH'){
    if(tag(e,2)!=='SOLID'||+tag(e,91)!==1)throw Error('Unsupported hatch pattern/holes: '+n+' '+e.handle);
    const begin=e.pairs.findIndex(([code])=>code===92),end=e.pairs.findIndex(([code],i)=>i>begin&&code===97),boundary=e.pairs.slice(begin+1,end),ps=[];
    if(+e.pairs[begin][1]&2){let v;const vertices=[];for(const [code,value]of boundary){if(code===10){v={p:[+value,0],b:0};vertices.push(v);}else if(code===20&&v)v.p[1]=+value;else if(code===42&&v)v.b=+value;}ps.push(...bulgePoints(vertices,true,size,tolerance));}
    else{const edges=[];let edge;for(const pair of boundary){if(pair[0]===72){edge={pairs:[],type:+pair[1]};edges.push(edge);}else if(edge)edge.pairs.push(pair);}
     for(const edge of edges){if(edge.type===1)ps.push(at(edge));else if(edge.type===2){const center=at(edge),radius=+tag(edge,40),start=+tag(edge,50)*Math.PI/180,end=+tag(edge,51)*Math.PI/180,ccw=+tag(edge,73)===1;let sweep=end-start;if(ccw&&sweep<=0)sweep+=2*Math.PI;if(!ccw&&sweep>=0)sweep-=2*Math.PI;const step=2*Math.acos(Math.max(-1,1-tolerance/(radius*size))),count=Math.max(8,Math.ceil(Math.abs(sweep)/Math.min(Math.PI/8,step)));if(count>990)throw Error('Hatch arc exceeds scene bound');for(let i=0;i<count;i++)ps.push([center[0]+radius*Math.cos(start+sweep*i/count),center[1]+radius*Math.sin(start+sweep*i/count)]);}else throw Error('Unsupported hatch edge: '+n);}
    }
    for(const triangle of triangulate(ps))emit({kind:'solid',layer:'0',points:triangle.map(p=>xy(m,p))},e);
   }else if(['POINT','SEQEND'].includes(e.type))ignored.push({handle:e.handle,reason:'non-plotting construction/terminator'});
   else throw Error('Unsupported library geometry: '+n+' '+e.type+' '+e.handle);
  }
 }
 visit(name,[scale*c,scale*s,-scale*s,scale*c,0,0],[]);
 return {geometry,evidence,ignored,toleranceMm:tolerance};
}

export function extractV02Rules(audit){
 const byHandle=new Map(audit.texts.map(t=>[t.handle.toUpperCase(),t]));
 const evidence=(handle,expected)=>{const t=byHandle.get(handle);if(!t||expected&&!t.text.includes(expected))throw Error('V02 source evidence mismatch: '+handle);return {handle,text:t.text,position:t.position};};
 const cell=(x,y)=>{const matches=audit.texts.filter(t=>Math.abs(t.position[0]-x)<400&&Math.abs(t.position[1]-y)<30);if(matches.length!==1)throw Error(`Ambiguous V02 table cell ${x},${y}: ${matches.length}`);return evidence(matches[0].handle);};
 const ratings=[16,20,25,32,40,50,63,80,100,125,160,200];
 const sections=[2.5,4,6,10,16];
 return {
  wire:{type:'WDZN-BYJ',voltage:'450/750V',source:evidence('2603E7','WDZN-BYJ')},
  ordinaryCable:{type:'WDZ-YJY',voltage:'0.6/1kV',source:evidence('2603CA','WDZ-YJY')},
  fireCable:{type:'WDZN-YJY',voltage:'0.6/1kV',source:evidence('2603CB','WDZN-YJY')},
  wireMatch:ratings.map((rating,i)=>({ratingA:rating,singlePhase:cell(-665845,-448717-i*1000),threePhase:cell(-662693,-448717-i*1000)})),
  cableMatch:ratings.map((rating,i)=>({ratingA:rating,conduit:cell(-659455,-448717-i*1000),tray:cell(-652979,-448717-i*1000)})),
  ampacity:sections.map((section,i)=>({sectionMm2:section,wireTwoLoaded:cell(-668575,-425004-i*1000),wireFourLoaded:cell(-666700,-425004-i*1000),cableConcealedA:cell(-661250,-425004-i*1000)})),
  ordinaryConduits:['2603C6','260383','260381','260385','260387'].map((h,i)=>({sectionMm2:sections[i],source:evidence(h)})),
  wireConduits:['2603E3','2603EA','2603EB','2603D4','2603EC'].map((h,i)=>({sectionMm2:sections[i],source:evidence(h),threePhase:evidence(['2603EE','2603EF','2603F0','2603ED','2603F1'][i])})),
  notes:['2604FE','2607DD','260505','26081F'].map(h=>evidence(h)),
  conflicts:[{sources:['2603E7','260743'],resolution:'本地项目采用保护管选择表明确列出的普通/消防统一WDZN-BYJ导线参考；类型表另列WDZ-BYJ，保留差异供审定。'}]
 };
}

export function selectV02Cable(rules,{ratingA,kind='wire',phase=1,installation='concealed-A'}={}){
 if(!Number.isFinite(ratingA)||ratingA<=0||!['wire','cable'].includes(kind)||![1,3].includes(phase))throw Error('Invalid cable selection request');
 if(kind==='cable'&&phase!==3)throw Error('This profile verifies three-phase five-conductor power cables only');
 if(installation!=='concealed-A')throw Error('Installation not verified for this profile; provide a separate reviewed rule.');
 const match=(kind==='wire'?rules.wireMatch:rules.cableMatch).find(r=>r.ratingA>=ratingA);if(!match)throw Error('Rating exceeds verified template range');
 const source=kind==='wire'?(phase===1?match.singlePhase:match.threePhase):match.conduit;
 const section=Number(source.text.match(/(?:x|×)([\d.]+)/)?.[1]);if(!section)throw Error('Invalid template conductor spec');
 const ampacity=rules.ampacity.find(a=>a.sectionMm2===section),conduit=(kind==='wire'?rules.wireConduits:rules.ordinaryConduits).find(a=>a.sectionMm2===section);
 if(!ampacity||!conduit)throw Error('Selected section lacks verified ampacity/conduit data');
 const izSource=kind==='wire'?(phase===1?ampacity.wireTwoLoaded:ampacity.wireFourLoaded):ampacity.cableConcealedA,conduitSource=kind==='wire'&&phase===3?conduit.threePhase:conduit.source;
 if(!izSource||!conduitSource)throw Error('Selected phase arrangement lacks verified ampacity/conduit data');
 const selected={kind,phase,installation,ratingA,tableRatingA:match.ratingA,type:kind==='wire'?rules.wire.type:rules.ordinaryCable.type,sectionMm2:section,conductors:source.text,conduit:conduitSource.text.split('.').at(-1),izA:Number(izSource.text),correctionFactor:1,sources:[source,izSource,conduitSource,kind==='wire'?rules.wire.source:rules.ordinaryCable.source]};
 if(!Number.isFinite(selected.izA)||selected.izA<ratingA)throw Error('Template selection fails In <= Iz');return selected;
}
