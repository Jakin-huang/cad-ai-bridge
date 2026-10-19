# WorkBuddy 接入与验收

CAD AI Bridge 连接本机 CAD 与现有 AI 客户端。WorkBuddy 不需要另开模型账号或填写本项目 API Key；AutoCAD、天正及 WorkBuddy 本身仍需正常安装和使用。

## 普通用户操作

1. 将 Windows 用户预览包解压到用户可写的固定目录，双击根目录的 `connect-workbuddy.cmd`。它准备依赖、检测 CAD、复用匹配插件、配置 MCP 并安装 Skill；末尾显示诊断结果，窗口保留供查看。用户包带有离线运行时，无需管理员安装 Node/PowerShell。
2. 打开 WorkBuddy，在“专家·技能·连接器 → 连接器”页点击**右上角“自定义连接器”**，在 MCP 服务管理中查看 `cad-ai-bridge`。若出现“首次连接此 MCP 服务需要您的信任确认”，核对本机启动路径后点击该行蓝色**“信任”**，等待显示已连接并加载工具。“1启用”的计数不能代替首次信任或已连接状态。新建任务时，通过输入框“+ → 连接器”确认当前任务已选用，再让 AI 调用 `cad_doctor`。`cadbridge-electrical` 则在技能“我安装的”中查看。
3. 用自然语言提出任务。例如：“检查 CAD 连接。然后新建电气测试图，在 (0,0) 与 (3000,0) 各放一盏灯，连接 WL1，编号 L-001、L-002。保存后重开核对数量、3000 毫米路线和连接，给我新 DWG。”

上述流程已在本机完成用户辅助的桌面验收：全局 Skill、连接器、自然语言绘图、文件卡片交付与手动打开均通过。首次信任和部分桌面操作由用户完成，不等于无人值守的 UI 自动化通过。安装入口成功仍只代表文件准备完成。

如需处理自己的图纸，在安装时指定图纸所在目录：

```powershell
.\connect-workbuddy.cmd --workspace "D:\CAD-work"
```

再次运行接入入口会沿用已有工作目录、CAD 选择和语言；显式参数可覆盖。不要要求用户手填文档 ID、文件摘要或请求 UUID，AI 应从工具结果中携带这些值。普通绘图不需要再安装依赖或编译插件。

## 安装行为

- 自定义 MCP 配置：`%USERPROFILE%\.workbuddy\mcp.json`，仅合并 `cad-ai-bridge`，保留其他服务与字段。
- 备用的客户端添加配置：安装目录中的 `mcp-config.workbuddy.local.json`。客户端自定义入口需要 JSON 时，使用此文件的完整内容，无需手填路径、参数或环境变量。文件生成不代表该版本客户端已完成注册、信任或任务选用。
- Skill：`%USERPROFILE%\.workbuddy\skills\cadbridge-electrical\`，包含入口及独立参考文档。MCP 提供执行能力，Skill 提供调用指导。
- 配置修改前保存同目录 `.bak-*`；同名 Skill 更新前完整移到 `.workbuddy\backups\`，避免备份被重复发现。安装失败时尝试恢复旧 Skill。损坏 JSON 会停止安装，保留旧内容。
- `.workbuddy\.mcp.json` 是本机观察到的客户端代理配置，本项目不修改它，也不修改连接器凭据、账号与全局权限。
- MCP 使用已发现的 Node、桥梁配置和 PowerShell 绝对路径。WorkBuddy 调用超时设为180秒，为120秒的原生宿主及前后处理留余量。此设置不会延长桥梁自身的宿主上限。

命令行等价入口为 `node bin/cadbridge.mjs setup --client workbuddy`。测试或不同安装位置可显式指定 `--client-home <WorkBuddy用户目录>`，可用 `--dry-run` 预览。其他 MCP 客户端继续使用通用生成配置或 `--client-config <文件>`；不需要复制另一套 CAD 逻辑。

安装目录移动后需重新运行接入入口，以刷新绝对路径。升级时保留旧目录，把新版解压到新目录后双击接入入口，它会从旧连接器沿用图纸目录、CAD选择与语言。失败重试会先恢复未完成的接入事务；需要回退时，停止正在运行的CAD任务并退出WorkBuddy，双击新版的 `restore-workbuddy.cmd`，恢复上一版连接器和完整Skill，保留之后新增的其他服务和图纸。已手动修改的本项目配置或Skill不会被强制覆盖；冲突会明确报告。[故障与验收范围](windows-user-release.md)

## 本机验收结果

2026-10-19，WorkBuddy 桌面5.3.8，Windows / AutoCAD 2022 / 天正电气 V8：

| 项目 | 结果与证据 |
| --- | --- |
| 全局 Skill | “我安装的”详情页可读完整内容；实际桌面任务调用 `cadbridge-electrical` |
| 首次连接 | 用户点击蓝色“信任”后，桌面日志确认已连接并加载15工具；桥梁由 WorkBuddy 启动 |
| 自然语言操作 | 原任务发送“继续”后成功调用诊断、新建、一次批量布置／连线／编号、统计与校验 |
| 保存重开 | 2盏灯、1条WL1路线、3000毫米、L-001/L-002；问题列表为空 |
| 独立检查 | 新DWG摘要一致，原始测试图未变；独立DXF解析核实设备、坐标、编号及路线长度 |
| 文件展示 | 桌面 `present_files` 成功交付真实DWG/DXF；用户确认卡片可见、手动可以打开 |

桌面会话、代理日志和实际文件由 `tests/workbuddy-desktop-evidence.mjs` 只读核验，共7项证据检查；另记录2项与本次图纸摘要绑定的用户观察。具体本机记录保存在被忽略的 artifacts 中，公开状态见[验收摘要](maintenance-summary.json)。此前独立SDK的7项、随附CLI的6项验证继续保留，各自范围不混用。

本轮发现并修正了接入说明不够准确的问题：自定义MCP不在市场卡片中直接查找；“1启用”仍可能缺少首次信任；配置文件或代理描述出现服务名不能当作成功连接。首个未信任任务仅加载Skill和搜索工具，明确记录为失败；完成客户端确认后，原任务复验成功。Skill 同时补充了断连恢复和文件展示规则，不再让 AI 要求用户手动打开CAD、启动Bridge或加载插件作为工具发现的前提。

桌面控制组件在本次环境中出现截图超时、点击缺少坐标及窗口状态不一致，因此用户协助完成信任、任务输入与打开观察。DWG/DXF 的 `previewed` 为空：通过的是文件卡片交付及本机手动打开，未验证内嵌CAD预览或点击卡片直接调起CAD。同机验收不替代干净Windows及普通权限环境，本项目仍是开发者预览。

依据：[WorkBuddy 桌面连接器操作](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)、[连接器规范](https://open.workbuddy.cn/docs/connector)、[项目级 Skill 配置](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project)、[MCP 配置与审批](https://www.codebuddy.cn/docs/cli/mcp)。客户端版本差异以实测为准。
