# 工程需求、设计与审核

目标是把项目资料解释为可追溯的设计约束，通过 CAD AI Bridge 新建、编辑、核对并交付待人工审核成果。当前 cad_design_project 仅实现明确边界的普通照明设计试验，支持利用系数法与有限IES直射逐点模式，不宣称通用工程推理、医院全专业设计、反射/UGR验收或专业签审。

源码增量提供cad_engineering_task通用任务入口（冻结v2包尚无）。先capabilities核对已安装适配器，明确task.kind后绑定项目UUID和任务摘要；后续invoke不得覆盖子任务身份。ordinary-lighting仍只调用原有照明能力，drawing-analysis只做来源绑定检查/计量；不能将未支持的任务套入照明，也不能把外层任务路由称为通用复杂工程设计。完整参数以当前连接器capabilities返回的契约为准；可安装Skill保持自包含。

## 解释输入

从用户提供的任务书、建筑条件、标准、产品资料和校审要求识别项目类型、范围、设计日期、房间功能、几何、目标照度、LPD、间距、回路容量、压降、安装高度与控制方式。project.sources 的每个来源必须记录 id、role、sha256 和说明。每条requirements精确字段是id、rule、value、roomIds（数组）、sourceIds（数组）、rationale（非空解释）、status（documented/interpreted/assumed）；不是kind、roomId或description。rule只使用工具枚举的target_lux/max_lpd/max_spacing/max_devices/max_circuit_watts/max_drop/control_mode/mounting_height/min_uniformity/max_avg_lux。用 requirement.sourceIds 追踪依据；明确区分 documented、interpreted、assumed。对照成图不得作为生成来源。建筑条件若从历史成图剥离，derivedFromFinalDrawing=true；不能称独立盲测。

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
2. design：传 jobId 和 expectedRevision。生成器采用明确几何和候选灯具，按所选利用系数或IES直射模式选择方案；检查器独立重算负荷、回路和控制关系。status=blocked 时读取问题，不继续出图。
3. deliver：仅使用 design 返回的 modelSHA256、jobId 和新 requestId。通过真实 CAD 新建图纸、布置带属性图块、独立重开核对、按图出 PDF/PNG，输出 CSV 和审核包。遇 delivery_unconfirmed 先读 status/native evidence，禁止换 UUID 绕过。
4. revise：以 expectedRevision、requirementId、value、reason、sourceId 记录需求变更；随后 design 重新计算。旧模型和交付保留，旧审核失效。设计变更采用模型重算重生成，不伪称现有全 CAD 语义的增量修改。
5. review：记录 simulation 或 unverified_external_record。模拟意见明确说明是测试；claimed_accepted 也不能变成已认证人工签审。status 可读取 summary/input/model/checks/delivery/review/history。

## 交付表达

提供工具返回的实际 DWG、PDF/PNG、计算/回路 CSV 和 HTML 审核包链接，说明设计范围、测得结果、假设及待审条件。利用系数法不是逐点照度、均匀度或 UGR 计算。普通照明配电模型声明不能证明短路、选择性或实际供电可靠性。图纸与清单基于同一设计模型，最终参考比较独立执行，不把照抄或相似度当正确率。


## IES 直射逐点模式

这是附加的有限计算模式。传入 photometricDesign={method:ies_direct_point,gridSpacingM,edgeOffsetM,boundaryModel:opaque_vertical_room_walls}，并逐房间补充有来源的 min_uniformity（Emin/Eavg，0—1之间）和 max_avg_lux（lx）。原有 target_lux 此时是维持直射平均目标，不能悄悄改写客户对总照度、均匀度或工作面的要求。未明确允许这种模型时需登记为假设/待审，不能代替正式总照度设计。

每个候选提供 iesFile={file,sha256}；文件必须位于已配置输入目录，sourceId 指向 role=catalog 且摘要相同的来源。支持 LM-63-1991/1995/2002、Type C、TILT=NONE，其他类型或补偿拒绝。按文件原坎德拉、倍率、rotationDegrees 和 maintenanceFactor 计算，不把光强强行归一化到任意流明。功率和相对光度声明灯泡流明必须匹配；晚于设计日期的文件声明发行日期会阻断。原始IES读取不证明Ra/CCT、产品可采购性或医院选型适用。

