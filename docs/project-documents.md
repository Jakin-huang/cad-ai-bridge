# 多文档依据与跨任务保留

这是未发行源码中的共用能力，适用于 `ordinary-lighting` 和 `office-space-planning`。项目主体仍是 CAD AI Bridge；医院是隔离的回顾性样例，最终图只供评价。项目名称和类型标签不选择专业，也不改变计算或验收门槛。

## 已实现的范围

`cad_project_documents` 从配置输入根内的 UTF-8 `.txt` / `.md` 冻结原始字节。每份文档有独立 id、标题、版本标签、用途、原始字节摘要及文本摘要。文本仅去一个可选 BOM，保留换行；原始快照另存。`update` 提交完整新清单并引用当前 `set`，历史版本、引用和模型不覆盖。`current` 表示登记版本是否最新，不监视原始路径被外部软件改写；外部改版须显式登记。

用途包括需求、协调、标准摘录、建筑说明、产品资料、背景和 `evaluation_only`。用途及权威均由提交方声明，产品始终返回 `authorityVerified:false`。标准摘录不会自动成为已核验标准或替代现有 PDF/条款/适用性门槛。

对照项不提供正文、不接受生成引用、不进入生成依赖。相同文档集中曾经用于对照的身份不能改作输入；同一项目内登记过的对照原始/文本摘要也不能在另一个文档集中改作输入。已有输入摘要不能被倒置登记为对照。它是登记身份和相同字节的隔离机制，不能识别被重绘、改写或另一个项目未登记的派生内容，不能替代来源审查。

## 客户端流程

1. `create` 提交唯一 `requestId`、项目 UUID 和 `documents`。每份包含 `id/title/versionLabel/role/file/expectedRawSHA256`；返回 `set={jobId,revision,sha256,projectId}`。
2. `cad_engineering_task prepare` 顶层增加 `documents:set`。专业准备参数沿用原契约。此任务立即要求文档审阅，未绑定前不能设计；即使准备中断，已创建子任务也不能经旧照明入口绕过。
3. `read` 分页取各原文和元数据。`targets` 传原任务 `task={jobId,expectedProjectId,expectedTaskSHA256}` 和 `set`；沿 `nextOffset` 取齐服务端的真实输入字段；目标按顶层字段及数组条目展开，完整保留复合对象的值，不拆成每一个标量的独立引文。包含要求、用途、几何、物理条件、产品、电气参数、标准和缺项，客户端不能提交缩小后的目标清单。`brief` 保留兼容任务摘要作用，不替代各份原文。
4. 客户端解释原文，对全部目标提交 `review.decisions`。每项有 `targetIds/expectedValuesSHA256/disposition/reason/citations`。单目标直接复制服务端 `singleTargetValuesSHA256`；分组摘要是按 `targetIds` 顺序的 `[{id,value}]` 的递归键排序 JSON SHA-256。该摘要固定实际值，不替客户端选择或修改值。引文包含 `documentId/textSHA256/quote`，必须是该份原文的连续片段。每份非对照文档还须显式列入 `documentDispositions`，说明已引用、背景或未解决。
5. `unresolved` / `conflict` 保留原记录并返回 `ready:false`，不能绑定。`supported` 是客户端提交的解释，`assumption` 是显式假设；二者都不升级专业输入自身的证据等级。服务端不判断引文含义、自动选择更高优先级资料或认证全部需求已被理解。`ready` 只表示所列机械检查通过。
6. `bind` 传当前 `task/set/expectedInputSHA256/review` 和新请求 UUID。引用必须属于同一项目、同一任务、同一专业和同一完整输入。绑定只关联依据，绝不改工程值。`read_review` 按 `summary/targets/decisions/documents` 分页阅读记录；`current:false` 明确其来源或输入已经过期，旧 `ready:true` 也不能抵扣当前验收。
7. 文档换版或输入修订后，重新审阅并绑定。已有模型不能因重新绑定而恢复“当前”资格，须通过原专业修订入口产生新版本，再重新审阅、重算、复核和出图。模型历史记录保存本次绑定摘要；原输入、模型及交付文件保留。两个专业包和直接照明入口均检查这一门槛。
8. 查看 `cad_engineering_task status` 或照明 `status` 的 `documentEvidence`。只有新检查的 `current/inputCurrent/documentsCurrent/reviewReady/modelCurrent/eligible` 能说明该次读取时的状态。`get_job` 是保存快照，不能替代新状态核验。任务中心突出显示过期或需重算状态，停止提供不适用的“准备审核 PDF”操作；依赖图保留原文、逐字段解释和审阅关联，明确排除对照。

默认不带 `documents` 的已有任务保留原契约，未被悄悄转换成某个示例项目。分析包和未安装专业明确不支持此设计审阅入口。

## 验证及当前缺口

本轮使用已知合成照明和办公空间输入，测试冻结原文、完整字段审阅、冲突/缺项/伪引用、项目与任务隔离、资料和输入换版、旧模型阻断及重新计算。真实 MCP 协议另测两类任务来回切换和原文件保留。最终 417 项单元回归、54 次实际 MCP 调用、7 项任务中心 HTTP 检查通过；六个既有已交付任务的七次读取切换、149 项文件摘要和五次原 PDF 下载也通过。它们验证产品机制及已有确定性设计器，不是自然语言理解、独立客户或专业设计验收。

