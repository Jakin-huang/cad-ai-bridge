import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {root} from './public-files.mjs';
if(!process.argv[2])throw Error('Usage: node scripts/verify-local.mjs <staged project manifest.json>');
const manifest=path.resolve(process.argv[2]);const tests=(await fs.readdir(path.join(root,'tests/unit'))).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join(root,'tests/unit',f));
async function run(args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Validation failed: '+args[0]+' ('+code+')')));});}
await run(['--test',...tests]);
if(await fs.access(path.join(root,'cadbridge-standard.local.json')).then(()=>true,()=>false))await run([path.join(root,'tests/standard-profile.mjs')]);
for(const args of [[path.join(root,'tests/project-integration.mjs'),manifest],[path.join(root,'tests/integration.mjs')],[path.join(root,'tests/tangent-integration.mjs')],[path.join(root,'tests/mcp-results.mjs')],[path.join(root,'tests/school-mcp.mjs')]])await run(args);
if(await fs.access(path.join(root,'artifacts/school-project-current.txt')).then(()=>true,()=>false))await run([path.join(root,'tests/school-delivery.mjs')]);
await run([path.join(root,'render-preview.mjs')]);await run([path.join(root,'scripts/check-release.mjs')]);
console.log(JSON.stringify({ok:true,completedAt:new Date().toISOString(),projectReport:path.join(path.dirname(manifest),'project-validation.json')}));
