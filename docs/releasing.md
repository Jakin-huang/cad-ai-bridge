# 预览版打包与发布准备

用户包主入口为 `开始使用.exe`，配套离线 `使用说明.html`。打包时使用系统 .NET Framework 编译 `scripts/UserLauncher.cs`，生成自有窗口启动器，并把二进制摘要与源文件摘要写入清单；不额外分发 Windows PowerShell 5.1 系统程序集。接入界面调用现有 setup，并在用户目录保存本机日志。命令行入口保留。

维护者另运行 `tests/user-onboarding.ps1 -Project <隔离解压目录> -TestRoot <隔离测试目录> -ReportPath <报告.json>`，验证真实安装后端的目录选择/记忆/更换和失败保护。`开始使用.exe -RenderTo <输出.png> [-PreviewReport <真实后端报告.json>]` 是无安装操作的控件布局核查模式，不代表桌面点击流程通过。

当前冻结发行标识为 **v0.2.0-preview.2**（[发布说明](releases/v0.2.0-preview.2.md)）。`release.json` 管理发行版本、日期和渠道；`package.json` 与 .NET 插件维持 `0.2.0` 兼容版本。两者不能混作稳定性承诺。

本地发布顺序：完成测试和公开文件审计，提交全部公开源码，创建同名 Git 标签，再运行 `node scripts/package-release.mjs --user --frozen`。冻结打包要求工作树干净、标签指向 HEAD，清单记录提交和 tree；同名 ZIP 已存在时拒绝覆盖。正式用户附件名为 `cad-ai-bridge-0.2.0-preview.2-windows-x64.zip`，附同名 `.sha256`。GitHub 发布时选用该标签并标记 **Pre-release**，正文使用本版发布说明。

`node scripts/audit-public.mjs` 检查全部可达 Git 历史 blob 和公开文件清单，包括已删除旧文件；匹配结果不输出密钥原文，详细报告留在 artifacts。该检查覆盖常见密钥格式、个人路径、禁止公开的文件和二进制，不替代专门的密钥扫描或权属审查。原有 Git 作者身份和邮箱仍保留在历史中，仓库公开时也会公开；本轮不改写既有提交。

打包后先在未安装的解压目录运行 `node scripts/verify-package.mjs <目录>`，检查无额外文件、全量 SHA-256 和用户包运行时固定摘要。然后用 `tests/windows-user-package.mjs` 进行隔离客户端、离线安装、真实 CAD、升级与回退验收，用 `tests/windows-dependency-repair.mjs` 验证依赖恢复，最后运行 `scripts/verify-user-repack.mjs` 做最终核对。冻结包须保留原始字节；后续修复创建新的预览版号。

发行提供两种 ZIP。**Windows 用户预览包**包含源码、Skill、项目插件、锁定依赖及官方 Node/PowerShell 便携 ZIP，普通权限下可离线准备桥梁环境。**Windows 开发者预览包**体积较小，不含运行时；缺失时从官方地址下载固定版本并校验 SHA-256。二者不使用 winget 或系统安装器，不修改系统 PATH；运行时存放在 `%LOCALAPPDATA%\CADBridge\runtimes`，避免深目录触发 Windows 5.1 的长路径限制。AutoCAD 2022、.NET Framework 4.8 与可选天正 V8 仍来自用户正常安装和授权的软件。[用户发行验收](windows-user-release.md)

获取源码或解压 ZIP 后，可以运行 `setup.cmd --workspace "D:\CAD-work"`。脚本准备 Node/PowerShell、检查锁定依赖、检测宿主，并复用通过目标版本、DLL 与源码摘要校验的本项目插件；需要时才下载依赖或构建插件。工作目录自动创建；未填写时为项目目录。本项目生成的任务输出也允许重新读取，无需将整个上级目录开放为工作区。`--rebuild` 强制构建；`--skip-build` 也要求插件通过校验。

