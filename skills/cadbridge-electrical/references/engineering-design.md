# 工程需求、设计与审核

出图前核对图签项目名与当前原文一致，种子结构的说明文字不能直接当成已完成设计的项目名。来源绑定任务可用 `cad_engineering_title inspect` 传原 task 身份，取得 expectedRevision/expectedInputSHA256/expectedTitle/documents；通过 cad_project_documents read 读需求或协调原文，自己解释项目名称，不从文件名、产品/标准标题或对照图猜。`revise` 传新 requestId、同 task、parameters{expectedRevision,expectedInputSHA256,expectedTitle,title,reason,evidence:[{documentId,textSHA256,quote}]}，quote 必须是连续原句并包含完整新 title，title 仅一行。

该操作只修订标题，逐项保持其余输入；沿用原正式任务生成新版本，旧模型、图纸、质量和审核退出当前且保留。未变字段的原审阅决定按实际值摘要保持，标题另给原文证据并重新绑定；完成只是新的 prepared 输入，之后仍需按当前 revision/inputSHA256 设计，再用新 modelSHA256 交付和准备审核包。不要另建任务或直接改旧 PDF。`status` 用返回 job-titlechange 身份和原 task 核对；状态不明停止并读收据，不能换 UUID 重做。照明存在冻结 project_context 来源续用历史时本入口拒绝，继续原来源修订协议；此边界不能改成强行更新历史摘要或放宽其他门槛。

已有结构化已知条件时，优先使用 `cad_engineering_intake`：`inspect_baseline` 只读取得输入根内 JSON 的原始摘要；`freeze` 关联当前文档集和项目/任务，固定几何、物理、产品、尺寸与原缺项。若调用上下文已给出 baseline/frozenSHA256，直接复用，不再次冻结或新建任务。`capabilities kind=...` 读取小型解释契约。

用 `draft` 提交原句支持的逻辑解释：`frozen.expectedSHA256` 复制冻结摘要，附本版明确续用条件的 reason/evidence；照明 roomUses 逐房间解释用途，requirements 按 roomIds/rule/values 数组提交全部规则，保留全部矛盾值，数字按契约单位换算。空间包提交 program/relations，源壳与尺寸参数由服务器保持。每份非对照原文用 documentDispositions 标明 used/context/unresolved，used 必须实际引用；引用只填 documentId/连续 quote。不要重写 sources、几何、产品、供电或旧缺项，也不要退役仅局部指标被替代的主文。未解决的值用空 values/status=unresolved；遗漏会形成阻断草稿，不能沿用旧要求。新增待审项用 additionalPending，不能删除或升级原有假设。

`read` 用同一 baseline/draft 分页读齐 requirements，并核对 summary、conditions 和 sources；ready 仅为已实现的结构检查，不是语义或专业验收。需要纠正时用 previousDraft 建新稿，旧稿保留，不另建正式任务。blocked 时报告矛盾/缺项并停止设计；不靠空物理输入、虚构任务身份、填充字段或诊断宿主来探测参数。

核对通过后 `commit` 传原 baseline/draft、实际 expectedInputSHA256、reviewed=true 和新 requestId；它只采纳一份输入并返回 task，不出图。重复采纳返回同一正式任务，结果不明先 status 核对收据，不能另建任务绕过。随后用正式任务身份查询单个 design 操作契约并调用原有设计/质量/交付流程。该入口当前是无历史基线的有界准备流程；既有来源修订、分类变更及范围编辑继续原协议，不能把未支持情况伪装成可用。医院仍仅是隔离对照样例。

新任务书先用cad_design_project的inspect_brief读取输入根目录内txt/md，briefFile可为相对输入根的路径；原文text及textSHA256用于新brief来源，rawSHA256标识原文件字节；仅去可选UTF8 BOM、保留换行，不擅自改写。该调用只读，不认证来源权威。

目标是把项目资料解释为可追溯的设计约束，通过 CAD AI Bridge 新建、编辑、核对并交付待人工审核成果。当前 cad_design_project 仅实现明确边界的普通照明设计试验，支持利用系数法与有限IES直射逐点模式，不宣称通用工程推理、多专业完整工程设计、反射/UGR验收或专业签审。

