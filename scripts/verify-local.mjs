import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {root} from './public-files.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/verify-local.mjs <staged project manifest.json>');
const manifest=path.resolve(process.argv[2]);const tests=(await fs.readdir(projectPath('tests/unit'))).filter(f=>f.endsWith('.test.mjs')).map(f=>projectPath('tests/unit',f));
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Validation failed: '+args[0]+' ('+code+')')));});}
await run(['--test',...tests]);
if(await fs.access(projectPath('cadbridge-standard.local.json')).then(()=>true,()=>false))await run([projectPath('tests/standard-profile.mjs')]);
for(const args of [[projectPath('tests/project-integration.mjs'),manifest],[projectPath('tests/integration.mjs')],[projectPath('tests/tangent-integration.mjs')],[projectPath('tests/mcp-results.mjs')],[projectPath('tests/school-mcp.mjs')]])await run(args);
if(await fs.access(projectPath('artifacts/school-project-current.txt')).then(()=>true,()=>false))await run([projectPath('tests/school-delivery.mjs')]);
await run([projectPath('scripts/check-release.mjs')]);
console.log(JSON.stringify({ok:true,completedAt:new Date().toISOString(),projectReport:path.join(path.dirname(manifest),'project-validation.json')}));
