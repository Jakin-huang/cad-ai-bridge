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
 const sceneMcp=await readJSON('artifacts/school-mcp-report.json');assert.equal(sceneMcp.ok,true);assert.equal(sceneMcp.checks.length,7);assert.ok(Date.parse(sceneMcp.checkedAt)>=builtAt);
 for(const result of Object.values(sceneMcp.results)){if(!result?.jobRoot)continue;const host=JSON.parse((await fs.readFile(path.join(result.jobRoot,'host.json'),'utf8')).replace(/^\uFEFF/,''));assert.equal(host.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());assert.equal(host.timedOut,false);}
 pass('Original-scene MCP creation, declared layers, numbering, fresh census and read-only discovery');
 try{
  const schoolFolder=(await fs.readFile(path.join(root,'artifacts/school-project-current.txt'),'utf8')).trim();
  const school=JSON.parse(await fs.readFile(path.join(schoolFolder,'delivery.json'),'utf8')),proof=JSON.parse(await fs.readFile(path.join(schoolFolder,'cad-verification.json'),'utf8')),model=JSON.parse(await fs.readFile(path.join(schoolFolder,'design-model.json'),'utf8')),manifest=JSON.parse(await fs.readFile(path.join(schoolFolder,'manifest.json'),'utf8'));
  assert.equal(school.ok,true);assert.equal(school.nativeReopened,true);assert.equal(school.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());assert.equal(school.pdfChecks.ok,true);assert.equal(proof.ok,true);assert.equal(proof.checks.length,11);assert.equal(model.validation.ok,true);assert.ok(model.validation.checks.length>=19);
  for(const source of school.sourceDigests)assert.equal(digest(await fs.readFile(path.join(root,source.file))),source.sha256);
  if(model.standard){
   const cfg=await readJSON('cadbridge-standard.local.json'),profile=JSON.parse(await fs.readFile(cfg.profile,'utf8')),standardProof=await readJSON('artifacts/standard-profile-report.json');
   assert.equal(digest(await fs.readFile(cfg.profile)),cfg.sha256);assert.equal(standardProof.ok,true);assert.equal(standardProof.checks.length,5);assert.equal(standardProof.profileSha256,cfg.sha256);
   assert.equal(JSON.parse(await fs.readFile(path.join(schoolFolder,'template-provenance.json'),'utf8')).profileSha256,cfg.sha256);
   for(const source of profile.sources){assert.equal(digest(await fs.readFile(source.source)),source.sha256);assert.equal(digest(await fs.readFile(source.dxf)),source.dxfSha256);}
  }
  for(const file of manifest.files)assert.equal(digest(await fs.readFile(path.join(schoolFolder,file.name))),file.sha256);
  for(const result of school.results){const host=JSON.parse((await fs.readFile(path.join(result.jobRoot,'host.json'),'utf8')).replace(/^\uFEFF/,''));assert.equal(host.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());assert.equal(host.timedOut,false);}
  assert.equal(JSON.parse(await fs.readFile(path.join(school.nativeJob,'cleanup.json'),'utf8')).ok,true);
  const faultChecks=await readJSON('artifacts/school-delivery-report.json');assert.equal(faultChecks.ok,true);assert.equal(faultChecks.checks.length,6);assert.equal(faultChecks.drawingSha256,school.drawingSha256);
  pass('Requirements-driven school project: current sources/DLL, independent drawing readback, native reopen, PDF and delivery hashes');
 }catch(error){if(error.code!=='ENOENT')throw error;else if(await fs.access(path.join(root,'artifacts/school-project-current.txt')).then(()=>true,()=>false))throw error;}
 try{
  const projectFolder=(await fs.readFile(path.join(root,'artifacts/real-project-current.txt'),'utf8')).trim();
  const project=JSON.parse(await fs.readFile(path.join(projectFolder,'project-validation.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(projectFolder,'manifest.json'),'utf8'));
  assert.equal(project.ok,true);assert.ok(Date.parse(project.completedAt)>=builtAt);assert.ok(project.checks.length>=18);
  for(const entry of manifest.files){assert.equal(digest(await fs.readFile(entry.source)),entry.sha256);if(entry.copy)assert.equal(digest(await fs.readFile(entry.copy)),entry.sha256);}
  for(const entry of project.files.filter(e=>!e.skipped)){
   assert.equal(entry.comparison.ok,true);
   for(const jobRoot of [entry.inspectionJob,entry.auditJob,entry.repairJob].filter(Boolean)){const host=JSON.parse((await fs.readFile(path.join(jobRoot,'host.json'),'utf8')).replace(/^\uFEFF/,''));assert.equal(host.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());assert.equal(host.timedOut,false);}
  }
  for(const result of Object.values(project.results)){const host=JSON.parse((await fs.readFile(path.join(result.jobRoot,'host.json'),'utf8')).replace(/^\uFEFF/,''));assert.equal(host.pluginSHA256.toLowerCase(),build.sha256.toLowerCase());if(host.backend==='tangent-gui'){assert.equal(JSON.parse(await fs.readFile(path.join(result.jobRoot,'cleanup.json'),'utf8')).ok,true);}}
  pass('Engineering drawings: independent DXF, real symbols, rollback, matching final DLL and unchanged original/source hashes');
 }catch(error){if(error.code!=='ENOENT')throw error;else if(await fs.access(path.join(root,'artifacts/real-project-current.txt')).then(()=>true,()=>false))throw error;}
 await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
 await fs.writeFile(path.join(root,'artifacts/release-check.json'),JSON.stringify({ok:true,version:pkg.version,checkedAt:new Date().toISOString(),checks,sourceFileCount:files.length,pluginSHA256:build.sha256},null,2));
}
console.log(JSON.stringify({ok:true,staticOnly,publicFiles:files.length,checks:checks.length}));