源码增量提供cad_engineering_task通用任务入口（冻结v2包尚无）。先capabilities核对已安装适配器，明确task.kind后绑定项目UUID和任务摘要；后续invoke不得覆盖子任务身份。ordinary-lighting仍只调用原有照明能力；新增office-space-planning独立处理声明的矩形办公净边界、入口/窗/保留构件与房间面积/邻接/座位程序，完成有界方案、改版、自检、原生图与待审输出，只覆盖两侧直走廊矩形房间族；drawing-analysis只做来源绑定检查/计量。空间包先capabilities取得完整契约，prepare.parameters={input}；design参数含expectedRevision/expectedInputSHA256和可选budget；revise_program提供同版本摘要、新brief/program/relations/parameters及reason；deliver/review需expectedModelSHA256。空间包可用shell.capture绑定完整毫米捕获中的WCS轴向矩形、入口/窗线段及保留矩形，实体语义与资料权威仍待审；交付后publish_spaces生成upstream_design共享包。data只读分页section=spaces/context/sources/space_bindings，space_bindings的functionSHA256直接用于programSHA256，不自行计算哈希、不从名称推断用途；显式revision/expectedDataSHA256续页，current=false为历史。照明prepare.parameters.project.spaceProgram（直接cad_design_project为prepare.project.spaceProgram）显式选空间、程序摘要/原句并解释use；上游换版会阻断旧照明继续设计/质量/交付，adopt_spaces需同项目同生产者当前包及冻结照明条件摘要、任务书原句续用证据，旧模型/图纸/审核失效。增删空间、用途及条件变化用preview_space_scope先提交expectedRevision/expectedInputSHA256及完整project；它只计算变更且通用invoke保留审计收据，不自动解释用途。project需同项目/同上游当前包、新任务书和建筑来源ID及互相承接的退役来源链。revise_space_scope另传reason和覆盖所有条件的decisions，逐项从预览复制key/disposition/previousSHA256/nextSHA256，加reason/evidence{sourceId,quote}；原句须来自新任务书，不会补造。新输入使全部选定模型/质量/CAD/审核退出当前，历史保留；缺项/错摘要/改写旧来源被拒绝，未知条件保持blocked。不能自动升级假设、推断空间拆并身份或签发消防/无障碍/采光/声学合格；不能将未支持的任务套入照明，也不能把外层任务路由称为通用复杂工程设计。完整参数以当前连接器capabilities返回的契约为准；可安装Skill保持自包含。

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

每个候选提供 iesFile={file,sha256}；文件必须位于已配置输入目录，sourceId 指向 role=catalog 且摘要相同的来源。支持 LM-63-1991/1995/2002、Type C、TILT=NONE，其他类型或补偿拒绝。按文件原坎德拉、倍率、rotationDegrees 和 maintenanceFactor 计算，不把光强强行归一化到任意流明。功率和相对光度声明灯泡流明必须匹配；晚于设计日期的文件声明发行日期会阻断。原始IES读取不证明Ra/CCT、产品可采购性或项目选型适用。

allowedRoomUses 可限定候选用途，schematicSymbol=panel/downlight 可指定图面示意符号。程序不替用户认证这些用途。产品功率、型号映射和源摘要见灯具CSV及说明页；逐点输出见 point-illuminance.csv，Eavg/Emin/Emax/Emin/Eavg见计算CSV和审核HTML。deliver前再次核对IES摘要；私有待审打包保存原始IES供审核，禁止把它放进源码或通用发行包。

当前网格不包含反射光、日光、UGR及复杂遮挡，点源远场适用性须复核；有障碍而没有高度时阻止本模式。有限网格搜索无解或预算耗尽不能说明现实工程不可能，保留理由并扩充经证据绑定的候选或输入条件，不暗中放宽目标、灯具输出或项目日期。


## 本机照明标准子集

先调用 `{action:"lighting_basis"}`，取得 configured、profileId、profileSHA256、sources、classes 和表格定位；configured=false 表示尚未配置，不能声称标准已核验。此只读动作返回摘要和解释指标，不返回完整标准或本机路径。标准全文、清单、交叉核读页图和配置只保存在用户本地资料区。

由维护者逐页核读后，通过 `scripts/import-lighting-evidence.py MANIFEST.json EXPECTED-SHA256 NEW-PROFILE.json` 导入新版本。清单须记录原PDF和公告页摘要、表所在PDF页及渲染像素摘要、独立核读表图摘要、来源URL、实施日期和分类解释。导入器核对字节/页图，**不自动认证数值转录或专业适用性**。配置环境变量 CADBRIDGE_ENGINEERING_LIGHTING_RULES 指向私有配置，或放在本机 dataHome/engineering-lighting-rules.json；禁止把这些资料提交到源码或用户通用包。换版使用新文件并复核摘要。