将生成的 `mcp-config.local.json` 导入客户端，或运行 `setup.cmd --workspace "D:\CAD-work" --client-config "D:\AI-config\mcp.json"`，仅合并本项目服务条目并备份原文件；其他字段和服务保留。配置位置由用户明确提供，不猜测客户端私有目录。Skill 指引随包提供；基础工具调用不要求安装 Skill。运行 `cadbridge.cmd mcp` 或 `cadbridge.cmd mcp --read-only` 可启动服务。

维护者在有本机 CAD 的 Windows 环境构建：

```powershell
npm ci --ignore-scripts
npm run setup
npm test
node bin/cadbridge.mjs selftest --native
node tests/mcp-results.mjs
node tests/school-mcp.mjs
node tests/school-delivery.mjs     # 本地已有学校交付时，检查回读及故障注入
npm run preview
npm run check
npm run package:preview
node scripts/package-release.mjs --user   # 含离线便携运行时的用户包
```

`check` 核对普通/天正报告确实来自当前 DLL、编译时源码摘要与当前源码一致、原生宿主清理成功、摘要/分页验收通过、锁文件一致，以及公开源码的语法、链接和私有路径。静态 CI 使用 `npm run check -- --static`，不宣称完成真实 CAD 验收。

`package:preview` 采用源码白名单，另外包含本项目 DLL、移除本机路径的构建记录和锁文件明确列出的 Node 依赖，生成 ZIP、SHA-256 和包内逐文件清单。依赖保留原 LICENSE/NOTICE，不带 npm 缓存及无关包。版本包保存在被 Git 忽略的 `dist/`。包中不包含商业 CAD DLL/ARX、对象解释器、图纸、图库、个人配置或任务日志。合成 DWG/DXF 由用户本地生成，公开仓库仅带可复现方法与 SVG 预览。

在准备发布的 ZIP 中检查 `release-manifest.json`，在独立解压目录运行 `connect-workbuddy.cmd` 或 `setup.cmd` 与 `doctor`。使用 `node tests/windows-user-package.mjs <用户ZIP> <旧版本ZIP>` 验证非提权进程、离线环境、原工作区继承、真实CAD、重装与回退；随后 `node tests/windows-dependency-repair.mjs` 验证依赖缺失、下载失败和在线补齐。不同语言与干净Windows/独立标准账户仍需额外实机证据。

0.2 本机另行通过了 ZIP 解压后逐文件 SHA-256 核对、缓存依赖安装、独立工作目录 setup、随包 DLL 的 doctor，以及完整 demo（3 灯具、1 回路、6000 mm、无校验问题）。这是同一测试机上的独立目录验收，不替代干净机器验证。对刚解压且尚未安装依赖的包，可运行 `node scripts/verify-package.mjs <解压包目录>` 核对清单。

GitHub 常规 CI 只运行无 CAD 检查。真实宿主验收由维护者在自己的授权环境执行，公开 `docs/validation-summary.json` 只保留脱敏的版本、测试项、耗时、摘要字节数和插件摘要；详细日志本地留存。发布新版本时同步 README、Changelog、依赖锁文件和构建版本。

本次仅准备本地仓库和预览包。远程仓库地址、GitHub 账户和实际推送由维护者决定；未设置远程、未推送、未创建线上发行版。

新增学校流程使用额外的Python、reportlab/pypdf及本机字体，不随ZIP分发运行时或字体。维护者还需运行 `cadbridge school`，检查各页PDF渲染及设计待审清单。本地有学校交付指针时，完整发布检查会核对当前设计源码、DLL、DWG/DXF回读、PDF及交付文件哈希。测试机使用reportlab4.4.9、pypdf6.10.0；可按此版本复现。学校底图与符号均为原创，生成图纸默认仍留在artifacts。

包含工程实例适配的版本还应在维护者授权图纸的隔离副本上运行 `node scripts/verify-local.mjs <manifest.json>`。本地存在工程验收指针时，完整发布检查还会验证每张图的独立 DXF 对照、最终 DLL 摘要和全部原图/源副本哈希。详细工程报告和几何预览仍留在 artifacts，公开包仅包含通用测试流程与合成示例。
