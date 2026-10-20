import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {atomicJson,atomicReplace,readJson} from '../../src/files.mjs';
test('transient Windows sharing failures retry without removing the previous journal',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-journal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const old=path.join(root,'task.json'),next=path.join(root,'next.json');await fs.writeFile(old,'old valid record');await fs.writeFile(next,'new valid record');let calls=0;
 await atomicReplace(next,old,{sleep:async()=>{},rename:async(a,b)=>{calls++;if(calls<3){assert.equal(await fs.readFile(old,'utf8'),'old valid record');throw Object.assign(Error('sharing violation'),{code:'EPERM'});}await fs.rename(a,b);}});assert.equal(calls,3);assert.equal(await fs.readFile(old,'utf8'),'new valid record');
});
test('permanent journal denial is bounded and preserves original; concurrent readers only see complete JSON',async t=>{
 let calls=0;await assert.rejects(atomicReplace('new','old',{attempts:3,sleep:async()=>{},rename:async()=>{calls++;throw Object.assign(Error('denied'),{code:'EACCES'});}}),/denied/);assert.equal(calls,3);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-journal-readers-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'task.json');await atomicJson(file,{revision:0,payload:'x'.repeat(3000)});let done=false,count=0;const reader=(async()=>{while(!done){const record=await readJson(file);assert.equal(record.payload.length,3000);count++;}})();try{for(let i=1;i<=30;i++)await atomicJson(file,{revision:i,payload:'x'.repeat(3000)});}finally{done=true;await reader;}assert.ok(count>0);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).revision,30);
});
