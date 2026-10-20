// Fresh-guest acceptance without CAD. Run from inside the extracted package.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {installWorkbuddy,restoreWorkbuddy,workbuddyLocations} from '../src/client-install.mjs';
import {projectRoot as root} from '../src/config.mjs';
const checks=[],home=workbuddyLocations().home;
const server={command:process.execPath,args:[path.join(root,'bin/cadbridge.mjs'),'mcp'],env:{CADAGENT_POWERSHELL:process.env.CADAGENT_POWERSHELL}};
const mcp={mcpServers:{'cad-ai-bridge':server}};
const client=new Client({name:'fresh-windows-standard-user',version:'0.2.0'});
try{
 await client.connect(new StdioClientTransport({...server,env:{...process.env,...server.env},stderr:'pipe'}));
 const names=(await client.listTools()).tools.map(tool=>tool.name);assert.equal(names.length,22);checks.push('Fresh Windows MCP discovers 22 tools without CAD installed');
 const doctor=JSON.parse((await client.callTool({name:'cad_doctor',arguments:{}})).content[0].text);assert.equal(doctor.ok,false);assert.ok(doctor.checks.some(check=>!check.ok&&String(check.detail).includes('CAD_NOT_SUPPORTED')));checks.push('Missing CAD returns a structured diagnostic without crashing MCP');
 await fs.mkdir(home,{recursive:true});const locations=workbuddyLocations(home);
 await fs.writeFile(locations.config,JSON.stringify({otherOption:true,mcpServers:{unrelated:{command:'retain'}}}));await fs.writeFile(path.join(home,'.mcp.json'),'client-owned proxy');
 const first=await installWorkbuddy(mcp);assert.equal(first.ok,true);assert.ok(await fs.readFile(path.join(locations.skill,'SKILL.md'),'utf8'));checks.push('Standard account installs global Skill and custom MCP in its own real profile');
 const upgraded={mcpServers:{'cad-ai-bridge':{...server,env:{...server.env,BRIDGE_GUEST_UPGRADE:'1'}}}};await installWorkbuddy(upgraded);
 const current=JSON.parse(await fs.readFile(locations.config,'utf8'));current.mcpServers.later={command:'retain later'};await fs.writeFile(locations.config,JSON.stringify(current));
 assert.equal((await restoreWorkbuddy()).restored,true);const restored=JSON.parse(await fs.readFile(locations.config,'utf8'));
 assert.deepEqual(restored.mcpServers['cad-ai-bridge'].env,server.env);assert.equal(restored.mcpServers.unrelated.command,'retain');assert.equal(restored.mcpServers.later.command,'retain later');assert.equal(restored.otherOption,true);assert.equal(await fs.readFile(path.join(home,'.mcp.json'),'utf8'),'client-owned proxy');checks.push('Standard account upgrades and restores connector/Skill, retaining unrelated services and proxy');
 const report={ok:true,checkedAt:new Date().toISOString(),scope:'Fresh Windows guest, actual independent standard account; protocol and local installation only, no CAD/WorkBuddy desktop execution',checks,toolNames:names,doctor};
 await fs.writeFile(process.argv[2],JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:true,checks}));
}finally{await client.close();}
