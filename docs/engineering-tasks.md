# 通用任务身份、能力匹配与执行收据

2026-10-21新增源码入口`cad_engineering_task`（CLI动作`engineering_task`），支持`capabilities`、`prepare`、`status`、`invoke`、`dependencies`、只读`data`和有边界的`reconcile`。冻结v2.0发行包尚未包含该入口。

## 解决的问题与边界

项目名称和项目类型作为身份信息保存，执行流程由明确的task.kind匹配已安装适配器。通用任务契约不要求房间、灯具或医院字段。参数进入各自适配器的严格契约；同一个requestId不能换成另一个项目或另一组参数。后续调用必须同时提供任务jobId、项目UUID及任务摘要，不能通过parameters覆盖子任务jobId/requestId。

当前实现三个适配器：ordinary-lighting调用既有有界普通照明流程；office-space-planning独立求解办公空间方案；drawing-analysis调用来源绑定的规则检查和计量，后者不算复杂设计能力。空间包的输入、求解、家具/通道自检和图纸不导入照明管理器或灯具模型。其他kind明确拒绝，项目名称里出现医院、办公或学校不会触发模板切换。该匹配是显式能力路由，尚无任意自然语言任务的自动分类或工程适用性认证。

这次抽取的是任务身份、适配接口、调用前校验、执行收据和重放隔离。专业需求、标准适用性、模型、审核及图纸分别由专业包承接；空间包已有有界通路，完整跨专业资料/房间清单/用途变更与协调尚未实现，不能将外层接口改为通用就声称整个设计引擎已通用化。

## 使用顺序

尚无结构化设计输入时，可先用 `cad_engineering_intake review_scope/read_scope_review` 建立原文范围记录，保留候选任务、后续委托、不支持项、缺失条件、冲突和背景，逐句段关联原始文档。此时不需要 baseline 或正式设计任务；`capabilities section=scope` 返回契约。候选不代表已完成，依赖候选的任务仍待前置成果。后续 intake.freeze 的可选 scope 关联限定同文档集和同专业候选；详情见[公开技能的工程流程](../skills/cadbridge-electrical/references/engineering-design.md)。该机制不做自然语言自动分类，也不改变既有专业设计门槛。

1. 调用`{"action":"capabilities"}`读取真实适配器、准备参数契约和operation参数契约。不能凭项目类型或工具名称推测支持能力。
2. `prepare`提交唯一requestId、project{id,name,type}、task{kind,title,objective}及parameters。project.id是调用方生成并持续沿用的UUID。返回jobId和taskSHA256后原样保存。
3. `status`使用jobId、expectedProjectId和expectedTaskSHA256；返回current为当前子任务状态，lastExecution为历史执行收据摘要，两者分别读取。
4. `invoke`另传唯一requestId、operation及parameters。普通照明operation=design的parameters为`{"expectedRevision":0}`；deliver须提供当前expectedModelSHA256。其他修改/复核仍遵守原引擎的版本、来源及质量闸门。
5. 断连后先status，已有完成收据的相同请求只返回记录。收据中的result属于该次历史操作，current属于当前版本；旧交付不会被伪装成新版交付。原生或外层执行状态不明时阻断新操作，不能改UUID重做。

照明准备的parameters保留原action=prepare（含project输入）或action=prepare_from_seed（含seedFile、expectedSeedSHA256、requirements及可选建筑/功能证据）；不传jobId/requestId。完整字段以capabilities及原[功能接入](functional-intake.md)、[来源换版](source-revisions.md)、[建筑换版](architecture-revisions.md)为准。

图纸分析准备的parameters与cad_analyze一致，但expectedResultSha256必填，必须引用cad_scan_drawing的完整冻结结果；同时提交checks或quantities。之后invoke使用operation=analyze、parameters={}。数量语义、未知单位和捕获完整性继续由原分析器判断；每次使用都会核对捕获字节摘要。大结果只传摘要和有限问题，逐对象记录通过返回的子任务cad_read_result继续分页。