allowedRoomUses 可限定候选用途，schematicSymbol=panel/downlight 可指定图面示意符号。程序不替用户认证这些用途。产品功率、型号映射和源摘要见灯具CSV及说明页；逐点输出见 point-illuminance.csv，Eavg/Emin/Emax/Emin/Eavg见计算CSV和审核HTML。deliver前再次核对IES摘要；私有待审打包保存原始IES供审核，禁止把它放进源码或通用发行包。

当前网格不包含反射光、日光、UGR及复杂遮挡，点源远场适用性须复核；有障碍而没有高度时阻止本模式。有限网格搜索无解或预算耗尽不能说明现实工程不可能，保留理由并扩充经证据绑定的候选或输入条件，不暗中放宽目标、灯具输出或项目日期。


## 本机照明标准子集

先调用 `{action:"lighting_basis"}`，取得 configured、profileId、profileSHA256、sources、classes 和表格定位；configured=false 表示尚未配置，不能声称标准已核验。此只读动作返回摘要和解释指标，不返回完整标准或本机路径。标准全文、清单、交叉核读页图和配置只保存在用户本地资料区。

由维护者逐页核读后，通过 `scripts/import-lighting-evidence.py MANIFEST.json EXPECTED-SHA256 NEW-PROFILE.json` 导入新版本。清单须记录原PDF和公告页摘要、表所在PDF页及渲染像素摘要、独立核读表图摘要、来源URL、实施日期和分类解释。导入器核对字节/页图，**不自动认证数值转录或专业适用性**。配置环境变量 CADBRIDGE_ENGINEERING_LIGHTING_RULES 指向私有配置，或放在本机 dataHome/engineering-lighting-rules.json；禁止把这些资料提交到源码或用户通用包。换版使用新文件并复核摘要。

输入增加 `lightingStandards={profileId,expectedProfileSHA256}`；逐房间增加 `standardSpace={classId,classification,sourceIds,reason}`。classification 只能为 documented/interpreted/assumed，sourceIds 必须存在。project.standards 必须明确登记所选版本、来源SHA及生效日期。不可凭房间中文名称自动把“值班室”归为办公室、“示教室”归为会议室；缺乏功能依据时保留未分类并阻断。工作面冲突也必须通过有来源的条件修订解决，不能暗改原任务书。

有效最低照度和均匀度取任务/标准较高值，LPD上限取任务/强制性当前基准较低值；不自动使用小房间或照度级差上浮，也不把推荐目标值冒称当前强制限值。必须启用明确的直射逐点模式，声明Ra低于最低值的候选不能入选；Ra真实性、UGR、反射光、版本现行性及项目适用性仍待专业核对。源PDF、核读图或解释配置变化会在设计/交付前阻断，不能沿用旧模型。

当前控制图采用分组母线归属示意，开关分开且置于声明房间内；不等于现场敷设路线、开关线数或安装位置已经协调。


## 有限光源与漫反射复核

默认design以有来源IES直射网格预检；solve_lighting和optimize_lighting则以完整复核后的维持总照度选择候选，此时target_lux和max_avg_lux约束总平均照度，直射值仅作诊断。需要反射总照度时，在输入中显式登记 `lightingEnvironment={model:"closed_diffuse_rooms",geometry:"ies_rectangular_opening",sourceIds,status,description,rooms:[...]}`，逐空间声明 roomId、enclosure="closed_opaque"、floorReflectance/wallReflectance/ceilingReflectance（0—0.9）、sourceIds、status（documented/interpreted/assumed）和描述，必须恰好覆盖全部房间。反射率不是通用医院事实；没有装修表时只能明确作为假设。

维护者先独立核验官方Radiance运行时来源和发行摘要，再用 `node scripts/register-radiance-runtime.mjs TRUSTED-ROOT NEW-PRIVATE-PROFILE.json` 登记四个工具及完整lib支持文件摘要。配置 CADBRIDGE_RADIANCE_RUNTIME 或本机 dataHome/radiance-runtime.json。该脚本不下载、不认证发布者；私有配置和二进制不放进源码/通用发行包。

