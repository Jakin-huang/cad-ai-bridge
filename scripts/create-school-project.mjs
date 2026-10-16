import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {root} from './public-files.mjs';
import {makeSchoolDesign} from '../src/school-design.mjs';
import {verifySchoolReadback} from '../src/school-verification.mjs';
import {readDxf} from '../src/dxf-audit.mjs';
import {csvCell} from '../src/files.mjs';
const requirementFile=process.argv.slice(2).find(arg=>!arg.startsWith('--'))||path.join(root,'examples/school-requirements.json');
const requirements=JSON.parse((await fs.readFile(path.resolve(requirementFile),'utf8')).replace(/^\uFEFF/,''));
let standard,standardFile;
const standardConfig=path.join(root,'cadbridge-standard.local.json');
if(!process.argv.includes('--without-standard')&&await fs.access(standardConfig).then(()=>true,()=>false)){
 const cfg=JSON.parse(await fs.readFile(standardConfig,'utf8'));standardFile=cfg.profile;const bytes=await fs.readFile(standardFile);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==cfg.sha256)throw Error('Local standard profile changed; re-import before generation');standard=JSON.parse(bytes);
 for(const source of standard.sources){const sha=file=>fs.readFile(file).then(b=>crypto.createHash('sha256').update(b).digest('hex'));if(await sha(source.source)!==source.sha256||await sha(source.dxf)!==source.dxfSha256)throw Error('Standard or reference source changed; re-import');}
}
const model=makeSchoolDesign(requirements,{standard});
const designSourceFiles=['src/school-design.mjs','src/school-routing.mjs','src/school-review.mjs','src/school-standard.mjs','src/standard-library.mjs','src/school-verification.mjs','src/contracts.mjs','scripts/create-school-project.mjs','scripts/render-school.py','examples/school-standards-register.json'];
const sourceDigests=await Promise.all(designSourceFiles.map(async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')})));
const python=process.env.CADBRIDGE_PYTHON||'python';
const child=(exe,args)=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd:root,windowsHide:true,stdio:'inherit'});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Project renderer failed; configure CADBRIDGE_PYTHON and install reportlab/pypdf. Exit '+code)));});
if(!process.argv.includes('--model-only'))await child(python,['-c','import reportlab, pypdf']);
const folder=await fs.mkdtemp(path.join(await fs.mkdir(path.join(root,'artifacts/school-projects'),{recursive:true}).then(()=>path.join(root,'artifacts/school-projects')),'school-'));
const json=(name,data)=>fs.writeFile(path.join(folder,name),JSON.stringify(data,null,2),{flag:'wx'});
await json('requirements.json',requirements);await json('design-model.json',model);
if(standard){await json('template-provenance.json',{profileSha256:crypto.createHash('sha256').update(await fs.readFile(standardFile)).digest('hex'),...model.standard});await json('resolved-requirements.json',model.requirements);}
await fs.copyFile(path.join(root,'examples/school-standards-register.json'),path.join(folder,'standards-register.json'),fs.constants.COPYFILE_EXCL);
if(!model.validation.ok)throw Error('Design checks failed; see '+path.join(folder,'design-model.json'));
if(process.argv.includes('--model-only')){console.log(JSON.stringify({ok:true,folder,devices:model.devices.length,routes:model.routes.length,sheets:model.sheets.length,checks:model.validation.checks.length}));process.exit(0);}
const {execute,hashFile}=await import('../bridge.mjs');
const results=[];
const run=async(action,args)=>{const result=await execute(action,args);results.push({action,jobRoot:result.jobRoot,ok:result.ok,drawingSha256:result.drawingSha256});if(!result.ok)throw Error(JSON.stringify(result.error));return result;};
console.log('CREATE '+folder);
let current=await run('create_drawing',{scene:model.scene});
const placed=new Map();for(const d of model.devices){if(!placed.has(d.blockName))placed.set(d.blockName,[]);placed.get(d.blockName).push({id:d.id,position:d.position,layer:d.layer,rotationRadians:d.rotationRadians,attributes:{...d.attributes,DEVICE_ID:''}});}
const operations=[...[...placed].map(([blockName,instances])=>({type:'place_symbols',blockName,instances})),...model.routes.map(w=>({type:'connect_route',id:w.id,circuitId:w.circuitId,from:{id:w.from,port:'PWR'},to:{id:w.to,port:'PWR'},vertices:w.vertices,layer:w.layer})),...model.numbering];
for(let i=0;i<operations.length;i+=100){const request={drawing:current.drawing,expectedSha256:current.drawingSha256,documentId:current.snapshot.documentId,expectedRevision:current.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:operations.slice(i,i+100)};const before=await hashFile(current.drawing);current=await run('apply',request);if(await hashFile(request.drawing)!==before)throw Error('Source job drawing changed');console.log('APPLY '+Math.min(i+100,operations.length)+'/'+operations.length);}
const finalDwg=path.join(folder,'school-electrical.dwg'),finalDxf=path.join(folder,'school-electrical.dxf');
await fs.copyFile(current.drawing,finalDwg,fs.constants.COPYFILE_EXCL);await fs.copyFile(current.dxf,finalDxf,fs.constants.COPYFILE_EXCL);
const fresh=await run('inspect',{drawing:finalDwg});
const dxf=await readDxf(finalDxf),verification=verifySchoolReadback(model,fresh.snapshot,dxf);
await json('cad-verification.json',verification);
if(!verification.ok)throw Error('CAD readback checks failed: '+JSON.stringify(verification.checks.filter(c=>!c.ok)));
const native=await run('inspect',{drawing:finalDwg,host:'tangent'});
if(native.snapshot.deviceCount!==model.devices.length||native.snapshot.issues.length||!native.nativeHost?.nativeKernelLoaded)throw Error('Native Tangent reopen mismatch');
const cleanup=JSON.parse(await fs.readFile(path.join(native.jobRoot,'cleanup.json'),'utf8'));if(!cleanup.ok||!cleanup.originalTipRestored)throw Error('Native host cleanup failed');
const csv=async(name,rows)=>fs.writeFile(path.join(folder,name),'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n',{flag:'wx'});
const circuitColumns=['id','panel','floor','system','phase','watts','demandWatts','kd','currentA','breakerA','assumedIzA','sectionMm2','geometryLengthM','estimatedLengthM','controlExtraEquivalentM','voltageDropEquivalentLengthM','voltageDropPercent','feederDropPercent','totalDropPercent','dcDropPercent'];
await csv('circuits.csv',[[...circuitColumns,'cableType','conductors','conduit','sourceHandles'],...model.circuits.map(c=>[...circuitColumns.map(k=>c[k]??''),c.selection?.type??'',c.selection?.conductors??'',c.selection?.conduit??'',c.selection?.sources.map(v=>v.handle).join('|')??''])]);
await json('sheet-review.json',model.review);
await csv('required-inputs.csv',[['id','影响图纸','所需资料','提供方','未取得前的限制'],...model.review.requiredInputs.map(v=>[v.id,v.sheets,v.materials,v.owner,v.limit])]);
await csv('panel-hardware.csv',[['箱号','用途','型号','订货参考','规格','上级保护A','状态','依据'],...(model.standard?.panels||[]).flatMap(p=>[{...p.incoming,use:'进线开关'},...p.rows.map(row=>({...row.hardware,use:'出线 '+row.id}))].filter(h=>h.model).map(h=>[p.id,h.use,h.model,h.reference||'',h.spec,h.upstreamProtectionA??'',h.status,h.url||h.evidence||'']))]);
await csv('cable-quantities.csv',[['回路','系统','规格','根/条数','图面m','含立面端接估长m','线缆合计m','采购损耗'],...model.circuits.map(c=>[c.id,c.system,c.selection?c.selection.type+' '+c.selection.conductors+'.'+c.selection.conduit:c.system==='data'?'Cat6':c.system==='emergency'?'WDZN-BYJ 2x4.SC25':'厂家确定',(c.parallelCables||1),c.geometryLengthM,c.estimatedLengthM,c.estimatedLengthM*(c.parallelCables||1),'未计；控制线另表'])]);
await csv('lighting-controls.csv',[['分组','房间','开关','按键','功能','灯具ID'],...model.controls.map(c=>[c.id,c.room,c.switchId,c.key,c.description,c.deviceIds.join('|')])]);
await csv('control-wiring.csv',[['回路','线路','起点','终点','导线','管径','估长m','口径'],...model.controlWiring.map(w=>[w.circuitId,'开关腿',w.junctionAt,w.switchId,w.conductors,w.conduit,w.estimatedLengthM,w.scope]),...model.routes.filter(w=>w.controlPipe).map(w=>[w.circuitId,'受控返回',w.from,w.to,w.controlPipe.conductors,w.controlPipe.conduit,w.controlPipe.geometryLengthM,w.controlPipe.scope+'；图面长度，立面端接另核'])]);
await csv('devices.csv',[['id','number','symbol','model','floor','room','circuit','watts','role','sheet'],...model.devices.map(d=>[d.id,d.attributes.DEVICE_ID,d.blockName,d.attributes.MODEL,d.floor,d.attributes.ROOM,d.attributes.CIRCUIT,d.watts,d.role,d.sheetId])]);
const counts=new Map();for(const d of model.devices){const k=d.blockName+'|'+d.attributes.MODEL;counts.set(k,(counts.get(k)||0)+1);}
await csv('bill-of-quantities.csv',[['symbol','model','count','scope'],...[...counts].map(([k,n])=>[...k.split('|'),n,standard?'模型实体数量；图例来源见template-provenance.json；线缆另计':'原创模型实体数量；线缆另计，接口柜为组合预留'])]);
await child(python,[path.join(root,'scripts/render-school.py'),folder]);
const pdfValidation=JSON.parse(await fs.readFile(path.join(folder,'pdf-validation.json'),'utf8'));if(!pdfValidation.ok)throw Error('PDF layout checks failed');
const files=[];for(const name of (await fs.readdir(folder)).sort()){const file=path.join(folder,name);files.push({name,bytes:(await fs.stat(file)).size,sha256:await hashFile(file)});}
await json('manifest.json',{schemaVersion:1,files});
for(const source of sourceDigests)if(await hashFile(path.join(root,source.file))!==source.sha256)throw Error('Design source changed during generation: '+source.file+'; generate a fresh delivery.');
if(standard)for(const source of standard.sources)if(await hashFile(source.source)!==source.sha256)throw Error('Standard/reference original changed during generation');
const build=JSON.parse(await fs.readFile(path.join(root,'plugin/bin/build.json'),'utf8'));
const delivery={ok:true,projectId:requirements.projectId,completedAt:new Date().toISOString(),folder,drawing:finalDwg,dxf:finalDxf,pdf:path.join(folder,'school-electrical.pdf'),report:path.join(folder,'project-report.html'),drawingSha256:await hashFile(finalDwg),pluginSHA256:build.sha256,nodeVersion:process.version,sourceDigests,sheetCount:model.sheets.length,deviceCount:model.devices.length,routeCount:model.routes.length,circuitCount:model.circuits.length,designChecks:model.validation.checks.length,cadChecks:verification.checks.length,pdfChecks:pdfValidation,nativeReopened:true,nativeJob:native.jobRoot,reviewStatus:model.validation.reviewStatus,pending:model.validation.pending,results};
await json('delivery.json',delivery);await fs.writeFile(path.join(root,'artifacts/school-project-current.txt'),folder+'\n');
console.log(JSON.stringify(delivery,null,2));
