# CAD AI Bridge

连接用户现有的 CAD 软件与 AI，通过 MCP 和 Skill 开放软件能力，减少接入与操作步骤。当前预览已实现本地 AutoCAD 电气读图和批量制图：**设备识别、回路读取、统计、图块布置、连线和编号**，提供 CLI、自动配置与可复现演示。

[现有项目完善与优化方案](docs/connector-plan.md)优先降低接入成本、提高稳定性和调用效率，保留当前已验证能力。学校生成器是业务回归样本，WorkBuddy 等是客户端兼容性样本；常驻会话、通用命令等按实际收益决定后续实施。

[三批优化交付记录](docs/maintenance-validation.md)记录本轮实现、实测收益、回归结果和仍需验证的分发环境。

当前发行：**v0.2.0-preview.1，Windows 用户预览版**。适合已有 AutoCAD 2022 的用户试用；实测 Windows 10 x64 / AutoCAD 2022 简体中文 / 可选 T20 天正电气 V8.0 / WorkBuddy 5.3.8。CAD、天正需自行正常安装授权；内部包与插件兼容版本为 0.2.0。[本版发布说明](docs/releases/v0.2.0-preview.1.md)

## 普通用户三步开始

1. 从本仓库 Releases 下载 `cad-ai-bridge-0.2.0-preview.1-windows-x64.zip`，解压到用户可写目录。GitHub 自动生成的 Source code ZIP 不包含便携运行时和插件，请选择上述用户包。
2. 双击 `connect-workbuddy.cmd`，等待配置完成。在 WorkBuddy 的“自定义连接器”中找到 `cad-ai-bridge`，完成客户端首次“信任”，等待工具加载。
3. 新建任务，发送：“使用 CAD AI Bridge 检查连接，新建测试图，放两盏相距 3000 毫米的灯并连接 WL1，编号 L-001、L-002；保存后重开核对，返回 DWG/DXF 文件。”

用户包内含官方便携 Node/PowerShell 和锁定依赖；桥梁环境准备可离线完成，无需管理员、开发工具或模型 API 密钥。文件卡片可交付 DWG/DXF，使用本机 CAD 打开。升级时保留旧目录，在新目录运行同一入口；需回退时使用 `restore-workbuddy.cmd`。[安装、升级和排障](docs/windows-user-release.md)

本版已经过本机未提权进程、离线缺失运行时、升级恢复及真实 CAD 验证，**尚未完成干净 Windows 和独立标准账户验收**；本地虚拟机验收已暂缓。其他 CAD 版本和 MCP 客户端需另行验证。支持本地 stdio MCP 的客户端可导入生成的 `mcp-config.local.json`；Skill 按各客户端机制添加。[通用接入与 WorkBuddy 流程](docs/workbuddy.md)

学校项目支持 [本地 DWG 标准库](docs/local-standard.md)：主模板统一箱柜、图例及电力选型，缺少图例可从已有施工图补充；本地资产不加入公开源码。

[English](README.en.md) · [详细技术方案](docs/technical-plan.md) · [学校项目完整流程](docs/school-project.md) · [工具与数据契约](docs/tools.md) · [安装排障](docs/troubleshooting.md) · [开源项目对标](docs/open-source-benchmarks.md)

![从实际测试 DXF 生成的电气示例](docs/images/tangent-electrical-demo.svg)

## 从源码开始（开发者）

需要 Node.js **22.19+**、PowerShell **7+**、本机 AutoCAD 2022 与 .NET Framework 4.8。原生天正后端另需本地天正电气 V8。

```powershell
npm ci
npm run setup -- --workspace "."
npm run demo
```

setup 自动检测 CAD、编译本项目的 .NET 插件，并生成 `cadbridge.local.json` 与 `mcp-config.local.json`。重复配置会先备份。多安装实例可使用 `--cad-root` 选择，图纸工作目录可由 `--workspace` 指定。项目不依赖 REA 运行目录，也不需要模型 API 密钥。

Windows 也可运行 `setup.cmd --workspace "D:\CAD-work"` 完成依赖准备、配置和诊断。省略工作目录时使用项目目录。[预览包与发布说明](docs/releasing.md)

WorkBuddy 用户可双击 `connect-workbuddy.cmd`，完成环境配置、MCP 合并与完整 Skill 安装；已有服务保留，更新前备份。随后在客户端右上角“自定义连接器”中完成该服务的首次“信任”，等待工具加载，再用自然语言操作。桌面完整流程已通过用户辅助验收，DWG/DXF 以文件卡片交付并用本机CAD打开。[接入步骤与验收边界](docs/workbuddy.md)

