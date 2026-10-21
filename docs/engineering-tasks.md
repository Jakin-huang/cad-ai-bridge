# 通用任务身份、能力匹配与执行收据

2026-10-21新增源码入口`cad_engineering_task`（CLI动作`engineering_task`），支持`capabilities`、`prepare`、`status`、`invoke`、`dependencies`和有边界的`reconcile`。冻结v2.0发行包尚未包含该入口。

## 解决的问题与边界

项目名称和项目类型作为身份信息保存，执行流程由明确的task.kind匹配已安装适配器。通用任务契约不要求房间、灯具或医院字段。参数进入各自适配器的严格契约；同一个requestId不能换成另一个项目或另一组参数。后续调用必须同时提供任务jobId、项目UUID及任务摘要，不能通过parameters覆盖子任务jobId/requestId。

当前只实现两个适配器：ordinary-lighting调用既有有界普通照明流程，drawing-analysis调用来源绑定的规则检查和计量。后者不算第二类复杂工程设计能力。其他kind明确拒绝，项目名称里出现医院、办公或学校不会触发模板切换。该匹配是显式能力路由，尚无任意自然语言任务的自动分类或工程适用性认证。

这次抽取的是任务身份、适配接口、调用前校验、执行收据和重放隔离。专业需求图、标准适用性、空间模型、审核及图纸仍由原照明引擎承接；空间方案包和完整跨专业依赖分析未实现，不能将外层接口改为通用就声称整个设计引擎已通用化。

## 使用顺序

1. 调用`{"action":"capabilities"}`读取真实适配器、准备参数契约和operation参数契约。不能凭项目类型或工具名称推测支持能力。
2. `prepare`提交唯一requestId、project{id,name,type}、task{kind,title,objective}及parameters。project.id是调用方生成并持续沿用的UUID。返回jobId和taskSHA256后原样保存。
3. `status`使用jobId、expectedProjectId和expectedTaskSHA256；返回current为当前子任务状态，lastExecution为历史执行收据摘要，两者分别读取。
4. `invoke`另传唯一requestId、operation及parameters。普通照明operation=design的parameters为`{"expectedRevision":0}`；deliver须提供当前expectedModelSHA256。其他修改/复核仍遵守原引擎的版本、来源及质量闸门。
5. 断连后先status，已有完成收据的相同请求只返回记录。收据中的result属于该次历史操作，current属于当前版本；旧交付不会被伪装成新版交付。原生或外层执行状态不明时阻断新操作，不能改UUID重做。

照明准备的parameters保留原action=prepare（含project输入）或action=prepare_from_seed（含seedFile、expectedSeedSHA256、requirements及可选建筑/功能证据）；不传jobId/requestId。完整字段以capabilities及原[功能接入](functional-intake.md)、[来源换版](source-revisions.md)、[建筑换版](architecture-revisions.md)为准。

图纸分析准备的parameters与cad_analyze一致，但expectedResultSha256必填，必须引用cad_scan_drawing的完整冻结结果；同时提交checks或quantities。之后invoke使用operation=analyze、parameters={}。数量语义、未知单位和捕获完整性继续由原分析器判断；每次使用都会核对捕获字节摘要。大结果只传摘要和有限问题，逐对象记录通过返回的子任务cad_read_result继续分页。

调用产生manifest.json、binding.json、task-binding.json和逐请求operation/result收据。当前输入、初始输入、模型、来源捕获和交付摘要按对应能力核对；不同任务的同名来源、规则、单位及设备ID不会由全局“当前项目”缓存替换。既有cad_design_project/cad_analyze入口保留兼容，未强制所有旧调用迁移。

## 本轮真实验证

已知合成照明A（300lx要求）→独立图纸分析B→另一照明项目C（400lx要求）→返回A出图，均使用本机真实MCP；A出图及B建图/捕获使用真实AutoCAD。A为9套假定24W灯具、216W、1回路、五张A3，利用系数估算324lx；独立模型子集28通过/0失败/6待审。B有两条闭合矩形及两条文字，实际边界24m、1条待审注记。C只完成模型生成，不冒称新增原生出图验收。

