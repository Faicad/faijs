# 2026-10-05 faijs 零件名称/备注（说明性元数据）API 设计

状态：方案（未实施）
作者：MainAgent（会话调研结论 + 用户 2026-10-05 需求重写）
替代：无（新主题；延续 PBR 外观方案的方法模式，见 [2026-10-05-faijs-pbr-appearance-api-design.md](./2026-10-05-faijs-pbr-appearance-api-design.md)）

## 0. 用户原话（最高优先级，直接引用）

> 现在，请写一份新的方案。我需要能够给零件/shape设置名称和备注，类似设置颜色、材质类似的做法和api设计。此外，你还需要查看3mf/step的格式规范，还有哪些说明性的字段，哪些是到零件的，哪些是到整体的。我们也都需要支持。

> 既然规范里description，那么我们的设置备注就不用要setNote, 用setDescription这样的。此外，faijs/ts语言里，整个开源社区，是用哪种风格，比如setName, set_name? 我们要保持一致。

需求拆解（本文档的验收锚点）：

1. faijs 模型**能给零件/Shape 设置名称和描述**，写法与颜色/材质一致（`box1.setName(...)` / `box1.setDescription(...)` 成员调用形态，PBR 外观方案 §3.3 同款执行机制）。
2. **盘点 3MF/STEP 格式规范的全部说明性字段**（名称、描述、料号、作者、版权等），明确**到零件**与**到整体**的分类。
3. **两类字段都要支持**：到零件的随 Shape 走（`Shape.meta`），到整体的随模型/文件走（`ModelMeta`，导入导出不丢）。
4. 外部 STEP/3MF 导入导出**按已有格式规范字段承载**（3MF `<object name>`/`partnumber`/`metadatagroup`/model `<metadata>`；STEP `PRODUCT`/header/`PRODUCT_IDENTIFICATION`/UDA），不发明私有字段。
5. **备注字段与方法命名**：字段叫 `description`（与 3MF/STEP 规范字段名一致，不叫 note）；方法名 `setDescription`。
6. **命名风格**：camelCase（`setName`/`setDescription`）——faijs 是 TS/JS 生态（`.fai.js` 为合法 JS 子集），社区标准与既有先例一致（§2.5）。

## 1. 背景与目标

PBR 外观方案（同日 v2）已建立「外观设置 = Shape 实例方法 + `Shape.appearance` 数据字段」的闭环：方法非 op、成员调用语法、跨 worker JSON 传递、导入导出按规范字段往返。**名称/备注是同一类需求**（零件级说明性元数据），但承载对象不止 Shape——3MF/STEP 规范里还有**文档/整体级**说明性字段（标题、作者、版权、许可证等），这些不属于任何单个零件，需要独立的 `ModelMeta` 承载。

目标：

- 零件级：`Shape.meta`（name/description/partNumber/自定义键值），方法设置，导入导出不丢。
- 整体级：`ModelMeta`（title/designer/description/copyright/licenseTerms/…），随模型文件导入导出不丢（编辑器项目级；脚本设置整体级作为 Phase 2，见 §12 ①）。
- 两种字段都按规范位置落盘：读入时从规范位置提取，写出时写回规范位置。

## 2. 设计原则

1. **延续外观方案的全部既定约束**：方法**不是 op**（不进 `defineOp`/`api-namespace`/args-schema）；写法是 `box1.setX(...)` 成员调用（复用 `asm1.solve()` 的 `classifyOpCall` receiver 机制，脚本面一次一条 setX 语句，链式不支持）；数据字段 JSON 可序列化、随 Shape 走 mesh/brep 双链路；`api/meta.ts` 零依赖（不 import THREE/occt/store），mesh/types 与 meta 类型环为 type-only。
2. **零件级 vs 整体级分开**：零件级挂 `Shape.meta`（方法设置）；整体级挂模型（`ModelMeta`，导入结果 / 导出选项；**不挂 Shape**——整体不是零件，`box1.setTitle` 无意义）。
3. **继承语义与外观一致**：op 产物构造点默认继承 `input.meta`（合并，undefined 不覆盖）；需要新名的产物（组合/变换后）由用户显式 `setName` 覆盖。理由：与 `appearance` 同一包装点、行为可预期；名称是显式声明，继承只是保底。
4. **宽容读取、按规范写**：外部文件未知 metadata 键**读入保留**（`meta.metadata`/`ModelMeta` 兜底），不因不识名而丢弃；写出时**只写规范位置**（3MF metadatagroup 需 vendor 命名空间前缀、STEP 无对应位置的字段不发明实体）。
5. **纯增量**：本方案不改动现有字段与语义（与 PBR 方案的破坏性变更不同——`Shape.meta` 是新字段，`ExportEntry.name` 既有语义不动，仅扩展 description/partNumber）。

