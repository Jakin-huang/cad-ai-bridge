# CAD AI Bridge 通用任务

按本次任务发现 cad_workflow；只有新建图纸才需要 cad_create_drawing，连接检查才需要 cad_doctor，异常恢复才需要 cad_get_job。能力问题才调用 cad_capabilities。不要默认发现全部工具。工具有客户端前缀时按实际名称调用。

cad_workflow 自动冻结输入、查询、在毫米制副本执行、重新打开保存结果并交付。requestId 使用新UUID；同一请求重放返回原有结果。断连后先以该ID调用cad_get_job，不用新UUID重做写入。任务保存在本地，技术字段由AI传递。

已有新图需要替换标题并交付时，直接按此形态调用，不搜索源码或再次读取同一工具契约：

```json
{"drawing":"<刚返回的新DWG路径>","requestId":"<新UUID>","filter":{"types":["TEXT","MTEXT"]},"plan":{"type":"replace_text","search":"测试","replacement":"CAD AI Bridge"},"preview":false,"response":"summary","delivery":{"csv":true,"exports":[{"name":"preview","format":"png"}]}}
```

通用工具公开契约精简了edit.operations的长列表；执行层仍逐项严格校验。只有需要具体几何操作时才发现cad_edit获取详细参数，不为文字替换、CSV或出图加载该长契约。

五种 plan.type：

- replace_text：search、replacement，match=exact/contains，caseSensitive默认true；明确filter.types为TEXT/MTEXT。替换是文字匹配，不执行正则或命令。
- organize：attributes和/或layer。属性修改必须筛选INSERT；只改已有可变实例属性，DEVICE_ID使用原有专用编号工具。目标图层必须存在且可编辑。
- takeoff：groupBy可选type/layer/blockName，attributeTags列出要分组的属性。返回明细和汇总CSV。模型空间根层计数包含图例和重复视图，用户需用图层/区域排除；不当作采购净量。
- edit：operations复用普通cad_edit操作；所有目标句柄必须在本次filter选择中。用于阵列、复制、补画和尺寸；受管理电气身份和原生天正操作使用专用工具。
- export_batch：items每项包含唯一name、format=pdf/png、layout，Model可附region。name仅用字母数字下划线短横线；输出目录由Bridge管理。结果逐项报告，成功项保留，失败项可用新的只读导出请求单独重做。

通常设response="summary"，完整记录仍保存在任务内。若用户需要修改后的CSV/PNG/PDF，在同一个编辑工作流附delivery:{csv:true,exports:[{name:"preview",format:"png"}]}。CSV覆盖保存后全部已捕获模型根层并应用exclude，不只统计编辑选择。最终PNG同时返回图像；不另发takeoff/export获取相同结果。已有最终PNG时可设preview=false避免额外两次打印。需要前后对照时保留preview=true，并按需给reviewRegion。结果卡片或链接使用delivery.files中的确切路径，不把文件存在等同于客户端已展示。

写入要求图纸声明为毫米；未管理图纸自动准备副本。其他单位、未知单位不静默转换。工作流单次捕获至多100000条，遍历预算仍为100000；截断或读取错误时停止，不能声称完整统计。每批至多100个操作项，一个文字/属性项可批量处理至多1000个句柄，不逐个对象发起工具调用。

统计可给scope.layout/includeNested/maxDepth只读展开，并用exclude.layers/handles/blockNames/regions明确排除图例或重复区域；返回排除数和口径。不自动猜测图例，不把嵌套definition_长度当世界长度，不把图面数量当采购净量。

大图反复查询用cad_scan_drawing一次捕获并建本地索引，随后cad_read_result传jobId、kind="entities"、filter、fields、offset、limit。后续页带expectedResultSha256，防止中途结果变化；这些读取不启动CAD。捕获反映当时文件副本，不能证明后续人工修改后的状态。

PDF可显式plot:{paper:"A3",orientation:"landscape",scale:"fixed",denominator:100,style:"monochrome.ctb"}。固定比例只支持毫米制Model，超出保守可打印范围时拒绝而非静默裁切；布局固定比例需另行设置视口。PDF页大小/方向和CAD实际比例设置会核对，字体外观仍需看图。

保存后比较未选中ENTITIES/BLOCKS的DXF记录及主要平面几何；表、字典、厂商内部关联不是完整保留证明。review.pendingGeometry列出尚无独立几何后置检查的操作，不能声称全面验证。保存后验证或导出失败仍保留DWG，先恢复原任务，不能重放写入。

最终交付直接逐行采用返回的 delivery.markdown，里面已经包含本次真实 DWG、CSV、PNG/PDF 的 Markdown 链接。保持方括号和链接目标，不改写成反引号路径或纯路径清单；不要重构、猜测或缩短文件地址。链接之后只需简述核对结果与未验证项。