调用产生manifest.json、binding.json、task-binding.json和逐请求operation/result收据。当前输入、初始输入、模型、来源捕获和交付摘要按对应能力核对；不同任务的同名来源、规则、单位及设备ID不会由全局“当前项目”缓存替换。既有cad_design_project/cad_analyze入口保留兼容，未强制所有旧调用迁移。

部分设计包的内部记录不单独登记 `result.json`。任务中心现在会在核验对应正式任务的清单及绑定摘要后转到正式任务；认证下载同样仅使用该绑定任务已经登记的文件及摘要。已有独立结果的记录继续以自身为准，坏结果不能回落绕过，父绑定/清单/结果不符则拒绝。关联查找只读，不补写旧记录或重放设计。正式任务身份继续采用原 JSON 序列摘要，不能混用依赖图的键排序摘要。实际旧空间任务和三种任务切换的核验见 [验证记录](space-natural-client-validation.json)，浏览器自动跳转尚无独立可视交互验收。

## 本轮真实验证

已知合成照明A（300lx要求）→独立图纸分析B→另一照明项目C（400lx要求）→返回A出图，均使用本机真实MCP；A出图及B建图/捕获使用真实AutoCAD。A为9套假定24W灯具、216W、1回路、五张A3，利用系数估算324lx；独立模型子集28通过/0失败/6待审。B有两条闭合矩形及两条文字，实际边界24m、1条待审注记。C只完成模型生成，不冒称新增原生出图验收。

11项本机集成检查和最终源码新进程重放/只读边界8项通过。A原模型及16项交付摘要保持；B来源和分析CSV保持。五张原生PDF物理尺寸、渲染与逐页目视已核对，未见截断或缺字；系统/布线仍为原有归属示意，不能据图面完整认定施工设计完成。原生PDF解析保留重复PageMode键的警告，实际页面可解析并正常渲染，不重写原文件掩盖诊断。

没有新增医院资料处理、医院资料外发或模型服务调用。本轮不含客户端自主理解任务、未见真实项目、独立建筑输入、第二类复杂设计、整层光度/UGR、外部用户、新机器或专业签审；这些门槛保持未通过。脱敏记录见[任务入口验证](engineering-tasks-validation.json)。

## 仍需处理

已接入声明的需求/来源/标准/成果依赖及有界标量一致性，按真实操作保存前后图和可读影响清单，见[依赖与影响范围](task-dependencies.md)。任意语义与跨包影响、自动能力解释、选择性原生更新和任务中心专用工作台仍待开发。当前外层对状态不明的操作采取停止并保留证据；新增的reconcile仅衔接适配器声明的未发布计算中断；任意中断/原生CAD恢复和自动认证审核仍未提供。真实客户、跨任务设计质量和人工返工预算继续按[迁移验收矩阵](task-portability.md)执行。


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


## 第二设计包：office-space-planning

空间方案包独立维护输入、预算搜索、几何/家具审计、版本与图纸。它不导入照明模型，也不靠医院、房间名称或项目名称选择算法。参数以capabilities返回的JSON Schema为准。

prepare.parameters为{input}。输入明确固定矩形净边界、入口边及净宽/偏移、源窗段、矩形保留构件；房间程序含用途、人数、净面积范围/偏好、最小面宽/进深、窗接触及入口路径要求；关系支持最小共墙长度与最大门间路径。工位、座位、通道、门口、墙厚与未分配面积上限均为显式项目尺寸。来源包含摘要、角色和是否最终图派生；程序/关系/尺寸必须引用活动任务书来源及逐字原句。活动brief摘要必须等于所存UTF-8正文；原句存在只证明引用，不认证数值解释或客户意图。未知/待补的阻断条件不求解。