### 2.5 命名风格：camelCase（依据）

faijs 的公开标识符与**整个 TS/JS 生态一致**：

- **faijs 语言本体**：`.fai.js` 是合法 JS 子集（L0 文本层），标识符天然遵循 JS 词法；既有 API 全为 camelCase——`cad.box`/`cad.union`/`asm1.solve()`、PBR 外观方案已定 `setAppearance`/`setColor`/`setMaterial`/`setOpacity`/`setFaceColor`/`setFaceMaterial`（用户已接受，v2 方案全篇 camelCase）。
- **TS/JS 社区标准**：方法名/函数名 camelCase 是 MDN 代码风格指南、AWS TypeScript 最佳实践、`typescript-eslint/naming-convention`（默认首选 camelCase）的一致结论；三大框架与 Node 生态（Three.js、Babylon.js、React 等）无一例外。
- **对照（非本生态）**：CadQuery 用 snake_case（`assy.add(name=..., color=...)`、`cq.Color`），但它属于 **Python 生态**（PEP 8），不构成 faijs 的参照系——faijs 不是 Python 绑定，是独立 TS 语言与运行时。
- **同类几何库（JS 侧）**：Three.js（`Color.set`、`MeshStandardMaterial` 属性）、OCCT 的 JS/TS 绑定层均以 camelCase 暴露。

结论：**`setName`/`setDescription`/`setPartNumber`/`setMeta`/`getMeta`**，不用 `set_name` 等 snake_case。

## 3. 规范字段盘点（3MF / STEP，到零件 vs 到整体）

### 3.1 3MF Core Specification 1.3.0

**整体级（Model context）**——`<model>` 根下 `<metadata name="...">`，标准名（表 3-1）：

| 字段 | 3MF 名 | 说明 |
|---|---|---|
| 标题 | `Title` | 3MF 文档标题 |
| 设计者 | `Designer` | 文档设计者名 |
| 描述 | `Description` | 文档描述 |
| 版权 | `Copyright` | 版权 |
| 许可 | `LicenseTerms` | 许可证信息 |
| 评级 | `Rating` | 行业评级 |
| 创建时间 | `CreationDate` | 源应用创建日期 |
| 修改时间 | `ModificationDate` | 最后修改日期 |
| 源应用 | `Application` | 创建文档的源应用名 |

规则：well-known 名（上表）不带命名空间；自定义名必须带模型上声明的 XML 命名空间前缀（vendor 定义）；同名 metadata 不得重复；`preserve` 属性指示消费者保留；`type` 属性可标注值类型（默认 `xs:string`）。

**零件级（Object context）**——`<object>`：

| 字段 | 3MF 位置 | 说明 |
|---|---|---|
| 名称 | `<object name="...">` 属性 | "Name of object to improve readability"（Bambu 等导出人类标签） |
| 料号 | `<object partnumber="...">` 属性 | 零件号；规范要求编辑/派生时**尽量保留**（拆分复制、合并移除、修改保留） |
| 自定义键值 | `<object><metadatagroup><metadata name="vendor:xxx">` | vendor 命名空间前缀的任意键值 |

**实例级（Item/Component context）**——`<build><item partnumber>`、`<item><metadatagroup>`、`<component>`：装配实例/组件的料号与自定义键值（本方案映射到编辑器装配实例层，见 §7）。

### 3.2 3MF Production Extension

- `<object>` / `<component>` / `<item>` / `<build>` 的 `UUID`（required）——跟踪用唯一标识，非文本说明，**本期不纳入 meta**（编辑器内部已有 scopedId 体系）。
- `<object thumbnail>`——缩略图 URI，**不纳入**（编辑器有渲染视图）。

### 3.3 STEP（ISO 10303-21 header + AP203e2/AP214/AP242 实体）

**整体级（Header）**——P21 文件头：

