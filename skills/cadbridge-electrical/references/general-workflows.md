# CAD AI Bridge 通用任务

优先发现 cad_capabilities、cad_workflow 和 cad_get_job。工具有客户端前缀时按实际名称调用。保持现有安装目录名 cadbridge-electrical 以兼容升级；本说明面向通用 CAD，专业流程按需另读。

cad_workflow 自动冻结输入、查询、在毫米制副本执行、重新打开保存结果并交付。requestId 使用新UUID；同一请求重放返回原有结果。断连后先以该ID调用cad_get_job，不用新UUID重做写入。任务保存在本地，技术字段由AI传递。

五种 plan.type：

- replace_text：search、replacement，match=exact/contains，caseSensitive默认true；明确filter.types为TEXT/MTEXT。替换是文字匹配，不执行正则或命令。
- organize：attributes和/或layer。属性修改必须筛选INSERT；只改已有可变实例属性，DEVICE_ID使用原有专用编号工具。目标图层必须存在且可编辑。
- takeoff：groupBy可选type/layer/blockName，attributeTags列出要分组的属性。返回明细和汇总CSV。模型空间根层计数包含图例和重复视图，用户需用图层/区域排除；不当作采购净量。
- edit：operations复用普通cad_edit操作；所有目标句柄必须在本次filter选择中。用于阵列、复制、补画和尺寸；受管理电气身份和原生天正操作使用专用工具。
- export_batch：items每项包含唯一name、format=pdf/png、layout，Model可附region。name仅用字母数字下划线短横线；输出目录由Bridge管理。结果逐项报告，成功项保留，失败项可用新的只读导出请求单独重做。

preview默认true；修改前后PNG直接作为MCP图像返回，显示仍取决于客户端。reviewRegion可明确复核范围，默认根据选中实体边界估算，复制到远处或大阵列应显式给出覆盖修改前后的区域。图像失败以warnings报告，不重放修改。文件卡片使用工具返回的确切路径。

写入要求图纸声明为毫米；未管理图纸自动准备副本。其他单位、未知单位明确报告，不静默转换。查询截断或存在读取错误时停止任务，缩小筛选后再做。超过5000条选择、100个操作或普通编辑范围的任务需分为用户可理解的独立工作范围，不通过逐个对象调用绕过原子边界。

变更清单针对本次选择及操作返回的新增模型空间实体。它不等同于全图保留审计；完整工程验证仍使用工程审计流程。查询和图像均来自冻结的输入或保存输出，不能用旧结果证明用户后来修改过的图纸。