默认求解族为两侧直走廊和有厚度隔墙的矩形房间。可显式设置 `design.budget.corridorMode=allow_single_sided`，增加贴合矩形净边界的单侧直走廊；完整入口净宽、原有构件和全部项目要求保持。缺省或 `two_sided` 保留原族。搜索走廊宽/位置、房间顺序/侧别/网格长度及窗对齐退让，保留构件分割可用侧带。每个走廊变体保留首个可行方案，再在已找到方案中按面积偏好/未分配面积选优；不证明全局最优，也不把预算耗尽称为项目不可行。默认最多50000个状态、10秒、3个方案；可显式设置，最大200000状态、30秒、10方案。网格长度枚举超预算明确拒绝，不静默截断。

| operation | 参数与结果边界 |
| --- | --- |
| design | expectedRevision、expectedInputSHA256、可选budget；独立检查所有候选，仅发布通过者，无候选保留研究和失败状态 |
| revise_program | 同版本/摘要、新brief/program/relations/parameters及reason；新任务书来源，源边界几何冻结并显式延续；新输入修订使当前模型、交付和审核失效，旧文件保留；assumed不自动升级 |
| deliver | expectedModelSHA256；重新核对模型/输入/投影，真实新建普通可编辑DWG、空间属性块、保存重开回读、PDF/PNG、房间CSV与JSON待审包；未知保存状态阻断新请求 |
| review | expectedModelSHA256、origin=simulation或external_unverified、reviewer及有目标的comments；仅登记待审意见，绝不签发专业合格 |

SP01依据说明、SP02分隔和静态尺寸、SP03家具/净空意图、SP04面积座位表、SP05关系及待审；内容超页后续页。场景版本随模型保存：图面改进不重写历史模型或图。房间物理身份与跨图表示分开，以SPACE_ID/SOURCE_SHA等自定义属性回读，不伪装成灯具或回路。人工CAD自由编辑后须重新核验，当前不将静态标注称为关联尺寸。

窗接触、面积与连通矩形通道仅验证几何项目子集，不认证采光、消防、无障碍、声学、机电或施工合规。标准登记始终pending；没有执行建筑规范规则。新增shell.capture可绑定完整毫米捕获中的明确矩形、入口/窗线段及保留构件，摘要和逐实体路径不符就拒绝；来源权威性、对象角色与遗漏仍待审。任意边界、清单增删/用途重分类与混合专业权威变更仍需开发。

2026-10-21已用已知开发用例验证10房间/34席改为36席、两版原生出图、照明A→空间B改版→空间C→照明A，以及新只读进程和历史重放。首轮几何通过但图面有缺点，保留后修正再测；不是独立客户、自然语言理解或专业质量验收。详见[脱敏验证](space-planning-validation.json)。

## 来源捕获、共用空间及照明联动增量

以下是上述历史记录之后的源码增量，未重新打包v2.0。当前证据见[联动验证](shared-space-coordination-validation.json)。

空间输入可提供shell.capture：captureJobId、捕获文件captureSHA256、drawingSHA256、boundaryPath、entryPath、windows和keepouts的id/instancePath。必须是完整、未截断、无错误的毫米本地捕获；边界/保留构件为WCS平面轴对齐四角直线闭合矩形，入口和窗为明确线段，偏移/宽度/尺寸逐项在0.001mm内一致，活动建筑来源摘要必须覆盖该DWG。source_bound只说明声明对象与真实文件的几何一致；对象角色、遗漏、现状权威性和适用性仍待审，不自动从任意图纸识别所有工程条件。

空间包的publish_spaces需expectedModelSHA256及不与房间ID冲突的circulationId。只有当前模型已经实际出图、重开捕获核对通过才能发布不可变space-pack版本。共用包保存项目/父子任务/版本/输入/模型摘要、原生文件与捕获摘要、来源角色、空间多边形和入口、用途活动/人数及原句、上下文线图和待审条件。role固定upstream_design，professionalApproval=false；生成方案保持提议身份，不升级为已签发建筑依据。上下文目前只含边界、保留构件和隔墙矩形子集。

发布后的数据可从真实MCP只读分页取得；参数中的身份来自prepare/status，摘要来自发布结果或第一页，以下占位值需要替换：

