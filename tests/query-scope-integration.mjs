import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {localPath,projectPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
const host=JSON.parse((await fs.readFile(localPath('artifacts','session-qa','host.json'),'utf8')).replace(/^\uFEFF/,'')),folder=localPath('artifacts','query-qa'),checks=[],results={};
const seed=JSON.parse(await fs.readFile(localPath('artifacts','workflows-report.json'),'utf8')).results.seed.drawing;
const built=await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',projectPath('tests/query-fixture.ps1'),'-ExpectedPid',String(host.pid),'-OutputDirectory',folder,'-Seed',seed],{windowsHide:true,timeout:60000});
const fixture=JSON.parse(built.stdout.replace(/^\uFEFF/,'')),sourceHashes=Object.fromEntries(await Promise.all(['drawing','meters','xref'].map(async key=>[key,await hashFile(fixture[key])]))),client=new Client({name:'cadbridge-query-compatibility',version:'0.2.0'}),transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],env:{...process.env,CADAGENT_ALLOWED_ROOT:folder},stderr:'pipe'});
const check=(name,verify)=>{verify();checks.push(name);console.log('PASS '+name);};
async function call(name,args){const response=await client.callTool({name,arguments:args},{timeout:180000});return JSON.parse(response.content.find(c=>c.type==='text').text);}
try{
 await client.connect(transport);const root=results.root=await call('cad_query_entities',{drawing:fixture.drawing,filter:{types:['LINE']}});assert.equal(root.ok,true,JSON.stringify(root));
 check('Legacy default query remains model-space roots only',()=>assert.equal(root.query.entities.some(e=>e.handle===fixture.lineHandle),false));
 const nested=results.nested=await call('cad_query_entities',{drawing:fixture.drawing,scope:{includeNested:true},filter:{types:['LINE']}});assert.equal(nested.ok,true,JSON.stringify(nested));const leaves=nested.query.entities.filter(e=>e.handle===fixture.lineHandle);
 check('Nested local instances have distinct instance paths despite sharing one definition handle',()=>{assert.equal(leaves.length,2);assert.notDeepEqual(leaves[0].instancePath,leaves[1].instancePath);assert.ok(leaves.every(e=>e.nested&&!e.editableScope));});
 const first=leaves.find(e=>e.instancePath[0]===fixture.firstHandle);check('Nested point coordinates apply both local scale and parent rotation in WCS',()=>{assert.ok(Math.abs(first.start[0]-4980)<1e-6);assert.ok(Math.abs(first.start[1]-1010)<1e-6);assert.ok(Math.abs(first.end[1]-1210)<1e-6);assert.equal(first.definition_length,100);assert.equal(first.length,undefined);});
 const cropped=results.cropped=await call('cad_query_entities',{drawing:fixture.drawing,scope:{includeNested:true},filter:{types:['LINE'],region:{min:[4900,1000,0],max:[5100,1300,0]}}});check('Nested regional selection uses transformed WCS bounds',()=>{assert.equal(cropped.query.entities.length,1);assert.equal(cropped.query.entities[0].instancePath[0],fixture.firstHandle);});
 const limited=await call('cad_query_entities',{drawing:fixture.drawing,scope:{includeNested:true,maxDepth:1},filter:{types:['LINE']}});check('Depth limits report incomplete traversal instead of a complete count',()=>{assert.equal(limited.query.truncated,true);assert.ok(limited.query.errors.length>0);});
 const xref=await call('cad_query_entities',{drawing:fixture.drawing,scope:{includeNested:true},filter:{handles:[fixture.xrefHandle]}});check('External references are identified without silently expanding external contents',()=>{assert.equal(xref.query.entities.length,1);assert.equal(xref.query.entities[0].xref,true);});
 const paper=results.paper=await call('cad_query_entities',{drawing:fixture.drawing,scope:{layout:fixture.paperLayout},filter:{types:['LINE']}});check('Paper-space queries name the actual layout and mark objects outside editable root scope',()=>{assert.ok(paper.query.entities.some(e=>e.handle===fixture.paperHandle));assert.ok(paper.query.entities.every(e=>e.layout===fixture.paperLayout&&!e.editableScope));});
 const meters=results.meters=await call('cad_query_entities',{drawing:fixture.meters,scope:{includeNested:true},filter:{types:['LINE']}});check('Non-millimeter reading reports actual units without length conversion assumptions',()=>{assert.equal(meters.snapshot.units,'Meters');assert.equal(meters.query.units,'Meters');});
 const blocked=await call('cad_edit',{drawing:fixture.meters,expectedSha256:sourceHashes.meters,documentId:meters.snapshot.documentId,expectedRevision:meters.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations:[{type:'move',handles:[fixture.firstHandle],delta:[100,0,0]}]});check('Non-millimeter writes remain explicitly rejected rather than silently converting the source',()=>{assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'UNITS_UNKNOWN');});
 for(const key of Object.keys(sourceHashes))assert.equal(await hashFile(fixture[key]),sourceHashes[key]);check('All ordinary, meter and xref source files preserve their original hashes',()=>{});
 const pluginSHA256=JSON.parse((await fs.readFile(projectPath('plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,'')).sha256;
 await fs.writeFile(localPath('artifacts','query-scope-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),pluginSHA256,checks,fixture,results,scope:'AutoCAD 2022 actual ordinary nested blocks, WCS bounds, xref identification, paper-space reading and meter-unit read-only coverage; no new CAD version or custom-object write support claimed.'},null,2));
}catch(error){await fs.writeFile(localPath('artifacts','query-scope-failure.json'),JSON.stringify({ok:false,error:error.stack,checks,fixture,results},null,2));throw error;}finally{await client.close();}
