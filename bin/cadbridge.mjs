#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {discover,selectInstallation,loadConfig,projectRoot,psExecutable} from '../src/config.mjs';
import {atomicJson,csvCell} from '../src/files.mjs';
const [command='help',...argv]=process.argv.slice(2);
const values=new Set(['workspace','cad-root','language','host','units','format','config','detail']);
const flags=new Set(['dry-run','skip-build','read-only','native','json','model-only']);
const options={},positional=[];
for(let i=0;i<argv.length;i++){const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}const key=token.slice(2);if(values.has(key)){if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing --'+key+' value');options[key]=argv[++i];}else if(flags.has(key))options[key]=true;else throw Error('Unknown option --'+key);}
if(options.config)process.env.CADBRIDGE_CONFIG=path.resolve(options.config);
const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function child(exe,args){await new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd:projectRoot,windowsHide:true,stdio:['inherit',process.stderr,process.stderr]});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Command failed ('+code+'): '+path.basename(exe))));});}
async function setup(){
 const inventory=await discover(),cad=selectInstallation(inventory,options['cad-root']);
 const settings={schemaVersion:1,workspace:path.resolve(options.workspace||process.cwd()),cadRoot:cad.root,productKey:cad.productKey,language:options.language||cad.language,
  tangentRoot:inventory.tangent.find(t=>t.r24ModulePresent)?.root,tangentProfile:cad.profiles.find(p=>/^TElec20V8$/i.test(p)),powershell:inventory.powershell||psExecutable()};
 if(!settings.language)throw Error('Select --language for this CAD installation');await fs.access(settings.workspace);
 const config=process.env.CADBRIDGE_CONFIG||path.join(projectRoot,'cadbridge.local.json');
 const mcp={mcpServers:{'cad-ai-bridge':{command:process.execPath,args:[path.join(projectRoot,'bin/cadbridge.mjs'),'mcp'],env:{CADBRIDGE_CONFIG:config,CADAGENT_POWERSHELL:settings.powershell}}}};
 if(options['dry-run'])return output({dryRun:true,settings,files:[config,path.join(projectRoot,'mcp-config.local.json')],buildPlugin:!options['skip-build'],mcp});
 if(!options['skip-build'])await child(settings.powershell,['-NoProfile','-NonInteractive','-File',path.join(projectRoot,'build.ps1'),'-CadRoot',cad.root]);
 const written=await atomicJson(config,settings,{backup:true});const clientConfig=await atomicJson(path.join(projectRoot,'mcp-config.local.json'),mcp,{backup:true});
 output({ok:true,settings,written,clientConfig,next:'Import mcp-config.local.json into your MCP client. Existing client settings were not modified.'});
}
async function doctor(){
 const inventory=await discover(),checks=[];let settings;
 const add=(name,ok,detail)=>checks.push({name,ok,detail});
 const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);
 add('windows',process.platform==='win32',process.platform);add('node',nodeMajor>22||(nodeMajor===22&&nodeMinor>=19),process.versions.node);
 try{settings=await loadConfig();add('supportedAutoCAD',true,settings.cadRoot);add('workspace',true,await fs.realpath(settings.workspace));}catch(e){add('configuration',false,e.message);}
 try{const b=JSON.parse(await fs.readFile(path.join(projectRoot,'plugin/bin/build.json'),'utf8'));const dll=await fs.readFile(path.join(projectRoot,'plugin/bin/CadAgent.dll'));const digest=crypto.createHash('sha256').update(dll).digest('hex');add('plugin',b.sha256.toLowerCase()===digest,digest);}catch(e){add('plugin',false,'Run cadbridge setup to build the local plugin');}
 if(settings)add('tangentFiles',Boolean(settings.tangentRoot&&settings.tangentProfile),settings.tangentRoot||'Optional Tangent installation not configured');
 let native;
 if(options.native){if(!positional[0])throw Error('doctor --native requires a DWG path inside configured workspace');const {execute}=await import('../bridge.mjs');native=await execute('native_status',{drawing:path.resolve(positional[0])});add('nativeRuntime',Boolean(native.ok&&native.nativeHost?.nativeKernelLoaded),native.jobRoot);}
 const required=checks.filter(c=>c.name!=='tangentFiles');const ok=required.every(c=>c.ok);output({ok,checks,inventory,native,notes:['File detection does not verify license or native runtime readiness.','Use doctor --native <test.dwg> after completing normal first-run dialogs.']});if(!ok)process.exitCode=1;
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
 else if(command==='doctor')await doctor();
 else if(command==='mcp'){if(options['read-only'])process.env.CADBRIDGE_READ_ONLY='1';await import('../mcp-server.mjs');}
 else if(command==='selftest'){await child(process.execPath,[path.join(projectRoot,'tests/integration.mjs')]);if(options.native)await child(process.execPath,[path.join(projectRoot,'tests/tangent-integration.mjs')]);output({ok:true,nativeTested:Boolean(options.native)});}
 else if(command==='demo')await demo();
 else if(command==='school')await child(process.execPath,[path.join(projectRoot,'scripts/create-school-project.mjs'),...(positional[0]?[path.resolve(positional[0])]:[]),...(options['model-only']?['--model-only']:[])]);
 else if(command==='inspect'||command==='takeoff'){
  if(!positional[0])throw Error('A DWG path is required');if(options.format&&!['csv','json'].includes(options.format))throw Error('Format must be json or csv');const {execute}=await import('../bridge.mjs');const result=await execute(command==='inspect'?'tangent_inspect':'tangent_takeoff',{drawing:path.resolve(positional[0]),...(options.units?{units:options.units}:{}),...(options.host?{host:options.host}:{}),...(options.detail?{detail:options.detail}:{}),...(options.format==='csv'?{detail:'full'}:{})});
  if(options.format==='csv'){if(!result.ok)throw Error(JSON.stringify(result.error));const rows=[['circuit','wireCount','lengthDrawingUnits','lengthMm'],...result.tangent.circuits.map(c=>[c.id,c.wireCount,c.lengthDrawingUnits,c.lengthMm])];process.stdout.write('\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');}else output(result);
  if(!result.ok)process.exitCode=1;
 }else if(command==='call'){if(!positional[0]||!positional[1])throw Error('Usage: cadbridge call <action> <request.json>');const {execute}=await import('../bridge.mjs');const result=await execute(positional[0],JSON.parse((await fs.readFile(positional[1],'utf8')).replace(/^\uFEFF/,'')));output(result);if(!result.ok)process.exitCode=1;}
 else if(command==='help')process.stdout.write('CAD AI Bridge 0.2 preview\n\n  setup [--workspace DIR] [--cad-root DIR] [--dry-run]\n  doctor [--native TEST.dwg]\n  mcp [--read-only]\n  demo [--host core|tangent]\n  school [requirements.json]  (Python + reportlab + pypdf required)\n  inspect DRAWING.dwg [--units mm] [--host core|tangent]\n  takeoff DRAWING.dwg [--format csv]\n  selftest [--native]\n  call ACTION REQUEST.json\n');
 else throw Error('Unknown command '+command);
}catch(error){process.stderr.write(JSON.stringify({ok:false,error:{code:'CADBRIDGE_ERROR',message:error.message}})+'\n');process.exitCode=1;}