```json
{
  "action": "data",
  "jobId": "job-task-<UUID>",
  "expectedProjectId": "<项目UUID>",
  "expectedTaskSHA256": "<任务摘要>",
  "section": "spaces",
  "revision": 1,
  "expectedDataSHA256": "<发布文件摘要>",
  "offset": 0,
  "limit": 25
}
```

spaces/context/sources三节分别读取，最多100条且每页数据最多256KiB；沿nextOffset继续，固定revision和dataSHA256以免混页。省略revision读取当前版本；当前尚未发布时明确失败，不退回旧版本。显式历史版本可以读取但current=false；篡改摘要、错项目、未支持节或能力包明确拒绝。capabilities返回dataSections。

照明prepare.project.spaceProgram显式引用pack{jobId,revision,sha256}、expectedProjectId、独立sourceId及rooms绑定。每项含roomId、programSHA256（活动/人数/原句对象的规范JSON摘要）、明确use、quote、reason、status=interpreted。必须覆盖全部选定照明房间，房间ID/名称/边界/入口及architecture上下文与共用包相符；geometryStatus保留inferred。系统不依据房间名自动推断照明用途或标准；未选空间明确在本次照明范围外。

上游修订程序后，即使新方案尚未生成，旧照明status.spaceProgram.current也会变false。新设计、质量计算、优化、采纳和交付被阻断；历史请求仍能读取原收据，但current始终描述当前状态，不能把重放当成新成果。历史模型、图纸和审核字节保留。

上游启用原始文档审核时，文档集换版也会使已发布空间包失效，即使空间任务仍显示已交付、模型修订号尚未变化。共享包加载同时核对文档版本、当前输入审核和模型所绑定的审核；`currentProducer.documentEvidence` 提供原因。只重新绑定文档不使旧模型恢复有效，必须完成模型重算和新原生交付。历史空间分页仍可读取，但 `current=false`；项目审核不得将其计为当前覆盖。未启用文档审核的历史任务保持原有校验范围，不追认其具有原文语义验收。

显式adopt_spaces通过普通invoke调用，parameters含expectedRevision、expectedInputSHA256、新binding以及carryForward{expectedConditionsSHA256,reason,evidence{sourceId,quote}}。expectedConditionsSHA256由冻结的非几何照明条件规范JSON计算，包含各房间用途/高度/工作面/障碍和要求/标准/灯具/电气/光度/反射/眩光条件；quote须逐字来自摘要正确的活动照明任务书，说明其他条件继续适用。采用新来源ID并保留supersedes及spaceProgramChanges链，重查历史输入、旧/新功能摘要、来源和条件摘要。成功产生新输入修订，旧模型/CAD/质量结果及审核退出当前，全部选定空间保守重算，不做选择性CAD更新。

adopt_spaces仍只支持同一上游生产任务、同一项目、同一选定房间ID清单及照明use不变的方案改版；不能绕过它的限制。新增/删除房间和明确用途/条件变化使用下述完整修订。流明估算设计可能返回ok=true/status=blocked的诊断结果，必须同时检查状态、模型存在及failed=0，不能只看ok。

照明交付另存delivery-layout-scene与delivery-room-labels：平面R编号与E05全名/ID对应；房间、灯具、开关文字在有界范围避让，必要时加图面引线。原模型、计算、物理灯位/开关/路径不改变；放置失败会在启动原生生成前拒绝。delivery.layout绑定最终场景，已有delivery.projection仍只绑定质量注释基础投影。预测文字边界检查不能代替实际PDF逐页检查或任意字体/图纸适用性验收。

## 完整清单、用途及条件修订

preview_space_scope和revise_space_scope支持已绑定共用空间的照明任务完整改版。使用当前项目/上游生产者的已发布版本：可以保留同一上游版本调整照明选取范围，也可以前进到新版；不倒退、不自动切换项目/生产任务，不按名字猜测拆房/并房关系。几何、名称、入口、programme摘要及引文必须符合所绑定原生交付的共享包；proposal始终是待审生成方案。

