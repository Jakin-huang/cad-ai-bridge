import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
// Explicit local acceptance, never run by npm test. Supply the installed client's home.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {projectRoot as root} from '../src/config.mjs';
import {workbuddyLocations} from '../src/client-install.mjs';
const home=process.argv[2];if(!home)throw Error('Supply the WorkBuddy home directory explicitly');
const locations=workbuddyLocations(home),config=parseLocalJSON(await fs.readFile(locations.config,'utf8'));
const server=config.mcpServers['cad-ai-bridge'];assert.equal(server.type,'stdio');
const skill=path.join(locations.skill,'SKILL.md');assert.deepEqual(await fs.readFile(skill),await fs.readFile(projectPath('skills/cadbridge-electrical/SKILL.md')));
await fs.access(path.join(locations.skill,'references/school-workflow.md'));
assert.deepEqual(await fs.readFile(path.join(locations.skill,'references/editing-workflow.md')),await fs.readFile(projectPath('skills/cadbridge-electrical/references/editing-workflow.md')));
assert.deepEqual(await fs.readFile(path.join(locations.skill,'references/native-tray-workflow.md')),await fs.readFile(projectPath('skills/cadbridge-electrical/references/native-tray-workflow.md')));
const client=new Client({name:'installed-workbuddy-config-acceptance',version:'0.2.0'}),checks=[],results={};
async function call(name,args={}){const reply=await client.callTool({name,arguments:args},{timeout:server.timeout});const value=parseLocalJSON(reply.content[0].text);assert.equal(value.ok,true,JSON.stringify(value.error));results[name]=value;return value;}
try{
 await client.connect(new StdioClientTransport({command:server.command,args:server.args,env:{...process.env,...server.env},stderr:'pipe'}));
 assert.equal((await client.listTools()).tools.length,24);checks.push('Installed MCP configuration starts and discovers 24 tools');
 await call('cad_doctor');checks.push('Installed environment diagnostic passes');
 const fixture=await call('cad_create_test_drawing',{adapter:'tangent-v8'});
 const applied=await call('electrical_apply',{drawing:fixture.drawing,documentId:fixture.snapshot.documentId,expectedRevision:fixture.snapshot.revision,expectedSha256:fixture.drawingSha256,requestId:crypto.randomUUID(),units:'mm',adapter:'tangent-v8',operations:[
  {type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'L1',position:[0,0,0]},{id:'L2',position:[3000,0,0]}]},
  {type:'connect_route',id:'WL1-route',circuitId:'WL1',from:{id:'L1',port:'PWR'},to:{id:'L2',port:'PWR'},vertices:[[0,0,0],[3000,0,0]],wireSpec:{wireType:'BV',conductorSpec:'2x2.5'}},
  {type:'number_devices',ids:['L1','L2'],prefix:'L-',start:1,width:3}
 ]});
 assert.equal(applied.snapshot.devices.length,2);assert.equal(applied.snapshot.routes.length,1);checks.push('Atomic placement, route and numbering saves through installed entry');
 const takeoff=await call('electrical_takeoff',{drawing:applied.drawing});assert.equal(takeoff.snapshot.devices.length,2);checks.push('Saved drawing reopens and retains devices');
 const validation=await call('electrical_validate',{drawing:applied.drawing});assert.deepEqual(validation.snapshot.issues,[]);checks.push('Saved connectivity and numbering validate');
 const recovered=await call('cad_get_job',{jobId:path.basename(applied.jobRoot)});assert.equal(recovered.result.drawingSha256,applied.drawingSha256);checks.push('Recorded result can be recovered');
 const queried=await call('cad_query_entities',{drawing:applied.drawing,filter:{ids:['L1']}});assert.equal(queried.query.entities.length,1);
 const changed=await call('cad_edit',{drawing:applied.drawing,expectedSha256:applied.drawingSha256,documentId:applied.snapshot.documentId,expectedRevision:applied.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'move_devices',ids:['L1','L2'],delta:[0,500,0]}]});assert.equal(changed.snapshot.routeLengthMm,3000);assert.deepEqual(changed.snapshot.issues,[]);
 await call('cad_export',{drawing:changed.drawing,format:'png'});checks.push('New query/edit/actual PNG tools work through the installed entry');
 checks.push('Installed Skill and standalone reference match the delivered source');
 const report={ok:true,checkedAt:new Date().toISOString(),scope:'Official MCP SDK using actual installed WorkBuddy configuration; not a desktop conversation test',checks,results};
 await fs.writeFile(projectPath('artifacts/workbuddy-installed-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks,drawing:applied.drawing}));
}finally{await client.close();}