| 字段 | STEP 位置 | 说明 |
|---|---|---|
| 文件名/标题 | `FILE_NAME('name', ...)` 第一参 | 文件名（可作标题） |
| 时间戳 | `FILE_NAME` 第二参 | 创建时间 |
| 作者 | `FILE_NAME` 第三参（列表） | 作者（取第一个） |
| 组织 | `FILE_NAME` 第四参（列表） | 组织（取第一个） |
| 预处理程序 | `FILE_NAME` 第五参 | 源应用 |
| 发起人 | `FILE_NAME` 第六参 `originator` | 发起人 |
| 描述 | `FILE_DESCRIPTION(('...'), '2;1')` | 文件级描述（列表取第一个） |

**零件级（Product 实体）**：

| 字段 | STEP 位置 | 说明 |
|---|---|---|
| 名称 | `PRODUCT('name', 'description', frame)` 第一参 | 产品名（装配内唯一标识） |
| 描述 | `PRODUCT` 第二参 description | 产品描述 |
| 版本描述 | `PRODUCT_DEFINITION_FORMATION('id', 'description', ...)` | 版本描述（次要，Phase 2） |
| 定义描述 | `PRODUCT_DEFINITION('design', 'description', ...)` | 定义描述（次要，Phase 2） |
| 料号 | `PRODUCT_IDENTIFICATION('id', ..., #role)`（AP214/AP242） | 标准料号实体（若内核/解析器支持）；否则 UDA 回退 |
| 自定义键值 | UDA：`GENERAL_PROPERTY('','name',$)` + `PROPERTY_DEFINITION('name',$,target)` + `GENERAL_PROPERTY_ASSOCIATION` + `PROPERTY_DEFINITION_REPRESENTATION` + `DESCRIPTION_REPRESENTATION_ITEM`/`INTEGER_REPRESENTATION_ITEM`/…（CAx-IF Recommended Practices for UDA） | 任意键值；可挂到 product、component instance、solid、face 等（本期只读/写 product 级） |

## 4. 数据模型

### 4.1 `ShapeMeta`（faijs 侧权威类型，`packages/core/src/api/meta.ts`）

```ts
/** 零件级说明性元数据 —— 引擎无关、JSON 可序列化、随 Shape 走双链路。 */
export interface ShapeMeta {
  /** 零件名：3MF <object name> / STEP PRODUCT.name（既有 ExportEntry.name 同源）。 */
  name?: string
  /** 描述：STEP PRODUCT.description；3MF 无 object 级标准 description → 写 metadatagroup（见 §5.2）。 */
  description?: string
  /** 料号：3MF <object partnumber>；STEP 写 PRODUCT_IDENTIFICATION 或 UDA（见 §5.2）。 */
  partNumber?: string
  /**
   * 自定义键值：3MF <object><metadatagroup>（vendor 前缀）；STEP UDA（product 级）。
   * 键为规范/厂商原始名（3MF 含命名空间前缀）；faijs 不解释值语义，读入保留、写出回写。
   */
  metadata?: Record<string, string>
}
```

### 4.2 `ModelMeta`（整体级，`packages/core/src/api/meta.ts`）

```ts
/** 整体/文档级说明性元数据 —— 导入结果 / 导出选项，不挂 Shape。 */
export interface ModelMeta {
  title?: string            // 3MF Title / STEP FILE_NAME.name
  description?: string      // 3MF Description / STEP FILE_DESCRIPTION.description
  designer?: string         // 3MF Designer / STEP FILE_NAME.originator
  author?: string           // STEP FILE_NAME.author（3MF 无对应；跨格式不互转）
  organization?: string     // STEP FILE_NAME.organization（3MF 无对应）
  copyright?: string        // 3MF Copyright（STEP 无标准位置）
  licenseTerms?: string     // 3MF LicenseTerms（STEP 无标准位置）
  rating?: string           // 3MF Rating（STEP 无标准位置）
  creationDate?: string     // 3MF CreationDate / STEP FILE_NAME.timestamp
  modificationDate?: string // 3MF ModificationDate（STEP 无标准位置）
  application?: string      // 3MF Application / STEP FILE_NAME.preprocessor
  /** 未知/厂商自定义 metadata 兜底（3MF model 级带前缀名；STEP header 其余字段）。 */
  metadata?: Record<string, string>
}
```

### 4.3 `Shape` 扩展（`packages/core/src/mesh/types.ts`）

```ts
interface Shape {
  // …既有字段（positions/indices/appearance/materialGroups/vertexColors…）
  /** 零件级说明性元数据（P1+）；方法见 api/meta.ts ShapeMetaMethods。 */
  meta?: ShapeMeta
}
```

### 4.4 方法集（`ShapeMetaMethods`，挂载方式同 `attachAppearanceMethods`）

