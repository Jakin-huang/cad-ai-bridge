import {dependency} from './dependencies.mjs';
import {schemas,execute} from './bridge.mjs';
import {publicWorkflowSchema,readonlyWorkflowSchema,readonlySessionSchema,readonlyProjectSchema,publicProjectSchema} from './src/contracts.mjs';
import {toolResponse} from './src/tool-response.mjs';
import {failure} from './src/errors.mjs';
const {McpServer}=await dependency('@modelcontextprotocol/server');
const {serveStdio}=await dependency('@modelcontextprotocol/server/stdio');
const definitions=[
 ['cad_project','project','创建、查看、取消或恢复多图项目任务。start立即返回jobId，再status查看真实进度；源图先冻结，各图另存副本。cancel在当前图保存后停止后续项，resume只继续未开始项，状态不明的写入不自动重做。'],
 ['cad_analyze','analyze','对cad_scan_drawing的完整冻结结果执行工程检查和逐对象计量，不启动CAD。支持重复/必需属性、旧文字、图层、最小长度、文字高度；显式计量规则可设系数损耗及进位，缺少世界长度或单位时不声称完整总量。'],
 ['cad_scan_drawing','scan','一次只读捕获图纸至多100000条实体并建立本地索引。默认返回统计和jobId；随后cad_read_result按filter、fields分页，无需重启CAD。truncated表示捕获不完整，不能声称全图统计；支持显式布局和嵌套只读。'],
 ['cad_session','session','读取已接入AutoCAD 2022的当前文档、视图和选择集，按明确文档身份与版本查询、受约束编辑或保存副本。先list再context；人工修改后须重新读取。修改只作用当前内存文档，默认另存副本，不覆盖原文件。'],
 ['cad_capabilities','capabilities','说明CAD AI Bridge实际支持的宿主、对象、单位、操作与限制；不启动CAD，不表示本机已连接。'],
 ['cad_workflow','workflow','在副本中完成文字替换、属性图层整理、CSV统计、批量编辑或出图。delivery可同时交付编辑后全根层CSV和PDF/PNG，减少调用；普通任务设response=summary、preview=false。自动冻结输入、保存重开、校验保护内容与主要几何。传唯一requestId；断连先cad_get_job，勿换UUID重复写。'],
 ['cad_query_entities','query_entities','只读查询模型空间对象：按图层、类型、区域、文字、图块属性或句柄筛选，返回位置、几何、属性、图层、布局与命名视图。句柄必须与本次文件摘要一起使用。'],
 ['cad_edit','edit','在图纸副本中批量编辑普通对象、属性、文字、图层、尺寸标注及布局，调整受管理设备和路线；支持天正 V8 独立直线槽式桥架创建、尺寸型号修改、原生关联桥架标注。天正原生操作单独成批。失败回滚，另存新 DWG，保留原图。'],
 ['cad_export','export','用真实 AutoCAD 打印引擎将图纸或局部区域导出 PDF/PNG，支持指定布局。仅处理副本；PNG 可作为可视反馈。失败不重放任何编辑。'],
 ['cad_doctor','doctor','检查 CAD AI Bridge 的配置、工作目录与插件，给出修复建议。不启动 CAD；即使 CAD 或配置缺失也可调用。refresh=true 强制重新检测。'],
 ['cad_get_job','get_job','查询已有任务和保存结果；提供 jobId，或用原请求 requestId 查找相关任务。无需 CAD，不重放任何修改；断连或超时后先调用本工具。'],
 ['cad_audit_drawing','audit_drawing','只读清点真实图纸的实体、图层、图块实例与定义，并导出副本 DXF；默认摘要，详情可分页。'],
 ['cad_prepare_project','prepare_project','将明确为毫米制的真实工程图初始化为可管理副本；保留原有实体，输出新 DWG，不修改源图。'],
 ['cad_repair_copy','repair_copy','仅对输入快照运行 AutoCAD AUDIT 并另存修复副本；需要源摘要，不修改源图。修复可能改变损坏对象，必须对照复核。'],
 ['cad_create_test_drawing','create_test_drawing','创建毫米制空白测试 DWG，包含 EA_LIGHT 测试灯具定义。输出新文件。'],
 ['cad_create_drawing','create_drawing','从声明式毫米场景新建普通二维DWG。scene需layers、symbols、entities；不用图块时symbols=[]，图层0可显式声明一次。支持line/polyline/arc/circle/text/solid；不执行脚本。'],
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
   const readOnly=process.env.CADBRIDGE_READ_ONLY==='1',inputSchema=action==='workflow'?(readOnly?readonlyWorkflowSchema:publicWorkflowSchema):action==='project'?(readOnly?readonlyProjectSchema:publicProjectSchema):readOnly&&action==='session'?readonlySessionSchema:schemas[action];
   server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly||!['project','session','workflow','apply','edit','create_drawing','create_test_drawing','prepare_project','repair_copy'].includes(action),destructiveHint:false,openWorldHint:false}},async args=>{
     try{return await toolResponse(action,args,await execute(action,args));}
     catch(error){return{content:[{type:'text',text:JSON.stringify(failure(error))}],isError:true};}
   });
 }
 return server;
},{onerror:error=>process.stderr.write(error.message+'\n')});
