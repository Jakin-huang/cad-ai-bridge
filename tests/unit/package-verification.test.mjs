import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const verifier=fileURLToPath(new URL('../../scripts/verify-package.mjs',import.meta.url));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t,user){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cb-verify-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const manifest={version:'0.2.0',containsVendorRuntime:false,containsNodeRuntime:user,files:[]};
 await fs.writeFile(path.join(folder,'source.txt'),'source');manifest.files.push({file:'source.txt',bytes:6,sha256:sha('source')});
 if(user){
  await fs.mkdir(path.join(folder,'runtime-archives'));await fs.writeFile(path.join(folder,'runtime-archives/fixture.zip'),'runtime');
  manifest.offlineSetup=true;manifest.containsPowerShellRuntime=true;manifest.runtimeAssets={node:{file:'fixture.zip',sha256:sha('runtime')},powershell:{file:'fixture.zip',sha256:sha('runtime')}};
  manifest.files.push({file:'runtime-archives/fixture.zip',bytes:7,sha256:sha('runtime')});
 }
 const save=()=>fs.writeFile(path.join(folder,'release-manifest.json'),JSON.stringify(manifest));await save();
 return{folder,manifest,save,run:()=>spawnSync(process.execPath,[verifier,folder],{encoding:'utf8',windowsHide:true})};
}
test('standalone verifier accepts developer and offline user packages',async t=>{
 for(const user of [false,true]){const f=await fixture(t,user),r=f.run();assert.equal(r.status,0,r.stderr);}
});
test('standalone verifier rejects altered files and unlisted additions',async t=>{
 const f=await fixture(t,true);await fs.writeFile(path.join(f.folder,'source.txt'),'tampered');assert.notEqual(f.run().status,0);
 await fs.writeFile(path.join(f.folder,'source.txt'),'source');await fs.writeFile(path.join(f.folder,'extra.txt'),'extra');assert.notEqual(f.run().status,0);
});
test('standalone verifier binds portable runtime pins to bundled bytes',async t=>{
 const f=await fixture(t,true);f.manifest.runtimeAssets.node.sha256='0'.repeat(64);await f.save();assert.notEqual(f.run().status,0);
});
test('standalone verifier rejects a manifest outside the package root',async t=>{
 const f=await fixture(t,false),outside=f.folder+'-outside.txt';await fs.writeFile(outside,'source');t.after(()=>fs.rm(outside,{force:true}));
 f.manifest.files[0].file='../'+path.basename(outside);await f.save();const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Manifest escapes package/);
});
test('standalone verifier binds the user entry to its source and requires the offline guide',async t=>{
 const f=await fixture(t,true);f.manifest.entry='start.exe';f.manifest.userLauncher={sha256:'0'.repeat(64),source:'source.txt',sourceSHA256:sha('source')};f.manifest.guide='guide.html';await f.save();assert.notEqual(f.run().status,0);
 await fs.writeFile(path.join(f.folder,'start.exe'),'own launcher');f.manifest.files.push({file:'start.exe',sha256:sha('own launcher')});f.manifest.userLauncher.sha256=sha('own launcher');await f.save();assert.notEqual(f.run().status,0);
 await fs.writeFile(path.join(f.folder,'guide.html'),'offline guide');f.manifest.files.push({file:'guide.html',sha256:sha('offline guide')});await f.save();assert.equal(f.run().status,0);
 f.manifest.userLauncher.sourceSHA256='0'.repeat(64);await f.save();assert.notEqual(f.run().status,0);
});
