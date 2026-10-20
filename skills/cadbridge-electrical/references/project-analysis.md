# 项目、计量与验证

一个多图项目调用 cad_project(action=start, requestId, items)。每项提供 id、drawing、plan；plan 沿用 cad_workflow。可提供 expectedSha256 防止源图身份变化。所有图先冻结，再按 failurePolicy=stop（默认）或 continue 顺序执行。start 返回排队信息，不代表完成；用 action=status 查看逐图结果，list 查看项目列表。

cancel 只在图与图之间停止，当前 CAD 操作保存及留证后才停止后续项。resume 核对保留子结果的文件摘要，只继续未开始项；blocked、状态不明或输出已变更时不重做该写入。修改失败不换 UUID 绕过。项目不是跨 DWG 原子事务，各图单独保留结果。

出图失败且 DWG 已保存时，cad_project(action=reexport, jobId, itemId, requestId) 只重导原失败项；names 可缩小为失败出图名的子集。它验证保存 DWG 的 SHA，使用新只读工作流，不重做编辑，也不抹去原项目失败记录。结果和重导历史分别交付。

cad_scan_drawing 取得完整冻结查询后，可用 cad_analyze(captureJobId, checks, quantities)。分析不启动 CAD；expectedResultSha256 可绑定已有查询记录。截断或读取错误不能形成完整检查/总量。单次最多 300000 次实体与规则组合，必要时缩小筛选或分批。

checks 支持：duplicate_attribute(tag)、required_attributes(tags)、forbidden_text(text)、allowed_layers(layers)、minimum_length(minimum,unit=mm|drawing)、text_height(minimumMm,maximumMm)。每条带唯一 id、可选 filter、severity 和 authority。authority 是明确给定的规则来源，不由模型编造法规或标准合规结论。

quantities 每条提供 id、version、measure=count|length，可设 filter、meaning=drawing_occurrences|installed_rule|procurement_rule、factor、wastePercent、roundUpTo 和 authority。长度 unit=mm|m。数量来自实例出现次数；安装或采购含义来自明确规则，不能从块名自行认定。单位未知或只有 definition_length 时，长度缺项保留为 partial，total=null；partialSubtotal 只是可测部分。图例、重复视图、外参及筛选范围须明确。

检查和计量输出带源 DWG SHA、handle、instancePath、layout，可从 CSV 或 cad_read_result(kind=issues|quantityRows|quantityResults|checkResults) 分页追溯。把问题定位到具体实例，不用只含总数的答复掩盖缺项。

verification.levels 分 execution、source、saved、reopened、geometry、preservation、render、visualReview、delivery；状态为 passed、partial、failed、unknown、not_applicable。requiredSatisfied 只指声明的机器检查。几何未覆盖项、厂商内部语义、字体/视觉、外部用户与效率验收不能从 ok=true 推断。旧结果没有分级证据时显示 unknown。
