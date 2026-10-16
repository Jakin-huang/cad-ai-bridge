# 工具与数据契约

MCP 与 `cadbridge call <action> <request.json>` 共用 `src/contracts.mjs` 的严格 schema。图纸路径必须位于 setup 配置的 workspace 或本项目任务输出目录，解析真实路径后检查边界。输出路径由宿主生成，调用者不能指定覆盖源图。

## 读取天正

```json
{"drawing":"D:/CAD-work/example.dwg","host":"core"}
```

`tangent_inspect` 与 `tangent_takeoff` 默认返回摘要。`host` 可为 `core` 或 `tangent`；后者启动独立图形会话。`detail: full` 返回完整记录。若图纸单位为 Undefined，`units: mm` 明确声明长度按毫米解释；已有其他单位不能被假设覆盖。

设备输出包含 handle、块名、分类、位置、属性、识别依据和分组后的 typed XData。识别 light、socket、fireequip、weakequip、switchboard、switch、powerequip、otherequip 等已有标记；有名称证据时识别旧式专业设备层字段。导线输出包含几何类型、回路标签、原始规格字段、图面长度及有依据时的毫米长度。全空导线字段计入待复核项，不计入有效导线。统计覆盖模型空间根层，包括图例与重复视图实例；未知实体、代理和读取错误分别报告。

`circuitLabelCount` 是原样标签的分组数，保留大小写。未建立配电箱、馈线和拓扑身份时 `circuitCount` 为 null，`circuitIdentityResolved` 为 false；相同 WL1 不能跨楼层/配电箱直接当作同一条实际回路。图面实例数也不等于工程净量或采购量。

完整结果超过 MCP 返回预算时，即使请求 `detail: full` 也会返回 `responseTruncated: true` 与分页入口；不会重启 CAD。完整 JSON 仍在任务目录内。所有 MCP 工具返回均受此边界保护。

## 原始审计与工程图块

`cad_audit_drawing` 对副本列出实体类型、图层、XData 应用名、根层 INSERT、图块定义和文字，同时独立导出 DXF。默认只返回摘要；分页 kind 新增 inserts、definitions、texts。XData 预览和图块几何预览有长度上限，DXF 保留完整记录。`auditDxfExported` 和 `auditDxfError` 单独报告导出状态，失败的部分文件不能作为验收证据。

`cad_prepare_project` 接受 drawing、expectedSha256、requestId UUID、units:mm、可选 host，给明确为毫米制的既有图纸生成带文档身份的副本，不修改已有实体或自动设置单位。

在其输出上调用 `electrical_apply`，adapter 为 tangent-project：

```json
{"type":"clone_project_symbols","templateHandle":"ABC","instances":[{"id":"L1","position":[10000,0,0],"rotationRadians":0,"portOffset":[0,0,0]}]}
```

模板目前限已验证的普通本地灯具/插座根层块，保留原定义、图层、比例、属性和 XData；当前位置及旋转由请求指定。带关联字典、反应器、已知拓扑身份字段、动态图块和外参的模板拒绝。portOffset 是块局部坐标中的显式几何连接锚点，由实际几何核对后选择，通过原实例的块变换转换为 WCS，不自动推断厂家端子。新设备编号使用 DEVICE_ID；若源块没有该属性，仅给新增实例附加本项目的编号属性，不覆盖 A 等原有专业属性，不改共享块定义。ATTSYNC 等外部属性同步可能重置这类实例附加属性，需由上层适配器另行处理。新增导线可设置回路与规格字段。

`cad_repair_copy` 接受 drawing、expectedSha256、requestId 和可选 host，运行 CAD 自带 AUDIT，再输出新 DWG/DXF；不设置图纸单位、不覆盖原文件。AUDIT 可能删除损坏对象，需查看宿主日志和对照结果。此操作只修复副本，不视为一次可自动重放的制图事务。

### 分页

摘要给出 `details.jobId`。调用 `cad_read_result`：

