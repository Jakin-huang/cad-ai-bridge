import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
export const projectRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function psExecutable(){return process.env.CADAGENT_POWERSHELL||'pwsh.exe';}
export async function discover(){
 if(process.platform!=='win32')return{platform:process.platform,cads:[],tangent:[]};
 return new Promise((resolve,reject)=>{
  const p=spawn(psExecutable(),['-NoProfile','-NonInteractive','-File',path.join(projectRoot,'src/discover.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
  p.stdout.on('data',b=>{output+=b;if(output.length>1024*1024)p.kill();});p.stderr.on('data',b=>error+=b);p.on('error',reject);p.on('close',code=>{if(code)return reject(new Error('CAD_DISCOVERY_FAILED: '+error));try{resolve(JSON.parse(output.replace(/^\uFEFF/,'')));}catch(e){reject(e);}});
 });
}
export function selectInstallation(inventory,preferredRoot){
 const supported=inventory.cads.filter(c=>c.verifiedTarget&&(!preferredRoot||path.resolve(c.root).toLowerCase()===path.resolve(preferredRoot).toLowerCase()));
 if(supported.length!==1)throw new Error(supported.length?'CAD_SELECTION_REQUIRED: multiple AutoCAD 2022 installations; choose --cad-root.':'CAD_NOT_SUPPORTED: AutoCAD 2022 is required by this preview.');
 return supported[0];
}
export async function loadConfig(){
 const configPath=process.env.CADBRIDGE_CONFIG||path.join(projectRoot,'cadbridge.local.json');
 const stored=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')):{};
 const inventory=await discover(),cad=selectInstallation(inventory,process.env.CADAGENT_CAD_ROOT||stored.cadRoot);
 const tangent=inventory.tangent.find(t=>t.r24ModulePresent&&(!stored.tangentRoot||path.resolve(t.root).toLowerCase()===path.resolve(stored.tangentRoot).toLowerCase()));
 const language=stored.language||cad.language;if(!language)throw new Error('CAD_LANGUAGE_REQUIRED: set language in local configuration for this installation.');
 const workspace=path.resolve(process.env.CADAGENT_ALLOWED_ROOT||stored.workspace||projectRoot);
 return{...stored,cadRoot:cad.root,productKey:cad.productKey,language,workspace,tangentRoot:stored.tangentRoot||tangent?.root,tangentProfile:stored.tangentProfile||cad.profiles.find(n=>/^TElec20V8$/i.test(n)),powershell:process.env.CADAGENT_POWERSHELL||stored.powershell||inventory.powershell||psExecutable(),configPath};
}
