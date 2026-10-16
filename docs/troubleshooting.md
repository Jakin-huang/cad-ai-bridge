# 安装与排障

先运行 `npm run doctor`。缺少插件时运行 setup；选择多个 AutoCAD 安装时明确给出 `--cad-root`。本版只验收 AutoCAD 2022，其他年份需要对应 API 和独立验收，不能直接复制 DLL 宣称兼容。

## 首次启动

正常启动本机 CAD 一次并完成首次使用流程。登录与授权界面由用户操作。天正“日积月累”属于普通使用提示，会在本项目独立任务期间临时抑制并恢复；该操作不改变授权数据。

图形宿主需要 Windows 交互式桌面，运行时会显示独立测试会话。CoreConsole 适合普通图块与 XData 的快速读写，不能直接替代完整天正 GUI 初始化。

## 加载失败

本项目 CLR4 DLL 使用 NETLOAD，天正原生 ARX 使用原生加载方式。工具临时信任精确插件目录，并保留安全加载原值；完整天正内核通过启动预载处理，不使用安全警告按钮作为自动化接口。

天正电气与天正对象解释器可能都提供 `tch_kernal.arx`，但文件并不相同。若打开含代理图形的 DWG 时出现另一目录的未签名提示，检查 native-status 和启动参数；不要将整个安装盘或工作区加入受信目录。

宿主通过 `/ld` 明确选择完整天正内核；`/b` 必须位于参数末尾。原生参数参见 [AutoCAD 2022 官方参考](https://help.autodesk.com/cloudhelp/2022/ENU/AutoCAD-Core/files/GUID-8E54B6EC-5B52-4F62-B7FC-0D4E1EDF093A.htm)。

## 超时与恢复

错误中会给出 jobRoot。查看 host.json、response.json、startup-preferences.json、cleanup.json 和临时 stage。源图始终保留；输入副本可能被 CAD 初始化更新，不能把该副本当作原图。

`TIMEOUT_STATE_UNKNOWN` 不代表没有写入。不要自动重复请求。配置冲突时，工具保留外部变更；先退出不相关的测试会话，再检查需要恢复的项目自有值。

本机曾设置 acad.exe 的 RUNASADMIN 兼容标记。宿主为自己的独立进程请求普通用户权限并使用显式 CreateProcess，避免 ShellExecute 的提权等待；不修改该兼容标记。启动时记录 PID、时间和路径，超时只清理自己拥有的进程。

## 数据统计不同

先看 coverage 和 unitsSource。根层 INSERT 数不等于设备数；背景建筑块不应计入设备。Undefined 单位默认只报告图面长度。原生对象未解释时会报告代理，嵌套块与外参当前不展开。

长度是图面几何长度，不是含标高、余量和根数的采购电缆量。回路字段是读取到的线路信息，不自动等同于完整电气连接拓扑。
