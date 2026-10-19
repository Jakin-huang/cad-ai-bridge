import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
export const projectRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function psExecutable(){return process.env.CADAGENT_POWERSHELL||'pwsh.exe';}
export async function discover(executable=psExecutable()){
 if(process.platform!=='win32')return{platform:process.platform,cads:[],tangent:[]};
 return new Promise((resolve,reject)=>{
  const p=spawn(executable,['-NoProfile','-NonInteractive','-File',path.join(projectRoot,'src/discover.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';
  const timer=setTimeout(()=>p.kill(),15000);p.once('close',()=>clearTimeout(timer));p.once('error',()=>clearTimeout(timer));
  p.stdout.on('data',b=>{output+=b;if(output.length>1024*1024)p.kill();});p.stderr.on('data',b=>error+=b);p.on('error',reject);p.on('close',code=>{if(code)return reject(new Error('CAD_DISCOVERY_FAILED: '+error));try{resolve(JSON.parse(output.replace(/^\uFEFF/,'')));}catch(e){reject(e);}});
 });
}
export function selectInstallation(inventory,preferredRoot){
 const supported=inventory.cads.filter(c=>c.verifiedTarget&&(!preferredRoot||path.resolve(c.root).toLowerCase()===path.resolve(preferredRoot).toLowerCase()));
 if(supported.length!==1)throw new Error(supported.length?'CAD_SELECTION_REQUIRED: multiple AutoCAD 2022 installations; choose --cad-root.':'CAD_NOT_SUPPORTED: AutoCAD 2022 is required by this preview.');
 return supported[0];
}
function readStored(configPath){
 try{const value=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a JSON object');return value;}
 catch(error){if(error.code==='ENOENT'&&!process.env.CADBRIDGE_CONFIG)return{};throw Error('CONFIG_INVALID: '+error.message);}
}
function stamp(file){try{const s=fs.statSync(file);return[file,s.size,s.mtimeMs,s.ctimeMs];}catch{return[file,null];}}
// Process-local, bounded discovery cache. Never caches DWG contents or transaction checks.
export function createConfigLoader({discoverInstallations=discover,now=Date.now,ttlMs=30000}={}){
 let cached;
 return async function({refresh=false}={}){
 const configPath=process.env.CADBRIDGE_CONFIG||path.join(projectRoot,'cadbridge.local.json');
 const stored=readStored(configPath);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify([configPath,stored,process.env.CADAGENT_CAD_ROOT,process.env.CADAGENT_ALLOWED_ROOT,process.env.CADAGENT_POWERSHELL])).digest('hex');
 const watched=()=>JSON.stringify([stamp(path.join(projectRoot,'plugin/bin/CadAgent.dll')),stamp(path.join(projectRoot,'plugin/bin/build.json')),stamp(path.join(projectRoot,'src/discover.ps1')),...(cached?[stamp(path.join(cached.settings.cadRoot,'acad.exe')),stamp(path.join(cached.settings.cadRoot,'accoreconsole.exe')),stamp(cached.settings.powershell),...(cached.settings.tangentRoot?[stamp(path.join(cached.settings.tangentRoot,'sys24x64/tel_kernal.arx'))]:[])]:[])]);
 if(!refresh&&cached&&cached.fingerprint===fingerprint&&now()-cached.at<ttlMs&&cached.watch===watched())return{...cached.settings,discoveryCacheHit:true};
 cached=undefined;
 const inventory=await discoverInstallations(process.env.CADAGENT_POWERSHELL||stored.powershell||psExecutable()),cad=selectInstallation(inventory,process.env.CADAGENT_CAD_ROOT||stored.cadRoot);
 const tangent=inventory.tangent.find(t=>t.r24ModulePresent&&(!stored.tangentRoot||path.resolve(t.root).toLowerCase()===path.resolve(stored.tangentRoot).toLowerCase()));
 const language=stored.language||cad.language;if(!language)throw new Error('CAD_LANGUAGE_REQUIRED: set language in local configuration for this installation.');
 const workspace=path.resolve(process.env.CADAGENT_ALLOWED_ROOT||stored.workspace||projectRoot);
 const settings={...stored,cadRoot:cad.root,productKey:cad.productKey,language,workspace,tangentRoot:stored.tangentRoot||tangent?.root,tangentProfile:stored.tangentProfile||cad.profiles.find(n=>/^TElec20V8$/i.test(n)),powershell:process.env.CADAGENT_POWERSHELL||stored.powershell||inventory.powershell||psExecutable(),configPath};
 cached={settings,fingerprint,at:now()};cached.watch=watched();
 return{...settings,discoveryCacheHit:false};
 };
}
export const loadConfig=createConfigLoader();
