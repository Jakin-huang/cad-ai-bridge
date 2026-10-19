import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {schemas,readonlySessionSchema,readonlyWorkflowSchema} from '../../src/contracts.mjs';
import {listSessions,executeSession,sessionRequest} from '../../src/sessions.mjs';
import {hashFile} from '../../src/drawings.mjs';

test('session discovery hides authentication and ignores invalid or stale descriptors',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-session-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const sessionId=crypto.randomUUID(),descriptor={schemaVersion:1,pid:process.pid,sessionId,pipe:'cadbridge-'+process.pid+'-'+'a'.repeat(32),token:'b'.repeat(64)};
 await fs.writeFile(path.join(root,sessionId+'.json'),JSON.stringify(descriptor));await fs.writeFile(path.join(root,'bad.json'),'invalid');assert.equal((await listSessions(root)).length,1);const listing=await executeSession({action:'list'},{root});assert.equal(listing.sessions[0].token,undefined);assert.equal(listing.sessions[0].pipe,undefined);
 descriptor.pipe='arbitrary-service';await fs.writeFile(path.join(root,sessionId+'.json'),JSON.stringify(descriptor));assert.equal((await listSessions(root)).length,0);
});
test('session edit is identity-bound and cannot request native, managed, layout or script operations',()=>{
 const base={action:'edit',sessionId:crypto.randomUUID(),documentId:crypto.randomUUID(),expectedRevision:1,requestId:crypto.randomUUID()};assert.equal(schemas.session.parse({...base,operations:[{type:'set_text',handles:['A'],text:'NEW'}]}).saveCopy,true);
 for(const op of [{type:'run_command',command:'ERASE ALL'},{type:'move_devices',ids:['A'],delta:[0,0,0]},{type:'create_layout',name:'A',center:[0,0,0],width:100,height:100}])assert.equal(schemas.session.safeParse({...base,operations:[op]}).success,false);
 assert.equal(schemas.session.safeParse({...base,output:'source.dwg',operations:[{type:'erase',handles:['A']}]}).success,false);
});
test('session operations reject switched documents and outside-workspace drawings before dispatch',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-session-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const sessionId=crypto.randomUUID(),documentId=crypto.randomUUID(),file=path.join(root,'outside.dwg'),workspace=path.join(root,'workspace');await fs.mkdir(workspace);await fs.writeFile(file,'original');await fs.writeFile(path.join(root,sessionId+'.json'),JSON.stringify({schemaVersion:1,pid:process.pid,sessionId,pipe:'cadbridge-'+process.pid+'-'+'a'.repeat(32),token:'b'.repeat(64)}));let calls=0;const request=async()=>{calls++;return {ok:true,context:{documentId,name:file,revision:1}};},options={root,request,getSettings:async()=>({workspace})};
 const base={action:'query',sessionId,documentId,expectedRevision:1,filter:{},limit:100};assert.equal((await executeSession({...base,documentId:crypto.randomUUID()},options)).error.code,'SESSION_DOCUMENT_MISMATCH');assert.equal(calls,1);assert.equal((await executeSession(base,options)).error.code,'SESSION_OUTSIDE_WORKSPACE');assert.equal(calls,2);
});
test('named-pipe dispatch validates acknowledgement and decodes split UTF-8 replies',async t=>{
 const descriptor={sessionId:crypto.randomUUID(),pid:process.pid,pipe:'cadbridge-'+process.pid+'-'+crypto.randomUUID().replaceAll('-',''),token:'a'.repeat(64)},requestId=crypto.randomUUID();let dispatches=0;
 const server=net.createServer(socket=>socket.once('data',()=>{
  socket.write(JSON.stringify({eventType:'dispatch',pid:descriptor.pid,requestId,command:'CADBRIDGESESSIONEXEC'})+'\n');
  const bytes=Buffer.from(JSON.stringify({ok:true,text:'中文结果'})+'\n'),position=bytes.indexOf(Buffer.from('中文'))+1;socket.write(bytes.subarray(0,position));setImmediate(()=>socket.end(bytes.subarray(position)));
 }));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen('\\\\.\\pipe\\'+descriptor.pipe,resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const reply=await sessionRequest(descriptor,{action:'edit',requestId},{dispatch:async()=>{dispatches++;}});assert.equal(reply.text,'中文结果');assert.equal(dispatches,1);
});
test('read-only composite schemas preserve takeoff and session reading while rejecting writes and attachment',()=>{
 assert.equal(readonlyWorkflowSchema.safeParse({drawing:'file.dwg',requestId:crypto.randomUUID(),plan:{type:'takeoff'}}).success,true);
 assert.equal(readonlyWorkflowSchema.safeParse({drawing:'file.dwg',requestId:crypto.randomUUID(),plan:{type:'replace_text',search:'A',replacement:'B'}}).success,false);
 assert.equal(readonlySessionSchema.safeParse({action:'list'}).success,true);assert.equal(readonlySessionSchema.safeParse({action:'connect'}).success,false);
});
test('session recovery works offline and detects changed output against the durable bridge receipt',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-session-recover-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const sessionId=crypto.randomUUID(),requestId=crypto.randomUUID(),job=path.join(root,'jobs',sessionId,requestId);await fs.mkdir(job,{recursive:true});const drawing=path.join(job,'output.dwg');await fs.writeFile(drawing,'saved drawing');const nativeFile=path.join(job,'result.json'),native={ok:true,drawingSaved:true,drawing,outcome:'saved'};await fs.writeFile(nativeFile,JSON.stringify(native));const receipt={...native,drawingSha256:await hashFile(drawing),nativeRecordSha256:await hashFile(nativeFile)};await fs.writeFile(path.join(job,'bridge-result.json'),JSON.stringify(receipt));const args={action:'recover',sessionId,requestId};const recovered=await executeSession(args,{root});assert.equal(recovered.recovered,true);assert.equal(recovered.integrityBasis,'verified-against-recorded-output');await fs.appendFile(drawing,' changed');assert.equal((await executeSession(args,{root})).error.code,'SESSION_OUTPUT_CHANGED');
});

test('unexpected native failures without an outcome do not claim a live edit rolled back',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-session-unknown-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const sessionId=crypto.randomUUID(),documentId=crypto.randomUUID(),drawing=path.join(root,'input.dwg');await fs.writeFile(drawing,'source');await fs.writeFile(path.join(root,sessionId+'.json'),JSON.stringify({schemaVersion:1,pid:process.pid,sessionId,pipe:'cadbridge-'+process.pid+'-'+'a'.repeat(32),token:'b'.repeat(64)}));
 const result=await executeSession({action:'edit',sessionId,documentId,expectedRevision:1,requestId:crypto.randomUUID(),operations:[{type:'erase',handles:['A']}]},{root,getSettings:async()=>({workspace:root}),request:async(target,args)=>args.action==='context'?{ok:true,context:{documentId,name:drawing,revision:1}}:{ok:false,error:{code:'SESSION_ERROR',message:'Journal I/O failed'},mutationCommitted:false,safeToRetry:false}});
 assert.equal(result.ok,false);assert.equal(result.mutationCommitted,undefined);assert.equal(result.outcome,'unconfirmed');assert.equal(result.safeToRetry,false);
});
