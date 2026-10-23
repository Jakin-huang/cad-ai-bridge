# 原文到图面文字一致性

普通照明和办公空间规划共用 `parameters.presentation`。Agent负责从实际原文识别项目名称、描述性范围和项目说明，程序负责原文身份、连续引文、空间覆盖及输出一致性。医院、学校、办公名称不参与路由。

新 `cad_engineering_intake freeze` 默认要求文字声明。`draft` 参数中，`title`、`scope` 和 `notes` 每项包含 `text`、`reason`、`evidence:[{documentId,quote}]`；另提供 `spaceIds` 与 `reviewed:true`。名称1—80字符，范围20—1000字符，说明1—8条、每条10—500字符；每段为单行正文，必须完整出现在对应连续引文内。名称仅使用需求或协调原文。声明不是自动摘要，不从文件名或对照图推断。

`spaceIds` 必须恰好等于该任务全部房间或程序ID，不得漏项、重复或加入未设计空间。说明页同时列出模型中实际空间名称和ID；描述性范围不改变物理模型、已绑定的范围依赖或专业能力。经证明的名称/描述性范围可以替换基线占位文字，其他物理、产品、供电、数值、标准、假设和原有待补条件保持。

先提交草稿，再读取 `section=presentation` 对照基线与声明；结合 `summary/conditions/requirements/input/sources/source_coverage` 和原文核对，修正沿 `previousDraft` 留存。遗漏声明保持阻断稿，不创建正式任务。所有既有源段覆盖、一次采纳、当前来源及任务身份检查继续有效。

设计后的独立检查逐页核对完整图签，并核对说明页的范围、空间列表及全部项目说明。来源版本、字面证据或模型绑定不符时不能继续生成合格当前模型。原生CAD保存重开继续核对图面实体；审核PDF另做严格解析、标题/正文检查与逐页目视。格式通过不能替代内容检查。

旧冻结记录不追认新策略。`requirePresentation:false` 是明确保留的旧协议入口，不能把它称为文字审阅通过；旧无声明输入亦不追认为已验收。已有任务换版继续使用明确的输入/来源版本流程，本次不认证任意历史任务自动迁移。不要修改旧DWG/PDF冒充重算结果。

当前验收限于有原文证据的声明与实际图面一致。选择过于概括的范围原句、资料本身不完整、遗漏委托义务和专业适用性，仍需独立语义与工程评审。本次两类已知开发案例的结果、失败和限制见[验证记录](drawing-presentation-validation.json)。

## 同一正式任务的原文文字修正

新流程补齐了采纳后的同源文字修正：查 `capabilities section=presentation_revision`，再用原 `task` 身份 `inspect_presentation` 取得当前版本、输入摘要、原文集和实际空间。支持旧输入尚无声明或已有声明的任务；只校正同一有效原文集支持的项目名称、描述性范围和项目说明，不修改房间程序或工程条件，不以新任务代替修订。

`draft_presentation_revision` 提交唯一 `requestId`、原 `task` 和 `parameters:{expectedRevision,expectedInputSHA256,presentation,sourceCoverage?}`。所有草稿仍针对当前正式输入；预览新摘要仅用于最终采纳。`read_presentation_revision` 给原task及draft身份，分页读取 `input/source_coverage/presentation/summary`。字面引文候选只供Agent核对；缺覆盖留阻断稿，不替Agent选择源段语义。修正带 `previousDraft`，旧稿保留。

就绪后用 `commit_presentation_revision` 给新UUID、原task、最终draft、预览的 `expectedInputSHA256` 及 `reviewed:true`。系统核对当前原文与输入，保存输入修订、来源审阅、绑定各阶段收据，版本恰加一。确实未变的字段决定及假设级别保留；旧模型、质量、交付、审核及共享空间退出当前但留历史。随后在同一task重算设计、检查、CAD交付及审核PDF。若结果不明，查看原收据与任务，不改UUID重复修订或新建任务；未完成新来源绑定不能设计。

收据可通过 `read_presentation_revision section=summary` 的 `items[0].commit` 只读取得：未采纳为null，已开始或结束返回status、phase、error及审阅引用。`unconfirmed` 必须结合原task状态检查；完成采纳只表示input_prepared，不代表后续设计/出图完成。已采纳的稿因正式输入已推进，eligible为false，仍保留历史可读。

已有图面声明的任务不能通过旧标题或范围单字段接口留下不一致的新输入。来源换版、实际工程范围/程序变化和冻结 `project_context` 的续用历史仍走原专门流程；这里没有自动迁移任意旧项目的承诺。两个真实客户端的同任务R0→R1验证、照明的两次被拒映射与自行恢复、旧成果保留见[换版验证](presentation-revision-validation.json)。
