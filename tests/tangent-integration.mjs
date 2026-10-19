import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {root,hashFile} from '../bridge.mjs';
import {loadConfig} from '../src/config.mjs';
const config=await loadConfig(),client=new Client({name:'cadbridge-tangent-acceptance',version:'0.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[projectPath('mcp-server.mjs')],stderr:'pipe'});
const checks=[],results={};let serverErrors='';const started=performance.now();
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
async function call(name,args={}){if(name==='tangent_inspect'||name==='tangent_takeoff')args={detail:'full',...args};const r=await client.callTool({name,arguments:args},{timeout:180000});const text=r.content?.find(c=>c.type==='text')?.text;assert.ok(text);try{return parseLocalJSON(text);}catch{throw Error(text);}}
const artifactDir=projectPath('artifacts');await fs.mkdir(artifactDir,{recursive:true});
try{
 await client.connect(transport);transport.stderr?.on('data',b=>serverErrors=(serverErrors+b).slice(-32000));
 results.fixture=await call('cad_create_test_drawing',{adapter:'tangent-v8'});
 const fixture=results.fixture;assert.equal(fixture.ok,true);
 check('Tangent synthetic fixture has both symbols and explicit mm',()=>{assert.equal(fixture.snapshot.adapter,'tangent-v8');assert.equal(fixture.snapshot.units,'Millimeters');assert.ok(fixture.snapshot.symbols.some(s=>s.name==='EA_SOCKET'));});
 const fixtureHash=await hashFile(fixture.drawing);
 const request={drawing:fixture.drawing,expectedSha256:fixture.drawingSha256,documentId:fixture.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',adapter:'tangent-v8',host:'tangent',operations:[
  {type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'L1',position:[0,0,0]},{id:'L2',position:[3000,0,0]},{id:'L3',position:[6000,0,0]}]},
  {type:'place_symbols',blockName:'EA_SOCKET',instances:[{id:'S1',position:[0,3000,0]},{id:'S2',position:[6000,3000,0]}]},
  {type:'connect_route',id:'route-light',circuitId:'WL1',from:{id:'L1',port:'PWR'},to:{id:'L3',port:'PWR'},vertices:[[0,0,0],[3000,0,0],[6000,0,0]],wireSpec:{wireType:'BV',conductorSpec:'2x2.5',method:'SC',installation:'FC',conduitDiameter:'15'}},
  {type:'connect_route',id:'route-socket',circuitId:'WL2',from:{id:'S1',port:'PWR'},to:{id:'S2',port:'PWR'},vertices:[[0,3000,0],[6000,3000,0]],wireSpec:{wireType:'BV',conductorSpec:'3x2.5'}},
  {type:'number_devices',ids:['L1','L2','L3'],prefix:'L-',start:1,width:3},
  {type:'number_devices',ids:['S1','S2'],prefix:'S-',start:1,width:3}
 ]};
 const applied=results.applied=await call('electrical_apply',request);
 check('Native Tangent GUI loads vendor ARX and applies an atomic electrical task',()=>{assert.equal(applied.ok,true,JSON.stringify(applied.error));assert.equal(applied.nativeHost.nativeKernelLoaded,true);assert.equal(applied.snapshot.deviceCount,5);assert.equal(applied.snapshot.routeCount,2);assert.equal(applied.snapshot.revision,1);assert.equal(applied.tangent.deviceCount,5);assert.equal(applied.tangent.wireCount,2);});
 const status=await fs.readFile(path.join(applied.jobRoot,'native-status.txt'),'utf8');
 check('Native command names resolve and SECURELOAD stays enabled',()=>{for(const name of ['rybz','jxbz','pmbx','hlbh','yjbh','hljc'])assert.match(status,new RegExp('"_?'+name+'"','i'));assert.match(status.trim(),/\n1$/);});
 check('Original fixture file remains unchanged',()=>assert.equal(fixtureHash,fixture.drawingSha256));assert.equal(await hashFile(fixture.drawing),fixtureHash);
 const reopened=results.reopened=await call('tangent_inspect',{drawing:applied.drawing,host:'tangent'});
 check('Fresh native host reads persisted devices, numbered attributes and two circuits',()=>{assert.equal(reopened.ok,true);assert.equal(reopened.nativeHost.nativeKernelLoaded,true);assert.equal(reopened.tangent.deviceCount,5);assert.equal(reopened.tangent.wireCount,2);assert.deepEqual(reopened.tangent.circuits.map(c=>c.id),['WL1','WL2']);assert.equal(reopened.tangent.statistics.lengthMm,12000);assert.deepEqual(reopened.tangent.devices.map(d=>d.attributes.DEVICE_ID).sort(),['L-001','L-002','L-003','S-001','S-002']);});
 const core=results.coreTakeoff=await call('tangent_takeoff',{drawing:applied.drawing});
 check('Fast backend matches native host electrical counts and length',()=>{assert.equal(core.ok,true);assert.equal(core.tangent.deviceCount,5);assert.equal(core.tangent.statistics.lengthMm,12000);assert.equal(core.tangent.wires.find(w=>w.circuitId==='WL1').spec.lnoar,'2x2.5');});
 const valid=results.validation=await call('electrical_validate',{drawing:applied.drawing});
 check('Managed connection ports and numbering validate after native save',()=>{assert.equal(valid.ok,true);assert.deepEqual(valid.snapshot.issues,[]);});
 const source=path.join(config.tangentRoot,'sys','电气演示.dwg');
 const sampleDir=await fs.mkdtemp(projectPath('runs','vendor-sample-')),sample=path.join(sampleDir,'electrical.dwg');const originalHash=await hashFile(source);await fs.copyFile(source,sample);
 const vendor=results.vendorSample=await call('tangent_inspect',{drawing:sample});
 check('Vendor sample reads 34 lighting/socket instances plus other observed classes and 28 wires without assuming units',()=>{assert.equal(vendor.ok,true);assert.equal(vendor.tangent.devices.filter(d=>['lighting','socket'].includes(d.category)).length,34);assert.equal(vendor.tangent.deviceCount,vendor.tangent.devices.length);assert.equal(vendor.tangent.wireCount,28);assert.equal(vendor.tangent.unitsSource,'unresolved');assert.equal(vendor.tangent.statistics.lengthMm,null);assert.ok(vendor.tangent.circuits.some(c=>c.id==='WL1'));assert.equal(vendor.tangent.coverage.proxyEntities,129);assert.deepEqual(vendor.tangent.coverage.errors,[]);});
 const assumed=results.vendorUnits=await call('tangent_takeoff',{drawing:sample,units:'mm'});
 check('Explicit unit assumption is reported and enables length conversion',()=>{assert.equal(assumed.ok,true);assert.equal(assumed.tangent.unitsSource,'caller-assumption');assert.ok(assumed.tangent.statistics.lengthMm>0);});
 const nativeVendor=results.nativeVendor=await call('tangent_inspect',{drawing:sample,host:'tangent'});
 check('Native vendor interpreter resolves architectural proxies while preserving electrical recognition',()=>{assert.equal(nativeVendor.ok,true);assert.equal(nativeVendor.tangent.coverage.proxyEntities,0);assert.equal(nativeVendor.tangent.deviceCount,vendor.tangent.deviceCount);assert.equal(nativeVendor.tangent.wireCount,28);});
 assert.equal(await hashFile(source),originalHash);assert.equal(await hashFile(sample),originalHash);
 check('Vendor installation sample and workspace source copy remain byte-identical',()=>assert.equal(vendor.inputSha256,originalHash));
 for(const [from,to]of[[applied.drawing,'tangent-electrical-demo.dwg'],[applied.dxf,'tangent-electrical-demo.dxf']])await fs.copyFile(from,path.join(artifactDir,to));
 await fs.writeFile(path.join(artifactDir,'tangent-integration-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),checks,results},null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length,report:'artifacts/tangent-integration-report.json'}));
}catch(error){await fs.writeFile(path.join(artifactDir,'tangent-integration-failure.json'),JSON.stringify({error:error.stack,checks,results,serverErrors},null,2));throw error;}finally{await client.close();}