```ts
export interface ShapeMetaMethods {
  /** 合并 meta：`{...cur, ...spec}`，spec 中 undefined 字段保留旧值。 */
  setMeta(spec: ShapeMeta): this
  /** 便捷：等价 setMeta({ name })（空串视为清除）。 */
  setName(name: string): this
  /** 便捷：等价 setMeta({ description })（空串视为清除）。 */
  setDescription(description: string): this
  /** 便捷：等价 setMeta({ partNumber })。 */
  setPartNumber(partNumber: string): this
  /** 便捷：等价 setMeta({ metadata: {...cur.metadata, ...kv} })；值为空串的键删除。 */
  setMetaField(key: string, value: string): this
  /** 读取当前 meta（可能 undefined）。 */
  getMeta(): Readonly<ShapeMeta> | undefined
}
```

空串 = 清除语义（`setName('')` 删除 name）：与「undefined 不覆盖」互补，用户可显式去掉继承来的名称。

## 5. 导入（按已有规范读）

### 5.1 3MF 读（`mesh/threemf-loader.ts`）

现状：`ThreemfObject.name` 已读（Bambu 标签）；`partnumber`/`metadatagroup` 未读；model 级 metadata 未读。

P2 增量：

| 源 | → Shape/ModelMeta |
|---|---|
| `<object name>` | `Shape.meta.name`（既有字段贯通到 meta） |
| `<object partnumber>` | `Shape.meta.partNumber` |
| `<object><metadatagroup><metadata name="ns:key">` | `Shape.meta.metadata['ns:key']`（保留原始键含前缀） |
| `<model><metadata name="Title">` 等标准名 | `ModelMeta.title/designer/description/copyright/licenseTerms/rating/creationDate/modificationDate/application` |
| `<model><metadata name="vendor:xxx">` | `ModelMeta.metadata['vendor:xxx']` |
| `<build><item partnumber>`/`<item metadatagroup>` | 装配实例层（编辑器 ModelGroup 实例），Phase 2 |

`parseThreemf` 返回值扩展：`{ objects, modelMeta? }`；`io.ts` 组装 Shape 时把 meta 挂到 `shape.meta`（`mesh/io.ts` 的 `shape: Shape` 构造点）。

### 5.2 STEP 读（`occt-kernel` + `api/import-step.ts`）

现状：XCAF label name 已读（`getLabelInfo.name`，回退 labelPath）→ 已能得零件名（落到 `LabelInfo.name`，但未进 `Shape.meta`）。

P2 增量：

| 源 | → Shape/ModelMeta |
|---|---|
| XCAF label name（= PRODUCT.name） | `Shape.meta.name` |
| `PRODUCT.description`（XCAF 读不到时从 P21 文本解析：`PRODUCT\(` 第二参） | `Shape.meta.description`（解析器与 `stepColorParser.ts` 同族：文本正则提取 PRODUCT 实体参数；无则跳过） |
| header `FILE_NAME`（name/timestamp/author/organization/preprocessor/originator） | `ModelMeta.title/creationDate/author/organization/application/designer` |
| header `FILE_DESCRIPTION` | `ModelMeta.description` |
| `PRODUCT_IDENTIFICATION`（若解析到） | `Shape.meta.partNumber`（Phase 2，先 UDA 后标准实体均可） |
| UDA（`GENERAL_PROPERTY`+`PROPERTY_DEFINITION`+值，product 级） | `Shape.meta.metadata`（Phase 2） |

## 6. 导出（按已有规范写）

### 6.1 3MF 写（`brep/export/export-model.ts`）

现状：`ExportEntry.name` → `<object name>` 已有；`partnumber`/`metadatagroup`/model metadata 未写。

P3 增量：

| Shape.meta / ModelMeta | → 3MF |
|---|---|
| `meta.name` | `<object name>`（既有） |
| `meta.partNumber` | `<object partnumber>` |
| `meta.description` | `<object><metadatagroup><metadata name="faijs:description">`（faijs 命名空间前缀；规范要求自定义名必须带前缀） |
| `meta.metadata['ns:key']` | `<metadatagroup><metadata name="ns:key">`（键已带前缀直接写；不带前缀的补 `faijs:` 前缀） |
| `ModelMeta.title/designer/…` | `<model>` 下 `<metadata name="Title">` 等标准名（XML 顺序在 `<resources>` 前；`preserve="1"`） |
| `ModelMeta.metadata` | `<model>` 下 `<metadata name="ns:key">` |

