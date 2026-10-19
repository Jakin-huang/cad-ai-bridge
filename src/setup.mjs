import fs from 'node:fs/promises';
import path from 'node:path';
import {hashFile} from './drawings.mjs';
import {atomicJson} from './files.mjs';
import {projectRoot} from './config.mjs';

export async function verifyPlugin(root=projectRoot){
 const build=JSON.parse((await fs.readFile(path.join(root,'plugin/bin/build.json'),'utf8')).replace(/^\uFEFF/,''));
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 if(build.version!==pkg.version||build.target!=='AutoCAD 2022 x64, CLR4 / .NET Framework 4.8')throw Error('PLUGIN_INCOMPATIBLE: plugin target/version differs');
 const digest=await hashFile(path.join(root,'plugin/bin/CadAgent.dll'));
 if(digest!==build.sha256.toLowerCase())throw Error('PLUGIN_DIGEST_MISMATCH: reinstall or rebuild plugin');
 const sources=(await fs.readdir(path.join(root,'plugin'))).filter(f=>f.endsWith('.cs')).sort();
 if(JSON.stringify(sources)!==JSON.stringify(build.sourceDigests.map(s=>s.file).sort()))throw Error('PLUGIN_SOURCE_CHANGED: rebuild plugin');
 for(const source of build.sourceDigests)if(!sources.includes(source.file)||await hashFile(path.join(root,'plugin',source.file))!==source.sha256.toLowerCase())throw Error('PLUGIN_SOURCE_CHANGED: rebuild plugin');
 return{ok:true,sha256:digest,target:build.target};
}
export function mcpConfiguration(config,powershell){
 return{mcpServers:{'cad-ai-bridge':{command:process.execPath,args:[path.join(projectRoot,'bin/cadbridge.mjs'),'mcp'],env:{CADBRIDGE_CONFIG:path.resolve(config),CADAGENT_POWERSHELL:powershell}}}};
}
export async function mergeClientConfiguration(file,mcp){
 let previous={};try{previous=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch(error){if(error.code!=='ENOENT')throw Error('CLIENT_CONFIG_INVALID: '+error.message);}
 const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
 if(!object(previous)||(previous.mcpServers!==undefined&&!object(previous.mcpServers)))throw Error('CLIENT_CONFIG_INVALID: expected object with mcpServers');
 return atomicJson(file,{...previous,mcpServers:{...previous.mcpServers,...mcp.mcpServers}},{backup:true});
}
