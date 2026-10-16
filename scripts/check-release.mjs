import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,publicFiles} from './public-files.mjs';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON=async file=>JSON.parse((await fs.readFile(path.join(root,file),'utf8')).replace(/^\uFEFF/,''));
const staticOnly=process.argv.includes('--static');
const files=await publicFiles();
const checks=[];const pass=name=>{checks.push(name);console.log('PASS '+name);};
for(const file of files){
 const content=await fs.readFile(path.join(root,file),'utf8');
 assert.ok(!/C:[\\/]Users[\\/](?!PUBLIC\b|<)/i.test(content),'Personal user path in '+file);
 assert.ok(!['\\','/'].some(separator=>content.includes(['技术资料','cad自动化'].join(separator))),'Private workspace in '+file);
 assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content),'Private key in '+file);
 if(file.endsWith('.json'))JSON.parse(content.replace(/^\uFEFF/,''));
 if(file.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,file+' syntax: '+(result.stderr||result.error));}
 if(file.endsWith('.md')){
  for(const match of content.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)){
   const link=match[1];if(/^(?:https?:|app:|#)/.test(link))continue;
   assert.ok(!path.isAbsolute(link),'Absolute documentation link in '+file);
   const target=path.resolve(root,path.dirname(file),decodeURIComponent(link.split('#')[0]));
   assert.ok(target.startsWith(root+path.sep),'Documentation escapes public tree: '+file);
   await fs.access(target);
  }
 }
}
pass('Public source allowlist, syntax, JSON, local links and private-path checks');
const pkg=await readJSON('package.json'),lock=await readJSON('package-lock.json');
assert.equal(pkg.name,lock.name);assert.equal(pkg.version,lock.version);assert.equal(lock.packages[''].version,pkg.version);
assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);
for(const version of Object.values(pkg.dependencies))assert.match(version,/^\d+\.\d+\.\d+$/);
assert.ok(!(await fs.readFile(path.join(root,'dependencies.mjs'),'utf8')).includes('.tools'));
pass('Pinned independent dependencies and synchronized lockfile');
const ignored=await fs.readFile(path.join(root,'.gitignore'),'utf8');
for(const item of ['runs/','artifacts/','node_modules/','plugin/bin/','cadbridge.local.json*','mcp-config.local.json*','dist/'])assert.ok(ignored.split(/\r?\n/).includes(item),item+' must be ignored');
pass('Generated, proprietary and local configuration excluded from source distribution');
if(!staticOnly){
 const build=await readJSON('plugin/bin/build.json');
 assert.equal(build.version,pkg.version);const dll=await fs.readFile(path.join(root,'plugin/bin/CadAgent.dll'));
 assert.equal(digest(dll),build.sha256.toLowerCase());
 const sources=(await fs.readdir(path.join(root,'plugin'))).filter(f=>f.endsWith('.cs')).sort();
 assert.deepEqual(build.sourceDigests.map(s=>s.file).sort(),sources);
 for(const source of build.sourceDigests)assert.equal(digest(await fs.readFile(path.join(root,'plugin',source.file))),source.sha256.toLowerCase());
 const builtAt=(await fs.stat(path.join(root,'plugin/bin/CadAgent.dll'))).mtimeMs;
 for(const [file,count]of [['integration-report.json',16],['tangent-integration-report.json',11]]){
  const report=await readJSON('artifacts/'+file);assert.equal(report.ok,true);assert.equal(report.checks.length,count);assert.ok(Date.parse(report.checkedAt)>=builtAt,'Re-run '+file+' for current DLL');
  let executed=0;
  for(const result of Object.values(report.results)){
   if(!result.jobRoot)continue;
   let host;try{host=JSON.parse((await fs.readFile(path.join(result.jobRoot,'host.json'),'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT'&&!result.ok)continue;throw error;}
   assert.equal(host.pluginSHA256.toLowerCase(),build.sha256.toLowerCase(),'Report must exercise packaged DLL');assert.equal(host.timedOut,false);executed++;
   if(host.backend==='tangent-gui'){const cleanup=JSON.parse(await fs.readFile(path.join(result.jobRoot,'cleanup.json'),'utf8'));assert.equal(cleanup.ok,true);assert.equal(cleanup.originalTipRestored,true);}
  }
  assert.ok(executed>0);pass(file+': '+count+' real CAD checks with matching final DLL and successful cleanup');
 }
 const pages=await readJSON('artifacts/mcp-results-report.json');assert.equal(pages.ok,true);assert.equal(pages.checks.length,4);assert.ok(Date.parse(pages.checkedAt)>=builtAt);pass('Actual MCP summary, pagination and read-only evidence');
 await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
 await fs.writeFile(path.join(root,'artifacts/release-check.json'),JSON.stringify({ok:true,version:pkg.version,checkedAt:new Date().toISOString(),checks,sourceFileCount:files.length,pluginSHA256:build.sha256},null,2));
}
console.log(JSON.stringify({ok:true,staticOnly,publicFiles:files.length,checks:checks.length}));
