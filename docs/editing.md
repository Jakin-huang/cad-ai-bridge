# 已有图纸编辑与实际 CAD 出图

开发候选增加只读scope参数：layout选择布局，includeNested展开本地嵌套，maxDepth为1—8、默认4。返回实例路径和WCS点/边界；嵌套标量使用definition_字段，外参内容不展开。默认查询仍是模型空间根层，编辑范围不随只读展开而扩大。新通用任务及当前会话见[实施记录](practical-development.md)。

v0.2.0-preview.4 新增 cad_query_entities、cad_edit、cad_export，原有15个工具保留。新增能力是结构化操作，仍在输入快照中执行，输出新DWG/DXF；没有任意命令、LISP或输出覆盖入口。普通用户沿用同一中文开始入口和Skill，无需学习句柄、请求UUID或版本信息。

## 查询与执行

AI先查询用户指定图纸，按types、layers、blockName、textContains、attributes、handles、ids或region筛选。region为WCS XY轴对齐包围框，mode为intersects或contains，并非实体精确轮廓相交。组合条件取交集。查询返回inputSha256、受管理身份、模型空间根层实体、图层、命名视图和布局；未知对象可出现在只读记录中，不代表允许写入。最多保留5000条，truncated时缩小筛选范围；传输分页读取entities不再启动CAD。

图纸没有documentId时，先cad_prepare_project，要求原文件明确声明毫米单位，再查询副本；已有受管理图纸直接查询。cad_edit与electrical_apply使用相同的摘要、文档ID、版本、UUID、单位及源文件保护。AI只提交明确选中的handles，句柄必须绑定此次文件摘要，不能跨图纸套用。操作后保存并独立重开查询，必要时对照DXF和实际PNG。

| 操作type | 输入与范围 |
| --- | --- |
| move / copy | handles、delta；普通根层对象移动或复制 |
| rotate / scale | handles、center，加angleRadians或正值factor；均为平面变换、均匀缩放 |
| mirror | handles、axisStart、axisEnd，copy默认true |
| array | handles、rows、columns、rowSpacing、columnSpacing；矩形阵列保留原对象，最多2000个新增对象/操作 |
| erase | 只删除明确句柄选中的普通对象，不级联删除业务关联 |
| set_text | TEXT/MTEXT替换内容，其他位置/高度保留；中文内容使用独立微软雅黑字体样式 |
| set_attributes | 普通INSERT实例的已有可变属性；不改共享定义、常量属性或DEVICE_ID编号 |
| set_layer | 移到已存在、未锁定的目标图层 |
| upsert_layer | name、ACI color，可显式locked/off；已锁定图层需显式locked:false后再编辑 |
| add_geometry | 新增line、polyline、arc、circle、text、solid；仍受场景几何契约限制 |
| insert_block | 插入已有普通本地定义，position、rotationRadians、layer及可选attributes；不加载外部图库 |
| offset | 普通LINE/LWPOLYLINE/ARC/CIRCLE，正负distance按CAD曲线方向解释 |
| trim | 普通LINE，fromPoint/toPoint明确指定保留段，两点必须在原线段上 |
| extend_line | 普通LINE，endpoint=start/end，position必须沿原直线向外延伸 |
| add_dimension | aligned/rotated非关联尺寸，fromPoint、toPoint、position、layer、height；rotated另有rotationRadians |
| upsert_view | 新建或更新命名平面视图，name、center、width、height |
| create_layout | 创建布局与锁定视口，name、center、width、height定义模型范围；不覆盖同名布局 |
| move_devices | ids、delta；移动本项目管理的设备。两端同移时路线整体平移；仅一端移动时调整该端，其他折点保持 |
| update_route | 本项目受管理路线id，可改vertices、from/to、circuitId、wireSpec；最终端点必须匹配显式几何锚点 |
| add_route_label | 受管理路线id、position、height、layer；普通文字标签由本项目关联和更新，不是厂家原生标注对象 |

cad_edit也可组合现有place_symbols、clone_project_symbols、connect_route、number_devices。DEVICE_ID始终走编号操作，保留冲突校验。受管理对象不能通过通用复制、缩放、镜像、阵列或删除绕过业务身份。普通对象的代理类型、动态图块、外参、未知XData、外部关联字典及反应器拒绝修改。嵌套实体不单独编辑，图层锁不会被隐式解除。

电气路线修改仅涉及本项目建立并管理的路线；已验证适配器的已知导线字段更新时保留未指定的已知值，标签随回路/规格更新。没有自动绕障碍、工程负荷推导或厂家拓扑重建。普通设备型号属性修改不等于对天正原生设备类型进行替换。

## PDF、PNG与文件反馈

cad_export接受drawing、format=pdf/png、可选layout（默认Model）、可选region。调用AutoCAD PlotEngine，使用本机DWG To PDF.pc3或PublishToWeb PNG.pc3；默认A4或1600×1280像素。局部region只用于Model，按WCS平面出图。结果包含实际驱动、介质、源图摘要、导出文件摘要与路径，失败不重放写入。PNG在4MiB以内同时作为MCP图像返回；客户端是否展示图像仍取决于自身支持。

导出不修改源DWG或已保存输出，临时打印设置仅作用于自有宿主并恢复。新建布局包含本项目视口，不能视为已有图框、打印样式和比例标准已符合工程要求。颜色保留图纸/当前样式设置，文字是否适合出图需核对实际图片。PDF和PNG是真实CAD打印结果，区别于历史业务模型生成的PDF。

## 天正原生桥架与关联标注

同一cad_edit入口支持create_native_tray、set_native_tray_size和add_native_tray_label，原有18个工具和接入方式不变。详见[原生桥架范围](native-trays.md)。原生操作使用独立批次并自动选择天正宿主；普通用户无需设置命令、模块加载路径或内部句柄。

全套原生命令、桥架弯头/三通/交叉连接、自动绕障和厂家统计窗口一致性仍未开放。原生对象的显示、业务关联及工程正确性分别核对，不用普通折线或文字冒充厂家对象。

本次真实验证覆盖现有Windows上的AutoCAD 2022和天正V8；新增功能的MCP/SDK验收与WorkBuddy历史用户辅助桌面验收分别记录。干净Windows、独立标准账户及新增功能的桌面自然语言流程仍待验收。

参考：[Autodesk PlotEngine调用阶段](https://help.autodesk.com/cloudhelp/2022/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-__MEMBERTYPE_Methods_Autodesk_AutoCAD_PlottingServices_PlotEngine.html)、[打印参数验证](https://help.autodesk.com/cloudhelp/2022/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-Autodesk_AutoCAD_PlottingServices_PlotInfoValidator_Validate_PlotInfo.html)。
