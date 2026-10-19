import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const folder=await fs.realpath(process.argv[2]||'.');
const manifest=JSON.parse(await fs.readFile(path.join(folder,'release-manifest.json'),'utf8'));
const expected=new Set(['release-manifest.json']);
for(const entry of manifest.files){
 assert.ok(!expected.has(entry.file),'Duplicate manifest file');expected.add(entry.file);
 const file=await fs.realpath(path.resolve(folder,entry.file)),relative=path.relative(folder,file);
 assert.ok(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Manifest escapes package');
 const bytes=await fs.readFile(file);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file+' hash');
 if(entry.bytes!==undefined)assert.equal(bytes.length,entry.bytes);
}
async function walk(dir,relative=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){assert.equal(entry.isSymbolicLink(),false);const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),name);else assert.ok(expected.has(name),'Unlisted package file: '+name);}}
await walk(folder);assert.equal(manifest.containsVendorRuntime,false);
if(manifest.entry){
 const launcher=manifest.files.find(entry=>entry.file===manifest.entry);assert.ok(launcher,'Missing user entry');
 assert.equal(launcher.sha256,manifest.userLauncher.sha256);
 const source=manifest.files.find(entry=>entry.file===manifest.userLauncher.source);assert.ok(source,'Missing launcher source');assert.equal(source.sha256,manifest.userLauncher.sourceSHA256);
 assert.ok(manifest.files.some(entry=>entry.file===manifest.guide),'Missing offline guide');
}
if(manifest.containsNodeRuntime){
 assert.equal(manifest.offlineSetup,true);assert.equal(manifest.containsPowerShellRuntime,true);
 assert.ok(manifest.runtimeAssets.node&&manifest.runtimeAssets.powershell,'Both runtime pins are required');
 for(const asset of Object.values(manifest.runtimeAssets)){
  const entry=manifest.files.find(entry=>entry.file==='runtime-archives/'+asset.file);assert.ok(entry,'Missing bundled runtime');assert.equal(entry.sha256,asset.sha256);
 }
}else assert.equal(manifest.containsNodeRuntime,false);
console.log(JSON.stringify({ok:true,version:manifest.version,verifiedFiles:manifest.files.length}));
