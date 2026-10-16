# CAD AI Bridge

把本地 AutoCAD 电气读图和批量制图接入 AI：**设备识别、回路读取、统计、图块布置、连线和编号**。提供 MCP、CLI、自动配置与可复现演示。

当前为 **0.2 开发者预览**。实测环境：Windows x64 / AutoCAD 2022 简体中文 / T20 天正电气 V8.0。天正与 AutoCAD 由用户自行安装并正常授权。

[English](README.en.md) · [详细技术方案](docs/technical-plan.md) · [工具与数据契约](docs/tools.md) · [安装排障](docs/troubleshooting.md) · [开源项目对标](docs/open-source-benchmarks.md)

![从实际测试 DXF 生成的电气示例](docs/images/tangent-electrical-demo.svg)

## 三步开始

需要 Node.js **22.19+**、PowerShell **7+**、本机 AutoCAD 2022 与 .NET Framework 4.8。原生天正后端另需本地天正电气 V8。

```powershell
npm ci
npm run setup -- --workspace "."
npm run demo
```

setup 自动检测 CAD、编译本项目的 .NET 插件，并生成 `cadbridge.local.json` 与 `mcp-config.local.json`。重复配置会先备份。多安装实例可使用 `--cad-root` 选择，图纸工作目录可由 `--workspace` 指定。项目不依赖 REA 运行目录，也不需要模型 API 密钥。

Windows 也可运行 `setup.cmd --workspace "D:\CAD-work"` 完成依赖安装、配置和诊断。当前目录需事先存在；省略参数时使用项目目录。[预览包与发布说明](docs/releasing.md)

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
| 布置、连线、编号 | 一次原子任务操作受管理图纸中的普通图块；天正写入使用项目生成并标记的灯具、插座测试定义 |
| 两种宿主 | CoreConsole 快速批处理；`host: tangent` 使用独立 AutoCAD 图形会话解析天正对象 |
| 结果分页 | 默认返回天正摘要；`cad_read_result` 分页读取已有完整结果，不重新启动 CAD |
| 文件与事务 | 原图快照、SHA-256、文档 ID、版本检查、事务回滚、持久化请求幂等，另存新 DWG |

天正示例实测识别 34 个灯具/插座和 28 条导线；原生宿主解析了快速后端报告的 129 个建筑代理对象。合成测试图实测 3 灯具、2 插座、2 回路、12000 mm 路线与 L/S 编号的保存和重开。

这些结果不等于已支持所有天正工程对象。当前覆盖模型空间根层；嵌套块、外参、动态块写入、任意厂家图库、原生桥架创建、专用标注关联、负荷计算与规范校核不在预览版写入范围。设备编号使用 `DEVICE_ID`；回路字段使用新路线的 `linenum`。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `cad_create_test_drawing` | 创建普通或 `adapter: tangent-v8` 测试图 |
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

本机厂家示例读取中，默认摘要从完整结果的 32768 字节降至 4504 字节；这是一次 JSON 大小实测，不是模型 token 或跨机器性能保证。

## 加载与恢复

天正原生 ARX 使用原生加载机制，本项目 .NET 插件使用 NETLOAD。任务保持安全加载开启，临时加入精确插件目录，随后恢复。天正图形宿主预载完整内核，临时抑制日积月累提示，并恢复该偏好。

首次启动提示需要正常完成；程序不会操作登录或激活界面。出现超时、配置冲突或保存状态不明时先查看任务目录，不自动重放写入。

## GitHub 与维护

[MIT](LICENSE) · [贡献指南](CONTRIBUTING.md) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md)

公开仓库只包含独立源码、文档和合成示例。AutoCAD/天正二进制、对象解释器、图库、厂家 DWG、真实工程图、个人配置和运行缓存不打包。源码可以在其他机器重新构建；预览版发行包的依赖和兼容边界见发布清单。
