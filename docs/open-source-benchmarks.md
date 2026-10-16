# 开源项目对标与 GitHub 发布方案

调研日期：2026-10-15（Asia/Shanghai）。社区数据由 GitHub 公共 API 当次读取，原始筛选记录见 [research/github-projects-2026-10-15.json](research/github-projects-2026-10-15.json)。星标会变化；最近推送时间也不等于最近正式发行或已完成生产验证。

推荐以独立的 CAD AI 连接器仓库维护现有实现，采用“MCP 服务 + 电气 Skills / 客户端插件 + CAD 执行后端 + 可重现示例”的形态，配套 Windows 安装包 / 便携包。补充调研后，AutoCAD 接入优先对标 bimwright/dwg-mcp，能力封装与分发优先对标 earthtojake/text-to-cad；CC Switch、MCP for Blender、FreeCAD MCP 和 Inspector 分别提供配置体验、自动安装、分层与调试方面的参考。

本次阅读了项目仓库、README、包配置及若干 LICENSE，未安装运行其 CAD 功能。下表的第三方功能为项目维护者所述；我们自己已验证的能力仍以本项目的 AutoCAD 2022 验收记录为准。

## 补充主对标：dwg-mcp 与 text-to-cad

本文的名称分别指 [bimwright/dwg-mcp](https://github.com/bimwright/dwg-mcp) 与 [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad)。补充调查直接阅读了其仓库与官方文档，未将网页计数作为新的 GitHub API 快照。

### bimwright/dwg-mcp：AutoCAD 执行与部署

该项目采用外部 .NET MCP 网关与 AutoCAD 内部插件，按宿主年份拆分插件壳，覆盖源码层面的 2022–2027 目标；目前文档将 2022–2024 的本机通信描述为 TCP NDJSON，将 2025–2027 描述为命名管道。详见 [架构说明](https://github.com/bimwright/dwg-mcp/blob/master/ARCHITECTURE.md)。这与我们拟扩展的常驻 AutoCAD 模式比一般 COM 示例更贴近。

其安装方案提供自包含服务器、ApplicationPlugins bundle、固定的 server/current 路径、客户端配置备份与失败回滚，适合直接研究其工程组织和发行形式。[安装器源码](https://github.com/bimwright/dwg-mcp/blob/master/scripts/install.ps1)

需要区分主分支功能、已发布功能、发行包内实际编译年份和真实宿主验收。README 明确要求查看 ZIP 内 manifest，其他年份可能需要相应 SDK 自行构建；不能只根据标题的 2022–2027 就承诺本机 2022 即装即用。部分主分支能力仍标记 Unreleased / installed-host acceptance pending。[README](https://github.com/bimwright/dwg-mcp#readme) / [Releases](https://github.com/bimwright/dwg-mcp/releases)

建议将其列为交互式后端的基座候选。若评估复用，应先在本机 2022 完成编译、加载、图纸身份与同类电气任务回归，再决定采用适配器、维护分叉或向上游贡献。项目提供批量工具不自动证明与我们现有的整项事务回滚、请求幂等及另存副本语义等价。

### earthtojake/text-to-cad：Skills、插件与预览的能力产品

它的重点是本地参数化三维建模、机械工程及相关二维输出，主要使用 build123d / OpenCascade，输出 STEP、GLB、STL、3MF，并有 DXF 和工程图工作流。它不提供现成的 AutoCAD 电气业务内核。[项目说明](https://github.com/earthtojake/text-to-cad#readme)

最值得借鉴的是将工作流 Skills、运行时 CLI、可选 MCP 服务和预览组合成一个能力产品；为不同 Agent 提供插件适配，并将稳定分发与开发分支区分。可以把同样形式用于电气布置、连线、编号、统计与复核，将具体任务步骤交给 Skills，将确定的图纸修改交给结构化工具。

因此，发布优先级调整为先打包稳定 MCP / CLI 和电气 Skills，提供自测及图纸预览，再用桌面向导增强配置体验。Skills 单独安装能教会 Agent 流程，但实际写入 AutoCAD 仍需本机执行后端。

### 同名方向：dimitrovakulenko/dwg-mcp-server

[该仓库](https://github.com/dimitrovakulenko/dwg-mcp-server) 主要通过 LibreDWG 读取、查询和渲染 DWG / DXF，源文件保持只读，支持在内存中修改部分属性后检查和渲染。它与 bimwright 的 AutoCAD 宿主插件属于不同方向。

它的 npm 启动器按平台获取发行二进制、核对校验和并缓存，值得借鉴分发方式；若希望增加无 AutoCAD 的读图和预览，可作为候选。当前不能据此承诺原生 AutoCAD 插件、自定义对象或工程 DWG 回写能力。[README](https://github.com/dimitrovakulenko/dwg-mcp-server#readme)

补充许可证记录：bimwright/dwg-mcp 标注 Apache-2.0；earthtojake/text-to-cad 的 [LICENSE](https://github.com/earthtojake/text-to-cad/blob/main/LICENSE) 为 MIT；dimitrovakulenko/dwg-mcp-server 标注 GPL-3.0。若实际纳入代码或二进制，再单独核对相应版本的组件边界和许可证声明。

## 优先参考项目

| 项目 | 当次星标 / 最近推送 UTC | 已观察到的形式 | 对本项目的启发 |
| --- | --- | --- | --- |
| [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) | 30,912 / 2026-10-06 | 原名 blender-mcp；宿主 addon + MCP server；提供 setup、addon 安装、多客户端配置和原配置备份 | 把客户端检测、插件部署、配置备份收敛到一个 setup 流程；首页先给出可复现演示 |
| [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp) | 2,881 / 2026-10-13 | addon 与 src/freecad_mcp 分离；docs、examples、tests 独立；客户端启动协议服务 | 将 AutoCAD 插件、MCP 服务和专业示例分开维护；新增 CAD 适配器时保持工具契约稳定 |
| [daobataotie/CAD-MCP](https://github.com/daobataotie/CAD-MCP) | 609 / 2026-09-15 | 直接面向 AutoCAD / GCAD / ZWCAD 的项目；README 描述 COM 接入、查询、图元编辑、图块、截图反馈及协议输出 | 作为同类功能对照，建立“读图—操作—核对”的演示；其跨 CAD 支持仍需我们各自验证 |
| [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | 144,656 / 2026-10-15 | Tauri 桌面程序；Windows MSI 与便携 ZIP；MCP 配置同步、原子写入、自动备份、托盘与更新 | 对普通设计人员提供清楚的连接状态、配置向导、诊断、恢复和发行包 |
| [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) | 11,082 / 2026-10-14 | 面向 MCP 的 Web / CLI / TUI 检查工具；支持工具发现、调用与调试 | 将 Inspector 作为开发者排障和协议验收入口；展示实际工具返回和错误语义 |

上述项目的主要参考来源：

- [MCP for Blender 安装和组件说明](https://github.com/ahujasid/mcp-for-blender#quickstart)
- [FreeCAD MCP 快速开始和文档目录](https://github.com/neka-nat/freecad-mcp#quick-start)
- [CAD-MCP README](https://github.com/daobataotie/CAD-MCP#readme)
- [CC Switch 安装发行](https://github.com/farion1231/cc-switch#download--installation)、[功能说明](https://github.com/farion1231/cc-switch#readme)
- [MCP Inspector README](https://github.com/modelcontextprotocol/inspector#readme)

## 补充比较

[thewisekape/autocad-mcp](https://github.com/thewisekape/autocad-mcp) 当次为 7 星、最近推送 2026-04-05。它的 README 描述 File IPC、COM、ezdxf 三种后端及批量工具，适合参考后端分类；社区规模和当前维护信号不足以支持将它列为主要成熟基座。其宣称的支持范围与性能百分比未在本机验证。

[CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) 当次为 52,663 星、最近推送 2026-10-15。可参考桌面应用的文档、用户引导和发行组织；本项目的主要价值是 CAD 能力接入，完整模型聊天工作台会增加维护范围。

## 产品形态建议

对用户表现为一个 CAD AI Connector，暂以 `cad-ai-bridge` 作为工作名称，正式仓库与包名称发布前再确认。

### 使用流程

1. 从 GitHub Releases 下载 Windows 安装包或自包含便携包。
2. 自动检测 CAD；多版本并存时由用户选择，显示该版本是否已验证。
3. 选择工作目录与 AI 客户端，显示将写入的配置条目，备份后增量配置。
4. 执行自测，完成“创建测试图—布置—连线—编号—保存—重开—统计”。
5. 日常在现有 AI 客户端发起任务，在连接器中查看状态、输出图纸和诊断。

连接器配置现有 AI 客户端的 MCP 能力，模型鉴权继续由客户端管理。不同客户端使用各自的配置适配器；不能假设 JSON、TOML 或其他配置格式相同，也不能假设所有网页端 AI 都能启动本地 stdio 服务。

### 共用一份安装和检测逻辑

0.2 预览已实现以下命令；实际使用见 [README](../README.md)：

```text
cadbridge setup       检测 CAD、构建插件、备份并生成项目本地配置
cadbridge doctor      检查宿主、插件；可选 --native 检查原生运行时
cadbridge mcp         启动 stdio MCP 服务
cadbridge selftest    运行生成图纸的完整闭环
cadbridge demo        一条命令生成并验证合成图
```

桌面向导调用同一套 setup / doctor 服务，避免 CLI 和 GUI 各自实现一份注册表、路径和配置修改规则。安装器采用固定版本内容和可核对的校验和，配置写入支持备份、幂等和恢复。

### 技术取舍

现阶段保留已验证的 Node MCP 层、C# AutoCAD 插件和 Core Console 批处理。先解除开发机依赖，再封装分发；桌面 UI 可采用 .NET，也可评估 CC Switch 的 Tauri 形式。UI 框架的选择以维护者熟悉程度、安装体积和外部进程控制验证结果为依据。

协议服务负责契约和任务状态；CAD 后端负责宿主执行；电气图块和规则独立成为可版本化的目录。以后增加常驻 GUI、命名管道或其他 CAD 后端时，优先复用现有电气工具契约。

REA 保持为维护者的接口调查工具。0.2 已移除对其本地运行目录的回退依赖，使用项目自己的锁定依赖。配置为项目所有文件；客户端专用配置写入器、桌面向导与卸载器保留为后续工作。

## GitHub 仓库组织

下面是演进目标，不要求在首次公开前机械拆成很多独立包：

```text
cad-ai-bridge/
  src/                       MCP 服务、任务和宿主调度
  plugins/autocad/           C# 插件及版本适配
  apps/desktop/              配置和诊断界面
  examples/electrical/       自行生成的符号、请求和演示图
  tests/unit/               无 CAD 的契约、配置和路径测试
  tests/integration/        真实 CAD 的保存、重开和回滚回归
  docs/                     安装、兼容表、工具、排障、开发指南
  packaging/                安装包和便携包构建
  .github/                  Issue、PR 模板和工作流
```

首页突出用户可理解的成果：短演示视频、测试图、三步安装、已验证版本、工具列表、常见错误、问题反馈。提供中文和英文入口，Issue 模板收集软件版本、doctor 报告、预期行为和最小复现。

公开贡献采用 Issue / PR 流程、版本化 Changelog 和 GitHub Releases。普通 CI 跑无 CAD 的测试；真实 CAD 回归在维护者有相应安装环境的测试机受控运行，发行说明附上该版本的运行证据。不要把模拟后端通过当作真实 CAD 兼容通过。

## 0.2 落实情况与后续验收

| 项目 | 当前观察 | 下一步验收 |
| --- | --- | --- |
| 分发依赖 | 独立依赖、锁文件、setup.cmd、开发者预览 ZIP 与校验清单 | 带运行时的离线包与干净机器安装验收 |
| CAD 检测 | 注册表发现、多实例选择、所选实例的语言和 profile | 其他版本与语言的真实兼容验证 |
| AI 配置 | setup 生成并备份项目本地 MCP 配置，保留客户端设置 | 专用客户端配置适配、增量写入、恢复 |
| 插件加载 | 双宿主、安全加载、临时信任与 Tips 恢复、明确预载完整天正内核 | 常驻宿主与升级/卸载归属验证 |
| 测试 | 无 CAD 单元测试、16 项 CAD、11 项原生天正、4 项 MCP 结果验收 | 干净机器、更多授权样图和版本组合 |
| GitHub 基础 | MIT、贡献指南、第三方声明、Changelog、CI、Issue/PR 模板与发布检查 | 维护者实际创建远程并发布；本次不推送 |
| 示例 | 可重建测试图、实际 DXF 派生的合成 SVG、脱敏验收摘要 | 更真实的授权图块目录与专业对照样例 |

仓库范围限定在中间层源码、文档和自行生成的示例；现有工程原图、REA 源码副本、运行缓存及 AutoCAD 安装组件留在本地。发布的插件包包含我们构建的组件，CAD 宿主引用由构建和运行环境提供。

当前按可复现安装的开发者预览发布边界准备，再演进为带向导的 Windows 安装版。首次支持表只承诺已验收的 Windows x64 / AutoCAD 2022 / 天正 V8 读取和受控合成图写入；其余版本与专业对象通过独立兼容证据逐项扩大。详见 [技术方案](technical-plan.md) 和 [打包说明](releasing.md)。

## 许可证与引用记录

CC Switch、MCP for Blender、neka-nat/freecad-mcp 和 CAD-MCP 的当次 LICENSE 为 MIT；thewisekape/autocad-mcp 为 Apache-2.0；Cherry Studio 为 AGPL-3.0。Inspector 的 GitHub API 显示 NOASSERTION，其 README / LICENSE 说明存在 Apache-2.0、原 MIT 代码和文档 CC-BY-4.0 的过渡安排，因此不能仅凭过去印象标为纯 MIT。

许可证来源：[CC Switch](https://github.com/farion1231/cc-switch/blob/main/LICENSE)、[Blender](https://github.com/ahujasid/mcp-for-blender/blob/main/LICENSE)、[FreeCAD](https://github.com/neka-nat/freecad-mcp/blob/main/LICENSE)、[CAD-MCP](https://github.com/daobataotie/CAD-MCP/blob/main/LICENSE)、[Inspector](https://github.com/modelcontextprotocol/inspector/blob/main/LICENSE)、[Cherry Studio](https://github.com/CherryHQ/cherry-studio#license)、[thewisekape](https://github.com/thewisekape/autocad-mcp/blob/main/LICENSE)。

本轮产出为形式和维护策略对标，没有导入第三方项目源码。本项目可优先考虑 MIT 开源形式；实际选定 LICENSE、纳入外部代码或素材时，分别记录来源、版本、许可证和所需声明。此文不替代对将发布内容的逐项检查。
