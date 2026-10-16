// Deterministic rectilinear ceiling trees; socket branches follow room perimeters.
const point=(x,y)=>[Number(x.toFixed(6)),Number(y.toFixed(6)),0];
export const pathLength=ps=>ps.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-ps[i][0],p[1]-ps[i][1]),0);
function compact(ps){return ps.filter((p,i)=>!i||Math.hypot(p[0]-ps[i-1][0],p[1]-ps[i-1][1])>1e-5);}
function ringPath(a,b,box){
 const [x,y,X,Y]=box,w=X-x,h=Y-y,L=2*(w+h);
 function project(p){const candidates=[[x,Math.max(y,Math.min(Y,p[1]))],[X,Math.max(y,Math.min(Y,p[1]))],[Math.max(x,Math.min(X,p[0])),y],[Math.max(x,Math.min(X,p[0])),Y]];return candidates.sort((u,v)=>Math.hypot(u[0]-p[0],u[1]-p[1])-Math.hypot(v[0]-p[0],v[1]-p[1]))[0];}
 const at=p=>Math.abs(p[1]-y)<1e-5?p[0]-x:Math.abs(p[0]-X)<1e-5?w+p[1]-y:Math.abs(p[1]-Y)<1e-5?w+h+X-p[0]:2*w+h+Y-p[1];
 const xy=t=>{t=(t%L+L)%L;return t<=w?point(x+t,y):t<=w+h?point(X,y+t-w):t<=2*w+h?point(X-(t-w-h),Y):point(x,Y-(t-2*w-h));};
 const u=project(a),v=project(b),t=at(u),T=at(v),forward=(T-t+L)%L,backward=(t-T+L)%L;
 let corners=[];if(forward<=backward){for(const k of [0,w,w+h,2*w+h,L, L+w,L+w+h,L+2*w+h])if(k>t+1e-5&&k<t+forward-1e-5)corners.push(k);}
 else{for(const k of [-L,-L+w,-L+w+h,-L+2*w+h,0,w,w+h,2*w+h])if(k<t-1e-5&&k>t-backward+1e-5)corners.push(k);corners.sort((a,b)=>b-a);}
 return compact([a,point(...u),...corners.map(xy),point(...v),b]);
}
export function routedTree(panel,items,{ox,oy,width,depth,classWidth,classCount,circuitId,system}){
 const zone=p=>p[1]>=oy+depth?'corridor':p[0]<ox+4500?'stair-west':p[0]>=ox+width-4500?'stair-east':p[0]<ox+4500+classWidth*classCount?'class-'+Math.floor((p[0]-ox-4500)/classWidth):'service';
 const ordinal=Number(circuitId.match(/(?:L|S|E)(\d+)$/)?.[1]||circuitId.match(/NET\d+-(\d+)$/)?.[1]||1);
 const lane=oy+depth+(system==='data'?850+ordinal*100:system==='signal'?circuitId.startsWith('FA')?2500:1750:system==='emergency'?400+ordinal*100:500+ordinal*180);
 function path(a,b){const A=a.position,B=b.position,za=zone(A),zb=zone(B);
  if(za===zb&&za.startsWith('class-')&&circuitId.includes('-S')){const rx=ox+4500+Number(za.slice(6))*classWidth;return ringPath(A,B,[rx+800,oy+1200,rx+classWidth-500,oy+depth-500]);}
  if(za!==zb||a===panel){return compact([A,point(A[0],lane),point(B[0],lane),B]);}
  return compact([A,point(B[0],A[1]),B]);
 }
 const connected=[panel],remaining=[...items],edges=[];
 while(remaining.length){let best;for(const a of connected)for(const b of remaining){const vertices=path(a,b),lengthMm=pathLength(vertices);if(!best||lengthMm<best.lengthMm-1e-5)best={from:a.id,to:b.id,vertices,lengthMm,a,b};}edges.push(best);connected.push(best.b);remaining.splice(remaining.indexOf(best.b),1);}
 return edges.map(({a,b,...edge})=>({...edge,vertices:edge.vertices.map(p=>p.slice())}));
}
export function routeMetrics(routes){
 let bends=0;for(const r of routes)for(let i=1;i<r.vertices.length-1;i++){const a=r.vertices[i-1],b=r.vertices[i],c=r.vertices[i+1];if(Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-4)bends++;}
 return {routeCount:routes.length,lengthM:Number((routes.reduce((n,r)=>n+pathLength(r.vertices),0)/1000).toFixed(3)),bends};
}
