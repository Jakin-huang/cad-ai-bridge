import {projectPath,parseLocalJSON,resolveLocalPath} from '../src/local-paths.mjs';
import fs from 'node:fs';
import {localPath} from '../src/local-paths.mjs';
export function schoolRequirements(){
 const file=process.env.CADBRIDGE_SCHOOL_REQUIREMENTS||localPath('examples','school-requirements.json');
 try{return parseLocalJSON(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
 catch(error){if(error.code==='ENOENT')return undefined;throw error;}
}
