import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectRoot as root} from '../src/config.mjs';
import {dependencyFiles} from '../scripts/package-dependencies.mjs';
const checks=[],measurements=[];
const folder=await fs.mkdtemp(projectPath('artifacts/maintenance-mcp-'));
const missing=path.join(folder,'missing.json'),malformed=path.join(folder,'malformed.json');await fs.writeFile(malformed,'invalid json');
const cases=[['missing configuration',{CADBRIDGE_CONFIG:missing}],['malformed configuration',{CADBRIDGE_CONFIG:malformed}],['missing PowerShell',{CADAGENT_POWERSHELL:path.join(folder,'missing.exe')}],['unsupported CAD',{CADAGENT_CAD_ROOT:path.join(folder,'missing-cad')}],['missing workspace',{CADAGENT_ALLOWED_ROOT:path.join(folder,'missing-workspace')}],['read-only',{CADBRIDGE_READ_ONLY:'1'}]];
for(const [name,env]of cases){
 const client=new Client({name:'maintenance-protocol',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,...env},stderr:'pipe'});
 const started=performance.now();try{
  await client.connect(transport);const list=await client.listTools();measurements.push({name,startupMs:Math.round(performance.now()-started),toolCount:list.tools.length});
  for(const tool of ['cad_doctor','cad_get_job','cad_read_result','tangent_inspect'])assert.ok(list.tools.some(t=>t.name===tool));
  if(name==='read-only'){assert.ok(!list.tools.some(t=>['electrical_apply','cad_edit'].includes(t.name)));for(const tool of ['cad_query_entities','cad_export'])assert.ok(list.tools.some(t=>t.name===tool));}
  const reply=await client.callTool({name:'cad_doctor',arguments:{}}),result=parseLocalJSON(reply.content[0].text);
  if(name!=='read-only'){assert.equal(result.ok,false);assert.ok(result.checks.some(c=>!c.ok));}
  checks.push(name+': handshake and tools available; diagnostics callable');console.log('PASS '+checks.at(-1));
 }finally{await client.close();}
}
const isolated=path.join(folder,'without-plugin');await fs.mkdir(isolated);
for(const file of ['bridge.mjs','mcp-server.mjs','dependencies.mjs','package.json'])await fs.copyFile(projectPath(file),path.join(isolated,file));await fs.cp(projectPath('src'),path.join(isolated,'src'),{recursive:true});
for(const file of await dependencyFiles()){const target=path.join(isolated,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(projectPath(file),target);}
{
 const client=new Client({name:'missing-plugin',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(isolated,'mcp-server.mjs')],env:{...process.env,CADBRIDGE_CONFIG:projectPath('cadbridge.local.json')},stderr:'pipe'});
 try{await client.connect(transport);assert.ok((await client.listTools()).tools.some(t=>t.name==='cad_doctor'));const r=parseLocalJSON((await client.callTool({name:'cad_doctor',arguments:{}})).content[0].text);assert.equal(r.checks.find(c=>c.name==='plugin').ok,false);checks.push('Missing plugin does not prevent MCP handshake and is diagnosed');console.log('PASS '+checks.at(-1));}finally{await client.close();}
}
const before=(await fs.readdir(projectPath('runs'))).length;
const client=new Client({name:'maintenance-recovery',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADBRIDGE_CONFIG:missing},stderr:'pipe'});
try{
 await client.connect(transport);const prior=parseLocalJSON(await fs.readFile(projectPath('artifacts/integration-report.json'),'utf8')),jobId=path.basename(prior.results.applied.jobRoot);
 const reply=await client.callTool({name:'cad_get_job',arguments:{jobId}}),r=parseLocalJSON(reply.content[0].text);assert.equal(r.result.drawingSha256,prior.results.applied.drawingSha256);assert.equal(r.result.ok,true);assert.equal((await fs.readdir(projectPath('runs'))).length,before);checks.push('Recovery works without CAD configuration and creates no CAD jobs');console.log('PASS '+checks.at(-1));
}finally{await client.close();}
await fs.writeFile(projectPath('artifacts/maintenance-mcp-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,measurements,scope:'Official SDK protocol verification; does not establish WorkBuddy UI compatibility.'},null,2));
