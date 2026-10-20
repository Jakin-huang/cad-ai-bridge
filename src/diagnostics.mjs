import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {dataHome} from './local-paths.mjs';
import {loadConfig} from './config.mjs';
import {verifyPlugin} from './setup.mjs';

export async function diagnose({refresh=false}={}){
 const checks=[];const add=(name,ok,detail,next)=>checks.push({name,ok,detail,...(next?{next}:{})});let settings;
 const [major,minor]=process.versions.node.split('.').map(Number);
 add('windows',process.platform==='win32',process.platform);
 add('node',major>22||(major===22&&minor>=19),process.versions.node,'安装 Node.js 22.19 或更新版本');
 try{settings=await loadConfig({refresh});add('supportedAutoCAD',true,settings.cadRoot);try{add('workspace',true,await fs.realpath(settings.workspace));}catch(error){add('workspace',false,error.message,'重新运行 setup 并选择图纸工作目录');}}
 catch(error){add('configuration',false,error.message,'运行 cadbridge setup；检查配置、PowerShell 和 AutoCAD 2022 安装');}
 try{const plugin=await verifyPlugin();add('plugin',true,plugin.sha256);}catch(error){add('plugin',false,error.message,'重新运行 setup，复用正确插件或自动构建');}
 if(settings)for(const [name,directory]of [['workspaceWritable',settings.workspace],['dataHomeWritable',dataHome()]]){const file=path.join(directory,'.cadbridge-probe-'+crypto.randomUUID());let created=false;try{await fs.mkdir(directory,{recursive:true});const handle=await fs.open(file,'wx');created=true;await handle.close();add(name,true,'可创建任务文件');}catch(error){add(name,false,error.code||error.message,'选择当前账户可写的目录后重新接入');}finally{if(created)await fs.unlink(file);}}
 if(settings)add('tangentFiles',Boolean(settings.tangentRoot&&settings.tangentProfile),settings.tangentRoot||'可选天正环境未配置');
 return{ok:checks.filter(c=>c.name!=='tangentFiles').every(c=>c.ok),checks,discoveryCacheHit:settings?.discoveryCacheHit??false,acceptance:{currentMachineDiagnostics:true,freshMachine:false,independentAccount:false,externalUsers:false},notes:['诊断成功表示当前账户的文件和目录检查通过，不表示CAD授权、实际任务或外部用户验收通过。','需要原生验证时，使用 doctor --native <测试DWG>。']};
}