输入增加 `lightingStandards={profileId,expectedProfileSHA256}`；逐房间增加 `standardSpace={classId,classification,sourceIds,reason}`。classification 只能为 documented/interpreted/assumed，sourceIds 必须存在。project.standards 必须明确登记所选版本、来源SHA及生效日期。不可凭房间中文名称自动把“值班室”归为办公室、“示教室”归为会议室；缺乏功能依据时保留未分类并阻断。工作面冲突也必须通过有来源的条件修订解决，不能暗改原任务书。

有效最低照度和均匀度取任务/标准较高值，LPD上限取任务/强制性当前基准较低值；不自动使用小房间或照度级差上浮，也不把推荐目标值冒称当前强制限值。必须启用明确的直射逐点模式，声明Ra低于最低值的候选不能入选；Ra真实性、UGR、反射光、版本现行性及项目适用性仍待专业核对。源PDF、核读图或解释配置变化会在设计/交付前阻断，不能沿用旧模型。

当前控制图采用分组母线归属示意，开关分开且置于声明房间内；不等于现场敷设路线、开关线数或安装位置已经协调。


## 有限光源与漫反射复核

默认design以有来源IES直射网格预检；solve_lighting和optimize_lighting则以完整复核后的维持总照度选择候选，此时target_lux和max_avg_lux约束总平均照度，直射值仅作诊断。需要反射总照度时，在输入中显式登记 `lightingEnvironment={model:"closed_diffuse_rooms",geometry:"ies_rectangular_opening",sourceIds,status,description,rooms:[...]}`，逐空间声明 roomId、enclosure="closed_opaque"、floorReflectance/wallReflectance/ceilingReflectance（0—0.9）、sourceIds、status（documented/interpreted/assumed）和描述，必须恰好覆盖全部房间。反射率必须来自具体项目资料或明确假设；没有装修表时只能明确作为假设。

维护者先独立核验官方Radiance运行时来源和发行摘要，再用 `node scripts/register-radiance-runtime.mjs TRUSTED-ROOT NEW-PRIVATE-PROFILE.json` 登记四个工具及完整lib支持文件摘要。配置 CADBRIDGE_RADIANCE_RUNTIME 或本机 dataHome/radiance-runtime.json。该脚本不下载、不认证发布者；私有配置和二进制不放进源码/通用发行包。

设计冻结后调用 `assess_lighting`，传 jobId、requestId、expectedModelSHA256。当前只接受IES原始正宽/正长、零厚度矩形发光面，采用均匀发光面近似；尺寸缺失、负编码、障碍高度缺失、发光面相交/越界或需要吊顶开孔时拒绝，不用猜测尺寸或点光源替换。灯具至少低于封闭顶面20mm，本模式没有真实门窗开口、内部遮挡、日光或镜面材质。单分区上限10房间、100灯具、1000网格点；完整声明任务上限100房间、1000灯具、10000网格点，按完整房间分区并逐点计算，不拆房间或抽样。maxConcurrentRooms默认1、至多4；更大预算不表示已通过相应规模的质量/性能验收。

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


通用任务的reconcile只协调已停止且未发布结果的solve_lighting/assess_lighting/optimize_lighting。先status保存pendingOperations中的requestId和recordSHA256；另用新的requestId调用reconcile，提供原任务身份、operationRequestId、expectedOperationSHA256=recordSHA256、原operationParameters与recoveryParameters={}。适配器会核对并执行既有安全子任务恢复；已恢复时可指定recoveryParameters.recoveryRequestId。结果另存协调凭证，旧收据不改；旧调用仍返回interrupted，新计算必须用新UUID。deliver/原生状态不明、进程仍活着、身份或证据不符均阻断；只读模式不允许协调。该能力不是通用CAD崩溃恢复、工程验收或专业签审。

## 直接调用与通用任务包装的请求标识

### 原生交付后的审核 PDF（未发布源码）

ordinary-lighting 和 office-space-planning 共用 `review_pdfs`，须先完成原生 `deliver`。先 `status` 读取当前 `modelSHA256` 和 `pdfReviewSourceSHA256`；通用任务以 `invoke.operation="review_pdfs"` 调用，parameters 精确为 `{expectedModelSHA256:当前摘要,expectedSourceSHA256:pdfReviewSourceSHA256}`，外层另带新 requestId 和任务身份。直接照明调用则传 action/jobId/requestId 及上述两个摘要。不要自行计算、猜测或沿用旧摘要。

