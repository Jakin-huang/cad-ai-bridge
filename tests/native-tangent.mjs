import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {localPath} from '../src/local-paths.mjs';
import {hashFile} from '../src/drawings.mjs';
const client=new Client({name:'native-tangent-acceptance',version:'0.2.0'}),checks=[],results={};
await fs.mkdir(localPath('artifacts'),{recursive:true});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('mcp-server.mjs')],stderr:'pipe'});
const ok=r=>assert.equal(r.ok,true,JSON.stringify(r.error));
async function call(name,args={}){const r=await client.callTool({name,arguments:args},{timeout:240000});const text=r.content.find(c=>c.type==='text').text;try{return JSON.parse(text);}catch{throw Error(text);}}
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
function request(drawing,operations){return{drawing:drawing.drawing,expectedSha256:drawing.drawingSha256,documentId:drawing.snapshot.documentId,expectedRevision:drawing.snapshot.revision,requestId:crypto.randomUUID(),units:'mm',operations};}
const tray={type:'create_native_tray',fromPoint:[0,0,0],toPoint:[3000,0,0],width:400,height:150};
const labelRegion={min:[1300,600,0],max:[6500,1600,0]};
async function imageData(file){const b=await fs.readFile(file),parts=[];for(let p=8;p+12<=b.length;){const n=b.readUInt32BE(p);if(b.toString('ascii',p+4,p+8)==='IDAT')parts.push(b.subarray(p+8,p+8+n));p+=12+n;}assert.ok(parts.length);return Buffer.concat(parts);}
try{
 await client.connect(transport);assert.equal((await client.listTools()).tools.length,18);
 const seed=results.seed=await call('cad_create_drawing',{scene:{layers:[{name:'NATIVE_TEST',color:7}],symbols:[],entities:[{kind:'line',points:[[-1000,-1000,0],[-500,-1000,0]],layer:'NATIVE_TEST'}]}});ok(seed);
 const plan=request(seed,[tray,{...tray,fromPoint:[0,5000,0],toPoint:[4000,5000,0]}]);
 const created=results.created=await call('cad_edit',plan);ok(created);
 const loaded=JSON.parse(await fs.readFile(path.join(created.jobRoot,'native-runtime.json'),'utf8'));
 const preloads=JSON.parse(await fs.readFile(path.join(created.jobRoot,'native-preload.json'),'utf8'));
 assert.equal(path.win32.normalize(loaded.path).toLowerCase(),path.win32.normalize(preloads.find(m=>m.name.toLowerCase()==='tch_pipebase.arx').path).toLowerCase());
 const queried=results.queried=await call('cad_query_entities',{drawing:created.drawing,host:'tangent',filter:{types:['TCH_CABLETRY']}});ok(queried);
 const trays=queried.query.entities;
 check('Two real native trays survive save/reopen with exact lengths, dimensions and catalog model',()=>{assert.equal(trays.length,2);assert.deepEqual(trays.map(e=>Math.round(e.length)).sort(),[3000,4000]);for(const e of trays){assert.equal(e.native.widthMm,400);assert.equal(e.native.heightMm,150);assert.equal(e.native.model,'C-01-15-4');}assert.equal(created.nativeHost.completedByProtocol,true);assert.equal(created.nativeHost.timedOut,false);});
 const resized=results.resized=await call('cad_edit',request(created,[{type:'set_native_tray_size',handle:trays[0].handle,width:300,height:100}]));ok(resized);
 const resizedQuery=results.resizedQuery=await call('cad_query_entities',{drawing:resized.drawing,host:'tangent',filter:{types:['TCH_CABLETRY']}});ok(resizedQuery);
 check('Native size and model update together and persist after reopening',()=>{const e=resizedQuery.query.entities.find(e=>e.handle===trays[0].handle);assert.equal(e.native.widthMm,300);assert.equal(e.native.heightMm,100);assert.equal(e.native.model,'C-01-10-3');assert.ok(Math.abs(e.length-trays[0].length)<1e-5);for(const key of ['start','end'])assert.ok(Math.hypot(...e[key].map((n,i)=>n-trays[0][key][i]))<1e-5);});
 const decimals=results.decimals=await call('cad_edit',request(seed,[{...tray,fromPoint:[0,15000,0],toPoint:[1000,15000,0],width:50,height:25},{...tray,fromPoint:[0,20000,0],toPoint:[1000,20000,0],width:150,height:75}]));ok(decimals);
 const decimalQuery=results.decimalQuery=await call('cad_query_entities',{drawing:decimals.drawing,host:'tangent',filter:{types:['TCH_CABLETRY']}});ok(decimalQuery);
 check('Decimal catalog models for 50×25 and 150×75 persist after CAD reopening',()=>{assert.deepEqual(decimalQuery.query.entities.map(e=>e.native.model).sort(),['C-01-2.5-5','C-01-7.5-15']);assert.deepEqual(decimalQuery.query.entities.map(e=>[e.native.widthMm,e.native.heightMm]).sort((a,b)=>a[0]-b[0]),[[50,25],[150,75]]);});
 const labeled=results.labeled=await call('cad_edit',request(resized,[{type:'add_native_tray_label',handle:trays[0].handle,position:[1500,800,0],landingPoint:[2500,800,0]}]));ok(labeled);
 const labelQuery=results.labelQuery=await call('cad_query_entities',{drawing:labeled.drawing,host:'tangent',filter:{types:['TCH_CABLEDIM']}});ok(labelQuery);
 check('Real proprietary label survives reopening with its native tray association and text height',()=>{assert.equal(labelQuery.query.entities.length,1);const n=labelQuery.query.entities[0].native;assert.equal(n.nativeClass,'TDbCableDim');assert.ok(n.targetHandles.includes(trays[0].handle));assert.ok(n.textHeight>0,JSON.stringify(n));});
 const beforeLabelPNG=results.beforeLabelPNG=await call('cad_export',{drawing:labeled.drawing,host:'tangent',format:'png',region:labelRegion});ok(beforeLabelPNG);
 const relabeled=results.relabeled=await call('cad_edit',request(labeled,[{type:'set_native_tray_size',handle:trays[0].handle,width:400,height:150}]));ok(relabeled);
 const relabeledQuery=results.relabeledQuery=await call('cad_query_entities',{drawing:relabeled.drawing,host:'tangent',filter:{types:['TCH_CABLEDIM']}});ok(relabeledQuery);
 const afterLabelPNG=results.afterLabelPNG=await call('cad_export',{drawing:relabeled.drawing,host:'tangent',format:'png',region:labelRegion});ok(afterLabelPNG);
 const beforePixels=await imageData(beforeLabelPNG.exported.file),afterPixels=await imageData(afterLabelPNG.exported.file);
 check('Native label graphics refresh in an actual CAD crop excluding the resized tray',()=>{assert.ok(relabeledQuery.query.entities[0].native.targetHandles.includes(trays[0].handle));assert.notDeepEqual(afterPixels,beforePixels);});
 const labelRollback=results.labelRollback=await call('cad_edit',request(labeled,[{type:'add_native_tray_label',handle:trays[0].handle,position:[1500,1800,0],landingPoint:[2500,1800,0]},{type:'set_native_tray_size',handle:'FFFFFF',width:300,height:100}]));
 check('Late failure removes the new proprietary label while retaining the previous association',()=>{assert.equal(labelRollback.ok,false);assert.notEqual(labelRollback.error.code,'NATIVE_ROLLBACK_FAILED');assert.equal(labelRollback.mutationCommitted,false);assert.equal(labelRollback.drawing,undefined);const labels=labelRollback.afterFailureQuery.entities.filter(e=>e.type==='TCH_CABLEDIM');assert.equal(labels.length,1);assert.ok(labels[0].native.targetHandles.includes(trays[0].handle));});
 const locked=results.locked=await call('cad_edit',{...request(labeled,[{type:'upsert_layer',name:'CABLETRAY',color:4,locked:true}]),host:'tangent'});ok(locked);
 const denied=results.denied=await call('cad_edit',request(locked,[{type:'set_native_tray_size',handle:trays[0].handle,width:400,height:150}]));
 check('Native edits honor locked tray layers without publishing output',()=>{assert.equal(denied.ok,false);assert.equal(denied.error.code,'LAYER_LOCKED');assert.equal(denied.drawing,undefined);});
 const crossing=results.crossing=await call('cad_edit',request(resized,[{...tray,fromPoint:[1500,-1000,0],toPoint:[1500,1000,0]}]));
 check('Intersecting native assembly is rejected before creating fittings or changing existing trays',()=>{assert.equal(crossing.ok,false);assert.equal(crossing.error.code,'NATIVE_ASSEMBLY_UNSUPPORTED');assert.equal(crossing.mutationCommitted,false);assert.equal(crossing.drawing,undefined);assert.equal(crossing.afterFailureQuery.entities.filter(e=>e.type==='TCH_CABLETRY').length,2);});
 const replay=results.replay=await call('cad_edit',{...plan,drawing:created.drawing,expectedSha256:created.drawingSha256});
 check('Native UUID replay does not draw duplicate objects',()=>{ok(replay);assert.equal(replay.replayed,true);assert.equal(replay.snapshot.revision,created.snapshot.revision);assert.equal(replay.query.entities.filter(e=>e.type==='TCH_CABLETRY').length,2);});
 const conflict=results.conflict=await call('cad_edit',{...plan,drawing:created.drawing,expectedSha256:created.drawingSha256,operations:[{...tray,toPoint:[3500,0,0]}]});
 check('Reusing a native UUID with different geometry is rejected',()=>{assert.equal(conflict.ok,false);assert.equal(conflict.error.code,'REQUEST_ID_CONFLICT');assert.equal(conflict.drawing,undefined);});
 for(const [key,operations] of [['resizeRollback',[{type:'set_native_tray_size',handle:trays[0].handle,width:400,height:150},{type:'set_native_tray_size',handle:'FFFFFF',width:300,height:100}]],['createRollback',[{...tray,fromPoint:[0,10000,0],toPoint:[3000,10000,0]},{type:'set_native_tray_size',handle:'FFFFFF',width:300,height:100}]]]){
  const r=results[key]=await call('cad_edit',request(resized,operations));
  check(key+' restores the previous native objects and produces no DWG',()=>{assert.equal(r.ok,false);assert.notEqual(r.error.code,'NATIVE_ROLLBACK_FAILED',JSON.stringify(r.error));assert.equal(r.mutationCommitted,false);assert.equal(r.drawing,undefined);const es=r.afterFailureQuery.entities.filter(e=>e.type==='TCH_CABLETRY');assert.equal(es.length,2);assert.equal(es.find(e=>e.handle===trays[0].handle).native.widthMm,300);});
 }
 const stale=results.stale=await call('cad_edit',{...request(resized,[tray]),expectedSha256:'0'.repeat(64)});
 check('Stale source SHA is rejected before launching CAD',()=>{assert.equal(stale.ok,false);assert.equal(stale.metrics.hostLaunches,0);});
 const uncatalogued=results.uncatalogued=await call('cad_edit',request(resized,[{...tray,width:401}]));
 check('Unsupported catalog dimensions fail before CAD instead of keeping a stale model',()=>{assert.equal(uncatalogued.error.code,'NATIVE_SIZE_NOT_CATALOGUED');assert.equal(uncatalogued.metrics.hostLaunches,0);});
 const png=results.png=await call('cad_export',{drawing:relabeled.drawing,host:'tangent',format:'png'});ok(png);
 check('Actual CAD plot returns a nonempty native tray PNG and saved DXF',()=>{assert.ok(png.exported.bytes>1000);assert.ok(created.dxf);});
 for(const drawing of [seed,created,resized,decimals,labeled,relabeled])assert.equal(await hashFile(drawing.drawing),drawing.drawingSha256);
 check('Every source DWG keeps its original hash',()=>{});
 const build=JSON.parse((await fs.readFile('plugin/bin/build.json','utf8')).replace(/^\uFEFF/,''));
 await fs.writeFile(localPath('artifacts','native-tangent-report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),checks,results,pluginSHA256:build.sha256},null,2));
 console.log(JSON.stringify({ok:true,checks:checks.length}));
}catch(error){await fs.writeFile(localPath('artifacts','native-tangent-failure.json'),JSON.stringify({error:error.stack,checks,results},null,2));throw error;}finally{await client.close();}