```json
{"jobId":"job-EXAMPLE","kind":"devices","offset":0,"limit":25}
```

`kind` 为 devices、wires、circuits 或原始审计的 inserts、definitions、texts；每页 1–100 条。返回 total、items、hasMore 和完整结果文件 SHA-256。分页读取本项目已有任务记录，不启动 CAD、不读取任意路径。

## 创建测试图

`cad_create_test_drawing` 接受 `{}` 或 `{"adapter":"tangent-v8"}`，返回新的 DWG、摘要、documentId 和 revision。天正适配 fixture 提供独立编写的 EA_LIGHT 与 EA_SOCKET，定义单位为毫米。它们不是厂家图库的复制。

## 原子制图

`cad_create_drawing`（CLI action `create_drawing`）接受 `{scene:{layers,symbols,entities}}`，只在新空白图里建立毫米制图纸。图层使用有限ASCII名称与ACI颜色；普通图块包含声明式几何和有限属性。几何仅为polyline、circle、text，坐标为WCS `[x,y,0]`，不接受脚本、命令、输出覆盖路径或外参。最多100图层/100符号/20000静态实体，整体请求仍限1MiB。图块定义与实体在同一事务中创建，失败不输出新DWG。需要完整业务项目时参见[学校流程](school-project.md)。

`place_symbols.instances[].layer` 和 `connect_route.layer` 可指定普通新实体的图层，默认保留E-LIGHT/E-WIRE；工程模板复制仍保留原图层，不接受此覆盖字段。单行文字使用本机微软雅黑字体，新学校PDF使用本机黑体，不分发字体文件。

场景可用 `view:{center:[x,y,0],width,height}` 指定新图首次打开的平面视图，用 `views:[{name,center,width,height}]` 创建至多100个命名视图。视图仅影响新图的显示；初始视图按宿主宽高比扩大范围，避免裁掉目标边界。学校示范为每张图创建同名视图。

`electrical_apply` 需要 source drawing、expectedSha256、documentId、expectedRevision、requestId UUID、`units: mm` 和 operations。使用刚读取的文件指纹与版本。`adapter` 可选且必须与图纸状态匹配；不传时由图纸持久状态决定。

```json
{"type":"place_symbols","blockName":"EA_LIGHT","instances":[{"id":"L1","position":[0,0,0],"attributes":{"MODEL":"LED-18W"}}]}
```

```json
{"type":"connect_route","id":"route-WL1","circuitId":"WL1","from":{"id":"L1","port":"PWR"},"to":{"id":"L2","port":"PWR"},"vertices":[[0,0,0],[3000,0,0]],"wireSpec":{"wireType":"BV","conductorSpec":"2x2.5"}}
```

`wireSpec` 用于天正合成与工程适配的新增路线，字段还包括 method、installation、conduitDiameter。合成端口位于插入点；工程适配使用显式锚点。路线首尾必须匹配；不会自动寻找设备接线端子或绕障碍。

```json
{"type":"number_devices","ids":["L1","L2"],"prefix":"L-","start":1,"width":3}
```

编号写入本项目 DEVICE_ID 属性。一次 operations 中后续步骤失败会回滚先前步骤。请求 UUID 已经存在且内容相同则不重复插入；内容不同返回冲突。幂等只在已保存 DWG 的同一分支内成立。

## 错误与结果

- 输入 schema、路径、摘要和文档版本校验失败时不进行对应写入。
- 插件返回 `ok: false` 与 error.code/message。涉及保存失败时同时报告 mutationCommitted、drawingSaved。
- 宿主超时或异常可能发生在提交之后；先检查任务目录的 response、output 和 host 状态，再决定重试。
- 配置恢复遇到外部改变时保留外部值并报告冲突，不覆盖其他 CAD 会话写入的配置。

每个任务保留 request、input snapshot、response、完整 result、宿主信息和生成文件。读取摘要只影响传回 AI 的体积，完整证据仍保留在本地。
