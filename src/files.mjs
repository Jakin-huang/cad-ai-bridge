import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const accessTails=new Map();
export async function withFileAccess(file,operation){
 const key=process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file),previous=accessTails.get(key)??Promise.resolve();
 const work=previous.catch(()=>{}).then(operation),tail=work.catch(()=>{});accessTails.set(key,tail);
 try{return await work;}finally{if(accessTails.get(key)===tail)accessTails.delete(key);}
}
export async function readJson(file){return withFileAccess(file,async()=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')));}
// Windows readers can briefly hold the destination without delete sharing.
// Retry the atomic replacement; never unlink/truncate the last valid journal.
export async function atomicReplace(source,target,{rename=fs.rename,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=8}={}){
 for(let i=0;;i++)try{return await rename(source,target);}catch(error){if(i>=attempts-1||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await sleep(Math.min(100,10*2**i));}
}
export async function atomicJson(file,value,{backup=false}={}){
 return withFileAccess(file,async()=>{
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp-'+crypto.randomUUID();let backupPath;
 if(backup){try{backupPath=file+'.bak-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID();await fs.copyFile(file,backupPath,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT')throw e;backupPath=undefined;}}
 try{await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await atomicReplace(temporary,file);}finally{await fs.rm(temporary,{force:true});}
 return{file,backup:backupPath};
 });
}
export function csvCell(value){const s=String(value??'');const guarded=/^[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+guarded.replaceAll('"','""')+'"';}
