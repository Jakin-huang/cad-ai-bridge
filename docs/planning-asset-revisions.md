# 同任务物品和保留条件修订

这是未打包的源码增量。既有物品求解、来源审阅、通用任务收据与 CAD 交付继续使用原机制，未增加按医院、学校或办公名称分支的设计逻辑。

`revise_program` 不接受 `assets`：旧契约曾允许传入而执行时忽略，这会使调用者误以为修改生效。现在物理清单变化必须显式调用 `cad_engineering_task` 的 `revise_assets`，完整契约以 capabilities 为准。

## 来源及变更记录

提交当前 expectedRevision、expectedInputSHA256、完整 assets、新 brief、reason，以及 documents 和逐项 changes。documents 必须是原任务绑定的同一项目、同一文档集较新的当前版本，不能拿其他项目或旧版本替代。

每个新增、更新、删除的物品恰好对应一条 change，包含 assetId、kind、reason、evidence 和 retentionAction。更新和删除还需原物品的 expectedAssetSHA256；可直接使用 project_documents targets 对应 assets 行的 valueSHA256。未变物品不允许偷偷改来源，不能遗漏清单项而不声明删除。

evidence 包括 documentId、textSHA256 和连续原句 quote。引用须含独立的物品 ID，来自新加入或内容变化的 requirements、coordination、architecture_notes 或 catalog 文档。新增/更新还须引用新物品的 evidenceQuote。原 assumed/unresolved 等级不能在本操作中升级；新 brief 仍须保留所有未变工程条件的原句。

retentionAction 按实际变化为 unchanged、establish、relocate、release 或 remove。原来或新设置为固定的物品发生改变，还必须引用变化后的 coordination 或 architecture_notes；固定位置/朝向或所属空间改变须显式声明 relocate，解除固定须声明 release，删除须声明 remove。笼统需求、旧文档或单个同意字段不能替代这项证据。来源身份和原句只证明可追溯，**不证明签发者权限、变更语义正确或专业许可**。

## 修改后的闭环

1. 在原任务读取新旧原文和当前 targets，核对原值、尺寸、净空及变更引用。
2. 调用 revise_assets。只改物品及需求来源绑定，房间程序、壳、参数、原缺项等保持；新修订对已有项目文字要求显式presentation重审：名称、描述性范围和空间清单保持，说明按变更后条件重新判断；原句仍在旧原文中存在不等于仍适用。旧历史保留原重建规则。
3. 新输入退出旧模型、交付、PDF 审核、共享空间和审查记录的当前状态，旧字节保留。此时设计仍被来源审阅门槛阻断。
4. 对新输入/新文档集重新 draft_review、分页 read_review_draft、commit_review 和 bind。旧清单被新协调文替代的原句须明确作为历史背景处理；不把假设改成事实。
5. 来源绑定 eligible 后，重新 design、deliver、review_pdfs。独立物品审计、原生保存重开、CSV、图面名称/范围/说明及全部审核页均需重新检查。

通用操作收据提供完全相同请求的重放；输入发布阶段中断保留 unconfirmed，不允许换 UUID 重复修改或继续 CAD。修订记录包含旧/新输入摘要、来源版本、逐项变更和原审阅身份，历史加载会重建验证。当前只做完整有界重算，没有承诺最小局部重排；没有推断物品的机电接口、性能、完整维护路线或专业批准。

## 验证与边界

验证使用三个开发程序的共享实现及一个真实 Agent 的办公任务接续，结果见[验证记录](planning-asset-revisions-validation.json)。办公案例从原图到新图保持同一正式任务，仅两项明确尺寸发生变化，固定柜保持原坐标；旧输入、模型、图纸、原始审核及失败调用保留。

这不是三个独立客户项目验收，也不是复杂医院/学校工程设计完成。真正的固定设备迁移、物品删除/新增只由本机负向和来源约束测试覆盖，尚无对应真实 Agent/CAD 正向验收。人工权限确认、未知委托的语义完整性、新机器、外部用户和专业审核继续单列；实际客户端的自行纠错不得改记为全过程零错误。

后续[变更审核与固定冲突验证](asset-review-and-conflict.md)已补充SP07/JSON/CSV、固定包络阻断及项目说明重审；原验证记录保持其当时范围，不追认后续门槛。