11项本机集成检查和最终源码新进程重放/只读边界8项通过。A原模型及16项交付摘要保持；B来源和分析CSV保持。五张原生PDF物理尺寸、渲染与逐页目视已核对，未见截断或缺字；系统/布线仍为原有归属示意，不能据图面完整认定施工设计完成。原生PDF解析保留重复PageMode键的警告，实际页面可解析并正常渲染，不重写原文件掩盖诊断。

没有新增医院资料处理、医院资料外发或模型服务调用。本轮不含客户端自主理解任务、未见真实项目、独立建筑输入、第二类复杂设计、整层光度/UGR、外部用户、新机器或专业签审；这些门槛保持未通过。脱敏记录见[任务入口验证](engineering-tasks-validation.json)。

## 仍需处理

已接入声明的需求/来源/标准/成果依赖及有界标量一致性，按真实操作保存前后图和可读影响清单，见[依赖与影响范围](task-dependencies.md)。任意语义与跨包影响、自动能力解释、第二设计包、选择性原生更新和任务中心专用工作台仍待开发。当前外层对状态不明的操作采取停止并保留证据；新增的reconcile仅衔接适配器声明的未发布计算中断；任意中断/原生CAD恢复和自动认证审核仍未提供。真实客户、跨任务设计质量和人工返工预算继续按[迁移验收矩阵](task-portability.md)执行。


## 计算中断的父子任务协调

`reconcile`保留原来的operation文件与started/unconfirmed状态，另存协调凭证，把该操作解释为`interrupted_before_publication`。它不补造原请求成功回复，不重放求解，不启动CAD。普通照明适配器声明支持solve_lighting、assess_lighting和optimize_lighting；drawing-analysis、deliver及其他操作不自动获得此能力。以后专业包必须提供自己的恢复动作和可独立重查的证据。

先status，保存pendingOperations中的原requestId和recordSHA256；使用新的UUID提交以下字段（加原jobId、expectedProjectId、expectedTaskSHA256）：

```json
{
  "action": "reconcile",
  "requestId": "新的协调UUID",
  "operationRequestId": "原操作UUID",
  "expectedOperationSHA256": "status返回的recordSHA256",
  "operationParameters": {},
  "recoveryParameters": {}
}
```

operationParameters必须原样提供原操作参数，由同一个适配器规范化后与原payload摘要比较，不能改预算、修订、模型或输入。recoveryParameters={}时使用本次协调UUID调用已有安全恢复；子任务已经独立恢复过时，传recoveryParameters.recoveryRequestId。项目身份、任务/子任务绑定、原收据字节、已停止的原PID、归档租约、相邻的开始/恢复历史及输入/模型必须一致。权限不足、活进程、PID可能复用而无法确认、缺失/修改证据、有原操作结果文件或疑似首次模型发布均阻断。

成功后pendingOperations不再包含该操作，interruptedOperations保留原状态、协调UUID和凭证链接；原执行不进入completed计数。再次调用旧invoke返回TASK_OPERATION_INTERRUPTED，后续计算必须明确使用新UUID。相同reconcile可重放原凭证并返回新的current；后续模型/修订不被伪装成旧操作的成果。协调提交前中断可用同一协调UUID续接，停止的协调锁先归档；已经提交但未清理锁也可续接。不能借此清理其他请求或活进程的锁。

每次读取会重新核对凭证/结果摘要、原操作字节、历史前缀、输入/模型和归档租约。历史凭证允许后续合法状态发展；篡改、出现矛盾结果或并发衔接不明时继续阻断。只读模式拒绝协调。该接口不认证所有子进程均已停止，也不支持任意进程崩溃位置、已发布结果接管或状态不明的原生保存。当前实现和真实验证状态见[协调验证](task-reconciliation-validation.json)。