尚未验收：真实 AI 客户端独立解释本接口的多份新资料；任意资料中的需求遗漏、语义冲突与优先级判断；权威标准适用性与完整覆盖；PDF/扫描件原文提取；外部源文件变更自动发现；通用准备/绑定中断自动恢复；大规模真实项目中的预算与交互质量。现有总光照、布局、安装细节、跨专业和外部环境缺口也不因本接口而消失。

分项验证记录见 [project-document-validation.json](project-document-validation.json)。完整目标及阶段继续以 [engineering-design-plan.md](engineering-design-plan.md) 和 [engineering-design-progress.json](engineering-design-progress.json) 为准；M2—M4未完成，冻结 v2.0 包和 DLL 不重打包。
## 冻结条件与需求意图草稿

源码增量新增 `cad_engineering_intake`，供已有明确结构化条件的新任务准备使用，支持 `ordinary-lighting` 和 `office-space-planning`。医院仍只是隔离对照样例；项目名称、文件名和医院标签不选择适配器。未安装类型必须拒绝，不回落到照明。

先登记独立原文文档集，`inspect_baseline` 读取输入根内 JSON 的原始摘要，再以 `freeze` 保存原始字节、解析内容和逐项条件摘要。已有冻结身份可直接复用。已知几何、产品、供电或空间尺寸、假设等级、标准及原缺项由服务器保持；当前入口拒绝成图派生条件和带来源/修订历史的基线，已有修订任务继续使用原协议。摘要匹配不认证建筑或产品权威；经变换的未登记对照内容仍无法自动识别。

`capabilities` 按 kind 返回紧凑意图契约。AI 在 `draft.parameters` 中只提交用途和要求，或空间程序及关系，附具体原文连续引文、解释和全部文档处理意见；不重写整份工程输入或任意来源退役关系。照明规则值数组保留多个矛盾值，遗漏和未知变为阻断草稿，不沿用旧占位要求。`additionalPending` 仅追加，不能删除原待审项。单位、含义、局部替代及标准适用性仍由解释者与专业审核判断，服务端不会从文字自动决定。

草稿逐版保存在独立目录，可通过 `previousDraft` 关联，未采纳的草稿不建立正式任务。用 `read` 分页核对 `requirements`、`conditions`、`sources` 与 `summary`；ready 只说明已实现的结构与专业子集检查通过。`commit` 需精确草稿及输入摘要和 `reviewed=true`，重放装配后才准备一个正式任务，并通过原有文档审阅绑定门槛；该确认字段自身不是人工审核认证。空间包为兼容旧契约生成有明确标记的派生摘要容器，原始文档身份、引文和声明等级仍在独立台账，不能称为新原始权威来源。

每个冻结基线只能采纳一稿；阻断稿不会创建正式任务。同稿完成后的重试返回原任务；不同稿或中断状态禁止再建任务绕过。采纳前保存阶段收据，已执行但回包丢失时保留 `unconfirmed`，需核对原任务，不声称已具备所有失败阶段的自动恢复。任务中心将采纳显示为输入阶段完成，仍需进入原有设计、质量、原生交付、自检和人工审核流程。两个专业包继续各自的布局、计算和输出限制，分析任务及既有交付保持原契约。

本轮独立原文的真实客户端结果和机械集成回归见 [intake-draft-validation.json](intake-draft-validation.json)。合成双房间成功不能代替独立真实项目、外部用户、新机器或专业签审。

## 原任务上的项目图签修订

`cad_engineering_title` 在照明与办公空间规划两种任务中共用同一协议。出图前应核对实际项目名称是否来自当前原文，不能把准备输入的占位标题当成客户名称。先用 `inspect` 传原 `task={jobId,expectedProjectId,expectedTaskSHA256}`，取得 `expectedRevision/expectedInputSHA256/expectedTitle` 及当前文档集；读取需求或协调原文后，`revise` 传新 `requestId`、同一 `task` 和 `parameters={expectedRevision,expectedInputSHA256,expectedTitle,title,reason,evidence}`。每条依据含 `documentId/textSHA256/quote`，连续原句须包含完整新标题。标题仅一行；对照正文、产品名、规范名及文件名不能作为本入口的项目名称依据。字面包含检查不认证语义，仍须由解释者核对。

修订只改变完整输入的 `title`。已核验且值未变的字段决定、引文和假设等级保留，标题目标单独引用当前原文，重新审阅并绑定新输入；原始文件、旧输入/模型及输出不覆盖。旧模型、质量、图纸、审核和空间程序变为历史，须在原任务上重新设计、检查和出图。完成修订回执仅表示输入已准备，任务中心提供原任务入口，不显示为项目交付完成。上游空间程序因此换版后，下游仍执行既有失效检查。

`status` 传 `job-titlechange-UUID` 和原 `task`，只读返回阶段及 `currentTask`。新回执固定计划文件摘要；既有旧回执核对已登记的下载摘要，读取不会改写旧记录。同请求完成后重试返回原修订，状态不明则保留阶段并阻断，不换 UUID 或另建任务绕过。没有共享当前文档审阅的旧任务不能使用此入口；照明如有携带 `project_context` 的来源续用历史，须继续原来源修订流程，不能修改历史声明。

真实客户端在同一合成任务上完成两版原生图及五张审阅 PDF，初版标题内容问题保留；另有两专业包的实际 MCP 来回切换及既有任务回归。它没有证明完整自然语言空间方案、任意布局、标准适用性或专业出图完成。范围和失败记录见 [intake-publication-validation.json](intake-publication-validation.json)。
