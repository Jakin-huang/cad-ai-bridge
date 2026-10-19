import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
// Explicit network acceptance against an already isolated package test directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {projectRoot as root} from '../src/config.mjs';
const report=parseLocalJSON(await fs.readFile(projectPath('artifacts/windows-user-package-report.json'),'utf8'));
assert.equal(report.ok,true);assert.ok(path.resolve(report.base).startsWith(projectPath('artifacts')+path.sep));
const entries=await fs.readdir(path.join(report.base,'新版本')),folder=path.join(report.base,'新版本',entries[0]),home=path.join(report.base,'隔离 WorkBuddy');
const modules=path.join(folder,'node_modules'),held=path.join(report.base,'original-dependencies');
// Only the disposable extracted acceptance package is changed, never the source installation.
assert.ok(modules.startsWith(path.resolve(report.base)+path.sep));await fs.rename(modules,held);
const before=await fs.readFile(path.join(home,'mcp.json')),checks=[];
const env={...process.env,PATH:[path.join(process.env.WINDIR,'System32'),process.env.WINDIR,path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0')].join(';'),CADBRIDGE_RUNTIME_ISOLATED:'1',CADBRIDGE_RUNTIME_HOME:report.isolatedRuntimes,npm_config_cache:path.join(report.base,'npm-cache'),npm_config_fetch_retries:'0',npm_config_fetch_timeout:'15000',npm_config_registry:'https://registry.npmjs.org'};
for(const key of ['CADBRIDGE_CONFIG','CADBRIDGE_RUNTIME_CACHE','CADAGENT_POWERSHELL','CADAGENT_ALLOWED_ROOT','CADAGENT_CAD_ROOT'])delete env[key];
function setup(extra={}){
 return spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+path.join(folder,'connect-workbuddy.cmd')+'" --client-home "'+home+'""'],{windowsVerbatimArguments:true,encoding:'utf8',windowsHide:true,env:{...env,...extra},maxBuffer:10*1024*1024,timeout:180000});
}
try{
 let result=setup({CADBRIDGE_OFFLINE:'1'});await fs.writeFile(path.join(report.base,'dependency-offline.txt'),result.stdout+'\n'+result.stderr);
 assert.notEqual(result.status,0);assert.match(result.stderr,/DEPENDENCIES_OFFLINE_MISSING/);assert.deepEqual(await fs.readFile(path.join(home,'mcp.json')),before);checks.push('Missing dependencies offline fail before changing client configuration');
 result=setup({CADBRIDGE_OFFLINE:'0',npm_config_registry:'http://127.0.0.1:9',npm_config_fetch_timeout:'1000'});await fs.writeFile(path.join(report.base,'dependency-network-failure.txt'),result.stdout+'\n'+result.stderr);
 assert.notEqual(result.status,0);assert.match(result.stderr,/DEPENDENCIES_FAILED/);assert.deepEqual(await fs.readFile(path.join(home,'mcp.json')),before);checks.push('Unavailable npm registry fails with preserved client configuration');
 result=setup({CADBRIDGE_OFFLINE:'0'});await fs.writeFile(path.join(report.base,'dependency-repair.txt'),result.stdout+'\n'+result.stderr);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
 const verify=spawnSync(path.join(report.isolatedRuntimes,'node-22.23.3','node.exe'),[path.join(folder,'scripts/verify-dependencies.mjs')],{encoding:'utf8',windowsHide:true});assert.equal(verify.status,0,verify.stderr);checks.push('Official npm registry repairs all missing locked dependencies with bundled npm and no admin');
 result=setup({CADBRIDGE_OFFLINE:'1'});assert.equal(result.status,0,result.stderr);checks.push('Repaired package installs again offline without dependency downloads');
 const output={ok:true,checkedAt:new Date().toISOString(),packageSha256:report.packageSha256,scope:report.scope,checks,base:report.base};await fs.writeFile(projectPath('artifacts/windows-dependency-repair-report.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}catch(error){
 // Preserve failed dependencies for diagnosis; restore the known-good tree for further work.
 if(await fs.access(modules).then(()=>true,()=>false))await fs.rename(modules,path.join(report.base,'failed-dependencies-'+Date.now()));
 await fs.rename(held,modules);throw error;
}
