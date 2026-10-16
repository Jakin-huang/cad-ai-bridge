import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const topFiles=new Set(['.gitattributes','.gitignore','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','CHANGELOG.md','README.md','README.en.md','bridge.mjs','cli.mjs','dependencies.mjs','mcp-server.mjs','build.ps1','run-core.ps1','run-gui.ps1','render-preview.mjs','mcp-config.example.json','setup.cmd','cadbridge.cmd']);
const directories=new Set(['.github','bin','docs','plugin','src','tests','skills','scripts','examples']);
const extensions=new Set(['.mjs','.ps1','.cs','.md','.json','.yml','.yaml','.svg','.cmd']);
export async function publicFiles(){
 const files=[];
 async function walk(relative){for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
  const name=relative?relative+'/'+entry.name:entry.name;
  if(entry.isSymbolicLink())throw Error('Public tree contains a symbolic link: '+name);
  if(entry.isDirectory()){
   if(!relative&&!directories.has(entry.name))continue;
   if(name==='plugin/bin')continue;
   await walk(name);
  }else if(entry.isFile()&&(!relative?topFiles.has(entry.name):extensions.has(path.extname(entry.name))))files.push(name);
  else if(relative)throw Error('Unexpected public file: '+name);
 }}
 await walk('');return files.sort();
}
