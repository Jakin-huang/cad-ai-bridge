import fs from 'node:fs/promises';
import {execute} from './bridge.mjs';
try{
 const [action,requestFile]=process.argv.slice(2);
 const args=requestFile?JSON.parse((await fs.readFile(requestFile,'utf8')).replace(/^\uFEFF/,'')):{};
 const result=await execute(action,args);process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(!result.ok)process.exitCode=1;
}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}
