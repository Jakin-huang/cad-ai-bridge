// Bounded LM-63 Type C reader. Unsupported versions/tilt/types fail closed.
// Angles: nadir=0, C0 along +X, positive C toward +Y; no lamp-lumen rescaling.
const fail=reason=>{throw Error('IES_UNSUPPORTED_OR_INVALID: '+reason);};
const close=(a,b)=>Math.abs(a-b)<1e-6;
export function parseIes(text){
 if(typeof text!=='string'||text.length>16*1024*1024)fail('size');
 const lines=text.replace(/^\uFEFF/,'').split(/[\r\n]+/).map(v=>v.trim()).filter(Boolean),version=lines[0];
 if(!['IESNA91','IESNA:LM-63-1995','IESNA:LM-63-2002'].includes(version))fail('only LM-63-1991/1995/2002 headers supported');
 const tilt=lines.findIndex(l=>/^TILT=/i.test(l));if(tilt<1||lines[tilt].toUpperCase()!=='TILT=NONE')fail('TILT=NONE required');
 const header={};for(const line of lines.slice(1,tilt)){const m=line.match(/^\[([^\]]+)\]\s*(.*)$/);if(m)header[m[1]]=m[2];}
 const tokens=lines.slice(tilt+1).join(' ').split(/[\s,]+/);if(tokens.some(v=>!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?$/.test(v)))fail('non-numeric data');const n=tokens.map(Number);if(n.some(v=>!Number.isFinite(v))||n.length<13)fail('non-finite/truncated data');
 const [lamps,lumensPerLamp,multiplier,nv,nh,type,units,width,length,height,ballastFactor,futureUse,watts]=n;
 if(!Number.isInteger(lamps)||lamps<1||!(lumensPerLamp>0||lumensPerLamp===-1)||multiplier<=0||type!==1||![1,2].includes(units)||!Number.isInteger(nv)||nv<2||nv>2000||!Number.isInteger(nh)||nh<1||nh>2000||nv*nh>500000||watts<=0)fail('header/count/type/power');
 if(!close(ballastFactor,1)||!close(futureUse,1))fail('non-unit ballast/legacy factor requires explicit support');
 if(n.length!==13+nv+nh+nv*nh)fail('wrong candela value count');
 const vertical=n.slice(13,13+nv),horizontal=n.slice(13+nv,13+nv+nh),candela=Array.from({length:nh},(_,i)=>n.slice(13+nv+nh+i*nv,13+nv+nh+(i+1)*nv));
 for(const angles of [vertical,horizontal])if(angles.some((v,i)=>v<0||i&&v<=angles[i-1]))fail('angles must increase');
 if(!([0,90].includes(vertical[0])&&[90,180].includes(vertical.at(-1)))||vertical[0]>=vertical.at(-1))fail('vertical coverage');
 if(horizontal[0]!==0||![0,90,180,360].includes(horizontal.at(-1)))fail('horizontal coverage requires exact 0/90/180/360 symmetry');
 if(candela.flat().some(v=>v<0))fail('negative candela');
 if(close(horizontal.at(-1),360)&&candela[0].some((v,i)=>Math.abs(v-candela.at(-1)[i])>Math.max(1e-5,v*.001)))fail('discontinuous 0/360 seam');
 // At the nadir a single direction cannot have contradictory C-plane intensities.
 if(close(vertical[0],0)&&candela.some(row=>Math.abs(row[0]-candela[0][0])>Math.max(.1,candela[0][0]*.01)))fail('inconsistent nadir');
 const dimensionsM=[width,length,height].map(v=>Math.abs(v)*(units===1?.3048:1));
 return {schemaVersion:1,format:version,type:'C',tilt:'NONE',header,lamps,lumensPerLamp,absolute:lumensPerLamp===-1,multiplier,watts,dimensionsM,signedOpeningDimensionsM:[width,length,height].map(v=>v*(units===1?.3048:1)),vertical,horizontal,candela,convention:'nadir=0; C0=+X; C90=+Y; no tilt; original test candela without lumen normalization'};
}
function interval(values,v){let lo=0,hi=values.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(values[mid]<=v)lo=mid;else hi=mid;}return [lo,hi,(v-values[lo])/(values[hi]-values[lo])];}
const lerp=(a,b,t)=>a+(b-a)*t;
export function iesCandela(ies,verticalDegrees,horizontalDegrees){
 if(!Number.isFinite(verticalDegrees)||!Number.isFinite(horizontalDegrees)||verticalDegrees<0||verticalDegrees>180)fail('evaluation angle');
 if(verticalDegrees<ies.vertical[0]||verticalDegrees>ies.vertical.at(-1))return 0;
 let c=(horizontalDegrees%360+360)%360;const last=ies.horizontal.at(-1);
 if(last===0)c=0;else if(last===90){if(c>180)c=360-c;if(c>90)c=180-c;}else if(last===180&&c>180)c=360-c;
 const [v0,v1,tv]=interval(ies.vertical,verticalDegrees),row=i=>lerp(ies.candela[i][v0],ies.candela[i][v1],tv);
 if(ies.horizontal.length===1)return row(0)*ies.multiplier;
 const [c0,c1,tc]=interval(ies.horizontal,c);return lerp(row(c0),row(c1),tc)*ies.multiplier;
}
export function directPointLux(ies,{positionM,rotationDegrees=0,maintenanceFactor=1},pointM){
 if([...positionM,...pointM,rotationDegrees,maintenanceFactor].some(v=>!Number.isFinite(v))||maintenanceFactor<=0||maintenanceFactor>1)fail('point/source');
 const dx=pointM[0]-positionM[0],dy=pointM[1]-positionM[1],h=positionM[2]-pointM[2];if(h<=0)fail('horizontal workplane must be below source');
 const r2=dx*dx+dy*dy+h*h,cos=h/Math.sqrt(r2),gamma=Math.atan2(Math.hypot(dx,dy),h)*180/Math.PI,c=Math.atan2(dy,dx)*180/Math.PI-rotationDegrees;
 return iesCandela(ies,gamma,c)*cos/r2*maintenanceFactor;
}