先用cad_design_project的status.section=input读取完整当前专业输入，复制并明确填写新project。project使用完整engineeringInputSchema：新活动任务书正文、独立brief来源ID/摘要，以及新建筑来源ID/共享包摘要；旧brief和旧建筑来源互相记录supersededBy/supersedes。其他旧来源的身份、摘要、角色和描述均保留，不删除或改写。旧历史字段可省略，服务端从原输入保留；若提供，必须与旧值一致，不能导入其他任务的记录。新原句不认证资料的实际工程权威。

房间、要求、标准、产品、电气、工作面/障碍、反射/眩光及缺项均显式填写完整新范围；删除房间的条件不得留作当前引用。可以新增声明的标准/产品来源，已有标准/产品来源保持原身份，新专业适用性仍由既有证据检查及人工审核决定。当前只接受一个摘要正确的活动旧任务书及其唯一新承接来源。已有assumed状态/分类不能借此次修订自动提升为确认事实；新光度/标准配置仍须经过原解析器和质量门槛。

通过普通invoke操作preview_space_scope，parameters为expectedRevision、expectedInputSHA256和project。它不改子任务输入、模型、质量、CAD或审核；通用父任务仍保存该invoke的审计收据。返回proposalSHA256、new brief sourceId及decisions预览，每项含key、added/removed/revised/retained、previousSHA256/nextSHA256（不存在为null）、前后值。新值已包含契约缺省项，因此从预览复制摘要，避免客户端自行规范化不一致。该预览没有自动作出处置或批准。

正式invoke操作revise_space_scope，parameters在上述字段之外提供reason及decisions。每项只保留key/disposition/previousSHA256/nextSHA256，添加reason和evidence{sourceId,quote}；quote逐字存在于新任务书，sourceId为新活动任务书来源。所有project_context、room、requirement、luminaire、standard、source、缺项、电气和已使用的功能/光度/反射/眩光/标准配置均需一项处置，含沿用项；缺项、重复、漏删、错误摘要和原句被拒绝。最多2500项，仍受专业输入各字段上限限制。引用和摘要一致仅证明记录完整，不能认证解释含义。

成功另存原始修订日志、完整input新版本、来源链与spaceProgramChanges(mode=scope_revision)。原模型、质量、CAD、审核退出当前；新范围完整重算，原文件及原审核保留在历史。未满足的阻断条件可形成blocked输入版本，不能把操作成功视作设计通过。未知原生/质量操作期间不得修订。重复请求仅重放原收据；同UUID改参数拒绝。后续读取独立核对历史输入、原始日志、逐条件摘要/原句和共享包，不能只修改当前输入及state摘要掩盖变更。

cad_design_project的status.section=space_program_changes返回当前绑定、修订链及条件值/摘要。当前完整改版仍不自动解释自然语言、匹配任意空间拆并身份、判断专业标准适用性、进行选择性原生编辑或签发设计。已知开发任务的删房/加房、用途与要求变化、两版原生图和失败边界见[本轮验证](space-scope-revision-validation.json)。


## 紧凑提案及真实客户端验证

cad_design_revision 的 draft/read/apply 接收客户端明确的房间选择、用途、旧条件来源、改值/未知规则及新任务书原句，Bridge 从当前共享包装配几何与完整条件/来源处置。它继续调用完整修订门槛，不推断工程语义或降低假设、标准、光学质量和审核要求。inspect_brief 返回精确正文与textSHA256；space_bindings 直接提供functionSHA256，避免客户端手算技术摘要。完整字段与步骤见[独立公开技能](../skills/cadbridge-electrical/references/engineering-design.md)。

本机真实客户端最终完成一次5空间修订及新原生图；冲突与未知用例按要求阻断。未知用例首次引文不符被拒后自修正，零错误可用性未通过，原始结果之外有独立深层工具错误审计。数据为已知合成输入，不能证明任意医院或其他真实工程理解，也不抵扣整层光度失败、独立项目和专业验收。见[验证与边界](scope-client-validation.md)。