设计冻结后调用 `assess_lighting`，传 jobId、requestId、expectedModelSHA256。当前只接受IES原始正宽/正长、零厚度矩形发光面，采用均匀发光面近似；尺寸缺失、负编码、障碍高度缺失、发光面相交/越界或需要吊顶开孔时拒绝，不用猜测尺寸或点光源替换。灯具至少低于封闭顶面20mm，本模式没有真实门窗开口、内部遮挡、日光或镜面材质。当前上限10房间、100灯具、1000网格点；超限明确分区，不暗改网格。

复核保存有限光源直射及2/4/5次漫反射的四档结果，包含固定采样、环境插值、低权重射线的有界Russian roulette设置和命令记录。逐点两档变化须不超过1 lx加较大值的2%，平均变化不超过0.5 lx加较大平均值的1%；中/精两档都要满足冻结的最低照度、最高平均值和均匀度。该收敛观测不是严格误差界。不能把直射可行当作总照度合格，复核失败会阻断声明本条件项目的deliver。

`status` 可读取 lighting_quality；运行时显示当前房间/档次。报告、CSV、原场景/IES及逐档输出摘要被绑定，篡改会阻断读取/交付；需求修订使旧复核失效。UGR、真实发光面分布及产品条件、完整规范、专业签审仍须另验。

客户端中断后先读status与记录。只有已核实记录进程停止、模型一致，且原阶段为assess_lighting时，才可调用 `recover_lighting`（jobId、requestId、expectedModelSHA256）。它归档旧锁并保留旧计算目录，旧结果不复用，可在新目录另发复核；不认证所有子进程状态，不处理CAD创建/交付中断，也不重放CAD。活进程或无法核实的进程拒绝恢复；CAD交付仍按原不确定状态处理。


## 受保护种子的功能理解

`prepare_from_seed` 的可选 `functionalIntake` 让客户端补齐未确认功能，不必重写建筑或产品。逐房间提交 `{roomId,primary?,secondaryUses?,unresolved?}`；primary为 `{use,classId,reason,evidence:[{sourceId,quote}]}`，secondaryUses各项另带labelId；unresolved各项为 `{labelId,reason,evidence}`，主用途未解决时labelId=roomId。use仅支持ordinary-lighting既有枚举office/duty/teaching/corridor/pantry；classId只能从lighting_basis返回的本机源绑定类别中选择。引用与推理分开：quote必须逐字复制seed.brief中的原句，sourceId对应role=brief且SHA256与原brief的UTF-8字节一致。reason说明任务与类别之间的解释，不声称标准适用性已获确认。

只能补use=unknown且无standardSpace的主用途，或sourceSpaceLabels里尚未评估的secondary_use；已确认分类、别名关系、几何、工作面、表面、姿态、灯具和已有缺项不可覆盖。服务端自动把分类记为interpreted，兼用工作面继承种子、采用共同固定条件方法。确实不是共同条件或功能无法确认时必须unresolved，不得猜成office/meeting以通过。unresolved会形成持续阻断，即使其他数值约束齐全也不设计/出图。现方法只核对原句存在、源摘要及应用一致性，不自动认证语义判断正确。

先读取授权的brief/seed，用lighting_basis核对候选类别；引用原任务陈述，解释全部用途或保留未解项，再prepare_from_seed。通过status的input/functional_intake核对理解记录和缺项。只有prepared且输入完整时才继续solve_lighting/design；有共同用途或总照度条件时以完整物理/已请求UGR复核作为发布与交付门槛，直接诊断不是照明质量验收。不要通过prepare改写全项目来绕过种子保护。


### 准备后的精确只读调用

只读status只接收action、jobId、可选section，不能附加requestId、space、spaces、sections、include、view等字段。准备完成后，按返回的jobId各读取一次：

```json
{"action":"status","jobId":"job-design-返回的UUID","section":"input"}
```

```json
{"action":"status","jobId":"job-design-返回的UUID","section":"functional_intake"}
```

