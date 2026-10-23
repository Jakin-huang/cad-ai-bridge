# 通用工程 Agent 闭环

适用于完整工程委托和已准备任务的恢复。普通图纸编辑仍使用通用工作流。医院、学校、办公只提供不同需求和专业规则，不决定工具路由。

## 从资料到任务

先保留客户要求的范围和交付物，区分原文、现状条件、允许推导、明确假设和最终对照。查 cad_engineering_task capabilities section=summary 选择实际支持的 task.kind，再按需查询该包的 prepare/operations 小型契约。未支持的工作留在项目范围/问题清单，不改成背景以取得通过。

原文由 cad_project_documents 冻结。尚无设计条件时，可通过 cad_engineering_intake review_scope 保存需求、证据、依赖和缺项。已知物理条件使用 conditions_only，不预填房间程序或照明要求；随后由 Agent 引用原句提交 draft，读回实际条件/要求/输入再 commit。完整格式见工程需求参考。数值、用途、标准适用性和设计选择由原文及工程条件支持；服务端派生的摘要与版本身份直接使用返回值。

## 按当前状态执行

保存返回的 task 身份：jobId、expectedProjectId、expectedTaskSHA256。这些与原文/草稿/设计版本和操作收据共同构成持久状态；模型切换或会话恢复后重新读取，不靠聊天摘要构造新任务。

调用 cad_engineering_task action=next_step，传该身份。空间包若需要已支持的靠边单侧走廊，显式传 designBudget.corridorMode=allow_single_sided；其他预算字段按 capabilities 及项目要求设置，不能因无解而放宽设计阈值。返回：

- phase=design/analysis/quality/delivery/review_pdfs：核对 next.arguments 与当前委托相符，为这一次操作生成新 requestId 后调用 next.tool；完成后再次查询 next_step。
- phase=blocked：读取 issues。过期来源先完成来源审阅/模型重算，缺项和矛盾用原文修订输入，设计不满足则检查失败对象和候选/质量结果。LAST_OPERATION_FAILED 包含原操作和失败原因；先解决原因。只有原记录明确 not_applied 且无未确认操作时，才可在问题已修正后按能力契约新建操作；next_step 不自动重试。不要猜测条件、改低要求或循环轮询同一阻断状态。
- phase=awaiting_human_review：整理当前成果与待审问题。它只说明当前支持流程已到交付末端；还需核对委托交付清单、图面可读性、需求覆盖和工程缺项，不能据此宣称完整项目或专业签审。

next.arguments 不含 requestId；该操作确认开始后必须保存其 UUID。超时或回复丢失时先用原身份 status 读取 pendingOperations/lastExecution；未确认操作不得换 UUID 重做。next_step 是只读建议，后续实际 invoke 仍校验来源、版本与状态，期间变化会拒绝旧建议。

## 检查、修正与交付

每次修正保留失败版本，明确改变的要求和允许设计变量。专业包的修订接口会生成新来源身份，物理值相同也不代表 sourceIds 应相同。采用返回的新版本继续；不能删除来源链来通过对象比较。

相同错误和相同输入不产生进展时停止盲重试，改查具体问题。未知结果先恢复状态；真实缺失条件保持未完成。需要大幅新增专业/改产品代码时如实说明当前能力边界，不在工程任务中自行安装、编译或篡改桥接器。

交付核对当前 DWG、各张 PDF、计算/表格及已声明交付物；用实际图面检查发现遗漏、遮挡、字体和说明错误。多专业任务显式关联共享空间版本，变更后重新检查受影响任务；仅状态隔离通过不等于协调设计通过。项目待审包可用既有 project_review/project_review_package，前提是已发布共享空间范围及明确的任务列表。

报告分别说明：需求解释、计算/几何检查、原生 CAD、图面审查、独立项目可用性和专业审核。原文义务已登记不等于已实现，自动检查通过不等于专业合规。医院最终图只在设计冻结后的隔离比较中使用。

## 已交付前置任务的显式证据

范围中的候选/dependsOn只声明计划。前置正式任务已完成当前来源审阅、设计检查、原生CAD与审核PDF后，可用 `cad_engineering_intake action=bind_scope_task` 传新的requestId、当前review、workItemId、task身份和expectedModelSHA256。契约由capabilities section=scope的bindTaskParameters查询。项目、专业、原文集合和当前模型均须一致；原文集合不一致的旧任务不能仅凭相似名称采纳。

绑定返回新的不可变review，保留previousReview与原记录；后续明确使用新ref。旧ref仍表示旧快照，不自动增加绑定，也不提供项目全局最新计划的推断。原文覆盖和前置证据均有效时，尚无有效交付绑定的候选可准备条件；旧绑定失效时须显式重新准备，不能复用旧正式任务。executionBindings区分delivered_for_review和stale；已有交付项不再建议重复准备。

每个绑定冻结输入、模型及全部前置证据摘要。前置换版会使范围快照中的下游绑定失效；仅重绑新的前置不能使旧下游绑定恢复，须有新的下游设计版本。冻结下游输入后，status/read/commit同样重新核对。带范围的输入采纳会将scope写入正式任务不可变manifest；直接prepare也可显式提供scope及同一documents。status返回executionScope，next_step遇失效前置返回SCOPE_EXECUTION_BLOCKED，invoke在创建新执行收据及进入适配器之前拒绝。底层照明设计/修订入口同样沿持久父任务检查，项目审核不计入被计划阻断的设计或交付。旧操作重放只读返回原收据及当前失效状态，不表示重新执行成功。前置换版后显式生成新范围、重新准备受影响任务；旧任务和图纸保持历史，不自动迁移范围。旧的未关联范围任务不追认范围约束，也不推断项目全局最新计划。检查不提供跨任务并发锁、语义完整性、专业协调或签审。该机制不自动理解任务、不推断共享模型关系，也不认证全部工程内容或专业签审。


空间关系 `direct_door` 表示房间间直接门洞，valueMm为最小净宽，必须显式提供lockable布尔值；不得把shared_wall或max_door_route当成直接通行。只搜索同侧矩形房间的完整共墙隔断；按项目门宽生成洞口、两侧接近净空和门扇，检查家具/座位与已有门扇干涉。原走廊门保持，路径约束仍沿原走廊计算；不表示专用安全入口。模型、两张平面、门表CSV及共享空间entries保留该连接；硬件、防火、无障碍及施工审核保持待审。没有直接门关系的原方案输出不增加门。


输入准备的 `read section=input` 返回真实输入字段目标ID，不是section=targets。draft后可用 `read section=source_coverage`（必传该draft）分页核对原文块、blockSHA256、已提交处置和literalCitationTargetIds。候选只表示当前草稿中已有supported/assumption决定的字面引文匹配该原文块，最多返回100项并给出总数/截断标记，不自动判断语义、不选择mapped/context、不补写引用或工程值。由Agent根据原文义务选择恰当目标；没有匹配时修正对应解释/引文或保留未解，不能靠猜索引、删除要求或把未知工程义务改为背景放行。沿nextOffset读齐；历史草稿仍可读但eligible及documentsCurrent可能为false。


`cad_engineering_task action=capabilities` 是全局能力查询，只传kind/section/operation等该动作字段，不带jobId、expectedProjectId或expectedTaskSHA256。准备得到的task身份用于status、next_step、invoke等绑定任务动作，不能把身份对象合并进capabilities。操作契约查询示例：`{action:"capabilities",kind:"ordinary-lighting",section:"operations",operation:"design"}`。
