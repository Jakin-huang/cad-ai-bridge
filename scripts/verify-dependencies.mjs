import fs from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from '../src/config.mjs';
try{
 const lock=JSON.parse(await fs.readFile(path.join(projectRoot,'package-lock.json'),'utf8'));
 for(const [relative,entry]of Object.entries(lock.packages)){
  if(!relative||entry.optional)continue;
  const installed=JSON.parse(await fs.readFile(path.join(projectRoot,relative,'package.json'),'utf8'));
  if(installed.version!==entry.version)throw Error('Dependency version differs: '+relative);
 }
 for(const name of ['zod','@modelcontextprotocol/server','@modelcontextprotocol/client'])await import(name);
 console.error('Locked dependencies are ready; no download needed.');
}catch(error){console.error('Dependencies need preparation: '+error.message);process.exitCode=1;}