该步骤仅另存格式规范化 PDF 和逐张来源清单，不重新启动 CAD、不改变设计、原 DWG 或原始 PDF。当前返回的 `files` 优先列审核 PDF，`kind="pdf_source"` 保留原始 CAD 导出；`delivery.files` 仍为原生交付记录。相同来源复用现有包，篡改文件被拒绝；模型、输入或修订变化后旧包退出当前。查看 manifest 中原始/新文件摘要及 `reviewStatus`。包内载荷/纸张检查成功不等于所有外部阅读器、视觉或工程专业验收；相应标记保持 false，专业状态始终待人工审核。通用任务丢失回复时仍须遵守原收据状态，不能据文件级可重入就宣称通用中断恢复。

直接cad_design_project调用：preview_space_scope只传action/jobId/expectedRevision/expectedInputSHA256/project，不传requestId；revise_space_scope必须另传新的requestId、reason和decisions。直接design只传action/jobId/expectedRevision；直接status只传action/jobId/section。不要发送空项目试探契约，先从旧输入和新任务书构造完整proposal。

cad_engineering_task的invoke是另一层包装：外层始终带自己的requestId及任务身份，parameters里不带action/jobId/requestId。不能把外层字段移进直接调用，或把直接调用的字段原样塞进parameters。


### 紧凑的共享空间照明修订提案（未发布源码）

优先按需发现 cad_design_revision，以 draft → read → apply 登记明确的新任务书修订。旧的完整 preview_space_scope/revise_space_scope 接口继续支持。新入口只简化技术装配，工程解释由客户端提交；不替用户选择用途、标准类别、照度或未知条件。

1. inspect_brief 获取输入根内 briefFile 的 textSHA256（draft.expectedBriefSHA256）。读取旧输入和当前 space_bindings，按原文决定完整选择空间、用途以及 fromRoomId（明确沿用哪个旧房间的物理/要求条件）。
2. draft 传 jobId、唯一 requestId、expectedRevision、expectedInputSHA256、briefFile、expectedBriefSHA256、spacePack。sourceEvidence 和 carryForward 都是 {quote,reason}，quote 必须是新任务书的完整连续原句，reason 至少20字/字符。
3. rooms 每项 {roomId,use,fromRoomId,quote,reason}。仅对明确修改的规则附 requirements:[{rule,values:[...],status:'assumed'或'interpreted',quote,reason}]；相互矛盾值全留在 values，不自行取舍。无明确值时用 unresolvedRules:[{rule,quote,reason}]，use=unknown 保留未知。其他规则/物理/供电/产品参数只能在 carryForward 明确授权原值沿用时保留。新增房间也要明确 fromRoomId，不能猜模板。removedRooms:[{roomId,quote,reason}] 必须列全旧清单内被移除的空间。
4. 原有 standards 中的每个条款须用 standardScopes:[{standardId,clauseId,roomIds,quote,reason}] 显式决定范围；无标准则不填。resolvedMissingInputs 仅用 {id,quote,reason} 处理有明确新证据的原缺项，其他缺项保留。conditions 仅在明确改变 heightM/workplaneM/obstacles 时提交；classification 仅有明确分类原文时提交。多功能/附名空间和其他权威依据变动继续使用完整接口。
5. draft 返回不可变 draft:{jobId,draftId,sha256} 和 prepared/blocked、范围、阻断与待审摘要。read 传原 draft 和 section=summary/requirements/conditions/proposal。requirements 按房间/规则给出实际 values、状态、来源原句及 explicit_override/carried_forward/unresolved，按 offset/limit 和240KiB字节预算分页，沿 nextOffset 读取全部；不能把沿用旧值当成已落实新任务书。所有 read 返回 base.staleBase/currentRevision；过期提案仍可查看历史，以新请求 apply 会被原版本门槛拒绝。summary.requirementsReview 仅统计声明处置，不证明自然语言需求已全部提取。其余两节保留 offset/limit。核对每个要求的实际值及未决项、条件处置和项目提案后 apply 传 {action:'apply',requestId:新的UUID,draft:原引用}。它核对原版本与证据，产生新输入，旧模型/质量/图纸/审核失效；重复同请求返回原结果与当前状态。
6. prepared 后用 cad_design_project design，仅传 action/jobId/expectedRevision；status 读取新 input/model/checks。blocked 是保留冲突/未知后的有效输入状态，停止设计和轮询，如实说明待解决项。不要把“提案已登记”当成已设计或工程验收。

