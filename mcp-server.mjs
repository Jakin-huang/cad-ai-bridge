import {dependency} from './dependencies.mjs';
import {schemas,execute} from './bridge.mjs';
const {McpServer}=await dependency('@modelcontextprotocol/server');
const {serveStdio}=await dependency('@modelcontextprotocol/server/stdio');
const definitions=[
 ['cad_create_test_drawing','create_test_drawing','创建毫米制空白测试 DWG，包含 EA_LIGHT 测试灯具定义。输出新文件。'],
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
   if(process.env.CADBRIDGE_READ_ONLY==='1'&&['apply','create_test_drawing'].includes(action))continue;
   server.registerTool(name,{description,inputSchema:schemas[action],annotations:{readOnlyHint:!['apply','create_test_drawing'].includes(action),destructiveHint:false,openWorldHint:false}},async args=>{
     try{const result=await execute(action,args);return{content:[{type:'text',text:JSON.stringify(result)}],isError:!result.ok};}
     catch(error){return{content:[{type:'text',text:JSON.stringify({ok:false,error:{code:'HOST_OR_INPUT_ERROR',message:error.message}})}],isError:true};}
   });
 }
 return server;
},{onerror:error=>process.stderr.write(error.message+'\n')});
