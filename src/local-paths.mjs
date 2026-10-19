import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const project=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){if(error.code==='ENOENT')return{};throw Error('LOCAL_PATHS_INVALID: '+error.message);}};
const privateSettings=()=>read(path.join(project,'cadbridge-validation.local.json'));
export function outsideProject(value){
 if(!path.isAbsolute(value))throw Error('DATA_HOME_INVALID: use an absolute directory outside the source project');
 const result=path.resolve(value),relative=path.relative(project,result);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('DATA_HOME_INVALID: generated data must stay outside the source project');
 return result;
}
export function dataHome(){
 let config={};try{config=read(process.env.CADBRIDGE_CONFIG||path.join(project,'cadbridge.local.json'));}catch{}
 const base=process.platform==='win32'?(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local')):(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'));
 return outsideProject(process.env.CADBRIDGE_DATA_HOME||config.dataHome||privateSettings().dataHome||path.join(base,'CADBridge','data'));
}
export const localRoot=outsideProject(process.env.CADBRIDGE_TEST_HOME||privateSettings().localRoot||path.join(dataHome(),'validation'));
export const localPath=(...parts)=>path.join(localRoot,...parts);
export function projectPath(...parts){
 const relative=path.join(...parts);
 return path.join(/^(?:artifacts|runs|dist|examples)(?:[\\/]|$)/.test(relative)?localRoot:project,relative);
}
// Old reports remain byte-for-byte intact. Translate only archived data locations on read.
export function resolveLocalPath(value){
 if(typeof value!=='string'||!path.isAbsolute(value))return value;
 for(const mapping of privateSettings().pathMappings||[]){
  const relative=path.relative(mapping.from,value);
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))return path.join(outsideProject(mapping.to),relative);
 }
 return value;
}
export function resolveLocalReferences(value){
 if(typeof value==='string')return resolveLocalPath(value);
 if(Array.isArray(value))return value.map(resolveLocalReferences);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolveLocalReferences(item)]));
 return value;
}
export const parseLocalJSON=text=>resolveLocalReferences(JSON.parse(text));
