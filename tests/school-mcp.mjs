import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {root,hashFile} from '../bridge.mjs';
import {makeSchoolDesign} from '../src/school-design.mjs';
const r=parseLocalJSON(await fs.readFile(projectPath('examples/school-requirements.json'),'utf8')),m=makeSchoolDesign(r);
const scene={view:m.scene.view,views:m.scene.views,layers:m.scene.layers,symbols:[m.scene.symbols[0]],entities:m.scene.entities.slice(0,3)};
scene.symbols[0].geometry.push({kind:'solid',layer:'0',points:[[-100,-50,0],[100,-50,0],[0,50,0]]},{kind:'polyline',layer:'0',points:[[-300,80,0],[300,80,0]],closed:false,width:15},{kind:'text',layer:'0',position:[-200,120,0],text:'TEST',height:80,widthFactor:0.65,rotationRadians:0});
const client=new Client({name:'school-scene-integration',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],stderr:'pipe'});
const checks=[],results={};const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const call=async(name,args)=>{const reply=await client.callTool({name,arguments:args});return parseLocalJSON(reply.content[0].text);};
try{
 await client.connect(transport);
 const list=await client.listTools();check('MCP exposes bounded original scene creation',()=>assert.ok(list.tools.some(t=>t.name==='cad_create_drawing')));
 const seed=results.seed=await call('cad_create_drawing',{scene});
 check('MCP creates actual mm scene DWG with original block and no managed devices',()=>{assert.equal(seed.ok,true);assert.equal(seed.snapshot.units,'Millimeters');assert.equal(seed.snapshot.deviceCount,0);assert.ok(seed.snapshot.symbols.some(s=>s.name==='SCH_LIGHT'));});
 const invalid=structuredClone(scene);invalid.entities[0].points[0][2]=10;
 const jobs=(await fs.readdir(projectPath('runs'))).length;
 const badReply=await client.callTool({name:'cad_create_drawing',arguments:{scene:invalid}});
 check('MCP rejects off-plane scene before creating host job',()=>{assert.equal(badReply.isError,true);});assert.equal((await fs.readdir(projectPath('runs'))).length,jobs);
 const apply=results.apply=await call('electrical_apply',{drawing:seed.drawing,expectedSha256:seed.drawingSha256,documentId:seed.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'place_symbols',blockName:'SCH_LIGHT',instances:[{id:'A',position:[1000,1000,0],layer:'E-FIRE',attributes:{MODEL:'ORIGINAL-24W'}},{id:'B',position:[4000,1000,0],layer:'E-FIRE',attributes:{MODEL:'ORIGINAL-24W'}}]},{type:'connect_route',id:'R1',circuitId:'TEST1',from:{id:'A',port:'PWR'},to:{id:'B',port:'PWR'},vertices:[[1000,1000,0],[4000,1000,0]],layer:'E-DATA'},{type:'number_devices',ids:['A','B'],prefix:'S-',start:1,width:3}]});
 check('MCP places new symbols, uses declared layers, connects and numbers atomically',()=>{assert.equal(apply.ok,true);assert.equal(apply.snapshot.routeLengthMm,3000);assert.deepEqual(apply.snapshot.devices.map(d=>d.attributes.DEVICE_ID),['S-001','S-002']);});
 const fresh=results.fresh=await call('cad_audit_drawing',{drawing:apply.drawing,detail:'full'});
 check('Fresh CAD census confirms placement layers and new scene text',()=>{assert.equal(fresh.ok,true);assert.ok(fresh.audit.inserts.every(e=>e.layer==='E-FIRE'));assert.ok(fresh.audit.texts.length>=2);const def=fresh.audit.definitions.find(s=>s.name==='SCH_LIGHT');assert.ok(def.geometryPreview.some(g=>g.type==='SOLID'));});
 check('Scene source DWG remains unchanged',()=>assert.equal(seed.drawingSha256,apply.inputSha256));assert.equal(await hashFile(seed.drawing),seed.drawingSha256);
}finally{await client.close();}
const ro=new Client({name:'school-read-only',version:'0.2.0'}),rt=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_READ_ONLY:'1'},stderr:'pipe'});
try{await ro.connect(rt);const list=await ro.listTools();check('Read-only MCP hides original scene creation and all other writes',()=>assert.ok(!list.tools.some(t=>['cad_create_drawing','cad_create_test_drawing','cad_prepare_project','cad_repair_copy','electrical_apply'].includes(t.name))));}finally{await ro.close();}
await fs.writeFile(projectPath('artifacts/school-mcp-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,results},null,2));
console.log(JSON.stringify({ok:true,checks:checks.length}));
