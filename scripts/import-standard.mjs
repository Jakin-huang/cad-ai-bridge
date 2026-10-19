import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {root} from './public-files.mjs';import {execute,hashFile} from '../bridge.mjs';
import {readDxf,tag} from '../src/dxf-audit.mjs';import {blockIndex,flattenBlock,extractV02Rules} from '../src/standard-library.mjs';
const [sourceArg,referenceManifest,auditArg]=process.argv.slice(2);if(!sourceArg)throw Error('Usage: import-standard <standard.dwg> [reference-manifest.json] [cached-audit.json]');
const source=await fs.realpath(sourceArg),before=await hashFile(source),folder=await fs.mkdtemp(projectPath('artifacts/standard-profile-'));
const copy=path.join(folder,'standard.dwg');await fs.copyFile(source,copy,fs.constants.COPYFILE_EXCL);if(await hashFile(copy)!==before)throw Error('Source changed during copy');
let audit;if(auditArg){audit=parseLocalJSON(await fs.readFile(auditArg,'utf8'));if(audit.inputSha256!==before)throw Error('Cached audit source digest mismatch');}else{
 // Owned runs are accepted even when the configured user workspace is elsewhere.
 await fs.mkdir(projectPath('runs'),{recursive:true});const auditFolder=await fs.mkdtemp(projectPath('runs/standard-import-')),auditInput=path.join(auditFolder,'standard.dwg');await fs.copyFile(copy,auditInput,fs.constants.COPYFILE_EXCL);
 console.log('AUDIT '+auditInput);audit=await execute('audit_drawing',{drawing:auditInput,host:'tangent',detail:'full'});
}
if(!audit.ok||audit.audit.errors.length||!audit.dxf)throw Error('Standard audit incomplete');
await fs.writeFile(path.join(folder,'audit.json'),JSON.stringify(audit));
const dxfCopy=path.join(folder,'standard.dxf');await fs.copyFile(audit.dxf,dxfCopy,fs.constants.COPYFILE_EXCL);
const blocks=blockIndex(await readDxf(dxfCopy)),rules=extractV02Rules(audit.audit),symbols={},sources=[{role:'primary',source,sha256:before,copy,dxf:dxfCopy,dxfSha256:await hashFile(dxfCopy)}];
function register(key,bs,name,scale,sourceIndex,rotation=0){const data=flattenBlock(bs,name,{scale,rotation});symbols[key]={sourceIndex,blockName:name,blockHandle:bs.get(name).handle,scale,rotation,...data};}
for(const [key,name,scale,rotation]of [
 ['SCH_LIGHT','EF1',1,0],['SCH_BOARD','EFB',1,0],['SCH_CEILING','EXD',1,0],['SCH_SOCKET','EC1',1,0],['SCH_SWITCH','ES2',1,0],
 ['SCH_PANEL','EAL',0.6,0],['STD_POWER_PANEL','EAP',0.6,0],['STD_EM_PANEL','ALA',0.6,0],['STD_INTERFACE','EAC',0.6,0],
 ['SCH_EM','EAA',1,0],['SCH_EXIT','EET',1,0],['SCH_LEFT','EDX',1,Math.PI],['SCH_RIGHT','EDX',1,0],['SCH_FAN','DDJ',0.6,0],
 ['STD_MCB','带隔离的断路器',1500,Math.PI/2],['STD_IS','隔离开关',1500,Math.PI/2],['STD_RCBO','带隔离的漏电漏电断路器',1,0],['STD_PANEL_HEADER','配电箱表头(带计算式)',1,0]
])register(key,blocks,name,scale,0,rotation);
const missing=['SCH_SMOKE','SCH_MCP','SCH_SOUNDER','SCH_SPEAKER','SCH_DATA','SCH_AP'];
if(!referenceManifest)throw Error('Reference drawing manifest required for symbols absent from primary standard');
const manifest=parseLocalJSON(await fs.readFile(referenceManifest,'utf8')),validation=parseLocalJSON(await fs.readFile(path.join(path.dirname(referenceManifest),'project-validation.json'),'utf8'));
const matchers={SCH_SMOKE:/^感烟火灾探测器$/,SCH_MCP:/手动报警按钮/,SCH_SOUNDER:/火灾声光警报器/,SCH_SPEAKER:/^扬声器箱$/,SCH_DATA:/^双孔信息插座$/,SCH_AP:/^无线AP$/};
for(const file of validation.files){if(!missing.length)break;if(!file.auditJob)continue;
 const entry=manifest.files.find(v=>v.name===file.name);if(!entry||await hashFile(entry.source)!==entry.sha256)throw Error('Reference drawing source changed');
 const result=parseLocalJSON(await fs.readFile(path.join(file.auditJob,'result.json'),'utf8'));if(!result.ok||result.audit.errors.length||result.inputSha256!==entry.sha256)throw Error('Reference audit incomplete or source digest mismatch');
 const candidates=missing.map(key=>({key,insert:result.audit.inserts.find(i=>matchers[key].test(i.attributes.A||''))})).filter(v=>v.insert);
 if(!candidates.length)continue;const referenceDxf=path.join(folder,`reference-${sources.length}.dxf`);await fs.copyFile(result.dxf,referenceDxf,fs.constants.COPYFILE_EXCL);
 const sourceIndex=sources.length;sources.push({role:'supplement',source:entry.source,sha256:entry.sha256,copy:entry.copy,dxf:referenceDxf,dxfSha256:await hashFile(referenceDxf)});const refBlocks=blockIndex(await readDxf(referenceDxf));
 for(const {key,insert}of candidates){register(key,refBlocks,insert.blockName,insert.scale[0],sourceIndex);symbols[key].sourceInstanceHandle=insert.handle;symbols[key].meaning=insert.attributes.A;missing.splice(missing.indexOf(key),1);}
}
if(missing.length)throw Error('Unmapped reference symbols: '+missing.join(', '));
const catalog={blocks:[...blocks.values()].map(b=>({name:b.name,handle:b.handle,entities:b.entities.length,types:[...new Set(b.entities.map(e=>e.type))],texts:b.entities.filter(e=>['TEXT','MTEXT','ATTDEF'].includes(e.type)).map(e=>({handle:e.handle,text:tag(e,1),position:[+tag(e,10,0),+tag(e,20,0)]}))})),rootTexts:audit.audit.texts};
await fs.writeFile(path.join(folder,'catalog.json'),JSON.stringify(catalog));
const profile={schemaVersion:1,id:'distribution-v02',sourceUnits:audit.audit.units,coordinateInterpretation:'模板系统图坐标按现有350字高/1500行距使用；平面图例取原始图例尺寸，非根据Undefined单位自动换算',rules,symbols,sources,catalogFile:'catalog.json',conversions:['嵌套图块展平为普通CAD实体；单色按目标专业图层显示','曲线弦高误差≤0.05mm（各图块实际输出坐标），实心填充三角化','文字用已安装中文TTF重绘，保留字高、宽度系数、位置和旋转；原SHX字形不逐字保证','黑板灯采用模板壁装单管LED图形，配光和产品仍按黑板照明专项选择'],coverage:{primarySymbolCount:Object.values(symbols).filter(s=>s.sourceIndex===0).length,supplementSymbolCount:Object.values(symbols).filter(s=>s.sourceIndex>0).length,indexedDefinitions:blocks.size,missing:[]}};
for(const s of sources)if(await hashFile(s.source)!==s.sha256)throw Error('Original drawing changed');
const file=path.join(folder,'profile.json');await fs.writeFile(file,JSON.stringify(profile,null,2));
await fs.writeFile(projectPath('cadbridge-standard.local.json'),JSON.stringify({schemaVersion:1,profile:file,sha256:await hashFile(file)},null,2));
console.log(JSON.stringify({ok:true,profile:file,sha256:await hashFile(file),coverage:profile.coverage,originalsUnchanged:true}));