`setup.cmd` 复用匹配锁定版本的依赖和通过目标、摘要及源码校验的插件。缺少运行时时，优先使用随包的官方便携 ZIP；较小的开发者包则下载固定版本并校验 SHA-256，不调用系统安装器、不修改系统 PATH。工作目录可自动创建。源码有变或显式 `--rebuild` 才重建插件。可用 `--client-config <客户端MCP配置文件>` 合并本项目条目，其他服务保留，修改前备份；也可直接导入生成的通用配置。

将生成的 `mcp-config.local.json` 导入支持本地 stdio 的 MCP 客户端。此文件使用本机的真实路径；setup 不会覆盖已有 AI 客户端设置。

```powershell
npm run doctor
node bin/cadbridge.mjs mcp --read-only
```

## 已实现的能力

| 能力 | 当前范围 |
| --- | --- |
| 天正设备识别 | 根据 V8 示例实证的 XData 识别普通设备图块，保留属性、分类依据及原始字段 |
| 回路与统计 | 读取导线规格和 `linenum`，汇总设备、回路、图面长度；明确单位和覆盖范围 |
| 布置、连线、编号 | 原子操作合成测试图，或在工程副本中复制已识别的普通电气实例，保留原定义、比例、图层及专业属性，使用显式几何锚点连线 |
| 工程审计与修复副本 | 原始实体、图层、实例和定义清点，独立 DXF 对照；有摘要保护的 AUDIT 只修复快照并另存 |
| 从需求新建学校项目 | 参数化原创底图和符号、照度/负荷/压降初算、布置/接线/编号、DWG/DXF、A2 PDF、回路与设备表，含独立CAD回读证据 |
| 两种宿主 | CoreConsole 快速批处理；`host: tangent` 使用独立 AutoCAD 图形会话解析天正对象 |
| 结果分页 | 默认返回天正摘要；`cad_read_result` 分页读取已有完整结果，不重新启动 CAD |
| 文件与事务 | 原图快照、SHA-256、文档 ID、版本检查、事务回滚、持久化请求幂等，另存新 DWG |

天正示例含 34 个灯具/插座及其他可识别类别、28 条导线；原生宿主解析了快速后端报告的 129 个建筑代理对象。合成测试图实测 3 灯具、2 插座、2 回路、12000 mm 路线与 L/S 编号的保存和重开。真实工程验证流程见 [副本验收说明](docs/project-validation.md)。

既有图纸统计覆盖模型空间根层，包括图例和重复视图实例。全空导线字段单独列为待复核；未建立配电箱/馈线拓扑时，回路标签分组数不能当作实际回路总数。嵌套块、外参、动态块写入、任意外部厂家图库导入、原生桥架创建及专用标注关联仍需专项适配。学校模板有显式设备与回路模型，可做假设下的负荷和电阻压降初算；全项规范、产品与施工审查仍需专业完成。新增编号使用 DEVICE_ID；不覆盖原有 A 等专业属性。天正适配回路字段使用新路线的 linenum。

## 从头生成学校示范项目

```powershell
python -m pip install reportlab pypdf
node bin/cadbridge.mjs school examples/school-requirements.json
```

默认需求是二层六间教室、180人的小学教学单体。每次新建输出目录，生成14页A2图册、可编辑DWG/DXF、设备及回路CSV、计算报告和文件摘要。普通AutoCAD与天正宿主重开，并独立DXF核验。可用 `CADBRIDGE_PYTHON` 选择Python；无CAD时用 `--model-only` 预检。详见[范围、公式与待审事项](docs/school-project.md)。

这是方案深化示范。没有真实建筑、供电、IES/LDT及厂家接口时，不输出照明质量、消防闭环、防雷分类或短路保护“已合规”的结论。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `cad_doctor` | 不启动 CAD 的环境诊断，环境缺失时仍可连接和调用 |
| `cad_get_job` | 按 jobId 查询已有任务；按原 requestId 查找，断连后获取结果，不重放写入 |
| `cad_audit_drawing` | 原始清点、DXF 导出与有界详情分页 |
| `cad_prepare_project` | 给明确毫米制的工程图生成可管理副本 |
| `cad_repair_copy` | 对输入快照运行 AUDIT 并另存修复结果 |
| `cad_create_test_drawing` | 创建普通或 `adapter: tangent-v8` 测试图 |
| `cad_create_drawing` | 从受约束的图层、原创图块和几何场景新建图纸 |
| `cad_inspect` | 读取受管理图纸身份、符号、设备和路线 |
| `electrical_apply` | 批量布置、显式路径连线、编号，输出新 DWG/DXF |
| `electrical_takeoff` | 受管理设备与路线统计 |
| `electrical_validate` | 编号、端点连接检查 |
| `tangent_inspect` | 天正设备、导线与回路摘要；`detail: full` 获取完整记录 |
| `tangent_takeoff` | 天正设备与回路统计 |
| `cad_read_result` | 已有任务结果分页 |
| `cad_native_status` | 检查独立天正宿主的加载状态 |