XML 细节：`<model>` 需声明 faijs 命名空间 `xmlns:faijs="http://schemas.faicad.dev/3mf/2026/10"`；同对象同键不重复。

### 6.2 STEP 写（`brep/export/step.ts` + header 重写）

现状：`StepExportEntry.name` → XCAF label name（→ PRODUCT.name）已有。

P3 增量：

| Shape.meta / ModelMeta | → STEP |
|---|---|
| `meta.name` | PRODUCT.name（既有） |
| `meta.description` | PRODUCT.description（`exportStepFromSolids` 写 label 名时**同参带 description**——需内核支持；不支持则 UDA 描述性属性回退，见下） |
| `meta.partNumber` | `PRODUCT_IDENTIFICATION`（内核/模板支持时）或 UDA（`GENERAL_PROPERTY('','partnumber',$)` + `PROPERTY_DEFINITION` + `DESCRIPTION_REPRESENTATION_ITEM('', value)` + `PROPERTY_DEFINITION_REPRESENTATION`，CAx-IF 图 8 形态） |
| `meta.metadata` | 每个键一个 UDA（`GENERAL_PROPERTY('','key',$)`…，值用 DESCRIPTION_REPRESENTATION_ITEM） |
| `ModelMeta.title/description/…` | P21 header 重写（`exportModel` 已有 SI_UNIT 声明重写的先例——同样对 `FILE_NAME(...)`/`FILE_DESCRIPTION(...)` 行做文本替换；无对应位置的字段（copyright/licenseTerms/rating/modificationDate）**不写**（STEP 无标准位置，不发明） |

## 7. 编辑器对接（3d_editor）

- **协议**：`WireGeometry` 加 `meta`（toWire 拷 meta / wireToHostResult 回填），三端共用。
- **store**：`partMeta: Record<scopedId, ShapeMeta>`（原值，脚本/导入写）+ 用户编辑覆盖（属性面板编辑后写 override，类似 materialOriginals/overrides 结构；P1 可先只做原值 + 只读显示）。
- **executeScript**：createPart 透传 `metaOverride: shape.meta`（与 materialGroupsOverride 同通道）。
- **显示名**：ModelGroup 显示 `meta.name ?? 现有 partName 派生`（return key / scopedId fallback 不动）。
- **导入**：formatLoaders 从 `shape.meta` / `modelMeta` 写 partMeta / modelMeta 到 store；导出从 store 收集。
- **undo**：`partMeta`/`modelMeta` 加入 excludedFields（运行时重写、不撤销、不落盘），与 `materialGroups` 同款。
- **属性面板**（Phase 2）：类似 MaterialEditor 的 MetaEditor（改 name/description/partNumber/自定义键值）。

## 8. 破坏性变更清单

**无**（纯增量）：`Shape.meta`/`ModelMeta` 为新字段；`ExportEntry.name` 既有语义不动（扩展 description/partNumber 为可选新字段）；`ThreemfObject.name` 贯通到 meta 但既有消费方（编辑器显示名）行为不变（meta.name 与既有 name 同值）。

## 9. 测试与验收

| 项 | 验证 |
|---|---|
| faijs core：`api/meta.ts` 单测（setName/setDescription/setPartNumber/setMetaField/getMeta、空串清除、mergeMeta、方法挂载） | `npx vitest run packages/core/src/api/meta.test.ts` |
| faijs core：继承（op 产物继承 input.meta；setName 覆盖） | mesh 链 + brep 链各 1 例 |
| faijs-tests：e2e（`box1.setName(...).setDescription(...)` 脚本 → `shape.meta` 过线） | appearance e2e 同款新增 A 组 |
| 3MF 往返：写（object name/partnumber/metadatagroup + model metadata）→ 读回断言 | export-model.test + threemf-loader.test（真实 buffer 造档） |
| STEP 往返：写（PRODUCT name/description + header）→ 读回断言 | step-export.test + import-step.test |
| 3d_editor：createPart 通道（meta 落 store）、ModelGroup 显示名、导入/导出不丢 | 全量 test:unit |

## 10. 分阶段实施