后续数值审阅增量：draft/summary返回requirementsReview计数；read的requirements节列出每个房间/规则的实际values、effective状态、来源原句，以及explicit_override/carried_forward/unresolved。offset/limit与240KiB预算共同限定每页，必须沿实际nextOffset取齐；单项过大明确拒绝，不跳过。每个read节都返回base中的原/当前revision及inputSHA和staleBase；历史提案可读，重新应用仍受原版本门槛约束。读取本身不发布输入、模型或原生图；计数和引文不证明客户任务书已全部解释。真实MCP读取及当前限制见[验证](proposal-readback-validation.json)，真实AI客户端使用新视图尚未验收。

## 共用审核 PDF

两个设计包原生交付后均可 invoke review_pdfs。parameters 仅传 expectedModelSHA256 和 expectedSourceSHA256，分别复制 status.current.modelSHA256 与 pdfReviewSourceSHA256；外层另用唯一 requestId 及原任务身份。另存 PDF 和 manifest，不重做 CAD。当前 files 优先审核 PDF，pdf_source 是原始 CAD 导出，delivery.files 保持原生交付记录；均按已登记摘要下载。任务中心支持两包状态读取和审核 PDF 准备。

相同源复用当前包；输入/模型/修订变化后旧包仅历史。篡改、签名/加密输入、非单张或纸张不符、现有异物均拒绝。产品 manifest 的 independentStrictReaderAccepted/visualAccepted/professionalApproval 不由生成器自动提升；本机已知 11 张实际导出的独立格式、渲染、重放和下载证据见[验证](pdf-review-workflow-validation.json)。其他阅读器矩阵与通用中断恢复仍待验收。

## 引文诊断与实际客户端审阅

紧凑draft的原句验证在发布前聚合所有字段，REVISION_PLAN_QUOTE_NOT_IN_BRIEF错误消息以有界JSON列出sourceTextSHA256、invalidCount、invalidEvidence中的字段path/quoteSHA256/quoteLength及truncated。服务端只核对连续原文，不替换或归一化引文，不推断含义；不会产生部分draft或新设计。源要求为assumed时仍不得提交interpreted，契约明确允许保留assumed或省略status，拒绝消息给出room/rule/fromRoomId。

实际客户端已在已知合成案例使用requirements分页进行应用前审阅，并有客户端直接发起原生交付、审核PDF和链接的证据；仍有错误调用、非连续引文、假设升级尝试及测试轮数上限失败。有效最终模型、提交证明、交付阶段与整次可用性分开记录，详见[验证](requirement-review-client-validation.json)。这不表示任意自然语言、结构化多文档权威管理或独立工程验收已通过。

## 分段契约查询

`cad_engineering_task capabilities` 保留无筛选时的完整兼容响应。`section=summary` 读取类型简表；给出精确 `kind` 后，可用 `section=prepare/operations/data/reconciliation` 只取当前需要的部分。查询单操作须 `section=operations` 并传 `operation`；未知专业、未知操作或缺少必要范围会明确拒绝，不创建任务或启动 CAD。分段返回的准备/操作 schema 与完整响应中的对应项相同。

照明 `design` 新增可选 `expectedInputSHA256`，存在时会在计算和模型复用之前校验；原有仅传 `expectedRevision` 的请求保持兼容。空间规划继续执行原有必填输入摘要约束。


项目级只读审核：`cad_engineering_task action=project_review` 传 `expectedProjectId`、显式 `tasks:[{jobId,expectedTaskSHA256}]`、列表内的 `scopeTaskJobId` 和 `requiredKinds`。范围任务必须具有当前已发布共享空间包。`section=summary/tasks/spaces/issues`，按 `offset/limit` 读取全页，续页用 `expectedReportSHA256`；旧摘要或读取期间变化拒绝。报告按空间核对所需专业的当前设计/原生交付，列出漏项、重复任务待选择、过期来源、未确认操作与待审依据；未列任务/专业未知。覆盖率不代表规范适用、完整工程或人工签审；不触发重算/出图，不改原任务。

