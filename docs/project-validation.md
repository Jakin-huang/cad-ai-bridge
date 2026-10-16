# 真实工程图副本验证

工程图与详细统计留在本机，不作为公开样例上传。先将 source 目录配置为允许的工作区，或将验证副本生成在本项目 artifacts 中。

```powershell
node scripts/stage-project.mjs "D:\CAD-work\source"
node tests/project-integration.mjs "<上一步返回的 manifest.json>"
```

第一步递归清点 DWG、记录 SHA-256、排除零字节文件、制作独占副本。CAD 仅打开任务中的输入快照。验证结束后再次核对每张原图和源副本的哈希。

第二步通过真实 MCP 调用读取与原始审计，将设备 handle、块名、分类、插入点、属性，导线 handle、原始字段、几何长度及回路标签分组与导出的 DXF 独立对照。DXF 校验器独立解析 Unicode、属性附属关系、圆弧和带凸度的多段线，不将插件自己的计数作为唯一依据。

工程写入选择具有审计依据的毫米制平面图、灯具和插座模板，在既有内容以外的独立验证区域新增五个真实图块实例、两条回路及本项目编号。检查原生宿主保存与重开、块名和比例、源属性、编号、统计增量、端点、幂等和事务回滚。逐 handle 对比原有 ENTITIES 与 BLOCKS 的几何和属性；表及 OBJECTS 中正常的文档维护信息单独看待。

可用 `--resume` 复核上次已完成的 CAD/DXF 证据后继续，避免无意义重启。缓存证据必须与当前输入摘要一致；更换插件或规则后应完整重跑，不用恢复模式代替新版本验收。`node scripts/verify-local.mjs <manifest.json>` 顺序运行完整工程验收、已有宿主回归与发布检查；`node scripts/render-project-report.mjs <project-validation.json>` 生成仅本机保留的 HTML、CSV 和实际块几何预览。

真实图常包含图例、重复视图、其他专业背景、空字段、无标签线路、未分类设备与外参。根层识别一致，只证明已声明范围内的数据读取一致；没有配电箱和馈线拓扑时只报告标签分组，不宣称实际回路总量。Undefined 单位不默认换算毫米；专业采购长度、设备净量和规范判断仍需相应范围和工程依据。

原始清点与 DXF 导出可能分别成功或失败。损坏数据、宿主不支持的对象或导出错误必须单独记录；不把部分 DXF 或代理对象的外形当成已完整支持。需要时运行 cad_repair_copy，AutoCAD AUDIT 可能删除无法修复的对象，必须保留日志并对照电气记录。[Autodesk AUDIT API](https://blog.autodesk.io/audit-api-new-in-autocad-2015/)

原生宿主只在启动时预载内核，保留天正原有初始化顺序；所选安装与本机 V8 对象解释器的精确模块目录临时受信，结束后恢复。自建空白图完成初始化后，由会话 API 打开实际快照，保留原字体记录。直接扩展为预载全部 ARX 曾触发旧版 tch_public 初始化异常，该方案已撤回。缺失 SHX 仍是正式出图的环境问题，不因统计验收通过就声明恢复。

几何保护按原句柄和块记录身份校验。匿名尺寸块名称可在保存时重排，但只有身份与内部几何一致时才规范化；VIEWPORT 331 按冻结图层集合比较。图纸空间整体屏幕视口（编号 1）的视图大小等显示状态单独记录，真实布局视口仍检查。参考 [Autodesk VIEWPORT DXF](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-2602B0FB-02E4-4B9A-B03C-B1D904753D34.htm) 和 [视口编号说明](https://help.autodesk.com/cloudhelp/2019/ENU/OARX-RefGuide/files/OREF-acgsGetViewportInfo_int_int___int___int___int__.html)。