| 阶段 | 内容 | 交付 |
|---|---|---|
| **P1 最小闭环** | `api/meta.ts`（ShapeMeta/ModelMeta/mergeMeta/ShapeMetaMethods/attachMetaMethods）+ `Shape.meta` + 产物构造点继承 meta + 复用成员调用语句机制 + 编辑器协议 `WireGeometry.meta` + createPart 透传 + ModelGroup 显示名（meta.name 优先） | 「`box1.setName('…').setDescription('…')` 在编辑器正确显示」闭环 |
| **P2 导入** | 3MF（object name/partnumber/metadatagroup、model metadata）→ Shape.meta/ModelMeta；STEP（PRODUCT name/description、header）→ Shape.meta/ModelMeta；formatLoaders 写 store | 导入即所见（名称/描述/整体字段） |
| **P3 导出** | 3MF 写 `<object partnumber>`/metadatagroup/`<metadata>`（含 faijs:description 前缀）；STEP 写 PRODUCT.description + header 重写 + partNumber（UDA/标准实体）；编辑器导出对话框传 modelMeta | 导出不丢名称/描述/整体字段 |
| **P4 可选** | STEP UDA 通用键值读写（metadata 映射）；3MF vendor metadata 全键保留；装配实例级（item partnumber/metadatagroup）；脚本级 `cad.setMeta`（整体级脚本 API） | 自定义键值/实例级完整闭环 |

依赖：P1 依赖 PBR 外观方案的方法挂载机制（`attachAppearanceMethods` 的 shape.ts 包装点），P1–P3 均为增量实现、可独立停。

## 11. 未决问题（实施阶段实测确认）

1. 整体级脚本 API：`cad.setMeta({...})` 需要 lang 对 `cad` 命名空间全局方法调用的支持（PBR 方案未涉及 cad 全局方法）。**P1 决策：整体级不提供脚本 API**——导入结果/导出选项承载（编辑器项目级字段 + 文件往返）；脚本设置整体级作为 P4（实测 lang 支持后再定形态）。
2. STEP 写 PRODUCT.description：`exportStepFromSolids` 走 XCAF label（`doc.addShape(shape, { name, color })`）——description 是否进 XCAF label 待实测（occt-wasm 写侧）；不支持则回落 UDA 描述性属性（CAx-IF 图 8 形态，需内核写 UDA 能力）。
3. STEP 读 PRODUCT.description：XCAF label 是否有 description 通道；无则 P21 文本正则解析（`PRODUCT\(('[^']*'),\s*('[^']*')`）——解析器与 stepColorParser 同族、宽容失败（解析不到跳过）。
4. 3MF `faijs:description` 命名空间：`http://schemas.faicad.dev/3mf/2026/10` 是否作为长期规范（vs 复用 3MF Consortium 预留命名空间）——实施前确认。
5. STEP partNumber 实体：AP214/AP242 的 `PRODUCT_IDENTIFICATION` 读写是否被 occt 内核暴露；不暴露则一律 UDA。
6. `ShapeMeta.metadata` 键的 3MF 前缀规范：非带前缀键写出时补 `faijs:`（跨工具链兼容性）；读回时保留原始键（含前缀）——往返键名一致性（写 `faijs:description` 读回 `faijs:description`）需测试钉住。
7. 装配实例级（3MF item partnumber/metadatagroup、STEP NAUO 属性）：3d_editor 装配/组件模型是否已有实例级 meta 槽位——P4 前先盘点 scene-kernel 的 assembly/component 数据结构。

## 12. 相关文档

- 延续方法模式：`docs/plans/2026-10-05-faijs-pbr-appearance-api-design.md`（Shape 方法执行机制 §3.3 / 双链路 §6.1 / 导入导出矩阵 §8）
- 3MF 规范：Core Specification v1.3.0（§3.1 metadata 表 3-1 / CT_Object / CT_MetadataGroup / CT_Item）、Production Extension（UUID/partnumber/name）
- STEP 规范：ISO 10303-21（header FILE_NAME/FILE_DESCRIPTION）、AP214/AP242（PRODUCT/PRODUCT_IDENTIFICATION）、CAx-IF《Recommended Practices for User Defined Attributes v1.5》（UDA 结构 §5–7）
- faijs 代码位：`packages/core/src/api/appearance.ts`（方法模板）、`mesh/types.ts`（Shape）、`mesh/threemf-loader.ts`（3MF 读）、`brep/export/export-model.ts`（导出入口）、`occt-kernel/occtKernel.ts`（STEP label 名）、`occt-kernel/stepColorParser.ts`（P21 文本解析先例）
- 3d_editor：`packages/platform/src/execution/protocol.ts`（WireGeometry）、`stores/core/material-store.ts`（store 模式）、`engine/formatLoaders.ts`（导入）、`engine/exporters/index.ts`（导出）、`components/renderers/ModelGroup.tsx`（显示名）
