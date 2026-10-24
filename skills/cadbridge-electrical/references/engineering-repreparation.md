# 来源换版后的重新准备

适用于已有 scope 的 intake 创建任务：原文集合换版，旧范围已失效，但原任务输入仍为初次采纳的修订0。这里生成明确关联前版的新任务，保留原项目、专业、工作项和原冻结物理基线；不改写旧任务，不继承旧模型或批准。已有输入修订、未确认操作、物理条件变化或来源集合切换不能借此丢弃，遇拒绝按相应修订流程处理。

先用 task status 核对原身份、当前 inputSHA256、修订和 pendingOperations。用 project_documents read/source_blocks 分页读取新旧原文，查 intake capabilities section=scope，依据新原文创建新的 review_scope，保留同一 workItemId、所有义务、原句和完整源段处置。未知条件或前置未完成保持阻断；不复用旧 review 假装来源当前。

查 intake capabilities section=repreparation，按完整 actionSchema 调用 reprepare：原 task 身份、expectedInputSHA256、新 documents、新 scope、reason 和 changed-source evidence。它不需要原始基线文件路径，也不允许改物理值。返回新的 baseline、frozenSHA256、reprepares 和 predecessorStatus；读回 conditions 核对原值。新的准备默认要求原文支持的 title/scope/notes 和完整 spaceIds。

按该 kind 的 intake capabilities section=parameters，依据当前原文重新解释全部逻辑要求/程序；不把旧输入当成新需求的答案。frozen 使用新的 frozenSHA256、理由和原文延续依据。先 draft，再 read section=source_coverage 取得逐段字面引用候选，自行决定对应关系；不明段保留 unresolved/conflict。修正稿带 previousDraft，读齐 conditions/requirements/presentation/input/sources 后，ready 且核对无误才 commit。commit 的 task 是状态响应，重新取 jobId/project.id/taskSHA256 组成后续身份，不能把整个响应作为请求。

新 task status 的 preparationLineage 及可下载 JSON 记录前版身份。按 next_step 与局部 operations 契约完成设计、自检、deliver 和 review_pdfs；每次新操作使用独立 UUID。状态不明先查原收据，不重做 CAD。旧任务保持来源/范围过期，历史图单独标明；新任务没有当前设计时不能沿用旧图作为成果。

报告当前 DWG、每张审核 PDF、前后版关系及未完成条件。重新准备、字面引用、几何或文件验证都不证明新条件的工程意义、现场权限、标准适用性或专业审核。此入口不支持同一形式任务内部迁移 scope，也不自动关闭被保留的失败。
