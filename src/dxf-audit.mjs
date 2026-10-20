import fs from 'node:fs/promises';
export const tag=(entity,code,fallback=null)=>entity.pairs.find(p=>p[0]===code)?.[1]??fallback;
const decode=value=>value.replace(/\\U\+([a-f\d]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
export function parseDxf(text){
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),records=[];let entity=null,section=null,sawEOF=false;
 const flush=()=>{if(!entity)return;if(entity.type==='SECTION')section=tag(entity,2);else if(entity.type==='ENDSEC')section=null;else if(entity.type!=='EOF'){entity.section=section;entity.handle=tag(entity,5,tag(entity,105));records.push(entity);}};
 for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i].trim());if(!Number.isInteger(code))throw Error('Invalid DXF group code');const value=decode(lines[i+1]);if(code===0){flush();entity={type:value.trim(),pairs:[]};if(entity.type==='EOF')sawEOF=true;}else if(entity)entity.pairs.push([code,value]);}flush();
 if(!sawEOF)throw Error('DXF_INCOMPLETE: missing EOF record');
 const entities=records.filter(e=>e.section==='ENTITIES'),roots=entities.filter(e=>!['ATTRIB','VERTEX','SEQEND'].includes(e.type)&&Number(tag(e,67,0))!==1);
 const attributes=new Map();let insert=null;for(const entity of entities){if(entity.type==='INSERT'){insert=entity;attributes.set(entity.handle,{});}else if(entity.type==='ATTRIB'&&insert)attributes.get(insert.handle)[tag(entity,2)]=tag(entity,1);else if(entity.type==='SEQEND')insert=null;else insert=null;}
 return{records,entities,roots,attributes};
}
export async function readDxf(file){const bytes=await fs.readFile(file);let text;try{text=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gbk',{fatal:true}).decode(bytes);}return parseDxf(text);}
export function xdata(entity){const data={};let app=null;for(const [code,value]of entity.pairs){if(code===1001){app=value;data[app]=[];}else if(app&&code>=1000)data[app].push([code,value]);}return data;}
export const field=(data,key)=>data[key]?.find(p=>p[0]===1000)?.[1]??null;
const markerCategories={light:'lighting',socket:'socket',fireequip:'fire',weakequip:'weak-current',switchboard:'distribution-board',switch:'switch',powerequip:'power',otherequip:'other-equipment',EES_Fire:'fire'};
export function deviceCategory(entity){if(entity.type!=='INSERT')return null;const data=xdata(entity);for(const [app,category]of Object.entries(markerCategories)){const value=field(data,app);if(value&&value!=='F'&&value!=='false')return category;}
 if(field(data,'名称')){for(const [app,category]of [['照明平面设备层','lighting'],['动力平面设备层','power'],['消防平面设备层','fire']])if(app in data)return category;}
 return 'DEVTYPE' in data||field(data,'设备名称')?'device-unclassified':null;
}
export const wireKeys=['ltype','ldm','lmeth','linst','lnoar','lnorm','linenum'];
export function wireEvidence(entity){const data=xdata(entity);return wireKeys.some(key=>data[key])?{data,hasValue:wireKeys.some(key=>field(data,key)?.trim())}:null;}
const point=(e,base)=>[Number(tag(e,base,0)),Number(tag(e,base+10,0)),Number(tag(e,base+20,0))];
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function curveLength(entity){
 if(entity.type==='LINE')return distance(point(entity,10),point(entity,11));
 if(entity.type==='ARC'){let angle=(Number(tag(entity,51))-Number(tag(entity,50)))*Math.PI/180;if(angle<0)angle+=2*Math.PI;return Number(tag(entity,40))*angle;}
 if(entity.type!=='LWPOLYLINE')return null;
 const points=[];let current;for(const [code,value]of entity.pairs){if(code===10){current={x:Number(value),y:0,bulge:0};points.push(current);}else if(code===20&&current)current.y=Number(value);else if(code===42&&current)current.bulge=Number(value);}
 let total=0;const closed=(Number(tag(entity,70,0))&1)!==0;
 for(let i=0;i<points.length-(closed?0:1);i++){const a=points[i],b=points[(i+1)%points.length],chord=Math.hypot(a.x-b.x,a.y-b.y),bulge=Math.abs(a.bulge);total+=bulge<1e-12?chord:chord*(1+bulge*bulge)/bulge*Math.atan(bulge);}return total;
}
export function compareElectrical(dxf,tangent){
 const devices=dxf.roots.filter(e=>deviceCategory(e)),wires=dxf.roots.filter(e=>['LINE','ARC','LWPOLYLINE'].includes(e.type)&&wireEvidence(e)?.hasValue);
 const actualDevices=new Map(tangent.devices.map(e=>[e.handle.toUpperCase(),e])),actualWires=new Map(tangent.wires.map(e=>[e.handle.toUpperCase(),e]));
 const mismatches=[];let length=0;const circuits={};
 for(const entity of devices){const actual=actualDevices.get(entity.handle);if(!actual||actual.category!==deviceCategory(entity)||actual.blockName!==tag(entity,2)){mismatches.push({kind:'device',handle:entity.handle});continue;}
  if(distance(actual.position,point(entity,10))>1e-6)mismatches.push({kind:'device-position',handle:entity.handle});
  const attrs=dxf.attributes.get(entity.handle)||{};if(JSON.stringify(Object.entries(attrs).sort())!==JSON.stringify(Object.entries(actual.attributes).sort()))mismatches.push({kind:'device-attributes',handle:entity.handle});
 }
 for(const entity of wires){const actual=actualWires.get(entity.handle),data=xdata(entity),expected=curveLength(entity);length+=expected;
  if(!actual)mismatches.push({kind:'missing-wire',handle:entity.handle});else{if(Math.abs(actual.lengthDrawingUnits-expected)>Math.max(1e-6,expected*1e-9))mismatches.push({kind:'wire-length',handle:entity.handle,expected,actual:actual.lengthDrawingUnits});for(const key of wireKeys)if((actual.spec[key]??null)!==field(data,key))mismatches.push({kind:'wire-field',handle:entity.handle,key});}
  const label=field(data,'linenum')?.trim();if(label)circuits[label]=(circuits[label]||0)+1;
 }
 if(actualDevices.size!==devices.length)mismatches.push({kind:'device-count',expected:devices.length,actual:actualDevices.size});
 if(actualWires.size!==wires.length)mismatches.push({kind:'wire-count',expected:wires.length,actual:actualWires.size});
 for(const circuit of tangent.circuits)if(circuits[circuit.id]!==circuit.wireCount)mismatches.push({kind:'circuit-count',label:circuit.id});
 if(Object.keys(circuits).length!==tangent.circuits.length)mismatches.push({kind:'circuit-label-count'});
 return{ok:mismatches.length===0,devices:devices.length,wires:wires.length,circuitLabels:Object.keys(circuits).length,lengthDrawingUnits:length,emptyWireMetadata:dxf.roots.filter(e=>wireEvidence(e)&&!wireEvidence(e).hasValue).length,mismatches};
}
const numericCode=code=>(code>=10&&code<=59)||(code>=110&&code<=149)||(code>=210&&code<=239)||(code>=1010&&code<=1059);
export function unchangedRecords(before,after,{excludedHandles=[],protectExistingBlockMembership=false}={}){
 const excluded=new Set(excludedHandles.map(h=>h.toUpperCase()));
 const index=new Map(after.records.filter(e=>e.handle).map(e=>[e.section+'|'+e.handle,e])),differences=[],presentationChanges=[],anonymousRenames=[];let compared=0;
 const blockOwners=dxf=>new Map(dxf.records.filter(e=>e.section==='BLOCKS'&&e.type==='BLOCK').map(e=>[tag(e,2),tag(e,330)]));
 const oldBlocks=blockOwners(before),newBlocks=blockOwners(after);
 if(protectExistingBlockMembership){const oldHandles=new Set(before.records.filter(e=>e.handle).map(e=>e.section+'|'+e.handle)),owners=new Set(oldBlocks.values());for(const e of after.records.filter(e=>e.section==='BLOCKS'&&e.handle&&!oldHandles.has(e.section+'|'+e.handle)&&owners.has(tag(e,330))))differences.push({handle:e.handle,kind:'unexpected-addition-to-existing-block',owner:tag(e,330)});}
 function canonical(entity,blocks){
  const paperScreen=entity.type==='VIEWPORT'&&Number(tag(entity,67,0))===1&&Number(tag(entity,69,0))===1;
  const fields=entity.pairs.filter(([code])=>!(paperScreen&&[10,20,30,40,41,12,22,45].includes(code)));
  const frozen=entity.type==='VIEWPORT'?fields.filter(([code])=>code===331).map(([,value])=>value).sort():[];let frozenIndex=0;
  return fields.map(([code,value])=>{
   if(code===331&&entity.type==='VIEWPORT')return[code,frozen[frozenIndex++]];
   if(((code===2&&['DIMENSION','BLOCK','INSERT'].includes(entity.type))||(code===3&&entity.type==='BLOCK'))&&/^\*D\d+$/.test(value)&&blocks.has(value))return[code,'@dimension-block:'+blocks.get(value)];
   return[code,value];
  });
 }
 // Tables and OBJECTS carry legitimate document housekeeping. Entity records and
 // block geometry/attributes are the protected content for this comparison.
 const protectedRecords=before.records.filter(e=>e.handle&&['ENTITIES','BLOCKS'].includes(e.section)&&!excluded.has(e.handle.toUpperCase())&&!(['ATTRIB','SEQEND'].includes(e.type)&&excluded.has(String(tag(e,330,'')).toUpperCase())));
 for(const original of protectedRecords){const current=index.get(original.section+'|'+original.handle);compared++;if(!current){differences.push({handle:original.handle,kind:'missing'});continue;}
  const aPairs=canonical(original,oldBlocks),bPairs=canonical(current,newBlocks);
  if(original.type!==current.type||aPairs.length!==bPairs.length){differences.push({handle:original.handle,kind:'structure'});continue;}
  for(let i=0;i<aPairs.length;i++){const[a,v]=aPairs[i],[b,w]=bPairs[i];if(a!==b||(numericCode(a)?Math.abs(Number(v)-Number(w))>Math.max(1e-7,Math.abs(Number(v))*1e-12):v!==w)){differences.push({handle:original.handle,kind:'value',code:a,before:v,after:w});break;}}
  if(original.type==='BLOCK'&&tag(original,2)!==tag(current,2)&&oldBlocks.get(tag(original,2))===newBlocks.get(tag(current,2)))anonymousRenames.push({handle:original.handle,before:tag(original,2),after:tag(current,2)});
  if(original.type==='VIEWPORT'&&Number(tag(original,67,0))===1&&Number(tag(original,69,0))===1&&JSON.stringify(original.pairs)!==JSON.stringify(current.pairs))presentationChanges.push({handle:original.handle,kind:'overall-paperspace-screen-viewport'});
 }
 return{ok:differences.length===0,compared,differences,anonymousDimensionBlockRenames:anonymousRenames,presentationChanges};
}
