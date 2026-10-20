// Register an independently obtained/verified local runtime; never downloads binaries.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hashFile} from '../src/drawings.mjs';
import {radianceRuntimeSchema} from '../src/radiance-runtime.mjs';
const [rootArg,outArg]=process.argv.slice(2);if(!rootArg||!outArg)throw Error('Usage: node scripts/register-radiance-runtime.mjs TRUSTED-RADIANCE-ROOT NEW-PRIVATE-PROFILE.json');
const root=await fs.realpath(rootArg),file=path.resolve(outArg),tools=[];for(const name of ['ies2rad','xform','oconv','rtrace'])tools.push({file:name+'.exe',sha256:await hashFile(path.join(root,'bin',name+'.exe'))});
const supportFiles=[];async function walk(relative){for(const e of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const f=relative+'/'+e.name;if(e.isSymbolicLink())throw Error('RUNTIME_SYMLINK');if(e.isDirectory())await walk(f);else if(e.isFile())supportFiles.push({file:f,sha256:await hashFile(path.join(root,f))});}}await walk('lib');
const r=spawnSync(path.join(root,'bin','rtrace.exe'),['-version'],{shell:false,windowsHide:true,encoding:'utf8',timeout:10000,env:{...process.env,RAYPATH:'.;'+path.join(root,'lib')}});if(r.error||r.status!==0)throw Error('RUNTIME_VERSION_FAILED');const version=(r.stdout||r.stderr).trim(),profile=radianceRuntimeSchema.parse({schemaVersion:1,root,version,tools,supportFiles});await fs.writeFile(file,JSON.stringify(profile,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,version,tools:tools.length,supportFiles:supportFiles.length,sha256:await hashFile(file),scope:'Local runtime identity only; publisher authenticity must be independently verified'}));
