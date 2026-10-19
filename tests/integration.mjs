import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {dependency} from '../dependencies.mjs';
import {root,hashFile} from '../bridge.mjs';
const {Client}=await dependency('@modelcontextprotocol/client');
const {StdioClientTransport}=await dependency('@modelcontextprotocol/client/stdio');
const client=new Client({name:'cad-electrical-integration',version:'0.1.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],stderr:'pipe'});
let stderr='';const checks=[];const started=performance.now();const results={};
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
async function call(name,args={}){
 const result=await client.callTool({name,arguments:args});
 const text=result.content?.find(c=>c.type==='text')?.text;
 assert.ok(text,'MCP tool must return text');
 try{return parseLocalJSON(text);}catch(error){if(result.isError)return{ok:false,error:{code:'SDK_INPUT_VALIDATION',message:text}};throw error;}
}
try{
 await client.connect(transport);
 transport.stderr?.on('data',b=>{stderr=(stderr+b).slice(-32768);});
 const list=await client.listTools();
 check('MCP SDK initializes with all supported tools',()=>{for(const name of ['cad_create_test_drawing','cad_inspect','electrical_apply','electrical_takeoff','electrical_validate','tangent_inspect','tangent_takeoff','cad_native_status','cad_read_result'])assert.ok(list.tools.some(t=>t.name===name));});
 const fixture=results.fixture=await call('cad_create_test_drawing');
 check('test template saved with symbol and mm units',()=>{assert.equal(fixture.ok,true);assert.equal(fixture.snapshot.units,'Millimeters');assert.equal(fixture.snapshot.deviceCount,0);assert.ok(fixture.snapshot.symbols.some(s=>s.name==='EA_LIGHT'));});
 const fixtureDigest=await hashFile(fixture.drawing);
 const request={drawing:fixture.drawing,expectedSha256:fixture.drawingSha256,documentId:fixture.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',operations:[
   {type:'place_symbols',blockName:'EA_LIGHT',instances:[
     {id:'light-a',position:[0,0,0],attributes:{MODEL:'LED-18W'}},
     {id:'light-b',position:[3000,0,0],attributes:{MODEL:'LED-18W'}},
     {id:'light-c',position:[6000,0,0],attributes:{MODEL:'LED-24W'}}]},
   {type:'connect_route',id:'route-1',circuitId:'WL1',from:{id:'light-a',port:'PWR'},to:{id:'light-c',port:'PWR'},vertices:[[0,0,0],[3000,0,0],[6000,0,0]]},
   {type:'number_devices',ids:['light-a','light-b','light-c'],prefix:'L-',start:1,width:3}
 ]};
 const applied=results.applied=await call('electrical_apply',request);
 check('MCP task places, connects, numbers and saves DWG',()=>{assert.equal(applied.ok,true);assert.equal(applied.snapshot.deviceCount,3);assert.equal(applied.snapshot.routeCount,1);assert.equal(applied.snapshot.routeLengthMm,6000);assert.deepEqual(applied.snapshot.devices.map(d=>d.attributes.DEVICE_ID).sort(),['L-001','L-002','L-003']);assert.equal(applied.snapshot.revision,1);});
 check('source DWG preserved byte for byte',()=>assert.equal(fixtureDigest,fixture.drawingSha256));
 assert.equal(await hashFile(fixture.drawing),fixtureDigest);
 const inspected=results.reopened=await call('cad_inspect',{drawing:applied.drawing});
 check('new CAD process reopens actual saved DWG',()=>{assert.equal(inspected.ok,true);assert.equal(inspected.snapshot.documentId,applied.snapshot.documentId);assert.equal(inspected.snapshot.deviceCount,3);assert.equal(inspected.snapshot.routeLengthMm,6000);assert.equal(inspected.snapshot.revision,1);});
 const takeoff=results.takeoff=await call('electrical_takeoff',{drawing:applied.drawing});
 check('takeoff groups persisted model attributes',()=>{assert.equal(takeoff.ok,true);assert.deepEqual(takeoff.takeoff.groups,{'EA_LIGHT|LED-18W':2,'EA_LIGHT|LED-24W':1});assert.equal(takeoff.takeoff.routeLengthMm,6000);});
 const validation=results.validation=await call('electrical_validate',{drawing:applied.drawing});
 check('persisted numbering and connectivity validate',()=>{assert.equal(validation.ok,true);assert.deepEqual(validation.snapshot.issues,[]);});
 const current={...request,drawing:applied.drawing,expectedSha256:applied.drawingSha256};
 const replay=results.replay=await call('electrical_apply',current);
 check('same request UUID after reopen does not duplicate devices',()=>{assert.equal(replay.ok,true);assert.equal(replay.replayed,true);assert.equal(replay.snapshot.deviceCount,3);assert.equal(replay.snapshot.revision,1);});
 const conflict=results.conflict=await call('electrical_apply',{...current,operations:[{type:'number_devices',ids:['light-a'],prefix:'X-',start:1,width:3}]});
 check('UUID reused for different content is rejected',()=>{assert.equal(conflict.ok,false);assert.equal(conflict.error.code,'REQUEST_ID_CONFLICT');});
 const stale=results.stale=await call('electrical_apply',{...current,requestId:crypto.randomUUID()});
 check('stale drawing revision rejected',()=>{assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_REVISION');});
 const mutation={...current,requestId:crypto.randomUUID(),expectedRevision:1,operations:[
   {type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'must-rollback',position:[9000,0,0]}]},
   {type:'number_devices',ids:['must-rollback'],prefix:'L-',start:1,width:3}
 ]};
 const rollback=results.rollback=await call('electrical_apply',mutation);
 check('late numbering conflict rolls back earlier block insertion',()=>{assert.equal(rollback.ok,false);assert.equal(rollback.error.code,'NUMBER_CONFLICT');assert.equal(rollback.afterFailure.deviceCount,3);assert.equal(rollback.afterFailure.revision,1);assert.equal(rollback.afterFailure.excludedTopLevelEntities,0);assert.ok(!rollback.afterFailure.devices.some(d=>d.id==='must-rollback'));});
 const badRoute=results.badRoute=await call('electrical_apply',{...current,requestId:crypto.randomUUID(),expectedRevision:1,operations:[{...request.operations[1],id:'bad-route',vertices:[[100,0,0],[6000,0,0]]}]});
 check('disconnected route is rejected without adding geometry',()=>{assert.equal(badRoute.ok,false);assert.equal(badRoute.error.code,'DISCONNECTED_ROUTE');assert.equal(badRoute.afterFailure.routeCount,1);});
 const wrongDoc=results.wrongDocument=await call('electrical_apply',{...current,requestId:crypto.randomUUID(),documentId:crypto.randomUUID(),expectedRevision:1});
 check('document identity mismatch rejected',()=>{assert.equal(wrongDoc.ok,false);assert.equal(wrongDoc.error.code,'DOCUMENT_MISMATCH');});
 const staleFile=results.staleFile=await call('electrical_apply',{...current,expectedSha256:'0'.repeat(64)});
 check('file digest mismatch rejected before CAD launch',()=>{assert.equal(staleFile.ok,false);assert.match(staleFile.error.message,/STALE_FILE/);});
 const badSchema=results.badSchema=await call('electrical_apply',{...current,operations:[{...request.operations[1],vertices:[[0,0,1],[6000,0,0]]}]});
 check('MCP schema rejects non-planar coordinates',()=>assert.equal(badSchema.ok,false));
 const artifacts=projectPath('artifacts');await fs.mkdir(artifacts,{recursive:true});
 for(const [source,target]of [[applied.drawing,'electrical-demo.dwg'],[applied.dxf,'electrical-demo.dxf']])await fs.copyFile(source,path.join(artifacts,target));
 await fs.writeFile(path.join(artifacts,'sample-apply-request.json'),JSON.stringify(request,null,2));
 const dxf=await fs.readFile(applied.dxf,'utf8');const lines=dxf.split(/\r?\n/);let section='',pending=false,entities=[],entity=null;
 for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i].trim()),value=lines[i+1].trim();if(code===0&&value==='SECTION'){pending=true;continue;}if(pending&&code===2){section=value;pending=false;continue;}if(code===0&&value==='ENDSEC'){if(entity)entities.push(entity);entity=null;section='';continue;}if(section!=='ENTITIES')continue;if(code===0){if(entity)entities.push(entity);entity={type:value,pairs:[]};}else if(entity)entity.pairs.push([code,value]);}
 const get=(e,c)=>e.pairs.find(p=>p[0]===c)?.[1];
 const inserts=entities.filter(e=>e.type==='INSERT'&&get(e,2)==='EA_LIGHT');
 const polylines=entities.filter(e=>e.type==='LWPOLYLINE');
 const numbered=entities.filter(e=>e.type==='ATTRIB'&&get(e,2)==='DEVICE_ID').map(e=>get(e,1)).sort();
 check('independent DXF export contains three inserts, one route and numbers',()=>{assert.equal(inserts.length,3);assert.equal(polylines.length,1);assert.deepEqual(numbered,['L-001','L-002','L-003']);});
 const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const project=(x,y)=>[90+Number(x)*0.13,200-Number(y)*0.13];
 let shapes='';
 for(const e of polylines){let x=0;const pts=[];for(const [c,v]of e.pairs){if(c===10)x=Number(v);if(c===20)pts.push(project(x,v).join(','));}shapes+=`<polyline points="${pts.join(' ')}" fill="none" stroke="#139969" stroke-width="3"/>`;}
 for(const e of inserts){const [x,y]=project(get(e,10),get(e,20));shapes+=`<g transform="translate(${x},${y})"><circle r="19.5" fill="white" stroke="#b97c00" stroke-width="2"/><path d="M-14,-14L14,14M-14,14L14,-14" stroke="#b97c00" stroke-width="2"/></g>`;}
 for(const e of entities.filter(e=>e.type==='ATTRIB')){const [x,y]=project(get(e,10),get(e,20));shapes+=`<text x="${x}" y="${y}" font-size="13" fill="#24364a">${xml(get(e,1))}</text>`;}
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="380" viewBox="0 0 1040 380"><rect width="1040" height="380" fill="#f8fafc"/><text x="40" y="48" font-family="sans-serif" font-size="22" fill="#172a40">电气中间层 · 实际 DXF 数据预览</text><g font-family="sans-serif">${shapes}</g><text x="40" y="316" font-family="sans-serif" font-size="16" fill="#172a40">3 个灯具 · L-001 / L-002 / L-003 · WL1 路线 6000 mm</text><text x="40" y="348" font-family="sans-serif" font-size="13" fill="#53677a">由保存的 DXF 实体位置与属性生成；DWG 已经另一个 Core Console 进程重新读取验证。</text></svg>`;
 await fs.writeFile(path.join(artifacts,'electrical-demo.svg'),svg);
 const report={ok:true,checkedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),checks,artifacts:{drawing:path.join(artifacts,'electrical-demo.dwg'),dxf:path.join(artifacts,'electrical-demo.dxf'),preview:path.join(artifacts,'electrical-demo.svg')},drawingSha256:await hashFile(path.join(artifacts,'electrical-demo.dwg')),results};
 await fs.writeFile(path.join(artifacts,'integration-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length,elapsedMs:report.elapsedMs,report:path.join(artifacts,'integration-report.json')}));
}catch(error){
 await fs.mkdir(projectPath('artifacts'),{recursive:true});
 await fs.writeFile(projectPath('artifacts','integration-failure.json'),JSON.stringify({error:error.stack,checks,results,stderr},null,2));
 throw error;
}finally{await client.close();}
