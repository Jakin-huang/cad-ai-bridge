import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export async function atomicJson(file,value,{backup=false}={}){
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp-'+crypto.randomUUID();let backupPath;
 if(backup){try{backupPath=file+'.bak-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.copyFile(file,backupPath,fs.constants.COPYFILE_EXCL);}catch(e){if(e.code!=='ENOENT')throw e;backupPath=undefined;}}
 try{await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
 return{file,backup:backupPath};
}
export function csvCell(value){const s=String(value??'');const guarded=/^[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+guarded.replaceAll('"','""')+'"';}
