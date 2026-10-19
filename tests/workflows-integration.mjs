import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectPath,localPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';

const client=new Client({name:'cadbridge-practical-workflows',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:process.env,stderr:'pipe'}),checks=[],results={};
async function call(name,args){const reply=await client.callTool({name,arguments:args},{timeout:600000});const value=JSON.parse(reply.content.find(c=>c.type==='text').text);if(value.responseTruncated)return JSON.parse(await fs.readFile(path.join(value.jobRoot,'result.json'),'utf8'));return value;}
const check=(name,verify)=>{verify();checks.push(name);console.log('PASS '+name);};
const run=async(name,plan,filter={},extra={})=>{const result=await call('cad_workflow',{drawing:results.seed.drawing,requestId:crypto.randomUUID(),filter,plan,preview:false,...extra});results[name]=result;assert.equal(result.ok,true,JSON.stringify(result));return result;};
try{
 await client.connect(transport);const names=(await client.listTools()).tools.map(t=>t.name);assert.ok(names.includes('cad_workflow')&&names.includes('cad_capabilities'));
 const facts=await call('cad_capabilities',{});check('Capability facts remain available independently of CAD execution',()=>{assert.equal(facts.product,'CAD AI Bridge');assert.equal(facts.execution.sessionStatus,'experimental');});
 const seed=results.seed=await call('cad_create_drawing',{scene:{layers:[{name:'TEXT',color:2},{name:'BLOCK',color:3},{name:'GEOM',color:7},{name:'ALT',color:4}],symbols:[{name:'QA_SYMBOL',geometry:[{kind:'circle',layer:'BLOCK',position:[0,0,0],radius:100}],attributes:[{tag:'MODEL',position:[120,0,0],height:70,visible:true,value:'OLD'}]}],entities:[{kind:'text',layer:'TEXT',position:[0,500,0],text:'OLD PROJECT',height:150},{kind:'text',layer:'TEXT',position:[0,1000,0],text:'UNCHANGED',height:150},{kind:'line',layer:'GEOM',points:[[0,0,0],[3000,0,0]]}]}});assert.equal(seed.ok,true,JSON.stringify(seed));
 const inserted=await call('cad_edit',{drawing:seed.drawing,expectedSha256:seed.drawingSha256,documentId:seed.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'insert_block',blockName:'QA_SYMBOL',position:[500,0,0],layer:'BLOCK',attributes:{MODEL:'OLD'}},{type:'insert_block',blockName:'QA_SYMBOL',position:[1500,0,0],layer:'BLOCK',attributes:{MODEL:'OLD'}}]});assert.equal(inserted.ok,true,JSON.stringify(inserted));results.seed=inserted;
 const sourceSha=await hashFile(inserted.drawing);
 const text=await run('text',{type:'replace_text',search:'OLD PROJECT',replacement:'项目修改完成'}, {types:['TEXT']},{preview:true});
 check('T1 text task saves and independently reads Chinese replacement with before/after actual CAD PNG',()=>{assert.equal(text.summary.changed,1);assert.equal(text.query.entities.find(e=>e.text==='项目修改完成').type,'TEXT');assert.ok(text.files.some(f=>f.kind==='before-png'));assert.ok(text.files.some(f=>f.kind==='after-png'));assert.equal(text.review.verifiedBy,'fresh CAD readback');});
 const organized=await run('organize',{type:'organize',attributes:{MODEL:'NEW'},layer:'ALT'},{types:['INSERT']});
 check('T2 attributes and layer task changes only selected ordinary block instances after reopening',()=>{assert.equal(organized.summary.changed,2);assert.ok(organized.query.entities.every(e=>e.attributes.MODEL==='NEW'&&e.layer==='ALT'));});
 const takeoff=await run('takeoff',{type:'takeoff',groupBy:['blockName'],attributeTags:['MODEL']},{types:['INSERT']});
 check('T3 generic takeoff produces consistent two-instance totals and retained detail/summary CSV',()=>{assert.equal(takeoff.statistics.entityCount,2);assert.equal(takeoff.groups[0].count,2);assert.equal(takeoff.files.filter(f=>f.kind.endsWith('csv')).length,2);});
 const line=await call('cad_query_entities',{drawing:inserted.drawing,filter:{types:['LINE']}}),lineHandle=line.query.entities[0].handle;
 const arranged=await run('arrange',{type:'edit',operations:[{type:'array',handles:[lineHandle],rows:2,columns:2,rowSpacing:300,columnSpacing:4000},{type:'add_dimension',kind:'aligned',fromPoint:[0,0,0],toPoint:[3000,0,0],position:[1500,-500,0],layer:'GEOM',height:100}]},{types:['LINE']});
 check('T4 array and dimension task persists three copied lines and an actual 3000-unit dimension',()=>{assert.equal(arranged.summary.created,4);assert.ok(arranged.query.entities.some(e=>e.type==='DIMENSION'&&Math.abs(e.measurement-3000)<1e-5));});
 const exported=await run('exports',{type:'export_batch',items:[{name:'drawing',format:'pdf'},{name:'detail',format:'png',region:{min:[-500,-500,0],max:[4000,2000,0]}}]});
 check('T5 exports a valid PDF and PNG from one frozen source with delivery hashes',()=>{assert.equal(exported.exports.length,2);assert.ok(exported.files.every(f=>f.bytes>100));});
 for(const file of exported.files){const bytes=await fs.readFile(file.file);if(file.kind==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');if(file.kind==='png')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
 const request=JSON.parse(await fs.readFile(path.join(text.jobRoot,'request.json'),'utf8'));delete request.fingerprint;const replay=await call('cad_workflow',request);
 check('Workflow replay returns the same saved drawing without child CAD executions',()=>{assert.equal(replay.replayed,true);assert.equal(replay.drawingSha256,text.drawingSha256);assert.deepEqual(replay.children,text.children);});
 assert.equal(await hashFile(inserted.drawing),sourceSha);check('All source drawing bytes remain unchanged across five workflows',()=>{});
 const readonlyClient=new Client({name:'cadbridge-readonly-workflows',version:'0.2.0'});try{
  await readonlyClient.connect(new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_READ_ONLY:'1'},stderr:'pipe'}));const tools=(await readonlyClient.listTools()).tools;assert.equal(tools.find(t=>t.name==='cad_workflow').annotations.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='cad_session').annotations.readOnlyHint,true);
  const readonlyReply=await readonlyClient.callTool({name:'cad_workflow',arguments:{drawing:inserted.drawing,requestId:crypto.randomUUID(),plan:{type:'takeoff'},preview:false}},{timeout:180000});assert.equal(JSON.parse(readonlyReply.content.find(c=>c.type==='text').text).ok,true);
  const refused=await readonlyClient.callTool({name:'cad_workflow',arguments:{drawing:inserted.drawing,requestId:crypto.randomUUID(),plan:{type:'replace_text',search:'OLD',replacement:'BAD'}}});assert.equal(refused.isError,true);check('Read-only MCP still supports generic takeoff but refuses text modification at the schema boundary',()=>{});
 }finally{await readonlyClient.close();}
 const pluginSHA256=JSON.parse((await fs.readFile(projectPath('plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,'')).sha256;
 const report={ok:true,checkedAt:new Date().toISOString(),pluginSHA256,checks,results,scope:'Actual AutoCAD 2022 via official MCP SDK. This is automated host evidence, not external-user or desktop-dialogue acceptance.'};await fs.mkdir(localPath('artifacts'),{recursive:true});await fs.writeFile(localPath('artifacts','workflows-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:checks.length}));
}catch(error){await fs.mkdir(localPath('artifacts'),{recursive:true});await fs.writeFile(localPath('artifacts','workflows-failure.json'),JSON.stringify({ok:false,checkedAt:new Date().toISOString(),error:error.stack,checks,results},null,2));throw error;}finally{await client.close();}
