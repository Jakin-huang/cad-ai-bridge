#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {discover,selectInstallation,loadConfig,projectRoot,psExecutable} from '../src/config.mjs';
import {atomicJson,csvCell} from '../src/files.mjs';
import {verifyPlugin,mcpConfiguration,mergeClientConfiguration} from '../src/setup.mjs';
import {diagnose} from '../src/diagnostics.mjs';
import {dataHome,outsideProject} from '../src/local-paths.mjs';
import {installWorkbuddy,restoreWorkbuddy,workbuddyConfiguration,workbuddyLocations} from '../src/client-install.mjs';
const [command='help',...argv]=process.argv.slice(2);
const values=new Set(['workspace','cad-root','language','host','units','format','config','detail','client-config','client','client-home','standards-register']);
const flags=new Set(['dry-run','skip-build','rebuild','read-only','native','json','model-only','without-standard']);
const options={},positional=[];
for(let i=0;i<argv.length;i++){const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}const key=token.slice(2);if(values.has(key)){if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing --'+key+' value');options[key]=argv[++i];}else if(flags.has(key))options[key]=true;else throw Error('Unknown option --'+key);}
if(options.config)process.env.CADBRIDGE_CONFIG=path.resolve(options.config);
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function child(exe,args){await new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd:projectRoot,windowsHide:true,stdio:['inherit',process.stderr,process.stderr]});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Command failed ('+code+'): '+path.basename(exe))));});}
async function setup(){
 if(options.client&&options.client!=='workbuddy')throw Error('Unknown client: '+options.client);
 if(options.client&&options['client-config'])throw Error('Use --client or --client-config, not both');
 if(options['client-home']&&!options.client)throw Error('--client-home requires --client workbuddy');
 const config=process.env.CADBRIDGE_CONFIG||path.join(projectRoot,'cadbridge.local.json');
 let previous={};
 if(options.client){
  try{previous=JSON.parse((await fs.readFile(config,'utf8')).replace(/^\uFEFF/,''));if(!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('expected configuration object');}
  catch(error){
   if(error.code!=='ENOENT')throw Error('CONFIG_INVALID: '+error.message);
   // A side-by-side upgrade inherits the workspace from the installed bridge.
   try{
    const client=JSON.parse((await fs.readFile(workbuddyLocations(options['client-home']).config,'utf8')).replace(/^\uFEFF/,''));
    const former=client.mcpServers?.['cad-ai-bridge']?.env?.CADBRIDGE_CONFIG;
    if(former&&path.resolve(former)!==path.resolve(config))previous=JSON.parse((await fs.readFile(former,'utf8')).replace(/^\uFEFF/,''));
    if(!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('expected configuration object');
   }catch(prior){if(prior.code!=='ENOENT')throw Error('CONFIG_INVALID: cannot read existing installation; '+prior.message);}
  }
 }
 const inventory=await discover(),cad=selectInstallation(inventory,options['cad-root']||previous.cadRoot);
 const settings={schemaVersion:1,workspace:path.resolve(options.workspace||previous.workspace||process.cwd()),dataHome:outsideProject(process.env.CADBRIDGE_DATA_HOME||previous.dataHome||dataHome()),cadRoot:cad.root,productKey:cad.productKey,language:options.language||previous.language||cad.language,
  tangentRoot:inventory.tangent.find(t=>t.r24ModulePresent)?.root,tangentProfile:cad.profiles.find(p=>/^TElec20V8$/i.test(p)),powershell:inventory.powershell||psExecutable()};
 if(!settings.language)throw Error('Select --language for this CAD installation');
 try{if(!(await fs.stat(settings.workspace)).isDirectory())throw Error('WORKSPACE_INVALID: choose a directory');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(options['client-config']&&[config,path.join(projectRoot,'mcp-config.local.json')].some(file=>path.resolve(file).toLowerCase()===path.resolve(options['client-config']).toLowerCase()))throw Error('CLIENT_CONFIG_INVALID: client configuration must be separate from bridge configuration');
 const mcp=mcpConfiguration(config,settings.powershell,settings.dataHome);
 let reuse=false;try{await verifyPlugin();reuse=!options.rebuild;}catch{}
 if(options['skip-build']&&!reuse)throw Error('PLUGIN_UNVERIFIED: --skip-build requires a matching verified plugin');
 const client=options.client?await installWorkbuddy(mcp,{home:options['client-home'],dryRun:true}):undefined;
 if(options['dry-run'])return output({dryRun:true,settings,files:[config,path.join(projectRoot,'mcp-config.local.json'),...(options.client?[path.join(projectRoot,'mcp-config.workbuddy.local.json')]:[])],buildPlugin:!reuse,mcp,client});
 await fs.mkdir(settings.workspace,{recursive:true});
 if(!reuse)await child(settings.powershell,['-NoProfile','-NonInteractive','-File',path.join(projectRoot,'build.ps1'),'-CadRoot',cad.root]);
 await verifyPlugin();
 const written=await atomicJson(config,settings,{backup:true});const clientConfig=await atomicJson(path.join(projectRoot,'mcp-config.local.json'),mcp,{backup:true});
 const merged=options['client-config']?await mergeClientConfiguration(path.resolve(options['client-config']),mcp):undefined;
 const installed=options.client?await installWorkbuddy(mcp,{home:options['client-home']}):undefined;
 const workbuddyImport=options.client?await atomicJson(path.join(projectRoot,'mcp-config.workbuddy.local.json'),workbuddyConfiguration(mcp),{backup:true}):undefined;
 output({ok:true,settings,written,clientConfig,merged,client:installed,workbuddyImport,pluginReused:reuse,next:installed?.next||(merged?'Restart or reconnect your MCP client.':'Import mcp-config.local.json into your MCP client. Existing client settings were not modified.')});
}
async function doctor(){
 const result=await diagnose({refresh:true});
 if(options.native){if(!positional[0])throw Error('doctor --native requires a DWG path inside configured workspace');const {execute}=await import('../bridge.mjs');result.native=await execute('native_status',{drawing:path.resolve(positional[0])});const ok=Boolean(result.native.ok&&result.native.nativeHost?.nativeKernelLoaded);result.checks.push({name:'nativeRuntime',ok,detail:result.native.jobRoot});result.ok=result.ok&&ok;}
 output(result);if(!result.ok)process.exitCode=1;
}
async function demo(){
 const {execute}=await import('../bridge.mjs');const fixture=await execute('create_test_drawing',{adapter:'tangent-v8'});if(!fixture.ok)throw Error(JSON.stringify(fixture.error));
 const request={drawing:fixture.drawing,expectedSha256:fixture.drawingSha256,documentId:fixture.snapshot.documentId,expectedRevision:0,requestId:crypto.randomUUID(),units:'mm',host:options.host||'core',adapter:'tangent-v8',operations:[
  {type:'place_symbols',blockName:'EA_LIGHT',instances:[{id:'L1',position:[0,0,0]},{id:'L2',position:[3000,0,0]},{id:'L3',position:[6000,0,0]}]},
  {type:'connect_route',id:'WL1-route',circuitId:'WL1',from:{id:'L1',port:'PWR'},to:{id:'L3',port:'PWR'},vertices:[[0,0,0],[3000,0,0],[6000,0,0]],wireSpec:{wireType:'BV',conductorSpec:'2x2.5'}},
  {type:'number_devices',ids:['L1','L2','L3'],prefix:'L-',start:1,width:3}
 ]};
 const applied=await execute('apply',request);if(!applied.ok)throw Error(JSON.stringify(applied.error));
 const takeoff=await execute('tangent_takeoff',{drawing:applied.drawing});const validation=await execute('validate',{drawing:applied.drawing});
 output({ok:takeoff.ok&&validation.ok&&validation.snapshot.issues.length===0,drawing:applied.drawing,dxf:applied.dxf,statistics:takeoff.tangent.statistics,issues:validation.snapshot.issues,job:applied.jobRoot});
}
try{
 if(command==='setup')await setup();
 else if(command==='restore-workbuddy')output(await restoreWorkbuddy({home:options['client-home']}));
 else if(command==='doctor')await doctor();
 else if(command==='mcp'){if(options['read-only'])process.env.CADBRIDGE_READ_ONLY='1';await import('../mcp-server.mjs');}
 else if(command==='selftest'){await child(process.execPath,[path.join(projectRoot,'tests/integration.mjs')]);if(options.native)await child(process.execPath,[path.join(projectRoot,'tests/tangent-integration.mjs')]);output({ok:true,nativeTested:Boolean(options.native)});}
 else if(command==='demo')await demo();
 else if(command==='school'){if(!positional[0])throw Error('SCHOOL_INPUT_REQUIRED: provide your own requirements JSON; no sample files are bundled');await child(process.execPath,[path.join(projectRoot,'scripts/create-school-project.mjs'),path.resolve(positional[0]),...(options['standards-register']?['--standards-register',path.resolve(options['standards-register'])]:[]),...(options['model-only']?['--model-only']:[]),...(options['without-standard']?['--without-standard']:[])]);}
 else if(command==='standard')await child(process.execPath,[path.join(projectRoot,'scripts/import-standard.mjs'),...positional.map(p=>path.resolve(p))]);
 else if(command==='inspect'||command==='takeoff'){
  if(!positional[0])throw Error('A DWG path is required');if(options.format&&!['csv','json'].includes(options.format))throw Error('Format must be json or csv');const {execute}=await import('../bridge.mjs');const result=await execute(command==='inspect'?'tangent_inspect':'tangent_takeoff',{drawing:path.resolve(positional[0]),...(options.units?{units:options.units}:{}),...(options.host?{host:options.host}:{}),...(options.detail?{detail:options.detail}:{}),...(options.format==='csv'?{detail:'full'}:{})});
  if(options.format==='csv'){if(!result.ok)throw Error(JSON.stringify(result.error));const rows=[['circuit','wireCount','lengthDrawingUnits','lengthMm'],...result.tangent.circuits.map(c=>[c.id,c.wireCount,c.lengthDrawingUnits,c.lengthMm])];process.stdout.write('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');}else output(result);
  if(!result.ok)process.exitCode=1;
 }else if(command==='call'){if(!positional[0]||!positional[1])throw Error('Usage: cadbridge call <action> <request.json>');const {execute}=await import('../bridge.mjs');const result=await execute(positional[0],JSON.parse((await fs.readFile(positional[1],'utf8')).replace(/^\uFEFF/,'')));output(result);if(!result.ok)process.exitCode=1;}
 else if(command==='help')process.stdout.write('CAD AI Bridge 0.2 preview\n\n  setup [--workspace DIR] [--cad-root DIR] [--client-config FILE] [--rebuild] [--dry-run]\n    WorkBuddy: setup --client workbuddy [--client-home DIR]; or connect-workbuddy.cmd\n    Reuses verified plugin; --skip-build requires verified plugin.\n  doctor [--native TEST.dwg]\n  mcp [--read-only]\n  demo [--host core|tangent]\n  standard STANDARD.dwg REFERENCE-MANIFEST.json\n  school REQUIREMENTS.json [--standards-register REGISTER.json] [--model-only] [--without-standard]\n    School PDF requires Python + reportlab + pypdf.\n  inspect DRAWING.dwg [--units mm] [--format json|csv] [--host core|tangent]\n  takeoff DRAWING.dwg [--format csv]\n  selftest [--native]\n  call ACTION REQUEST.json\n');
 else throw Error('Unknown command '+command);
}catch(error){process.stderr.write(JSON.stringify({ok:false,error:{code:'CADBRIDGE_ERROR',message:error.message}})+'\n');process.exitCode=1;}