section只支持一个字符串，不是数组；功能理解没有spaceId等过滤参数。输入缺项时，blocked是明确结果，不是等待后台处理，报告问题后停止轮询。若工具拒绝参数，先核对本例，不轮流猜字段。只有已经启动、确在运行的物理计算才需要等待进度。

functionalIntake的secondaryUses和unresolved可省略或传空数组表示没有该类条目；整条房间记录必须至少有一项主用途、兼用解释或未决功能，不接受全空记录。不得用空数组抹去未评估的真实兼用功能，缺少它的评估仍然阻断。


## 任务书换版与重新确认

`replace_brief` 接收jobId、requestId、expectedRevision、expectedInputSHA256、briefFile（授权目录内UTF-8的.txt/.md）、expectedFileSHA256、sourceId（新且唯一）、supersededSourceId（当前任务书ID）及description。它先冻结原文件和文本快照，再保留旧来源SHA并建立替代关系；旧依赖约束/用途、模型、交付与审核立即退出当前版本，文件仍保留。不能在CAD保存不明或计算仍运行时换版。

换版后只读调用精确形式：
```json
{"action":"status","jobId":"job-design-返回的UUID","section":"source_changes"}
```
这里返回conditions，每项key/valueSHA256就是被冻结条件的身份。要继续设计，用`reconcile_brief`传jobId、requestId、expectedRevision和expectedInputSHA256，另传requirements（本次新增约束）、functionalIntake（新任务书原句对应的用途或未解项）及carryForwards。carryForwards每项精确为 `{key,expectedValueSHA256,reason,evidence:[{sourceId,quote}]}`：key和值摘要沿用查询结果，来源必须为当前任务书ID，quote逐字引用本版本明确要求保留对应条件的原句。它只确认值不变，不修改几何/工作面/表面/供电/产品等值，不把原假设升级为事实。

必须重新解释任务书依赖的全部目标与控制要求，不能因标准下限较低或旧图已经存在而沿用。只确认部分条件仍保持blocked；未知用途继续unresolved。原标准若错误引用旧任务书，不能用新任务书重新认证标准，需要正确的独立标准来源。旧缺项和说明保留待审，不能删除来过关。新任务确实修改几何或供电等条件时，当前carry方法不能替代权威条件修订，保持阻断。

reconcile_brief可分步补齐未知槽位，不能覆盖已绑定的新解释或独立来源要求；再次换版仍重新失效。成功返回prepared才用新revision/inputSHA继续solve_lighting；旧modelSHA及旧审核不能复活。重试同requestId只重放同一事务快照，后续版本已推进时拒绝旧重放，不重复生成。当前支持任务书版本，不宣称完整多文档或建筑/标准换版已实现。

source_changes.contract会返回当前reconcile_brief精简字段契约、要求项的rule/status枚举和单位，先按该契约构造，不凭经验猜kind/roomId等别名。


## 同清单建筑边界与入口换版

先inspect_architecture建立新版来源包。expectedRooms每项可加entryInstancePaths（完整原图对象路径数组）；TEXT/MTEXT/INSERT/POINT源position必须唯一、平面且在本房间边界，入口角色仍是声明，不能当成门宽或疏散认证。replace_architecture要求全部房间有来源入口及观察闭合边界，不接受推断替代。

精确字段为action="replace_architecture"、jobId、requestId、expectedRevision、expectedInputSHA256、architecturalPack={jobId,sha256}、supersededSourceId、description；新来源ID来自新包并须唯一。只支持相同房间ID/名称/附名用途清单；边界、入口、建筑线与附名源对象更新，其他冻结条件不改。若原建筑来源还承担要求、供电、产品、标准或功能分类，不能直接迁移这些引用，操作拒绝并等待正确专业依据。房间增删/功能变化、净高及电气等改值均不在此动作范围。

成功后旧模型/复核/交付/审核失效，使用新revision/inputSHA重新design或solve_lighting并生成全范围图纸，不能复用旧modelSHA。status精确用{action:"status",jobId,section:"architecture_changes"}，核对面积/入口前后差异与源对象；任务书沿用的历史原句不代表新建筑几何仍未变化。控制器重放不代表CAD中断恢复，真实专业审核始终待审。
