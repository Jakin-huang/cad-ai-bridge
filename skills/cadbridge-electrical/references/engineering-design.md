# 工程需求、设计与审核

目标是把项目资料解释为可追溯的设计约束，通过 CAD AI Bridge 新建、编辑、核对并交付待人工审核成果。当前 cad_design_project 仅实现明确边界的普通照明设计试验，不宣称通用工程推理、医院全专业设计、逐点光度或专业签审。

## 解释输入

从用户提供的任务书、建筑条件、标准、产品资料和校审要求识别项目类型、范围、设计日期、房间功能、几何、目标照度、LPD、间距、回路容量、压降、安装高度与控制方式。project.sources 的每个来源必须记录 id、role、sha256 和说明。用 requirement.sourceIds 追踪依据；明确区分 documented、interpreted、assumed。对照成图不得作为生成来源。建筑条件若从历史成图剥离，derivedFromFinalDrawing=true；不能称独立盲测。

客户原始资料不足时，保留 missingInputs；阻断项阻止设计，允许产生草案的假设必须明示。不要虚构标准条款核验、IES、建筑底图、医疗用途分级或设备产品。公告只能证明版本/实施时间，不能证明条款内容已读。

## 执行动作

新项目先处理建筑条件：`inspect_architecture` 接收 requestId、drawing、expectedSha256、sourceId、sourceOrigin、inventoryOrigin、scope、boundaryLayers、labelLayers、expectedRooms；可提供 geometryLayers、ignoredLabels 和 inferRectangles。scope.rootHandles 是所选布局的根实体句柄，不能填定义内部句柄。先通过根层查询定位建筑块；所列空间同名时用 labelInstancePath 区分。

boundaryLayers 声明的是明确房间边界图层，必须是可验证闭合直线多段线；曲线、开口、重叠、遗漏和未展开外参会阻断完整性结论。geometryLayers 是需要绘制的背景几何，未支持的背景对象保留在捕获中并列为待审。ignoredLabels 必须逐个写排除理由。inventoryOrigin=source_labels 只能说明来源标签清点，不是独立项目空间表。sourceOrigin=historical_final_drawing 必须保留历史成图派生标记。

返回建筑包 jobId、packSHA256、覆盖和问题清单。不能仅凭 ok=true 继续：还须核对 coverage.completeInventory / geometryComplete 与 status。若明确允许矩形推断，也不能将 inferred 改称实测边界。

将建筑包传给 prepare_from_seed.architecturalPack={jobId,sha256,acceptInferredGeometry}，本地 seed.rooms 只需房间 ID、名称、功能、入口、净高、工作面和来源等条件，polygon 与 architecture 由已登记建筑包按摘要合并。来源的 role=architecture、SHA 和派生标记必须匹配；默认拒绝推断几何，允许推断也不能绕过遗漏或重叠。设计模型和审核报告保留建筑包与源捕获摘要。

平面保持真实毫米坐标，按范围选择 A3—A0 与固定比例；房间编号显示在平面和计算表中。大于支持范围时明确要求分区，不通过缩小模型几何塞进图框。该功能不证明整层空间用途、入口、吊顶、真实光度或专业签审已经确认。

数值单位固定：target_lux 为 lx，max_lpd 为 W/m²，max_spacing 和 mounting_height 为 m，max_devices 为数量，max_circuit_watts 为 W，max_drop 为百分数数值（3% 填 **3**，不填0.03）。control_mode 只接受 **local**（房间就地）、**regional_manual**（区域集中并具备手动操作）、**occupancy_manual**（感应且可手动）。不要猜测 centralized、group 等其他取值；明确区域集中要求应使用 regional_manual。

1. prepare：传 requestId 和 project，检查返回 issues/status。每个房间需要 target_lux、max_lpd、max_spacing、max_devices、max_circuit_watts、max_drop、control_mode、mounting_height 八类有来源的约束；同类冲突不静默覆盖。
   已有本地 project-seed.json 且 requirements 为空时，优先用 prepare_from_seed：传 requestId、seedFile、expectedSeedSHA256 和解释出的 requirements。建筑条件、产品和来源保留在本地按摘要加载，不必由模型重新输出整份几何。仅接受配置图纸目录内的 JSON；摘要变化、外部路径或已有约束的种子均拒绝。
2. design：传 jobId 和 expectedRevision。生成器采用明确几何、候选灯具和利用系数法选择方案；检查器独立重算负荷、回路和控制关系。status=blocked 时读取问题，不继续出图。
3. deliver：仅使用 design 返回的 modelSHA256、jobId 和新 requestId。通过真实 CAD 新建图纸、布置带属性图块、独立重开核对、按图出 PDF/PNG，输出 CSV 和审核包。遇 delivery_unconfirmed 先读 status/native evidence，禁止换 UUID 绕过。
4. revise：以 expectedRevision、requirementId、value、reason、sourceId 记录需求变更；随后 design 重新计算。旧模型和交付保留，旧审核失效。设计变更采用模型重算重生成，不伪称现有全 CAD 语义的增量修改。
5. review：记录 simulation 或 unverified_external_record。模拟意见明确说明是测试；claimed_accepted 也不能变成已认证人工签审。status 可读取 summary/input/model/checks/delivery/review/history。

## 交付表达

提供工具返回的实际 DWG、PDF/PNG、计算/回路 CSV 和 HTML 审核包链接，说明设计范围、测得结果、假设及待审条件。利用系数法不是逐点照度、均匀度或 UGR 计算。普通照明配电模型声明不能证明短路、选择性或实际供电可靠性。图纸与清单基于同一设计模型，最终参考比较独立执行，不把照抄或相似度当正确率。
