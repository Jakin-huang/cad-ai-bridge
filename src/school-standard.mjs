import {selectV02Cable} from './standard-library.mjs';
import {sceneSchema} from './contracts.mjs';
export function standardSelections(profile,e){return {main:selectV02Cable(profile.rules,{ratingA:e.mainBreakerA,kind:'cable',phase:3}),floor:selectV02Cable(profile.rules,{ratingA:e.floorBreakerA,kind:'cable',phase:3}),lighting:selectV02Cable(profile.rules,{ratingA:e.lightingBreakerA}),socket:selectV02Cable(profile.rules,{ratingA:e.socketBreakerA})};}
export function standardRequirements(input,profile){
 const r=structuredClone(input),s=standardSelections(profile,r.electrical),e=r.electrical;
 Object.assign(e,{mainCableMm2:s.main.sectionMm2,mainAssumedIzA:s.main.izA,floorCableMm2:s.floor.sectionMm2,floorAssumedIzA:s.floor.izA,lightingCableMm2:s.lighting.sectionMm2,socketCableMm2:s.socket.sectionMm2,branchAssumedIzA:Math.min(s.lighting.izA,s.socket.izA)});
 r.assumptions.push('采用本地V02标准库：普通馈线按独立穿管暗敷A、30℃、不成束假设；载流量和开关匹配取模板表，实际条件变化必须重新选型。');return r;
}
const move=(g,x,y,layer='S-TEXT')=>{const p=structuredClone(g);p.layer=layer;if(p.points)p.points=p.points.map(v=>[v[0]+x,v[1]+y,0]);if(p.position)p.position=[p.position[0]+x,p.position[1]+y,0];return p;};
export function applySchoolStandard(model,profile){
 const m=model,r=m.requirements,e=r.electrical,s=standardSelections(profile,e),entities=m.scene.entities;
 const text=(x,y,text,height=260,layer='S-TEXT')=>entities.push({kind:'text',layer,position:[x,y,0],text:String(text),height,rotationRadians:0});
 const line=(x,y,X,Y,layer='E-WIRE')=>entities.push({kind:'polyline',layer,points:[[x,y,0],[X,Y,0]],closed:false});
 const stamp=(key,x,y,layer='E-LIGHT')=>{const entry=profile.symbols[key];if(!entry)throw Error('Unmapped standard symbol: '+key);entities.push(...entry.geometry.map(g=>move(g,x,y,layer)));};
 for(const symbol of m.scene.symbols){const source=profile.symbols[symbol.name];if(!source)throw Error('Unmapped school symbol '+symbol.name);symbol.geometry=structuredClone(source.geometry);}
 const attrs=structuredClone(m.scene.symbols.find(s=>s.name==='SCH_PANEL').attributes);
 for(const name of ['STD_POWER_PANEL','STD_EM_PANEL','STD_INTERFACE'])m.scene.symbols.push({name,geometry:structuredClone(profile.symbols[name].geometry),attributes:structuredClone(attrs)});
 for(const d of m.devices){if(d.blockName==='SCH_PANEL')d.blockName=d.attributes.MODEL.startsWith('AP')?'STD_POWER_PANEL':d.attributes.MODEL.startsWith('AEL')?'STD_EM_PANEL':d.attributes.MODEL.startsWith('FD')?'STD_INTERFACE':'SCH_PANEL';if(d.blockName==='STD_EM_PANEL')d.attributes.MODEL=d.attributes.MODEL.replace(/^AEL/,'ALA');}
 for(const c of m.circuits){if(c.system==='power')c.selection=structuredClone(c.id.includes('-S')?s.socket:s.lighting);}
 const replace=t=>t.replaceAll('WDZ-BYJ','WDZN-BYJ').replace(/\bB(10|16)A/g,'C$1A').replace(/MCB B(\d+)/g,'MCB C$1').replace(/B(10|16)A/g,'C$1A').replaceAll('AEL','ALA').replaceAll('原创示范','学校示范').replaceAll('版本 R1','版本 R2（V02标准）');
 for(const p of entities)if(p.kind==='text'){p.text=replace(p.text);if(p.text.startsWith('五、布线：'))p.text=`五、布线：照明/插座 ${s.lighting.type} 2x${s.lighting.sectionMm2}+E${s.lighting.sectionMm2}.${s.lighting.conduit}。`;if(p.text.startsWith('进线初选'))p.text=`总进线 ${s.main.type} ${s.main.conductors}.${s.main.conduit}；Iz表值=${s.main.izA}A（暗敷A）。`;}
 for(const c of m.circuits){const old=c.id;c.id=replace(c.id);for(const w of m.routes)if(w.circuitId===old)w.circuitId=c.id;for(const id of c.deviceIds)m.devices.find(d=>d.id===id).attributes.CIRCUIT=c.id;}
 // Replace the old first-sheet legend graphics; all symbols are now shown on a dedicated provenance sheet.
 m.scene.entities=m.scene.entities.filter(p=>{const v=p.position||p.points[0];return !(v[0]>37000&&v[0]<59000&&v[1]>7000&&v[1]<35000);});
 // Keep helpers bound to the final entities array.
 entities.splice(0,entities.length,...m.scene.entities);m.scene.entities=entities;
 text(38200,32000,'统一图例见末页',430);text(38200,30500,'V02优先 / 施工图补充',280);text(38200,29000,'选型及来源见标准对照页',260);
 function sheet(title){
  const index=m.sheets.length,id='E-'+String(index+1).padStart(2,'0'),x=index*70000;
  m.sheets.push({id,title,scale:'示意',origin:[x,0,0],widthMm:594,heightMm:420,modelPerPaper:100});m.scene.views.push({name:id,center:[x+29700,21000,0],width:62000,height:44000});
  entities.push({kind:'polyline',layer:'S-FRAME',closed:true,points:[[x+2000,1000,0],[x+57400,1000,0],[x+57400,41000,0],[x+2000,41000,0]]});
  text(x+4000,38000,title,600);text(x+4000,36400,`${r.projectId} | ${id} | V02标准对照 / 待专业审定`,280);line(x+2000,4800,x+57400,4800,'S-FRAME');text(x+3000,3000,r.name,330);text(x+38000,3000,`${id} A2 / ${r.designDate}`,300);return {x,id};
 }
 const panels=[{id:'AP0',title:'普通电源总配电箱',selection:s.main,rows:Array.from({length:r.floors},(_,i)=>['AL','AP'].map(k=>({id:`${k}${i+1}`,selection:s.floor,load:'楼层馈线',phase:'ABC',breaker:`4P-C${e.floorBreakerA}`}))).flat()},
 {id:'AFE0',title:'消防电源接口箱（校园专用电源）',selection:null,rows:Array.from({length:r.floors},(_,i)=>({id:`ALA${i+1}`,selection:null,load:'A型应急集中电源',phase:'待厂家',breaker:'输入保护待厂家'}))}];
 for(let f=1;f<=r.floors;f++)for(const prefix of ['AL','AP']){const panel=m.devices.find(d=>d.floor===f&&d.attributes.MODEL===`${prefix}-${f}`||d.floor===f&&d.attributes.MODEL===`${prefix}${f}`);if(!panel)throw Error('Missing panel '+prefix+f);
  panels.push({id:`${prefix}${f}`,title:prefix==='AL'?'楼层一般照明配电箱':'楼层一般动力及插座配电箱',selection:s.floor,rows:m.circuits.filter(c=>c.panel===panel.id&&c.system==='power').map(c=>({id:c.id,selection:c.selection,phase:c.phase,load:`${Math.round(c.watts)}W / Ib=${c.currentA.toFixed(2)}A`,breaker:`${c.id.includes('-S')?'2P':'1P'}-C${c.breakerA}${c.id.includes('-S')?'/0.03 A型':''}`,rcd:c.id.includes('-S')}))});}
 for(let f=1;f<=r.floors;f++)panels.push({id:`ALA${f}`,title:`A型应急照明集中电源 DC36V / ${r.emergency.supplyRatedWattsPerFloor}W`,selection:null,rows:m.circuits.filter(c=>c.floor===f&&c.system==='emergency').map(c=>({id:c.id,selection:null,phase:'DC±',load:`${c.watts}W / ${c.currentA.toFixed(2)}A`,breaker:'36V支路保护待厂家',dc:true}))});
 for(let i=0;i<panels.length;i+=2){const {x,id}=sheet('配电箱系统图 '+panels.slice(i,i+2).map(p=>p.id).join(' / '));
  for(let j=0;j<2&&panels[i+j];j++){const panel=panels[i+j],xx=x+7400+j*26400,yy=32500;panel.sheetId=id;
   stamp('STD_PANEL_HEADER',xx,yy,'S-TEXT');text(xx-2500,yy+900,panel.id,420);text(xx+1000,yy+900,panel.title,220);
   text(xx+1200,yy-500,panel.id,300);text(xx+4700,yy-500,'按本图定制',220);text(xx+9000,yy-500,'厂家定',240);text(xx+14600,yy-500,'待定',220);
   const cs=panel.id==='AP0'?m.circuits.filter(c=>c.system==='power'):m.circuits.filter(c=>panel.rows.some(row=>row.id===c.id));
   if(cs.length&&cs.every(c=>c.system==='power')){const pe=cs.reduce((n,c)=>n+c.watts,0),pj=cs.reduce((n,c)=>n+c.demandWatts,0),phase={A:0,B:0,C:0};for(const c of cs)phase[c.phase]+=c.demandWatts;const ij=Math.max(...Object.values(phase))/(e.phaseVoltage*e.powerFactor);
    for(const [dx,dy,v]of [[2100,-1050,(pe/1000).toFixed(2)],[2100,-1650,(pj/1000).toFixed(2)],[4700,-1050,(pj/pe).toFixed(2)],[4550,-1650,ij.toFixed(2)],[7000,-1050,e.powerFactor]])text(xx+dx,yy+dy,v,230);
   }else text(xx+9000,yy-1350,'保护/输入参数待厂家',225);
   text(xx+1000,yy-3850,panel.selection?`${panel.selection.type} ${panel.selection.conductors}.${panel.selection.conduit}`:'消防供电/厂家条件待确认',235);
   if(panel.selection)text(xx+1000,yy-4750,`进线保护：4P-C${panel.selection.ratingA}A；隔离/过流，分断容量待核`,220);
   const y0=yy-6100,yEnd=y0-Math.max(1,panel.rows.length-1)*1850;line(xx,y0+800,xx,yEnd-600);
   for(let k=0;k<panel.rows.length;k++){const row=panel.rows[k],y=y0-k*1850;line(xx,y,xx+750,y);if(row.dc)line(xx+750,y,xx+2300,y);else stamp(row.rcd?'STD_RCBO':'STD_MCB',xx+750,y);line(xx+2300,y,xx+15000,y);
    text(xx+600,y+600,row.breaker,220);text(xx+4200,y+600,row.id,250);text(xx+12500,y+600,row.phase,230);
    text(xx+4000,y-420,row.selection?`${row.selection.type} ${row.selection.conductors}.${row.selection.conduit}`:row.dc?'WDZN-BYJ 2x4.SC25（暂选，厂家校核）':'消防输入线规格待供电及厂家资料',215);text(xx+12000,y-420,row.load,200);
   }
   text(xx-2500,10200,'N、PE分设；插座RCBO A型30mA；PE不设开关。',230);text(xx-2500,9200,'空白参数不复制模板算例；短路、SPD及选择性待核。',230);
  }
 }
 const legend=sheet('统一图例、选型依据与来源对照');
 const labels={SCH_LIGHT:'教室单管LED灯',SCH_BOARD:'黑板灯（壁装LED图形）',SCH_CEILING:'吸顶灯',SCH_SOCKET:'单相二三眼组合插座',SCH_SWITCH:'双联翘板开关',SCH_PANEL:'一般照明箱',STD_POWER_PANEL:'一般动力箱',STD_EM_PANEL:'A型应急集中电源',STD_INTERFACE:'弱电接口柜',SCH_EM:'A型应急照明灯',SCH_EXIT:'安全出口标志灯',SCH_LEFT:'单向方向标志灯（左）',SCH_RIGHT:'单向方向标志灯（右）',SCH_FAN:'排风机（电动机图形）',SCH_SMOKE:'感烟火灾探测器',SCH_MCP:'手动报警按钮',SCH_SOUNDER:'火灾声光警报器',SCH_SPEAKER:'扬声器箱',SCH_DATA:'双孔信息插座',SCH_AP:'无线AP'};
 const keys=Object.keys(labels);for(let i=0;i<keys.length;i++){const key=keys[i],src=profile.symbols[key],xx=legend.x+5000+Math.floor(i/7)*17500,yy=33000-(i%7)*2700;stamp(key,xx+700,yy);text(xx+1800,yy,labels[key],240);text(xx+1800,yy-650,`${src.sourceIndex===0?'V02':'施工图补充'} / ${src.blockName.length>21?src.blockName.slice(0,19)+'…':src.blockName}`,180);}
 text(legend.x+5000,12000,`总进线：${s.main.type} ${s.main.conductors}.${s.main.conduit} / Iz=${s.main.izA}A`,280);
 text(legend.x+5000,10800,`楼层馈线：${s.floor.type} ${s.floor.conductors}.${s.floor.conduit} / Iz=${s.floor.izA}A`,280);
 text(legend.x+5000,9600,`支路：${s.lighting.type} ${s.lighting.conductors}.${s.lighting.conduit} / Iz=${s.lighting.izA}A`,280);
 text(legend.x+5000,8400,'载流量适用：暗敷A/独立管/30℃；成束、屋顶、土壤或敷设变化须重算。',260);
 text(legend.x+5000,7200,'普通导线类型存在表间差异，本次采用保护管选择表WDZN-BYJ参考；来源详见JSON。',235);
 m.scene.entities=m.scene.entities.filter(p=>p.kind!=='text'||!(p.position[0]<37000&&p.position[1]>10000&&p.position[1]<19000&&/^E-\d{2}  /.test(p.text)));
 for(let i=0;i<m.sheets.length;i++)m.scene.entities.push({kind:'text',layer:'S-TEXT',position:[4500+Math.floor(i/10)*16000,17700-(i%10)*700,0],text:`${m.sheets[i].id}  ${m.sheets[i].title}`,height:205,rotationRadians:0});
 m.standard={id:profile.id,privateDerivedAssets:true,selections:s,panels,symbols:Object.fromEntries(Object.entries(profile.symbols).map(([k,v])=>[k,{sourceIndex:v.sourceIndex,blockName:v.blockName,blockHandle:v.blockHandle,sourceInstanceHandle:v.sourceInstanceHandle,toleranceMm:v.toleranceMm}])),sources:profile.sources.map(v=>({role:v.role,source:v.source,sha256:v.sha256})),coverage:profile.coverage,conversions:profile.conversions,conflicts:profile.rules.conflicts};
 m.scene=sceneSchema.parse(m.scene);m.validation.pending.push('V02模板表内普通导线类型差异、消防输入及应急产品支路配置审定');
 return m;
}
