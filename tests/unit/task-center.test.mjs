import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startTaskCenter,taskCenterDocument} from '../../src/task-center.mjs';
import crypto from 'node:crypto';
import {hashFile} from '../../src/drawings.mjs';

test('Windows and Unix HTML yield the same browser-normalized inline-script CSP digest',()=>{const unix='<script>\nconst message="ready";\n</script>',windows=unix.replaceAll('\n','\r\n'),a=taskCenterDocument(unix),b=taskCenterDocument(windows);assert.deepEqual(a,b);assert.equal(b.scriptHash,crypto.createHash('sha256').update('\nconst message="ready";\n').digest('base64'));});
test('a displayed deliverable retains byte identity when CAD delivery reorders the former quality file list',async t=>{
 const runs=await fs.mkdtemp(path.join(os.tmpdir(),'cad-file-identity-')),job=path.join(runs,'job-a');await fs.mkdir(job);t.after(()=>fs.rm(runs,{recursive:true,force:true}));
 const csv=path.join(job,'observers.csv'),pdf=path.join(job,'drawing.pdf');await fs.writeFile(csv,'room,ugr\nsynthetic,18\n');await fs.writeFile(pdf,'%PDF procedural identity fixture');const a={file:csv,sha256:await hashFile(csv)},b={file:pdf,sha256:await hashFile(pdf)},result=path.join(job,'result.json');await fs.writeFile(result,JSON.stringify({files:[a]}));const center=await startTaskCenter({runs,execute:async()=>({ok:true})});t.after(()=>center.close());const get=sha=>fetch(center.origin+'/api/file?jobId=job-a&index=0&sha256='+sha,{headers:{Authorization:'Bearer '+center.token}});
 assert.equal(await(await get(a.sha256)).text(),'room,ugr\nsynthetic,18\n');await fs.writeFile(result,JSON.stringify({files:[b,a]}));assert.equal(await(await get(a.sha256)).text(),'room,ugr\nsynthetic,18\n');assert.equal((await get('invalid')).status,400);await fs.writeFile(result,JSON.stringify({files:[b]}));assert.equal((await get(a.sha256)).status,409);
});
test('task center requires local authentication, rejects foreign origins and serves only registered unchanged outputs',async t=>{
 const runs=await fs.mkdtemp(path.join(os.tmpdir(),'cad-center-'));t.after(()=>fs.rm(runs,{recursive:true,force:true}));const job=path.join(runs,'job-a');await fs.mkdir(job);const file=path.join(job,'output.csv');await fs.writeFile(file,'test');await fs.writeFile(path.join(job,'task.json'),JSON.stringify({action:'workflow',status:'completed',updatedAt:'2026-10-20'}));await fs.writeFile(path.join(job,'result.json'),JSON.stringify({ok:true,files:[{kind:'csv',file,sha256:await hashFile(file)}]}));const calls=[];
 const center=await startTaskCenter({runs,execute:async(action,args)=>{calls.push({action,args});return {ok:true};}});t.after(()=>center.close());const auth={Authorization:'Bearer '+center.token};
 const page=await fetch(center.origin);assert.equal(page.status,200);assert.ok(page.headers.get('content-security-policy').includes('sha256-'));assert.ok((await page.text()).includes('任务中心'));
 const html=await fs.readFile(new URL('../../src/task-center.html',import.meta.url),'utf8');assert.doesNotThrow(()=>new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
 assert.equal((await fetch(center.origin+'/api/jobs')).status,401);assert.equal((await fetch(center.origin+'/api/jobs',{headers:{...auth,Origin:'https://untrusted.invalid'}})).status,403);const jobs=await(await fetch(center.origin+'/api/jobs',{headers:auth})).json();assert.equal(jobs.jobs[0].jobId,'job-a');
 const post=body=>fetch(center.origin+'/api/call',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal((await post({action:'apply',args:{}})).status,400);assert.equal((await post({action:'project',args:{action:'list'}})).status,200);assert.equal(calls.length,1);
 const download=()=>fetch(center.origin+'/api/file?jobId=job-a&index=0',{headers:auth});assert.equal(await(await download()).text(),'test');await fs.writeFile(file,'tampered');assert.equal((await download()).status,409);assert.equal((await fetch(center.origin+'/api/file?jobId=../outside&index=0',{headers:auth})).status,400);
 const snapshot=jobs.snapshotId;await fs.mkdir(path.join(runs,'job-new'));await fs.writeFile(path.join(runs,'job-new','task.json'),JSON.stringify({action:'project',status:'running'}));const retained=await(await fetch(center.origin+'/api/jobs?snapshot='+snapshot,{headers:auth})).json();assert.equal(retained.total,1);assert.equal(retained.jobs[0].jobId,'job-a');const fresh=await(await fetch(center.origin+'/api/jobs',{headers:auth})).json();assert.equal(fresh.total,2);assert.equal((await fetch(center.origin+'/api/jobs?snapshot=missing',{headers:auth})).status,409);
 const stopped=await fetch(center.origin+'/api/shutdown',{method:'POST',headers:auth});assert.equal((await stopped.json()).ok,true);
});
