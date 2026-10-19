import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {installWorkbuddy,restoreWorkbuddy,workbuddyLocations} from '../../src/client-install.mjs';
const mcp={mcpServers:{'cad-ai-bridge':{command:process.execPath,args:['bridge with spaces.mjs']}}};
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cadbridge-client-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('WorkBuddy install preserves services and generated proxy; repeated install backs up skill and config',async t=>{
 const home=path.join(await temporary(t),'中文 空格'),locations=workbuddyLocations(home);await fs.mkdir(home,{recursive:true});
 const old={clientOption:true,mcpServers:{existing:{command:'original'}}};
 await fs.writeFile(locations.config,JSON.stringify(old));await fs.writeFile(path.join(home,'.mcp.json'),'owned proxy');
 const installed=await installWorkbuddy(mcp,{home});
 const current=JSON.parse(await fs.readFile(locations.config,'utf8'));assert.deepEqual(current.mcpServers.existing,old.mcpServers.existing);assert.equal(current.clientOption,true);
 assert.equal(current.mcpServers['cad-ai-bridge'].timeout,180000);assert.equal(current.mcpServers['cad-ai-bridge'].command,process.execPath);
 assert.deepEqual(JSON.parse(await fs.readFile(installed.config.backup,'utf8')),old);assert.equal(await fs.readFile(path.join(home,'.mcp.json'),'utf8'),'owned proxy');
 assert.ok(await fs.readFile(path.join(locations.skill,'references/school-workflow.md'),'utf8'));
 await fs.writeFile(path.join(locations.skill,'user-note.txt'),'preserve edit');
 const repeated=await installWorkbuddy(mcp,{home});assert.equal(await fs.readFile(path.join(repeated.skillBackup,'user-note.txt'),'utf8'),'preserve edit');
 assert.ok(!repeated.skillBackup.startsWith(path.join(home,'skills')+path.sep));
});
test('broken client JSON leaves existing skill untouched',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);await fs.mkdir(locations.skill,{recursive:true});
 await fs.writeFile(path.join(locations.skill,'SKILL.md'),'existing');await fs.writeFile(locations.config,'invalid');
 await assert.rejects(installWorkbuddy(mcp,{home}),/CLIENT_CONFIG_INVALID/);assert.equal(await fs.readFile(path.join(locations.skill,'SKILL.md'),'utf8'),'existing');
 assert.deepEqual((await fs.readdir(home)).sort(),['mcp.json','skills']);
});
test('dry run has no writes and standalone skill rejects external local references',async t=>{
 const dir=await temporary(t),home=path.join(dir,'missing');await installWorkbuddy(mcp,{home,dryRun:true});
 await assert.rejects(fs.access(home));const source=path.join(dir,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'SKILL.md'),'[broken](../../docs/scope.md)');
 await assert.rejects(installWorkbuddy(mcp,{home,source}),/reference escapes/);await assert.rejects(fs.access(home));
});
test('install refuses a linked skill target without changing its destination',async t=>{
 const dir=await temporary(t),home=path.join(dir,'client'),outside=path.join(dir,'outside'),locations=workbuddyLocations(home);
 await fs.mkdir(outside);await fs.writeFile(path.join(outside,'SKILL.md'),'keep');await fs.mkdir(path.dirname(locations.skill),{recursive:true});
 await fs.symlink(outside,locations.skill,process.platform==='win32'?'junction':'dir');
 await assert.rejects(installWorkbuddy(mcp,{home}),/CLIENT_PATH_INVALID/);assert.equal(await fs.readFile(path.join(outside,'SKILL.md'),'utf8'),'keep');await assert.rejects(fs.access(locations.config));
});
test('upgrade rollback restores old connector and complete Skill, retaining later unrelated services',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);
 const original={theme:'dark',mcpServers:{'cad-ai-bridge':{command:'previous-node'},unrelated:{command:'keep'}}};
 await fs.writeFile(locations.config,JSON.stringify(original));await fs.mkdir(locations.skill,{recursive:true});
 await fs.writeFile(path.join(locations.skill,'SKILL.md'),'previous skill');await fs.writeFile(path.join(locations.skill,'note.txt'),'user note');
 await installWorkbuddy(mcp,{home});
 const current=JSON.parse(await fs.readFile(locations.config,'utf8'));current.mcpServers.later={command:'added later'};await fs.writeFile(locations.config,JSON.stringify(current));
 const restored=await restoreWorkbuddy({home});assert.equal(restored.restored,true);
 const config=JSON.parse(await fs.readFile(locations.config,'utf8'));assert.deepEqual(config.mcpServers['cad-ai-bridge'],original.mcpServers['cad-ai-bridge']);assert.equal(config.mcpServers.later.command,'added later');assert.equal(config.theme,'dark');
 assert.equal(await fs.readFile(path.join(locations.skill,'note.txt'),'utf8'),'user note');assert.equal(await fs.readFile(path.join(locations.skill,'SKILL.md'),'utf8'),'previous skill');
 assert.equal((await restoreWorkbuddy({home})).restored,false);
});
test('fresh installation can be undone without removing other services',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);await fs.writeFile(locations.config,JSON.stringify({mcpServers:{keep:{command:'keep'}}}));
 await installWorkbuddy(mcp,{home});await restoreWorkbuddy({home});
 assert.deepEqual(JSON.parse(await fs.readFile(locations.config,'utf8')).mcpServers,{keep:{command:'keep'}});await assert.rejects(fs.access(locations.skill));
});
test('next install recovers an interrupted upgrade and keeps the true previous version for rollback',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);await fs.mkdir(locations.skill,{recursive:true});await fs.writeFile(path.join(locations.skill,'SKILL.md'),'old');
 const prior={mcpServers:{'cad-ai-bridge':{command:'old'}}};await fs.writeFile(locations.config,JSON.stringify(prior));
 await installWorkbuddy(mcp,{home});const file=path.join(home,'.cadbridge-transaction.json'),journal=JSON.parse(await fs.readFile(file,'utf8'));
 journal.phase='prepared';await fs.writeFile(file,JSON.stringify(journal));await fs.rm(locations.skill,{recursive:true});
 const exited=spawnSync(process.execPath,['-e',''],{windowsHide:true});assert.equal(exited.status,0);assert.ok(exited.pid>0);
 await fs.writeFile(path.join(home,'.cadbridge-install.lock'),JSON.stringify({pid:exited.pid}));
 // Models termination after moving the old Skill and before installing the staged replacement.
 await fs.writeFile(locations.config,JSON.stringify(prior));
 await installWorkbuddy(mcp,{home});await restoreWorkbuddy({home});
 assert.equal(await fs.readFile(path.join(locations.skill,'SKILL.md'),'utf8'),'old');assert.deepEqual(JSON.parse(await fs.readFile(locations.config,'utf8')),prior);
});
test('recovery preserves post-install edits and refuses tampered backups',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);await installWorkbuddy(mcp,{home});
 await fs.writeFile(path.join(locations.skill,'user.txt'),'new edit');await assert.rejects(restoreWorkbuddy({home}),/CLIENT_RECOVERY_CONFLICT/);
 assert.equal(await fs.readFile(path.join(locations.skill,'user.txt'),'utf8'),'new edit');await fs.rm(path.join(locations.skill,'user.txt'));
 const file=path.join(home,'.cadbridge-transaction.json'),journal=JSON.parse(await fs.readFile(file,'utf8'));journal.skillBackup=path.join(home,'outside');await fs.writeFile(file,JSON.stringify(journal));
 await assert.rejects(restoreWorkbuddy({home}),/CLIENT_RECOVERY_INVALID/);assert.ok(JSON.parse(await fs.readFile(locations.config,'utf8')).mcpServers['cad-ai-bridge']);
});
test('linked client configuration is refused and the destination remains unchanged',async t=>{
 const dir=await temporary(t),home=path.join(dir,'client'),outside=path.join(dir,'other.json');await fs.mkdir(home);await fs.writeFile(outside,'{}');
 // A hard link is a file; symlinks require developer mode on Windows, so use a directory junction at this file path.
 const other=path.join(dir,'folder');await fs.mkdir(other);await fs.symlink(other,workbuddyLocations(home).config,process.platform==='win32'?'junction':'dir');
 await assert.rejects(installWorkbuddy(mcp,{home}),/CLIENT_PATH_INVALID/);assert.equal(await fs.readFile(outside,'utf8'),'{}');
});
test('concurrent install is refused before changing client settings',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);await fs.writeFile(locations.config,'{}');
 await fs.writeFile(path.join(home,'.cadbridge-install.lock'),JSON.stringify({pid:process.pid}));
 await assert.rejects(installWorkbuddy(mcp,{home}),/CLIENT_INSTALL_BUSY/);await assert.rejects(restoreWorkbuddy({home}),/CLIENT_INSTALL_BUSY/);
 assert.equal(await fs.readFile(locations.config,'utf8'),'{}');await assert.rejects(fs.access(locations.skill));
});
test('failed transaction-journal write leaves the currently installed version intact',async t=>{
 const home=await temporary(t),locations=workbuddyLocations(home);
 await fs.writeFile(locations.config,JSON.stringify({mcpServers:{'cad-ai-bridge':{command:'original'}}}));
 await installWorkbuddy(mcp,{home});
 const before=await fs.readFile(locations.config),skill=await fs.readFile(path.join(locations.skill,'SKILL.md')),journal=await fs.readFile(path.join(home,'.cadbridge-transaction.json'));
 const writeFile=fs.writeFile;
 const mocked=t.mock.method(fs,'writeFile',async(file,...args)=>{
  if(String(file).includes('.cadbridge-transaction.json.tmp-'))throw Object.assign(Error('simulated disk full'),{code:'ENOSPC'});
  return writeFile(file,...args);
 });
 try{await assert.rejects(installWorkbuddy(mcp,{home}),/simulated disk full/);}finally{mocked.mock.restore();}
 assert.deepEqual(await fs.readFile(locations.config),before);assert.deepEqual(await fs.readFile(path.join(locations.skill,'SKILL.md')),skill);assert.deepEqual(await fs.readFile(path.join(home,'.cadbridge-transaction.json')),journal);
});