项目级待审包：先读 `project_review` 取得当前 `reportSHA256`，再调用 `project_review_package`，传相同 `expectedProjectId/tasks/scopeTaskJobId/requiredKinds`、新 `requestId` 和必填 `expectedReportSHA256`；此动作写入独立本地目录，不能在只读模式使用。返回 `entry` 为离线 HTML 入口，包含两类任务成果、空间覆盖、登记需求/条件/来源/标准及全部问题；包内复制登记成果并记录摘要，不自动复制标准全文或原始输入资料。复制后再次检查所有任务快照，变化则保留失败目录且不发布成功结果；同请求只校验后重用，不能覆写。上限10000个成果、2 GiB源文件；超限明确失败。旧包始终是历史快照，审核前重新查询当前摘要；覆盖完整也不代表工程验收或专业签审。

回路设计：普通照明生成器在原灯数/负荷分组已满足声明电流、载流量和压降限制时保留原分组；仅在超限时搜索固定灯具顺序的连续分组，先最少回路，再比较示意路径估长。保留灯位、灯具、线径、断路器、载流量假设和所有原限值，不自动改大线径或保护参数。每房间最多核算20000组候选；预算耗尽、固定供电声明冲突和该分组族无可行方案分别报告，不能外推所有安装方案无解。`model.circuitPartitioning`记录发生细分的房间及前后指标，审核HTML与CAD说明保留范围。该估算沿用既有保守示意路径和电阻压降公式，实际敷设、温升修正、短路与保护配合仍待专项验证。

声明路径条件：普通照明输入可选 `routingConditions`，`mode=declared_rectilinear_regions`；`allowedRegions` 和 `exclusions` 均为有 `id/min/max/sourceIds/status/description` 的轴对齐矩形，坐标毫米；根对象同样提供来源、状态和说明，以及必填 `clearanceMm`（1—5000）。允许区域取并集，禁入区向四周扩展声明避让距离；矩形边界表示中心线路径可达边界，不代表管线宽度或穿墙许可。固定灯具访问顺序下搜索各连接的最短正交路径，路径参与回路分组、长度及保守压降核算，E02绘制扩展禁入区边界；控制图仍为归属示意。网格最多20000点、最短路最多累计2000000次有效节点取出；不连通、端点越界和预算耗尽明确失败，不回退无约束连线。独立检查沿每条完整线段的区域边界分段验证，不能只检查端点。路径条件参与来源失效、冻结条件、空间变更逐项记录及假设保护；没有该字段的历史任务保持原模式。当前不核定三维高度/竖向长度、穿墙、防火封堵、管槽容量、共线回路分段标注和控制接线，实际安装及专业签审仍待验收。

## 路径区段表

带routingConditions的新设计附带routeSchedule：区段端点、回路及经过次数、分开的去重/累计长度和基本导体估量。deliver增加E06及续表、route-segments.csv；HTML审核页同步列出区段和估量。CSV沿用防公式转义，负坐标带单引号，程序读取时仅对完整数值字面量解码。三根L/N/PE基础估量不含控制线设计、核定竖向和管槽容量，不是采购或施工批准；原始路径每次重复经过均计量。缺失区段、篡改次数、数量及表格文字会使自检失败。实际验证与限制见[区段核算验证](route-schedule-validation.json)。

## 原文要求与设计条件双向核对

`cad_engineering_intake capabilities` 可用 `section=conditions` 查询 `intakeMode=conditions_only` 文件契约；默认仍返回原参数契约。新空间委托可只冻结壳体和物理条件，不先提供房间 program/relations；新照明委托可不预填 requirements，房间用途保留 unknown。原文解释随后通过同一 draft/read/commit 进入设计，正式任务中不保存 intakeMode 技术标记。原有完整输入方式保持兼容；两种格式都执行原几何/来源交叉检查、对照隔离与无导入历史限制。这里仍要求明确的结构化物理条件，不意味着从任意 CAD 自动识别现场条件，也不代表任意自然语言任务已能自动完成。