apply 前逐项读取 requirements，沿实际 nextOffset 读齐全部房间/规则，核对 values 与每一项新任务要求，不能仅看 summary 计数或 prepared。特别检查新任务明确改值的槽位是否仍标为 carried_forward；原句存在也可能错误沿用旧值。发现遗漏或误值时另建修正 draft，保留原稿，再完整审阅选定稿。base.staleBase=true 的历史稿不能当作当前可执行设计。

单位按公开契约换算，保留原文与换算理由；照度用 lx、功率用 W、间距/安装高用 m，压降用百分数数值。多份同时有效资料须逐份读取、检查身份及原句；数值相同但单位不同不算矛盾，含义不同则保留全部要求并阻断受影响设计，不能按文件先后或名称猜优先级。当前紧凑修订只绑定一份活动任务书；预先合并的测试资料包不代表 Bridge 已实现独立多文档版本、权威或冲突协调。无法可靠装配来源时说明缺口并保持待解决，不虚构引用。


初次总光照搜索的源码布局族增加外围行/列间隙补灯：从原网格及实际边界派生，保留原灯位，新增点仍受边界、障碍、功率、有限发光面及UGR方法适用性检查。它只用于solve_lighting/optimize_lighting的源候选与选择重放；默认design的旧直射/流明法选择不变。无实测基线时按直射诊断目标偏差分组后优先试算较低功率方案，0.05诊断分组仅用于排序，不是照度/均匀度/UGR验收容差；所有候选必须完整物理复核，不能因排序接近目标而采纳。


源码总光照搜索的候选覆盖继续保持每产品16个诊断预算：先覆盖可容纳的灯数层，再把剩余诊断分散到灯数范围并优先选择不同布局族/补灯方向，避免低灯数或同类删灯变体占满所有余位。同一初次诊断分组及功率下，均匀度距离参与组合排序；它仍不能替代物理验收。已有完整实测背景时，眩光反馈逐观察方向重用原间接眼照度，仅以新候选实际几何/IES源项估计排序，不将改变布局后的光传输当作已标定，也不按灯具产品身份一概处罚。原背景身份、观察位置或有效数值不符时返回不可预测；没有背景或有效眩光项时不补造通过值。所有入选方案仍须重新通过原UGR和照度门槛。

共享空间数据读取使用 cad_engineering_task：`{action:"data",jobId:上游job-task,expectedProjectId:原项目UUID,expectedTaskSHA256:原任务摘要,section:"space_bindings",offset:0,limit:25}`；专业项目读取使用 cad_design_project 的 `{action:"status",jobId:job-design,section:"input"}`。两种身份分别从现有上下文复制，不互换 action 或 jobId。

若 draft 返回 REVISION_PLAN_QUOTE_NOT_IN_BRIEF，其消息包含 sourceTextSHA256、invalidCount 和有界 invalidEvidence（精确字段 path、原提交引文摘要和长度）。先针对列出的字段重读该版本原文，用连续原句重新提交；不能把多个不相邻句子拼成一个 quote。摘要核对只定位原提交，不代表语义正确；服务端不替换引文或选择工程值。

多份需求/协调/依据文件可用 `cad_project_documents` 分别冻结版本；不要先拼接为唯一原始权威文档。仅输入根内 UTF-8 txt/md 可直接登记，PDF/扫描件不能假称已解析。创建文档集后，`cad_engineering_task prepare` 顶层传 `documents:set`，先阻断设计。用 `read` 取原文、`targets` 按原任务身份取齐实际输入字段；逐项解释并引用具体 documentId/textSHA256/连续原句。单字段复制 singleTargetValuesSHA256，不猜 SHA；brief 只是兼容摘要，不能代替逐份依据。全部字段和非对照文档都要显式处置，不明确的冲突/条件提交 unresolved 或 conflict，不猜文档优先级或已确认值。review 的 ready 只说明完整字段与字面引用检查通过；semanticCoverageAccepted/authorityVerified/professionalApproval 仍为 false。

查询契约时先按需要分段：`cad_engineering_task {action:"capabilities",kind:"ordinary-lighting",section:"prepare"}` 只取该专业准备参数；查询单操作使用相同 kind、`section:"operations",operation:"design"`，不要用一个专业的参数代替另一个。`section:"summary"` 返回已安装类型的简表，未传筛选仍兼容完整响应。照明 design 可同时提供当前 expectedRevision 和 expectedInputSHA256；摘要存在时必须相符才计算或复用模型。

