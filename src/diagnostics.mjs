import fs from 'node:fs/promises';
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
 if(settings)add('tangentFiles',Boolean(settings.tangentRoot&&settings.tangentProfile),settings.tangentRoot||'可选天正环境未配置');
 return{ok:checks.filter(c=>c.name!=='tangentFiles').every(c=>c.ok),checks,discoveryCacheHit:settings?.discoveryCacheHit??false,notes:['文件检测不代表授权或原生模块已就绪。','需要原生验证时，使用 doctor --native <测试DWG>。']};
}
