# CAD AI Bridge

连接已有 CAD 与 AI，将需求、项目条件和标准依据组织成可追溯、可编辑的设计成果，完成修订、自检、出图和人工审核交接。

当前支持通用图纸操作、有限普通照明和办公空间方案。复杂项目的独立需求理解、完整工程设计及专业验收仍未完成；医院、学校和办公是验证案例，项目名称不决定设计流程。

## 开始使用

已验证环境：Windows 10 x64、AutoCAD 2022 简体中文；天正电气 V8 可选，WorkBuddy 为主要验证客户端。

1. 下载 [Windows 用户预览包](https://github.com/Jakin-huang/cad-ai-bridge/releases)，完整解压到可写目录。
2. 打开 **开始使用.exe**，选择图纸文件夹，点击“接入 WorkBuddy”。
3. 在 WorkBuddy 中找到 **cad-ai-bridge**，完成首次信任，并在任务中选用连接器。
4. 描述任务并查看返回的 DWG、PDF、PNG 或 CSV。常用批处理也可通过 **任务中心.cmd** 提交。

用户包自带运行环境，无需开发工具。其他 stdio MCP 客户端可导入生成的配置，并按其机制安装 Skill。详见[一页使用说明](使用说明.html)、[安装与恢复](docs/windows-user-release.md)和[接入排障](docs/troubleshooting.md)。

## 当前能力

| 能力 | 范围 |
| --- | --- |
| 图纸查询与编辑 | 对象筛选、文字/属性/图层修改、二维变换、补画、标注与清单统计 |
| 批量交付 | 多图队列、另存副本、保存重开核对、PDF/PNG/CSV、取消与有边界的恢复 |
| 工程任务（源码增量） | 来源及需求登记、条件/冲突判断、有界照明与办公空间求解、修订、自检和待审包 |
| 当前文档（实验性） | 读取视图/选择集，按文档身份与内存版本执行受控修改 |
| 可选天正扩展 | 已验证的 V8 电气对象读取，以及独立直线槽式桥架与关联标注 |

源码主线为 **v2.1 预览及后续增量**；已冻结的 Windows 用户包为 **v2.0.0-preview.1**，未包含全部源码设计能力。[工具契约](docs/tools.md) · [工程任务](docs/engineering-tasks.md)

## 使用边界

- 用户自备图纸和项目资料；仓库与用户包不分发私有图纸、厂家图库或历史测试成果。
- 保存成功、CAD 重开、自检通过与工程合格分别报告。需求遗漏、未知条件、资料冲突及专业待审项须保留。
- 两类设计包均有明确适用范围；任意复杂建筑、多专业施工设计、完整天正对象及其他 CAD 版本不在已验收范围内。
- 独立客户项目、跨模型、新机器、外部用户与专业审核仍待验收。本机开发案例不能替代这些结论。

开发计划及优先级见[实施方案](docs/engineering-design-plan.md)，实际结果见[最新 Agent/CAD 验证](docs/real-agent-standard-conditions.md)。

## 源码开发

需要 Node.js 22.19+、PowerShell 7+；运行 CAD 需本机 AutoCAD 2022 和 .NET Framework 4.8。

```powershell
npm ci
.\setup.cmd
npm test
npm run check -- --static
```

真实 CAD 测试需要相应软件环境，私有资料与运行产物保存在仓库外。[贡献指南](CONTRIBUTING.md) · [发布说明](docs/releasing.md)

[English](README.en.md) · [MIT](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md) · [变更记录](CHANGELOG.md)
