# 条件义务与执行范围

2026-10-24，本轮增加通用条件义务判定，接入原文范围审阅、准备条件、任务执行、前置绑定和依赖校核。医院、学校、办公不参与逻辑路由。冻结 v2.0、现有发行包及旧图纸保持；本轮为源码增量，不重打包或提升版本验收等级。

`engineering_intake review_scope` 可选提交顶层 `facts` 与 `workItems[].when`。事实包含 ID、boolean/number/text 类型、值、状态、理由及字面来源；数字事实和比较必须显式使用相同单位，不自动换算。`interpreted` 表示调用者解释，不能冒充独立核验的事实或权限；`assumed` 和 `unresolved` 不确定适用性，未解决值必须为 null。项目现状的 interpreted 引文只接受 requirements、coordination、architecture_notes、catalog；标准或背景不能证明现场状况。evaluation_only 仍禁止作为输入。

when 采用 `mode: all|any` 与 conditions 数组，每项包含 factId、operator（eq/ne/gt/gte/lt/lte）、value 及数字 unit。它是有界的声明逻辑，不执行任意代码，不推断数值或理解法规。all 中明确为假的项足以使条件不成立，any 中明确为真的项足以触发；其余保留 unknown。缺 when 的旧义务维持 active，旧记录不补写默认字段或重算身份。

义务的 disposition 与适用性是两件事。unsupported 可以同时 unknown；candidate 也可能 inactive。只有 active 候选在来源当前、原文覆盖完整、前置交付有效且尚无当前绑定时才可准备。inactive/unknown 不改成 context，不计作交付、批准或专业通过。义务含义已明确、但触发事实未知，可以保留有条件的已解释义务；义务本身仍不明时继续用 unresolved/conflict。sourceCoverage.complete 只说明原文块是否登记，不证明这些条件已解决。

dependsOn 默认要求当前交付证据，inactive 前置也不能自动略过。只有原文允许独立推进时，才可为该依赖边提供 `allowInactiveDependencies: [{workItemId, reason, evidence}]`；目标必须是已声明的有条件前置。unknown 不接受这种豁免。豁免摘要冻结来源、条件、事实和依赖边，不伪造前置的交付摘要。绑定仍需实际模型、当前原文、检查、CAD 交付和审核 PDF，所有专业标记保持未批准。

`read_scope_review section=facts|applicability` 分页读回声明及判定；summary 的候选包含 applicability 和实际可准备状态。带 scope 的正式任务在 prepare、status、next_step、invoke 以及底层受约束入口重新校验；新来源使旧任务失效，新执行在创建收据及进入专业适配器之前被拒绝。历史条件在原快照中保持原判定，不根据后来文件改写。新解释创建新 review，受影响工作显式重新准备；本轮没有实现同任务自动迁移 scope，也不追认未关联 scope 的旧任务。

本轮有两类不同证据：

- **真实 Agent 原文理解**：使用已冻结的七页 UNDP 2021 公开办公委托，未提供答案、建筑基线或最终图。Agent 读取全部296块，最终登记90项义务/背景、9个未知事实、19项未知条件义务；报批是否需要和客户批准后深化两个原有锚点均保持 unknown。18块原文仍未解，两个候选均不能准备，没有虚构 CAD。69次调用中出现一次 ID 格式错误后自行修正，全过程零错误门槛不通过。该原文已用于开发，不能改称新的盲测或独立专业评分。
- **控制脚本的真实 CAD 闸门**：一个合成办公室，未知条件阻止准备；明确的新合成来源触发后，同一正式任务完成估算设计、CAD 保存重开和五页审核 PDF。来源再换版后任务失效，新的 deliver 被拒绝，图纸作为历史保留。五页严格解析、像素与图面文字核对及逐页查看通过。脚本前两次错误分别为误用 commit 的响应包装、将 prepared 状态误写为 ready；均发生在设计前，修正后继续原零执行任务，失败报告未覆盖。这不是 Agent 自主设计该办公室的证明。

全量回归605项通过，0失败、0跳过。开发及上述本机子集验证已完成；完整语义、真实现状/授权、标准适用性、复杂设计质量、跨模型稳定性、独立客户、新机器与专业审核均未据此通过。独立原委托没有足够建筑条件，合成图不能替代其工程交付。详细摘要见[验证记录](scope-applicability-validation.json)，资料、原始调用、图纸和失败版本仅保存在本地资料区。

下一优先级保持收敛：验证来源条件改变后实际受影响专业任务的采用与重算；完善原文说明的适用性及冲突审阅；再用独立输入评价遗漏和协调质量。暂不扩充新的项目专用模板或专业包。M2—M4及复杂工程总体目标仍未完成。
