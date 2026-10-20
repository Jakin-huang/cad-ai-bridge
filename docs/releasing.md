# GitHub 预览版发布准备

当前发行标识为 v0.6.0-preview.1，内部包与插件兼容版本为0.2.0。用户附件为 cad-ai-bridge-0.6.0-preview.1-windows-x64.zip 和同名 .sha256；GitHub 发布标记 Pre-release。 [发布说明](releases/v0.6.0-preview.1.md)

## 文件边界

源码仅含实现、文档、测试代码和必要元数据。用户包另含项目插件、自有中文窗口启动器、锁定 Node 依赖和官方便携运行时。商业软件、图纸、示例数据、测试预览、历史测试交付、私有配置和任务日志均不分发。 [外部数据约定](asset-separation.md)

打包采用白名单并拒绝图纸格式及示例目录。开始使用.exe 与其源码摘要绑定，使用说明.html 为离线接入文档。维护者在正常授权的Windows环境编译和验证，公开摘要不包含工程内容。

## 验证与冻结

npm test 运行无CAD测试。没有维护者的外部需求数据时，相关专项明确跳过；CI不宣称完成私有案例或真实CAD验证。npm run check -- --static 核对公开文件、链接、依赖锁定和禁止资产。

v0.6专项使用自行生成的6204对象图，验证索引、统计排除、复合交付、保存几何和10种ISO出图组合。独立PDF物理核对需要维护者Python中的pdfplumber；可用CADBRIDGE_PYTHON选择该解释器。它只用于维护者验收，不是普通CAD用户的运行依赖。PDF字体及工程图框仍需另行视检。真实工程样本专项须显式提供本地manifest，不随发行包提供图纸。

四阶段专项由node scripts/verify-practical.mjs顺序执行，报告保存于本机外部artifacts目录；支持--resume恢复同一次验收。代码变更后必须明确作废受影响步骤并记录原因，再重跑对应专项与单测；插件改变则新建完整验收，不能沿用旧DLL报告。新增通用工作流、当前文档和兼容查询专项必须与最终DLL一致。完整本机验证运行 tests/integration.mjs、tests/tangent-integration.mjs、tests/mcp-results.mjs及tests/native-tangent.mjs，并分别运行tests/editing-integration.mjs的普通/天正宿主验收。CAD验收顺序执行，避免争用同一本机宿主。配置外部输入后可运行 tests/school-mcp.mjs。npm run check 核对当前插件、普通/天正、原生标注和协议报告，以及旧电气/preview.4普通编辑的UUID兼容性。--with-local-projects 另外要求外部工程/项目交付与当前源码相符；历史报告不能代替新代码的专项验证。

完成代码提交并创建对应标签后运行 node scripts/package-release.mjs --user --frozen。工作树须干净，标签指向HEAD，清单记录源码提交与tree。ZIP和解压暂存保存在项目外验证目录的dist中，不覆盖已有冻结包。

在全新解压目录运行 scripts/verify-package.mjs 核对每个文件、禁止资产和启动器源码绑定。再运行 tests/windows-user-package.mjs 验证隔离接入、真实CAD、升级与回退；tests/user-onboarding.ps1 检查中文接入后端；tests/windows-dependency-repair.mjs 验证依赖修复。最后运行 scripts/verify-user-repack.mjs 核对最终ZIP和实际MCP诊断。

GitHub常规CI不需要商业CAD或私有资料。干净Windows、独立标准账户、浏览器下载提示和其他客户端版本需要额外实机证据；本地虚拟机验收继续暂缓。

## Git 历史

发布前运行 scripts/audit-public.mjs 检查可达历史和公开文件。它不打印疑似密钥原文，报告存放在外部验证目录。原始Git作者身份仍会随公开仓库展示。若剥离历史中的旧示例，应先保存完整外部Git备份，再明确处理旧提交和标签；不能仅凭当前工作树无资产就声称历史已清除。

本轮仅准备本地项目和发行包，不自动推送或创建线上Release。
