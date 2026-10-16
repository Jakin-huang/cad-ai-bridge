import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {root} from '../bridge.mjs';
const prior=JSON.parse(await fs.readFile(path.join(root,'artifacts/tangent-integration-report.json'),'utf8'));
const checks=[];let metrics;
for(const readOnly of [false,true]){
 const client=new Client({name:'cadbridge-result-validation',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp-server.mjs')],env:{...process.env,...(readOnly?{CADBRIDGE_READ_ONLY:'1'}:{})},stderr:'pipe'});
 try{await client.connect(transport);const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='cad_read_result'));
  if(readOnly){assert.ok(!list.tools.some(t=>t.name==='electrical_apply'||t.name==='cad_create_test_drawing'));checks.push('Read-only MCP discovery hides both write tools');continue;}
  const source=path.join(prior.results.vendorSample.jobRoot,'input.dwg');
  const response=await client.callTool({name:'tangent_inspect',arguments:{drawing:source}});const summary=JSON.parse(response.content[0].text);assert.equal(summary.ok,true);assert.equal(summary.tangent.deviceCount,34);assert.equal(summary.tangent.devices,undefined);assert.equal(summary.tangent.preview.devices.length,3);checks.push('Default Tangent MCP inspection returns bounded summary with full evidence retained');
  const full=JSON.parse(await fs.readFile(path.join(summary.jobRoot,'result.json'),'utf8'));const before=(await fs.readdir(path.join(root,'runs'))).length;
  const pageResult=await client.callTool({name:'cad_read_result',arguments:{jobId:summary.details.jobId,kind:'devices',offset:2,limit:2}});const page=JSON.parse(pageResult.content[0].text);assert.equal(page.ok,true);assert.deepEqual(page.items,full.tangent.devices.slice(2,4));assert.equal(page.total,34);assert.equal((await fs.readdir(path.join(root,'runs'))).length,before);checks.push('MCP result pages match retained data and create no CAD jobs');
  metrics={fullBytes:Buffer.byteLength(JSON.stringify(full)),summaryBytes:Buffer.byteLength(JSON.stringify(summary))};assert.ok(metrics.summaryBytes<metrics.fullBytes);checks.push('Summary reduces returned JSON bytes on actual vendor example');
 }finally{await client.close();}
}
await fs.writeFile(path.join(root,'artifacts/mcp-results-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,metrics},null,2));console.log(JSON.stringify({ok:true,checks,metrics}));
