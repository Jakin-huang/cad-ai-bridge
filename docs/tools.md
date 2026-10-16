# 工具与数据契约

MCP 与 `cadbridge call <action> <request.json>` 共用 `src/contracts.mjs` 的严格 schema。所有图纸路径必须位于 setup 配置的 workspace，解析真实路径后检查边界。输出路径由宿主生成，调用者不能指定覆盖源图。

## 读取天正

```json
{"drawing":"D:/CAD-work/example.dwg","host":"core"}
```

`tangent_inspect` 与 `tangent_takeoff` 默认返回摘要。`host` 可为 `core` 或 `tangent`；后者启动独立图形会话。`detail: full` 返回完整记录。若图纸单位为 Undefined，`units: mm` 明确声明长度按毫米解释；已有其他单位不能被假设覆盖。

设备输出包含 handle、块名、分类、位置、属性、识别依据和分组后的 typed XData。导线输出包含几何类型、回路 ID、原始规格字段、图面长度及有依据时的毫米长度。统计覆盖模型空间根层；未知实体、代理和读取错误分别报告，不把未识别实体默认为设备。

### 分页

摘要给出 `details.jobId`。调用 `cad_read_result`：

```json
{"jobId":"job-EXAMPLE","kind":"devices","offset":0,"limit":25}
```

`kind` 为 `devices`、`wires` 或 `circuits`；每页 1–100 条。返回 total、items、hasMore 和完整结果文件 SHA-256。分页读取本项目已有任务记录，不启动 CAD、不读取任意路径。

## 创建测试图

`cad_create_test_drawing` 接受 `{}` 或 `{"adapter":"tangent-v8"}`，返回新的 DWG、摘要、documentId 和 revision。天正适配 fixture 提供独立编写的 EA_LIGHT 与 EA_SOCKET，定义单位为毫米。它们不是厂家图库的复制。

## 原子制图

`electrical_apply` 需要 source drawing、expectedSha256、documentId、expectedRevision、requestId UUID、`units: mm` 和 operations。使用刚读取的文件指纹与版本。`adapter` 可选且必须与图纸状态匹配；不传时由图纸持久状态决定。

```json
{"type":"place_symbols","blockName":"EA_LIGHT","instances":[{"id":"L1","position":[0,0,0],"attributes":{"MODEL":"LED-18W"}}]}
```

```json
{"type":"connect_route","id":"route-WL1","circuitId":"WL1","from":{"id":"L1","port":"PWR"},"to":{"id":"L2","port":"PWR"},"vertices":[[0,0,0],[3000,0,0]],"wireSpec":{"wireType":"BV","conductorSpec":"2x2.5"}}
```

`wireSpec` 只用于天正合成 fixture 适配，字段还包括 method、installation、conduitDiameter。测试端口位于插入点，路线首尾必须匹配；不会自动寻找真实设备的接线端子或绕障碍。

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