新建文档集默认fields_and_sources。cad_project_documents source_blocks按分页返回原文句段、位置与摘要；review.sourceCoverage逐段登记mapped/context/unresolved/conflict、targetIds和reason。未处置或未解决句段阻止审阅绑定；mapped必须有对应字段及相关原句。read_review section=source_coverage可读取完整处置。紧凑intake的parameters也接收sourceCoverage，可先形成blocked草稿、读取实际input目标后再补全。更新原文使旧映射失效，严格文档集及任务不能降级。

fields_only仅保留历史字段核对口径，不能冒称任务书完整理解。句段处置和数值字段自检仍需与独立语义判断、标准适用及工程审核分开。验证结果见[原文覆盖验证](source-coverage-validation.json)。

## 通用 Agent 下一步

`action=next_step` 使用现有任务身份，读取持久状态并返回 `phase/issues/next/snapshotSHA256`；只读，不执行 CAD。`next` 给出当前版本的工具调用参数，调用者为确认执行的操作补充新的 requestId，执行后重新查询。空间包可显式 `designBudget` 指定原有预算/单侧走廊族。来源过期、依赖冲突、未确认操作、输入或设计检查失败将阻断；返回待人工审核不等于需求理解、整项目或专业审核通过。工作流详见[通用 Agent 闭环](../skills/cadbridge-electrical/references/engineering-agent-loop.md)。

空间关系新增 `max_frontage_difference`：沿走廊方向的两房间净开间差不超过 valueMm，0 表示等开间；容差必须显式给出。求解、独立几何检查和图纸说明一致执行，原面积偏好不自动改变。该关系不表示相邻、等面积或任意空间长度方向，也不补齐缺失建筑条件。

## 已交付前置任务的显式证据

范围中的候选/dependsOn只声明计划。前置正式任务已完成当前来源审阅、设计检查、原生CAD与审核PDF后，可用 `cad_engineering_intake action=bind_scope_task` 传新的requestId、当前review、workItemId、task身份和expectedModelSHA256。契约由capabilities section=scope的bindTaskParameters查询。项目、专业、原文集合和当前模型均须一致；原文集合不一致的旧任务不能仅凭相似名称采纳。

绑定返回新的不可变review，保留previousReview与原记录；后续明确使用新ref。旧ref仍表示旧快照，不自动增加绑定，也不提供项目全局最新计划的推断。原文覆盖和前置证据均有效时，尚无有效交付绑定的候选可准备条件；旧绑定失效时须显式重新准备，不能复用旧正式任务。executionBindings区分delivered_for_review和stale；已有交付项不再建议重复准备。

每个绑定冻结输入、模型及全部前置证据摘要。前置换版会使范围快照中的下游绑定失效；仅重绑新的前置不能使旧下游绑定恢复，须有新的下游设计版本。冻结下游输入后，status/read/commit同样重新核对，不只在最后采纳时拒绝。历史值和图纸保持可读。带范围的输入采纳会将scope写入正式任务不可变manifest；直接prepare也可显式提供scope及同一documents。status返回executionScope，next_step遇失效前置返回SCOPE_EXECUTION_BLOCKED，invoke在创建新执行收据及进入适配器之前拒绝。底层照明设计/修订入口同样沿持久父任务检查，项目审核不计入被计划阻断的设计或交付。旧操作重放只读返回原收据及当前失效状态，不表示重新执行成功。前置换版后显式生成新范围、重新准备受影响任务；旧任务和图纸保持历史，不自动迁移范围。旧的未关联范围任务不追认范围约束，也不推断项目全局最新计划。检查不提供跨任务并发锁、语义完整性、专业协调或签审。该机制不自动理解任务、不推断共享模型关系，也不认证全部工程内容或专业签审。
