import {dependency} from './dependencies.mjs';
import {schemas,execute} from './bridge.mjs';
import {boundForTransport} from './src/results.mjs';
import {failure} from './src/errors.mjs';
import fs from 'node:fs/promises';
const {McpServer}=await dependency('@modelcontextprotocol/server');
const {serveStdio}=await dependency('@modelcontextprotocol/server/stdio');
const definitions=[
 ['cad_query_entities','query_entities','只读查询模型空间对象：按图层、类型、区域、文字、图块属性或句柄筛选，返回位置、几何、属性、图层、布局与命名视图。句柄必须与本次文件摘要一起使用。'],
 ['cad_edit','edit','在受管理图纸副本中批量移动、复制、旋转、缩放、镜像、阵列、删除普通对象，修改文字/属性/图层，补画、偏移、直线修剪延伸、标注、视图和布局；支持受管理设备移动、路线修改及关联路线标签。失败整批回滚，另存新 DWG。'],
 ['cad_export','export','用真实 AutoCAD 打印引擎将图纸或局部区域导出 PDF/PNG，支持指定布局。仅处理副本；PNG 可作为可视反馈。失败不重放任何编辑。'],
 ['cad_doctor','doctor','检查 CAD AI Bridge 的配置、工作目录与插件，给出修复建议。不启动 CAD；即使 CAD 或配置缺失也可调用。refresh=true 强制重新检测。'],
 ['cad_get_job','get_job','查询已有任务和保存结果；提供 jobId，或用原请求 requestId 查找相关任务。无需 CAD，不重放任何修改；断连或超时后先调用本工具。'],
 ['cad_audit_drawing','audit_drawing','只读清点真实图纸的实体、图层、图块实例与定义，并导出副本 DXF；默认摘要，详情可分页。'],
 ['cad_prepare_project','prepare_project','将明确为毫米制的真实工程图初始化为可管理副本；保留原有实体，输出新 DWG，不修改源图。'],
 ['cad_repair_copy','repair_copy','仅对输入快照运行 AutoCAD AUDIT 并另存修复副本；需要源摘要，不修改源图。修复可能改变损坏对象，必须对照复核。'],
 ['cad_create_test_drawing','create_test_drawing','创建毫米制空白测试 DWG，包含 EA_LIGHT 测试灯具定义。输出新文件。'],
 ['cad_create_drawing','create_drawing','从受约束的毫米制场景新建 DWG：图层、原创普通图块、折线、圆及文字。仅创建空白图，不执行脚本。设备随后通过 electrical_apply 布置、连线和编号。'],
 ['cad_inspect','inspect','重新打开指定 DWG，返回文档 ID、版本、图块、设备、线路和源文件摘要。'],
 ['tangent_inspect','tangent_inspect','只读识别天正 V8 示例中观察到的设备图块、导线 XData 和回路；报告代理对象、单位与识别范围。'],
 ['tangent_takeoff','tangent_takeoff','只读汇总天正设备分类、回路和导线几何长度。未定义单位时长度不换算毫米；可明确传 units=mm。'],
 ['cad_native_status','native_status','在独立天正图形宿主中打开图纸副本，确认原生模块加载状态。需要本机天正及可用授权；不修改源图。'],
 ['cad_read_result','read_result','分页读取已有任务的设备、导线或回路完整记录，每页至多 100 条，不重新启动 CAD。'],
 ['electrical_apply','apply','在 DWG 副本中按一项原子任务布置普通图块、按显式路径连线、批量编号。始终另存新 DWG，保留源文件。'],
 ['electrical_takeoff','takeoff','读取已管理设备的型号分组数量和图面路线长度（毫米）。'],
 ['electrical_validate','validate','检查已管理设备的缺失/重复编号及线路端点连接。不是规范审查。']
];
await serveStdio(()=>{
 const server=new McpServer({name:'cad-ai-bridge',version:'0.2.0'});
 for(const [name,action,description]of definitions){
   if(process.env.CADBRIDGE_READ_ONLY==='1'&&['apply','edit','create_drawing','create_test_drawing','prepare_project','repair_copy'].includes(action))continue;
   server.registerTool(name,{description,inputSchema:schemas[action],annotations:{readOnlyHint:!['apply','edit','create_drawing','create_test_drawing','prepare_project','repair_copy'].includes(action),destructiveHint:false,openWorldHint:false}},async args=>{
     try{const result=boundForTransport(await execute(action,args));const content=[{type:'text',text:JSON.stringify(result)}];if(action==='export'&&args.format==='png'&&result.ok&&result.exported.bytes<=4*1024*1024)content.push({type:'image',mimeType:'image/png',data:(await fs.readFile(result.exported.file)).toString('base64')});return{content,isError:!result.ok};}
     catch(error){return{content:[{type:'text',text:JSON.stringify(failure(error))}],isError:true};}
   });
 }
 return server;
},{onerror:error=>process.stderr.write(error.message+'\n')});
