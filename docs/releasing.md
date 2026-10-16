# 预览版打包与发布准备

当前发行形式是 **Windows 开发者预览 ZIP**：源码、锁文件、电气 Skill、公开合成预览和本项目编译的插件。需要已安装 Node.js 22.19+、PowerShell 7+、.NET Framework 4.8 和正常授权的 AutoCAD 2022；原生后端另需天正电气 V8。ZIP 不包含 Node 运行时，首次安装依赖需要网络。普通用户桌面向导和全套离线运行时属于后续版本。

获取源码或解压 ZIP 后，可以运行 `setup.cmd --workspace "D:\CAD-work"`。脚本检查 Node/PowerShell、执行锁定依赖安装、检测宿主、编译本项目插件并生成项目本地配置，然后运行 doctor。工作目录应事先存在；未填写时为项目目录。本项目生成的任务输出也允许重新读取，无需将整个上级目录开放为工作区。

将 `mcp-config.local.json` 中对应的 MCP 条目添加到所用客户端。自动配置当前生成可审查的项目配置；各客户端的专用配置写入器尚未实现。运行 `cadbridge.cmd mcp` 或 `cadbridge.cmd mcp --read-only` 可启动服务。

维护者在有本机 CAD 的 Windows 环境构建：

```powershell
npm ci --ignore-scripts
npm run setup
npm test
node bin/cadbridge.mjs selftest --native
node tests/mcp-results.mjs
npm run preview
npm run check
npm run package:preview
```

`check` 核对普通/天正报告确实来自当前 DLL、编译时源码摘要与当前源码一致、原生宿主清理成功、摘要/分页验收通过、锁文件一致，以及公开源码的语法、链接和私有路径。静态 CI 使用 `npm run check -- --static`，不宣称完成真实 CAD 验收。

`package:preview` 采用源码白名单，另外仅包含本项目 DLL 和移除本机路径的构建记录，生成 ZIP、SHA-256 和包内逐文件清单。版本包保存在被 Git 忽略的 `dist/`。包中不包含商业 CAD DLL/ARX、对象解释器、图纸、图库、个人配置、依赖缓存或任务日志。合成 DWG/DXF 由用户本地生成，公开仓库仅带可复现方法与 SVG 预览。

在准备发布的 ZIP 中检查 `release-manifest.json`，在独立解压目录运行 `setup.cmd` 或 `npm ci` 与 `doctor`。干净 Windows 机器的首次安装、不同语言版本和普通用户向导尚未完成兼容验收。

0.2 本机另行通过了 ZIP 解压后逐文件 SHA-256 核对、缓存依赖安装、独立工作目录 setup、随包 DLL 的 doctor，以及完整 demo（3 灯具、1 回路、6000 mm、无校验问题）。这是同一测试机上的独立目录验收，不替代干净机器验证。对刚解压且尚未安装依赖的包，可运行 `node scripts/verify-package.mjs <解压包目录>` 核对清单。

GitHub 常规 CI 只运行无 CAD 检查。真实宿主验收由维护者在自己的授权环境执行，公开 `docs/validation-summary.json` 只保留脱敏的版本、测试项、耗时、摘要字节数和插件摘要；详细日志本地留存。发布新版本时同步 README、Changelog、依赖锁文件和构建版本。

本次仅准备本地仓库和预览包。远程仓库地址、GitHub 账户和实际推送由维护者决定；未设置远程、未推送、未创建线上发行版。
