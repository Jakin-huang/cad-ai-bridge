import fs from 'node:fs/promises';
import path from 'node:path';
import {projectRoot as root} from '../src/config.mjs';
export async function dependencyFiles(){
 const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8')),files=new Set();
 for(const [relative,entry]of Object.entries(lock.packages)){
  if(!relative||entry.optional)continue;
  if(!/^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(relative))throw Error('Review nested dependency before packaging: '+relative);
  const pkg=JSON.parse(await fs.readFile(path.join(root,relative,'package.json'),'utf8'));if(pkg.version!==entry.version)throw Error('Dependency differs from lock: '+relative);
  async function walk(dir){for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(item.isSymbolicLink())throw Error('Dependency symlink is not distributable: '+dir);const file=dir+'/'+item.name;if(item.isDirectory())await walk(file);else files.add(file);}}
  await walk(relative);
 }
 return [...files].sort();
}
