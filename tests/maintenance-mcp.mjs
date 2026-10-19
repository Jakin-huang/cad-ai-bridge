import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectRoot as root} from '../src/config.mjs';
const checks=[],measurements=[];
const folder=await fs.mkdtemp(path.join(root,'artifacts/maintenance-mcp-'));
const missing=path.join(folder,'missing.json'),malformed=path.join(folder,'malformed.json');await fs.writeFile(malformed,'invalid json');
const cases=[['missing configuration',{CADBRIDGE_CONFIG:missing}],['malformed configuration',{CADBRIDGE_CONFIG:malformed}],['missing PowerShell',{CADAGENT_POWERSHELL:path.join(folder,'missing.exe')}],['unsupported CAD',{CADAGENT_CAD_ROOT:path.join(folder,'missing-cad')}],['missing workspace',{CADAGENT_ALLOWED_ROOT:path.join(folder,'missing-workspace')}],['read-only',{CADBRIDGE_READ_ONLY:'1'}]];
for(const [name,env]of cases){
 const client=new Client({name:'maintenance-protocol',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.mjs')],env:{...process.env,...env},stderr:'pipe'});
 const started=performance.now();try{
  await client.connect(transport);const list=await client.listTools();measurements.push({name,startupMs:Math.round(performance.now()-started),toolCount:list.tools.length});
  for(const tool of ['cad_doctor','cad_get_job','cad_read_result','tangent_inspect'])assert.ok(list.tools.some(t=>t.name===tool));
  if(name==='read-only')assert.ok(!list.tools.some(t=>t.name==='electrical_apply'));
  const reply=await client.callTool({name:'cad_doctor',arguments:{}}),result=JSON.parse(reply.content[0].text);
  if(name!=='read-only'){assert.equal(result.ok,false);assert.ok(result.checks.some(c=>!c.ok));}
  checks.push(name+': handshake and tools available; diagnostics callable');console.log('PASS '+checks.at(-1));
 }finally{await client.close();}
}
const isolated=path.join(folder,'without-plugin');await fs.mkdir(isolated);
for(const file of ['bridge.mjs','mcp-server.mjs','dependencies.mjs','package.json'])await fs.copyFile(path.join(root,file),path.join(isolated,file));await fs.cp(path.join(root,'src'),path.join(isolated,'src'),{recursive:true});
{
 const client=new Client({name:'missing-plugin',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(isolated,'mcp-server.mjs')],env:{...process.env,CADBRIDGE_CONFIG:path.join(root,'cadbridge.local.json')},stderr:'pipe'});
 try{await client.connect(transport);assert.ok((await client.listTools()).tools.some(t=>t.name==='cad_doctor'));const r=JSON.parse((await client.callTool({name:'cad_doctor',arguments:{}})).content[0].text);assert.equal(r.checks.find(c=>c.name==='plugin').ok,false);checks.push('Missing plugin does not prevent MCP handshake and is diagnosed');console.log('PASS '+checks.at(-1));}finally{await client.close();}
}
const before=(await fs.readdir(path.join(root,'runs'))).length;
const client=new Client({name:'maintenance-recovery',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.mjs')],env:{...process.env,CADBRIDGE_CONFIG:missing},stderr:'pipe'});
try{
 await client.connect(transport);const prior=JSON.parse(await fs.readFile(path.join(root,'artifacts/integration-report.json'),'utf8')),jobId=path.basename(prior.results.applied.jobRoot);
 const reply=await client.callTool({name:'cad_get_job',arguments:{jobId}}),r=JSON.parse(reply.content[0].text);assert.equal(r.result.drawingSha256,prior.results.applied.drawingSha256);assert.equal(r.result.ok,true);assert.equal((await fs.readdir(path.join(root,'runs'))).length,before);checks.push('Recovery works without CAD configuration and creates no CAD jobs');console.log('PASS '+checks.at(-1));
}finally{await client.close();}
await fs.writeFile(path.join(root,'artifacts/maintenance-mcp-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,measurements,scope:'Official SDK protocol verification; does not establish WorkBuddy UI compatibility.'},null,2));