电气工作流指引随仓库保存在 [skills/cadbridge-electrical](skills/cadbridge-electrical/SKILL.md)，可按所用 Agent 的 Skill 机制添加。实际能力由本地工具执行，Skill 本身不会安装或授权 CAD。

## CLI 使用

```powershell
node bin/cadbridge.mjs inspect "D:\CAD-work\sample.dwg"
node bin/cadbridge.mjs inspect "D:\CAD-work\sample.dwg" --host tangent
node bin/cadbridge.mjs takeoff "D:\CAD-work\sample.dwg" --units mm --format csv
node bin/cadbridge.mjs demo --host tangent
node bin/cadbridge.mjs doctor --native "D:\CAD-work\test.dwg"
```

上述路径应位于 setup 选择的工作目录。未定义单位的图纸默认不换算毫米；`--units mm` 是明确的调用者假设，并随结果记录。已有其他单位不能被该选项覆盖。

推荐给 AI 的请求：

> 创建天正适配测试图，放置 3 个灯具；沿 (0,0)、(3000,0)、(6000,0) 连接 WL1，编号 L-001 至 L-003。保存后重开，核对数量、回路和 6000 mm 长度，并返回新 DWG。

## 验证

```powershell
npm test                         # 无 CAD 的契约、边界、备份和分页测试
npm run test:cad                  # 真实 MCP / AutoCAD 的 16 项回归
npm run test:tangent              # 原生天正的 11 项端到端验收
node tests/mcp-results.mjs        # 摘要、分页和只读 MCP 协议验收
npm run check                    # 发布检查，含本地验收证据
```

真实图纸、日志、完整结果和失败诊断保留在被 Git 忽略的 `runs/` 与 `artifacts/` 中。通过报告不会覆盖成失败报告；失败记录单独保存。普通 CI 仅运行无 CAD 测试和静态发布检查。

公开的 [验收摘要](docs/validation-summary.json) 记录测试项与插件 SHA-256；[复现示例](examples/electrical/README.md) 说明如何本地生成 DWG/DXF。维护者使用 `npm run preview` 重建预览，使用 `npm run package:preview` 生成带文件清单及校验和的开发者预览 ZIP。

大图完整结果超过返回预算时，MCP 自动返回摘要和分页入口，避免协议消息过大导致断连。默认摘要的大小对比记录在验收摘要中；这是 JSON 字节实测，不是模型 token 或跨机器性能保证。

受管理快照的大结果也可分页读取 `managedDevices`、`routes`、`symbols` 与 `issues`。每次 CAD 调用记录配置、排队、快照、宿主、输出处理及插件事务/保存/导出耗时；只读结果查询不进入 CAD 队列。断连或超时先用 `cad_get_job` 找回记录；`outcome: saved` 表示已有 DWG，后续导出或清理失败不应触发重复写入。

## 加载与恢复

天正原生 ARX 使用原生加载机制，本项目 .NET 插件使用 NETLOAD。任务保持安全加载开启，临时限定所选本地运行时及插件的精确目录，随后恢复。图形宿主以自建空白图完成初始化，再用文档 API 打开输入快照，避免缺失 SHX 的启动选择阻塞；缺失字体仍需补齐才能保证正式出图。日积月累偏好同样临时抑制并恢复。

首次启动提示需要正常完成；程序不会操作登录或激活界面。出现超时、配置冲突或保存状态不明时先查看任务目录，不自动重放写入。

## GitHub 与维护

[MIT](LICENSE) · [贡献指南](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md)

公开仓库只包含独立源码、文档和合成示例。AutoCAD/天正二进制、对象解释器、图库、厂家 DWG、真实工程图、个人配置和运行缓存不打包。源码可以在其他机器重新构建；预览版发行包的依赖和兼容边界见发布清单。
