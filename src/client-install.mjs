import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {projectRoot} from './config.mjs';
import {mergeClientConfiguration} from './setup.mjs';
import {atomicJson} from './files.mjs';

// WorkBuddy owns .mcp.json (the generated connector proxy). Custom servers use mcp.json.
export function workbuddyLocations(home=path.join(os.homedir(),'.workbuddy')){
 home=path.resolve(home);
 return{home,config:path.join(home,'mcp.json'),skill:path.join(home,'skills','cadbridge-electrical')};
}
export function workbuddyConfiguration(mcp){
 return{mcpServers:Object.fromEntries(Object.entries(mcp.mcpServers).map(([name,server])=>[name,{...server,type:'stdio',timeout:180000}]))};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function skillDigest(directory){
 const values=[];
 async function walk(relative=''){
  for(const entry of (await fs.readdir(path.join(directory,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=path.join(relative,entry.name);
   if(entry.isSymbolicLink())throw Error('CLIENT_PATH_INVALID: linked skill file');
   if(entry.isDirectory())await walk(file);
   else values.push([file,crypto.createHash('sha256').update(await fs.readFile(path.join(directory,file))).digest('hex')]);
  }
 }
 try{await walk();return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function readClient(file){
 try{const value=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value)||(value.mcpServers!==undefined&&!object(value.mcpServers)))throw Error('expected object with mcpServers');
  return value;
 }catch(error){if(error.code==='ENOENT')return {};throw Error('CLIENT_CONFIG_INVALID: '+error.message);}
}
async function assertClientPaths(locations){
 for(const directory of [locations.home,path.dirname(locations.skill),locations.skill,path.join(locations.home,'backups')]){
  try{const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('CLIENT_PATH_INVALID: expected a real directory: '+directory);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 for(const file of [locations.config,path.join(locations.home,'.cadbridge-transaction.json'),path.join(locations.home,'.cadbridge-install.lock')]){
  try{if(!(await fs.lstat(file)).isFile())throw Error('CLIENT_PATH_INVALID: expected real file: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
async function withClientLock(home,operation){
 const locations=workbuddyLocations(home);await assertClientPaths(locations);await fs.mkdir(locations.home,{recursive:true});
 const file=path.join(locations.home,'.cadbridge-install.lock');let lock;
 for(let attempt=0;attempt<2;attempt++){
  try{lock=await fs.open(file,'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));break;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   let owner;try{owner=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Error('CLIENT_INSTALL_BUSY: incomplete lock; retry after the other installer exits');}
   if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw Error('CLIENT_INSTALL_BUSY: invalid lock owner');
   try{process.kill(owner.pid,0);throw Error('CLIENT_INSTALL_BUSY: another install or recovery is running');}
   catch(probe){if(probe.code!=='ESRCH')throw probe;}
   await fs.rm(file,{force:true});
  }
 }
 if(!lock)throw Error('CLIENT_INSTALL_BUSY: installation lock could not be acquired');
 try{return await operation();}finally{await lock.close();await fs.rm(file,{force:true});}
}
export async function restoreWorkbuddy(options={}){
 return withClientLock(options.home,()=>restoreWorkbuddyUnlocked(options));
}
async function restoreWorkbuddyUnlocked({home,pendingOnly=false}={}){
 const locations=workbuddyLocations(home),journalFile=path.join(locations.home,'.cadbridge-transaction.json');
 await assertClientPaths(locations);
 let journal;try{journal=JSON.parse(await fs.readFile(journalFile,'utf8'));}catch(error){if(error.code==='ENOENT')return{ok:true,restored:false,reason:'No previous installation'};throw error;}
 if(journal.schemaVersion!==1||!['prepared','installed','restored'].includes(journal.phase))throw Error('CLIENT_RECOVERY_INVALID: invalid transaction journal');
 if(journal.phase==='restored'||(pendingOnly&&journal.phase!=='prepared'))return{ok:true,restored:false};
 const backup=journal.skillBackup;
 if(backup&&(!path.resolve(backup).startsWith(path.join(locations.home,'backups')+path.sep)||path.dirname(path.resolve(backup))!==path.join(locations.home,'backups')))throw Error('CLIENT_RECOVERY_INVALID: backup outside client backup directory');
 if(backup){try{if(!(await fs.lstat(backup)).isDirectory()||(await fs.lstat(backup)).isSymbolicLink())throw Error('CLIENT_RECOVERY_INVALID: invalid backup');}catch(error){if(error.code!=='ENOENT')throw error;}}
 const current=await readClient(locations.config),server=current.mcpServers?.['cad-ai-bridge'];
 const before=journal.beforeHadServer?journal.beforeServer:undefined;
 if(!same(server,journal.afterServer)&&!same(server,before))throw Error('CLIENT_RECOVERY_CONFLICT: cad-ai-bridge settings changed after installation; preserve them and resolve manually');
 const digest=await skillDigest(locations.skill);
 if(digest!==null&&digest!==journal.beforeSkillDigest&&digest!==journal.afterSkillDigest)throw Error('CLIENT_RECOVERY_CONFLICT: installed Skill was edited; its files were preserved');
 const backupExists=backup&&await fs.access(backup).then(()=>true,()=>false);
 if(backupExists&&await skillDigest(backup)!==journal.beforeSkillDigest)throw Error('CLIENT_RECOVERY_CONFLICT: Skill backup differs from the recorded original');
 if(journal.beforeSkillDigest&&!backupExists&&digest!==journal.beforeSkillDigest)throw Error('CLIENT_RECOVERY_INVALID: original Skill backup missing');
 // Restore only our server. Other services added since the upgrade are retained.
 const servers={...current.mcpServers};if(journal.beforeHadServer)servers['cad-ai-bridge']=journal.beforeServer;else delete servers['cad-ai-bridge'];
 await atomicJson(locations.config,{...current,mcpServers:servers},{backup:true});
 if(backupExists){
  // Keep the original backup for retries, including interruption during recovery.
  const stage=await fs.mkdtemp(path.join(locations.home,'.cadbridge-restore-'));
  try{await fs.cp(backup,stage,{recursive:true});await fs.rm(locations.skill,{recursive:true,force:true});await fs.rename(stage,locations.skill);}finally{await fs.rm(stage,{recursive:true,force:true});}
 }else if(!journal.beforeSkillDigest){await fs.rm(locations.skill,{recursive:true,force:true});}
 await atomicJson(journalFile,{...journal,phase:'restored',restoredAt:new Date().toISOString()});
 return{ok:true,restored:true,client:locations.home,next:'已恢复上一次连接器和 Skill；重新连接 WorkBuddy。其他服务和图纸未变。'};
}
export async function installWorkbuddy(mcp,options={}){
 if(options.dryRun)return installWorkbuddyUnlocked(mcp,options);
 // Preflight the complete Skill and existing configuration before creating directories.
 await installWorkbuddyUnlocked(mcp,{...options,dryRun:true});
 return withClientLock(options.home,()=>installWorkbuddyUnlocked(mcp,options));
}
async function installWorkbuddyUnlocked(mcp,{home,source=path.join(projectRoot,'skills','cadbridge-electrical'),dryRun=false}={}){
 const locations=workbuddyLocations(home);
 const workbuddyMcp=workbuddyConfiguration(mcp);
 const files=[];
 async function collect(relative=''){
  for(const entry of await fs.readdir(path.join(source,relative),{withFileTypes:true})){
   const name=path.join(relative,entry.name);
   if(entry.isSymbolicLink())throw Error('SKILL_INVALID: symbolic links are not supported');
   if(entry.isDirectory())await collect(name);
   else if(entry.isFile())files.push(name);
  }
 }
 await collect();
 if(!files.includes('SKILL.md'))throw Error('SKILL_INVALID: missing SKILL.md');
 for(const file of files.filter(f=>f.endsWith('.md'))){
  const text=await fs.readFile(path.join(source,file),'utf8');
  for(const match of text.matchAll(/\]\(([^)\s]+)\)/g)){
   const link=match[1];if(/^(?:https?:|#)/.test(link))continue;
   const target=path.resolve(source,path.dirname(file),decodeURIComponent(link.split('#')[0]));
   if(!target.startsWith(path.resolve(source)+path.sep))throw Error('SKILL_INVALID: reference escapes installed skill');
   await fs.access(target);
  }
 }
 await assertClientPaths(locations);
 // Preflight JSON before installing the skill. A malformed existing config is never replaced.
 await readClient(locations.config);
 if(dryRun)return{dryRun:true,...locations,files};
 await restoreWorkbuddyUnlocked({home:locations.home,pendingOnly:true});
 const previous=await readClient(locations.config);
 await fs.mkdir(path.dirname(locations.skill),{recursive:true});
 const stage=await fs.mkdtemp(path.join(locations.home,'.cadbridge-skill-'));
 let backup,journal,journalPersisted=false;
 const journalFile=path.join(locations.home,'.cadbridge-transaction.json');
 try{
  for(const file of files){const target=path.join(stage,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(source,file),target);}
  const beforeSkillDigest=await skillDigest(locations.skill);
  backup=beforeSkillDigest?path.join(locations.home,'backups','cadbridge-electrical-'+Date.now()+'-'+crypto.randomUUID()):undefined;
  if(backup)await fs.mkdir(path.dirname(backup),{recursive:true});
  journal={schemaVersion:1,phase:'prepared',createdAt:new Date().toISOString(),beforeHadServer:Object.hasOwn(previous.mcpServers||{},'cad-ai-bridge'),beforeServer:previous.mcpServers?.['cad-ai-bridge']??null,afterServer:workbuddyMcp.mcpServers['cad-ai-bridge'],beforeSkillDigest,afterSkillDigest:await skillDigest(stage),skillBackup:backup};
  await atomicJson(journalFile,journal);
  journalPersisted=true;
  try{
   await fs.lstat(locations.skill);
   await fs.rename(locations.skill,backup);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rename(stage,locations.skill);
  const config=await mergeClientConfiguration(locations.config,workbuddyMcp);
  await atomicJson(journalFile,{...journal,phase:'installed'});
  return{ok:true,installationOnly:true,...locations,config,skillBackup:backup,files:files.length,next:'配置与 Skill 已安装。进入 WorkBuddy“专家·技能·连接器 → 连接器”，打开右上角“自定义连接器”查看 cad-ai-bridge。若显示首次信任提示，核对启动路径后点击该行蓝色“信任”，等待已连接和工具加载。“启用”计数不代表已连接；新建任务时通过“+ → 连接器”确认选用，再让 AI 调用 cad_doctor。'};
 }catch(error){
  if(journalPersisted)try{await restoreWorkbuddyUnlocked({home:locations.home});}catch(recovery){throw Error('CLIENT_RECOVERY_REQUIRED: '+error.message+'; '+recovery.message+'; run restore-workbuddy.cmd after resolving the conflict');}
  throw error;
 }finally{await fs.rm(stage,{recursive:true,force:true});}
}
