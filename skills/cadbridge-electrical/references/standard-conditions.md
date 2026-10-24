# 来源事实与标准类别条件

标准原文定义适用条件，不能证明项目现状。项目名称、表名、建筑图文件名和假设都不能自动确定事实。当前标准条件判断复用scope事实的boolean/number/text、明确单位、interpreted/assumed/unresolved及all/any三态逻辑；目前接入普通照明的导入类别，其他专业标准仍须各自实现。

通过`cad_design_project action=lighting_basis`读取已导入profileId/profileSHA256、classes和可选factDefinitions/when。这是来源核对过的标准子集，不是全套法规或法律适用结论。根据当前项目原文解释所需事实，使用定义的ID、类型、单位及条件中的类别代码；理由说明从原文到代码的解释，不能猜值。`review_scope.facts`保留原句，未知用unresolved/null，假设保持assumed；标准或背景不得充当已解释的项目现状来源。

任务是否属于委托范围，与某标准类别是否适用分别判断。原文完整但触发事实未知时，可保留明确的设计义务和候选类别，将事实保持未知；不能据此宣称类别适用、降低标准或把义务改成背景。intake仍需完整逻辑要求、候选类别与原文文字声明，经源段覆盖和读回后采纳；`next_step.standardApplicability`会报告active/inactive/unknown及所需事实。未知/假设或条件不符会阻断相应类别的设计，不自动换类别；缺少scope事实绑定也不凭输入字段或最新全局审阅补造。

带条件profile的任务data支持`section=standard_conditions`分页读取：basis元数据、fact/<ID>及decision/<序号>；沿hasMore/nextOffset读齐，用expectedDataSHA256固定同一快照。每页绑定当前输入和profile/事实来源；标准源、scope或原文变化会拒绝旧数据。旧profile未登记when的类别不补写规则，不能推定它们已完成条件/法规适用性核验。

日期、用途、工作面、产品及数值约束继续生效。类别条件active只说明声明逻辑成立；有效照度/均匀度取项目与标准的较严下限，LPD取较严上限，保留原项目数值；冲突不自动放宽。设计、复核、采纳、出图都会重查同一来源事实及标准证据。IES直射、反射、UGR、保护配合及专业签审仍按各自闸门，不能用条件active替代。

来源换版时保持原scope/任务历史。新原文必须有当前review_scope和新事实；无输入修订的原intake任务可按repreparation契约从原物理基线重新准备，旧任务不原地升级事实或继承模型/审核。原文仍未知就停止；有新明确依据才重新解释并完成设计/CAD/review_pdfs。每个presentation.text须完整包含在一条连续evidence.quote中，不由短引文拼接。