文档 role 是资料用途，专业 `input.sources.role` 是另一套契约。照明来源只接受 architecture/brief/standard/catalog/review_instruction，不能直接照抄 requirements/coordination/standard_excerpt 等文档用途。文本摘要和来源身份原样复制，类型名称并不确认权威或标准适用性。`supersedes/supersededBy` 会退役整份来源；协调文件仅替代一个房间的一项指标时，应保留主文其他约束及来源有效性，用实际要求与原句记录局部替代，不能把整份主文标成作废。结构参数错误应按当前契约和原输入修正，不用虚构任务身份、空几何/产品或测试填充字段探测接口；来源与参数错误也不等于 CAD 宿主故障。

`bind` 只把同任务、同输入和当前文档集的审阅关联起来，不修改工程参数。文档或输入换版后重新审阅；已有模型须专业修订后重算，不能只换绑定继续交付。`read_review` 分页复核 summary/targets/decisions/documents，current=false 是历史记录；不要把旧 ready 当作当前通过。设计、质量、交付、审核包前读取新 status.documentEvidence；get_job 保存快照不能证明来源仍为最新。evaluation_only 不读正文、不引用、不按其答案生成设计。未带多文档的已有任务继续原契约；不因为医院样例改变其他任务的效果或专业能力范围。

### 出图后的可视审阅与待审说明更正（未发行源码）

机检、PDF规范化与图面/内容审阅分别记录。客户端具备图像读取能力且具有对应文件读取权限时，应实际打开当前输出PNG或审核渲染，逐页核对原文与图面；只看到链接/成功状态不能称已经看图。图像过小或不支持时如实说明，不猜看不清的字。审阅意见也可能误读范围或推测不存在的修正，需对照原文和实际结构化值，不能因此擅改面积、人数、标准或物理条件。

同一任务的 `cad_engineering_notes` 只更正 `missingInputs.description`。先 `inspect` 传原 `task={jobId,expectedProjectId,expectedTaskSHA256}`，取得实际 `expectedRevision/expectedInputSHA256/documents` 及每项 `id/description/severity/expectedDescriptionSHA256`；读当前冻结原文，再 `revise` 传新 `requestId`、同 `task` 和 `parameters={expectedRevision,expectedInputSHA256,notes:[{id,expectedDescriptionSHA256,description,reason,evidence:[{documentId,textSHA256,quote}]}]}`。新 description 是10到1000字/字符的单段原文，必须完整位于单份连续 quote；不要凭错字猜词或从对照取答案。保留“待审/声明/假设”的原意，不能移除缺项、改变ID/严重级/来源链接、降低假设或称已解决。若没有当前原文依据则保持待审，不勉强修订。

完成仅是输入修订和来源重新绑定。用返回的 `job-notechange-UUID` 及同 task 查询 `status`，确认原任务新的实际版本、摘要和来源状态；再按该专业契约 design、检查、deliver、review_pdfs。旧输入/模型/图纸/审核留历史，不改旧PDF，不另建项目绕过；状态不明先核对收据，不换UUID重复。新的来源索引JSON/CSV及图面显示原始文档名、版本、用途和冻结原文行定位，登记身份与字面位置不认证权威或标准适用性。

空间新图面版本明确显示“实际净面积、要求范围、倾向面积”，范围使用“至”；关系表列几何实际值与要求。旧模型按原图面版本读取，不重画历史。所有图仍待专业审核；几何关系、窗接触与走廊路径不能当作消防、无障碍、采光或施工验收。
空间规划 `design.budget.searchMode` 可选 `improve`（缺省保持原首批可行搜索）。先获得既有可行方案，再按剩余节点/时间预算继续搜索；`maxPlans` 是保留候选数，不是改进搜索的停止条件。自动采纳保护首批最佳方案的房间净面积不减少、走廊及隔墙/门槛占地不增加，其他几何与项目阈值仍照常审核；取舍候选单独留在 study 的 `tradeoffPlans`，不能按较低组合评分宣称总体更好。面积偏好与未分配地面的评分、保护策略、原方案、候选及预算均需向审核者说明；入口路径等可能仍在原上限内变长。节点预算严格计数，时间为可让出检查点的协作预算，不承诺硬实时停止；未证明全局最优、任意布局、标准适用或专业验收。已有模型须按正常修订流程换版，不能在原修订反复设计或覆盖旧输出。
