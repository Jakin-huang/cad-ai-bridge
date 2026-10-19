# CAD AI Bridge

连接用户已有 CAD 与 AI 的本地中间层，通过 MCP 和 Skill 提供读图、统计与受约束的批量修改能力。保留软件原有工作方式，减少配置和重复操作。

当前为 **v0.2.0-preview.3 用户预览版**。已验证 Windows 10 x64、AutoCAD 2022 简体中文、可选天正电气 V8 和 WorkBuddy 5.3.8。CAD 与客户端由用户正常安装和使用。

## 普通用户开始使用

1. 获取本项目 Releases 的用户 ZIP，或直接接收分享者提供的完整用户包，解压到可写的固定目录。
2. 双击 **开始使用.exe**，点选自己的图纸文件夹，点击“接入 WorkBuddy”。根目录附有可离线阅读的 [一页图文说明](使用说明.html)。
3. 在 WorkBuddy 的“自定义连接器”中找到 cad-ai-bridge，完成客户端首次信任，等待工具加载，并确认当前任务选用了连接器。

用户包携带官方便携 Node/PowerShell、锁定依赖及项目插件，无需管理员、开发环境或额外模型 API 密钥。入口显示中文进度、成功/失败建议，可记忆和更换图纸目录。[安装、升级与恢复](docs/windows-user-release.md)

**源码和发行包不提供图纸、示例数据、厂家图库、测试预览图或历史测试交付物。** 用户提供自己的图纸和输入；需要时由工具按请求生成新文件。运行任务保存在用户本地数据目录，测试资料与发行暂存目录位于项目之外。[文件边界与维护方式](docs/asset-separation.md)

## 能力与边界

| 能力 | 当前范围 |
| --- | --- |
| 接入与诊断 | 本地 stdio MCP、全局 Skill、15 个工具、CLI 与中文接入入口 |
| 识别与统计 | 已观察的天正 V8 电气实例、导线字段、回路标签分组和统计 |
| 受约束写入 | 图块布置、显式路径连线、编号、原创场景创建，保存后可回读 |
| 文件保护 | 输入快照、摘要和版本检查、事务回滚、请求幂等、另存新图 |
| 稳定性与效率 | 批量操作、任务结果恢复、分页读取、环境发现缓存、分阶段耗时 |
| 扩展工作流 | 工程副本审计及修复、基于用户自备需求的受限项目生成 |

工具不等于完整天正 SDK 或工程审查系统。嵌套块、外参、动态块写入、原生桥架、专有标注关联和其他 CAD 版本仍需适配。统计覆盖与单位假设随结果说明；缺少拓扑时，标签分组不能当作实际回路数量。

WorkBuddy 桌面流程曾通过用户辅助验收，文件卡片与手动打开已确认；不宣称内嵌 CAD 预览或完整无人值守桌面流程。**干净 Windows、独立标准账户及浏览器下载安全提示流程仍待验收。**

## 开发与接入其他客户端

需要 Node.js 22.19+、PowerShell 7+、本机 AutoCAD 2022 和 .NET Framework 4.8。运行 npm ci，然后运行 setup.cmd。将自动生成的 mcp-config.local.json 导入支持本地 stdio 的 MCP 客户端；Skill 按该客户端机制安装。[工具契约](docs/tools.md) · [WorkBuddy 接入](docs/workbuddy.md) · [排障](docs/troubleshooting.md)

npm test 运行无 CAD 测试；npm run check -- --static 检查公开源码和链接。依赖私有需求数据的专项测试仅在配置外部资料后运行，普通 CI 会明确标记跳过。真实 CAD 验证需维护者的授权软件环境，产物写到项目外，不随源码或 ZIP 分发。[贡献指南](CONTRIBUTING.md) · [发布准备](docs/releasing.md)

项目生成的可选工作流必须提供自己的需求 JSON；不再有默认学校示例或示例交付下载。[输入契约与范围](docs/school-project.md)

[English](README.en.md) · [MIT](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md) · [本版说明](docs/releases/v0.2.0-preview.3.md)
