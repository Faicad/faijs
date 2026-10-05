# Agent Note: 零件级说明性元数据——方法链

Status: implemented

[English](2026-10-05-part-metadata-name-description.md) | 中文

## Problem

Shape 此前只能承载几何与视觉状态；零件没有一等公民的方式来携带说明性名称、描述、料号或自定义键值元数据，也没有用于承载文档级描述字段（标题、作者、版权、许可证等）的文件级容器。用户要求能给 shape 设置名称与描述，方式与颜色/材质相同的成员调用 API 风格，并要求 3MF/STEP 中零件级与整体级两类说明性字段在导入/导出中都不丢失。

## Decision（决定）

一个 shape 的说明性元数据落在新增的、JSON 可序列化字段 `Shape.meta`（`ShapeMeta = { name?, description?, partNumber?, metadata? }`），通过非 op 实例方法 `setName / setDescription / setPartNumber / setMetaField / setMeta / getMeta` 设置，与外观 API 同一成员调用形态——方法不是 op、一次调用一条 `setX` 语句、脚本内不支持链式、`api/meta.ts` 零依赖（仅 type-only 导入 `Shape`），字段随 mesh/brep 双链路一起走。文档/整体级元数据落在独立的 `FileMeta`（`title`、`description`、`designer`、`author`、`organization`、`copyright`、licenseTerms、rating、creationDate、modificationDate、application、自定义 `metadata`），不挂在任何 shape 上；随导入结果与导出选项走。op 产物在自身不声明 meta 时按引用继承 `input.meta`；显式 set 覆盖。空字符串清除对应字段/键。

导入按规范位置映射 3MF：对象级 `name`/`partnumber`/`metadatagroup` → 零件 meta（`faijs:description` 提升回 `description`），`<model><metadata>` 的 well-known 名 + vendor 键 → `FileMeta.metadata`。导出对 3MF 反向映射（零件 meta → `<object partnumber>` + `<metadatagroup>`；`FileMeta` → model 级 `<metadata>`；vendor 键补 `faijs:` 命名空间前缀）。STEP 读：通过文本解析把零件 description 与 vendor 属性并入零件 meta，把 header 字段（title、creationDate、author、organization、application、designer、description）并入 FileMeta。STEP 写：`FileMeta` header 字段经文本重写 `rewriteStepHeader`（`brep/export/step-meta-header.ts`，别名 `rewriteFileMetaHeader`）写入 P21 `FILE_NAME`/`FILE_DESCRIPTION` 两处标准实体中，限定在这些 header 槽位与规范定义位置；该改写同时被 `exportModel`/`exportModelSync` 的 STEP 分支复用、并经新增的可选 `fileMeta` 参数接入 `exportStepFromSolids`/`exportStepFromSolidsHighLevel`（宿主 worker STEP 路径经此写 header）。零件级 STEP `description`/`partNumber` 写因 occt-wasm XCAF 写侧仅暴露 name/color 标签通道而未实现。

## Alternatives considered

- 用 `note` 字段 + `setNote` 方法——否决：规范字段是 `description`，与 3MF/STEP 字段名和 faijs/TS 生态的 camelCase 风格一致，用 `description` 避免发明私有命名。
- 文件级容器命名为 `ModelMeta`——否决，改为 `FileMeta`：`Model` 更像单个零件，而 `File` 匹配文档/文件级所属范围。
- 用单一挂在 shape 上的结构同时承载零件级与文件级字段——否决：整个文件的文档字段无法属于单个 shape（「一个 shape 没有 title」）；`FileMeta` 独立保持每个事实一个家，零件不带模型级噪声。

## Consequences（收录方见英文版，此处按规范需要中文版标识）

- `Shape.meta` 与 `FileMeta` 引擎无关、JSON 安全，能干净跨 token/worker 边界；编辑器通过 `protocol.ts`、`formatLoaders.ts`、`exporters/index.ts`、以及新增的 `part-meta-store.ts`（material-store 的对偶）打通：零件名称/料号从导入 → 零件显示 → 导出全程不丢。
- 被继承的元数据是有意的兜底而非真源：需要新名的模型显式 set。
- 零件级元数据经 3MF 导入/导出往返不丢；编辑器显示名与导出读同一 store，改名处处生效。STEP 导出经 P21 header 重写 保留 `FileMeta` header 字段（title/description/designer/author/organization/application/creationDate），宿主 `exportModel` 路径与编辑器 worker STEP 路径（`exportSolids` → `exportStepFromSolidsHighLevel` 带 `fileMeta`，web/electron）都写 header；weapp 的 brepkit 逐实体通道不写 header。零件级 STEP `description`/`partNumber` 因 occt-wasm XCAF 写侧无该标签通道而未写，且文本层做实体手术违反导出红线，故如实保持未落地。

备注：本中文版为双语配对导出，权威决定以英文版本文档为准。