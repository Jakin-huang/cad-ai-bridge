import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {root,hashFile} from '../bridge.mjs';import {readDxf,compareElectrical,unchangedRecords,tag} from '../src/dxf-audit.mjs';
const manifestFile=path.resolve(process.argv[2]||'');const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));const folder=path.dirname(manifestFile);
const report={ok:false,startedAt:new Date().toISOString(),checks:[],files:[],results:{}};const started=performance.now();
let cached={files:[]};if(process.argv.includes('--resume')){try{cached=JSON.parse(await fs.readFile(path.join(folder,'project-validation.json'),'utf8'));}catch{}}
const client=new Client({name:'cadbridge-engineering-validation',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.mjs')],stderr:'pipe'});
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
async function call(name,args){const r=await client.callTool({name,arguments:args},{timeout:180000});let parsed=JSON.parse(r.content.find(c=>c.type==='text').text);assert.equal(parsed.ok,true,JSON.stringify(parsed.error));if(parsed.responseTruncated)parsed=JSON.parse(await fs.readFile(path.join(parsed.jobRoot,'result.json'),'utf8'));return parsed;}
const full=async result=>JSON.parse(await fs.readFile(path.join(result.jobRoot,'result.json'),'utf8'));
const save=()=>fs.writeFile(path.join(folder,'project-validation.json'),JSON.stringify(report,(key,value)=>{
 if(key==='tangent'&&value){const{devices,wires,circuits,...summary}=value;return summary;}
 if((key==='snapshot'||key==='afterFailure')&&value){const{symbols,...snapshot}=value;return{...snapshot,symbolCount:symbols?.length};}
 return value;
},2));
try{
 await client.connect(transport);transport.stderr?.on('data',bytes=>{report.serverErrors=((report.serverErrors||'')+bytes).slice(-64000);});
 for(const entry of manifest.files){assert.equal(await hashFile(entry.source),entry.sha256);if(entry.skipped){report.files.push({name:entry.name,skipped:entry.skipped});continue;}assert.equal(await hashFile(entry.copy),entry.sha256);
  const prior=cached.files.find(f=>f.sourceSha256===entry.sha256&&f.comparison?.ok);if(prior){const current=await full({jobRoot:prior.inspectionJob});const compared=compareElectrical(await readDxf(prior.dxf),current.tangent);assert.deepEqual(compared.mismatches,[]);report.files.push({...prior,comparison:compared});report.checks.push('Retained independent CAD/DXF evidence rechecked: '+entry.name);await save();console.log('PASS retained evidence '+entry.name);continue;}
  const inspected=await call('tangent_inspect',{drawing:entry.copy,detail:'full'});const audit=await call('cad_audit_drawing',{drawing:entry.copy});let effectiveAudit=audit;
  let repair;
  if(!audit.dxf){console.log('RETRY native DXF '+entry.name);effectiveAudit=await call('cad_audit_drawing',{drawing:entry.copy,host:'tangent'});}
  if(!effectiveAudit.dxf){console.log('REPAIR isolated copy '+entry.name);repair=await call('cad_repair_copy',{drawing:entry.copy,expectedSha256:entry.sha256,requestId:crypto.randomUUID()});effectiveAudit=await call('cad_audit_drawing',{drawing:repair.drawing});}
  const item={name:entry.name,sourceSha256:entry.sha256,copy:entry.copy,inspectionJob:inspected.jobRoot,auditJob:effectiveAudit.jobRoot,repairJob:repair?.jobRoot,repairedDrawing:repair?.drawing,dxf:effectiveAudit.dxf,devices:inspected.tangent.deviceCount,wires:inspected.tangent.wireCount,statistics:inspected.tangent.statistics,coverage:inspected.tangent.coverage};report.files.push(item);await save();
  if(!effectiveAudit.dxf){item.independentValidation='DXF_EXPORT_FAILED';item.exportError=effectiveAudit.auditDxfError;console.log('UNRESOLVED DXF '+entry.name);continue;}
  const dxf=await readDxf(effectiveAudit.dxf);item.comparison=compareElectrical(dxf,inspected.tangent);
  check('Independent DXF handles, classes, wire fields, geometry lengths and label groups: '+entry.name,()=>assert.deepEqual(item.comparison.mismatches,[]));
  assert.equal(await hashFile(entry.source),entry.sha256);assert.equal(await hashFile(entry.copy),entry.sha256);await save();
 }
 const chosen=report.files.filter(e=>e.dxf&&e.coverage?.proxyEntities===0&&e.statistics?.deviceGroups).find(e=>e.devices>500&&e.wires>1000&&e.name.includes('平面)'))||report.files.find(e=>e.dxf&&e.devices>500&&e.wires>1000);
 assert.ok(chosen,'Need an audited nonempty engineering plan');const audit=await full({jobRoot:chosen.auditJob});assert.equal(audit.audit.units,'Millimeters');
 const suitable=e=>e.scale.every(v=>v>0)&&!e.dynamic&&!e.hasExtensionDictionary&&!(e.persistentReactorCount>0);
 const lamp=audit.audit.inserts.find(e=>e.xdata.light?.[0]?.value==='T'&&suitable(e)),socket=audit.audit.inserts.find(e=>e.xdata.socket?.[0]?.value==='T'&&suitable(e));assert.ok(lamp&&socket);
 const def=audit.audit.definitions.find(d=>d.name===lamp.blockName);console.log(JSON.stringify({templates:[{handle:lamp.handle,name:lamp.attributes.A,scale:lamp.scale},{handle:socket.handle,name:socket.attributes.A,scale:socket.scale}],lampGeometry:def.geometryPreview}));
 // Separate QA area beyond every observed insert; real diagram placement is not
 // represented as an approved electrical design or automatic routing decision.
 const x=Math.ceil(Math.max(...audit.audit.inserts.map(e=>e.bounds?.max[0]??e.position[0]))/1000)*1000+20000,y=0;
 const prepare=report.results.prepared=await call('cad_prepare_project',{drawing:chosen.copy,expectedSha256:chosen.sourceSha256,requestId:crypto.randomUUID(),units:'mm'});
 check('Prepare a managed project copy without modifying original units or entities',()=>{assert.equal(prepare.snapshot.adapter,'tangent-project');assert.equal(prepare.snapshot.deviceCount,0);assert.equal(prepare.snapshot.units,'Millimeters');});await save();
 // The selected symbols have explicit local geometric anchors. These are not
 // inferred manufacturer terminals; both endpoints are checked in WCS.
 const lampOffset=def.geometryPreview.find(e=>e.type==='CIRCLE')?.ends?.start||[0,0,0];
 const socketDefinition=audit.audit.definitions.find(d=>d.name===socket.blockName),socketOffset=socketDefinition.geometryPreview.find(e=>e.ends)?.ends.start||[0,0,0];
 const lampRotation=Math.PI/2;
 const positions=[[x,y,0],[x+3000,y,0],[x+6000,y,0],[x,y+3000,0],[x+6000,y+3000,0]];
 const anchor=(p,template,offset,angle)=>[p[0]+offset[0]*template.scale[0]*Math.cos(angle)-offset[1]*template.scale[1]*Math.sin(angle),p[1]+offset[0]*template.scale[0]*Math.sin(angle)+offset[1]*template.scale[1]*Math.cos(angle),0];
 const lampPorts=positions.slice(0,3).map(p=>anchor(p,lamp,lampOffset,lampRotation)),socketPorts=positions.slice(3).map(p=>anchor(p,socket,socketOffset,0));
 const request={drawing:prepare.drawing,expectedSha256:prepare.drawingSha256,documentId:prepare.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',adapter:'tangent-project',host:'tangent',operations:[
  {type:'clone_project_symbols',templateHandle:lamp.handle,instances:positions.slice(0,3).map((position,i)=>({id:'QA-L'+i,position,rotationRadians:lampRotation,portOffset:lampOffset}))},
  {type:'clone_project_symbols',templateHandle:socket.handle,instances:positions.slice(3).map((position,i)=>({id:'QA-S'+i,position,rotationRadians:0,portOffset:socketOffset}))},
  {type:'connect_route',id:'QA-R1',circuitId:'CBQA-WL1',from:{id:'QA-L0',port:'PWR'},to:{id:'QA-L2',port:'PWR'},vertices:lampPorts,wireSpec:{wireType:'BV',conductorSpec:'2x2.5',method:'SC'}},
  {type:'connect_route',id:'QA-R2',circuitId:'CBQA-WL2',from:{id:'QA-S0',port:'PWR'},to:{id:'QA-S1',port:'PWR'},vertices:socketPorts,wireSpec:{wireType:'BV',conductorSpec:'3x2.5',method:'SC'}},
  {type:'number_devices',ids:['QA-L0','QA-L1','QA-L2'],prefix:'CBQA-L-',start:1,width:3},{type:'number_devices',ids:['QA-S0','QA-S1'],prefix:'CBQA-S-',start:1,width:3}
 ]};
 await fs.writeFile(path.join(folder,'project-apply-request.json'),JSON.stringify(request,null,2));
 const applied=report.results.applied=await call('electrical_apply',request);await save();
 check('Native engineering symbol clone, route and number batch persists five devices and two routes',()=>{assert.equal(applied.nativeHost.nativeKernelLoaded,true);assert.equal(applied.snapshot.deviceCount,5);assert.equal(applied.snapshot.routeCount,2);assert.equal(applied.snapshot.routeLengthMm,12000);assert.deepEqual(applied.snapshot.issues,[]);});
 const reopened=report.results.reopened=await call('tangent_inspect',{drawing:applied.drawing,host:'tangent',detail:'full'});await save();
 check('Fresh native host recognizes added actual engineering blocks and routes',()=>{assert.equal(reopened.tangent.deviceCount,chosen.devices+5);assert.equal(reopened.tangent.wireCount,chosen.wires+2);assert.equal(reopened.snapshot.deviceCount,5);assert.deepEqual(reopened.snapshot.issues,[]);});
 const before=await readDxf(chosen.dxf),after=await readDxf(applied.dxf);report.preservation=unchangedRecords(before,after);
 check('Existing geometry and attributes remain unchanged after verified dimension-name and screen-state normalization',()=>assert.equal(report.preservation.differences.length,0,JSON.stringify(report.preservation.differences.slice(0,5))));
 const nativeRaw=await full({jobRoot:reopened.jobRoot});report.finalComparison=compareElectrical(after,nativeRaw.tangent);check('Independent DXF agrees with native saved result',()=>assert.deepEqual(report.finalComparison.mismatches,[]));
 const inserts=new Map(after.roots.filter(e=>e.type==='INSERT').map(e=>[e.handle,e]));
 check('Actual block names, scales, source attributes and added numbers survive export',()=>{for(const device of applied.snapshot.devices){const e=inserts.get(device.handle);assert.ok(e);const template=device.id.startsWith('QA-L')?lamp:socket;assert.equal(tag(e,2),template.blockName);for(let i=0;i<3;i++)assert.equal(Number(tag(e,41+i,1)),template.scale[i]);assert.equal(after.attributes.get(device.handle).A,template.attributes.A);assert.equal(after.attributes.get(device.handle).DEVICE_ID,device.attributes.DEVICE_ID);}});
 const validation=report.results.validation=await call('electrical_validate',{drawing:applied.drawing});check('Reopened engineering connection anchors and numbering validate',()=>assert.deepEqual(validation.snapshot.issues,[]));
 const replay=report.results.replay=await call('electrical_apply',{...request,drawing:applied.drawing,expectedSha256:applied.drawingSha256,host:'core'});check('Engineering clone request replay does not duplicate existing geometry',()=>{assert.equal(replay.replayed,true);assert.equal(replay.snapshot.deviceCount,5);});
 const failure=report.results.rollback=await client.callTool({name:'electrical_apply',arguments:{...request,drawing:applied.drawing,expectedSha256:applied.drawingSha256,expectedRevision:1,requestId:crypto.randomUUID(),host:'core',operations:[{type:'clone_project_symbols',templateHandle:lamp.handle,instances:[{id:'QA-ROLLBACK',position:[x+9000,y,0],portOffset:lampOffset}]},{type:'number_devices',ids:['QA-ROLLBACK'],prefix:'CBQA-L-',start:1,width:3}]}},{timeout:180000});const failed=JSON.parse(failure.content.find(c=>c.type==='text').text);
 check('Late number conflict rolls back engineering deep clones and attributes without orphan geometry',()=>{assert.equal(failed.ok,false);assert.equal(failed.error.code,'NUMBER_CONFLICT');assert.equal(failed.afterFailure.deviceCount,5);assert.equal(failed.afterFailure.revision,1);assert.equal(failed.afterFailure.excludedTopLevelEntities,applied.snapshot.excludedTopLevelEntities);});report.results.rollback=failed;
 for(const entry of manifest.files)assert.equal(await hashFile(entry.source),entry.sha256);check('All original files and staged source copies remain byte-identical',()=>{});for(const entry of manifest.files.filter(e=>e.copy))assert.equal(await hashFile(entry.copy),entry.sha256);
 report.ok=report.files.every(e=>e.skipped||e.comparison?.ok);report.completedAt=new Date().toISOString();report.elapsedMs=Math.round(performance.now()-started);await save();console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,report:path.join(folder,'project-validation.json'),drawing:applied.drawing}));if(!report.ok)process.exitCode=1;
}catch(error){report.error=error.stack;await save();throw error;}finally{await client.close();}
