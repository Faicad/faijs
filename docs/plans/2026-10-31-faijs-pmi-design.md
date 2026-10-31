# faijs PMI 设计方案

- 产出：claude-sonnet-4-20250514 + CatPaw
- 状态：方案（未实施）

---

## 0. 用户原始需求

> 「一份是设计文档，faijs 如何表达 PMI 信息，如何查询、导出 PMI 信息」

---

## 1. 背景与目标

### 1.1 什么是 PMI

PMI（Product Manufacturing Information）是附着在 3D 模型上的产品制造信息，包括：

| 类别 | 内容 | 示例 |
|------|------|------|
| 尺寸公差 | 线性尺寸、直径、角度及其上下偏差 | phi30 +0.021/0 |
| 几何公差（GD&T） | 形状、方向、位置、跳动公差 | perp 0.05 A |
| 基准 | 基准面、基准轴、基准点 | A / B / C |
| 表面粗糙度 | Ra/Rz 参数 | Ra 1.6 |
| 注释文本 | 技术要求、材料规格 | "未注公差按 GB/T 1804-m" |

### 1.2 现状分析

参考 FreeCAD PMI 分析（`docs/analysis/freecad-pmi-analysis.md`），FreeCAD 的核心问题是：
- PMI 仅存在于 2D 图纸层面（TechDraw），不附着在 3D 模型上
- STEP 导入/导出不处理 PMI 实体
- 3D 模型修改后公差不会自动更新

**faijs 的机会**：faijs 已有成熟的拓扑命名系统（TopoRef），PMI 可以直接附着在拓扑引用上，实现 3D 原生 PMI。

### 1.3 设计目标

1. **3D 原生 PMI**：PMI 信息附着在 3D 模型的拓扑元素上（面/边/顶点），而非 2D 图纸
2. **可序列化**：PMI 数据可写进 `.fai.js` 脚本（纯数据，可改参重放）
3. **STEP 往返**：PMI 可通过 STEP AP242 导入/导出（利用 OCCT XCAFDoc_DimTolTool）
4. **双链路兼容**：BREP 链上的 PMI 是精确语义信息；mesh 链上的 PMI 是纯数据标注（几何由 mesh 离散近似）
5. **查询 API**：脚本开发者可通过 `cad` 命名空间查询、添加 PMI

---

## 2. PMI 数据模型

### 2.1 类型定义

PMI 类型定义在 `packages/core/src/api/pmi/types.ts`（新增）。

```ts
// ── 尺寸公差 ──

/** 尺寸类型（与 FreeCAD DrawViewDimension::DimensionType 对齐） */
export type PmiDimensionType =
  | 'linear'      // 线性尺寸（两点间距离）
  | 'linearX'    // X 方向投影距离
  | 'linearY'    // Y 方向投影距离
  | 'linearZ'    // Z 方向投影距离
  | 'diameter'   // 直径
  | 'radius'     // 半径
  | 'angle'      // 角度（两边夹角）
  | 'angle3pt'   // 三点角

/** 尺寸公差标注 */
export interface PmiDimension {
  readonly kind: 'dimension'
  /** 尺寸类型 */
  readonly dimType: PmiDimensionType
  /** 被标注的拓扑引用（面/边/顶点，1-3 个取决于 dimType） */
  readonly targets: readonly TopoRef[]
  /** 名义值（mm 或度；运行时从几何重算，不存储硬编码值） */
  readonly nominal?: number
  /** 上偏差（mm 或度） */
  readonly upperTolerance?: number
  /** 下偏差（mm 或度） */
  readonly lowerTolerance?: number
  /** 对称公差（upper = -lower 时设为 true，显示 +/-T） */
  readonly symmetric?: boolean
  /** 理论精确尺寸（框格显示，无公差） */
  readonly theoreticalExact?: boolean
  /** 格式规格（如 "%.2f"，自由格式串） */
  readonly formatSpec?: string
  /** 显示名（UI 用，不参与身份判定） */
  readonly label?: string
}

// ── 几何公差（GD&T）──

/** GD&T 特征类型（ISO 1101 / ASME Y14.5） */
export type PmiGdtType =
  | 'straightness'    // 直线度
  | 'flatness'        // 平面度
  | 'circularity'     // 圆度
  | 'cylindricity'    // 圆柱度
  | 'parallelism'     // 平行度
  | 'perpendicularity' // 垂直度
  | 'angularity'      // 倾斜度
  | 'position'        // 位置度
  | 'concentricity'   // 同轴度
  | 'symmetry'        // 对称度
  | 'circularRunout'  // 圆跳动
  | 'totalRunout'     // 全跳动
  | 'profileLine'     // 线轮廓度
  | 'profileSurface'  // 面轮廓度

/** 材料条件修饰符 */
export type PmiMaterialCondition = 'MMC' | 'LMC' | 'RFS' | null

/** 特征控制框（Feature Control Frame） */
export interface PmiGdt {
  readonly kind: 'gdt'
  /** GD&T 特征类型 */
  readonly gdtType: PmiGdtType
  /** 被测要素的拓扑引用 */
  readonly target: TopoRef
  /** 公差值（mm 或度） */
  readonly tolerance: number
  /** 公差带形状 */
  readonly toleranceZone?: 'diameter' | 'width' | 'radial'
  /** 材料条件修饰符 */
  readonly materialCondition?: PmiMaterialCondition
  /** 基准引用（A/B/C，指向 PmiDatum 的 identifier） */
  readonly datums?: readonly string[]
  /** 投影公差带 */
  readonly projectedToleranceZone?: { length: number; direction: Vec3 }
  /** 显示名 */
  readonly label?: string
}

// ── 基准 ──

/** 基准类型 */
export type PmiDatumType = 'datumPlane' | 'datumAxis' | 'datumPoint' | 'datumTarget'

/** 基准标注 */
export interface PmiDatum {
  readonly kind: 'datum'
  /** 基准标识（A/B/C，用户指定） */
  readonly identifier: string
  /** 基准类型 */
  readonly datumType: PmiDatumType
  /** 基准要素的拓扑引用 */
  readonly target: TopoRef
  /** 基准目标参数（面/线/点的局部参数） */
  readonly datumTargetParams?: {
    u?: number
    v?: number
    radius?: number
    width?: number
    height?: number
  }
}

// ── 表面粗糙度 ──

/** 表面粗糙度标注 */
export interface PmiSurfaceFinish {
  readonly kind: 'surfaceFinish'
  /** 被标注的面引用 */
  readonly target: FaceTopoRef
  /** 粗糙度参数类型 */
  readonly parameter: 'Ra' | 'Rz' | 'Rt' | 'Rq' | 'Rmax'
  /** 粗糙度值（um） */
  readonly value: number
  /** 加工方法 */
  readonly method?: string
  /** 表面纹理方向 */
  readonly textureDirection?: 'parallel' | 'perpendicular' | 'cross' | 'multidirectional' | 'circular' | 'radial' | 'particulate'
}

// ── 注释 ──

/** 文本注释标注 */
export interface PmiNote {
  readonly kind: 'note'
  /** 注释文本 */
  readonly text: string
  /** 附着的拓扑引用（可选：浮动注释不附着几何） */
  readonly target?: TopoRef
  /** 注释锚点坐标 [x,y,z]（世界坐标） */
  readonly anchor?: Vec3
  /** 领引线方向（UI 渲染用） */
  readonly leaderDirection?: Vec3
}

// ── PMI 统一类型 ──

export type PmiItem = PmiDimension | PmiGdt | PmiDatum | PmiSurfaceFinish | PmiNote
```

### 2.2 PMI 集合

```ts
/** 一个零件上的全部 PMI 标注 */
export interface PmiSet {
  /** 标注列表 */
  readonly items: readonly PmiItem[]
  /** 元数据（版本、来源等） */
  readonly meta?: {
    readonly source?: 'faijs' | 'step-ap242' | 'manual'
    readonly standard?: 'ISO' | 'ASME' | 'GB'
    readonly created?: string
  }
}
```

### 2.3 与现有系统的关系

```
TopoRef（已有，跨历史身份层）
    | 纯数据、JSON 安全、写进 .fai.js
    | 改参重放后仍能指认「同一个面/边/点」
    v 被引用
PmiItem
    | target: TopoRef（PmiDimension.targets / PmiGdt.target / ...）
    | 纯数据、JSON 安全、写进 .fai.js
    v 挂载在
Shape（已有）
    | Shape.pmi?: PmiSet（PMI 随 Shape 走双链路）
    v 导出
StepExportEntry / ExportEntry
    | pmi?: PmiSet（导出时写进 STEP XCAF PMI 实体）
```

---

## 3. 脚本面 API

### 3.1 添加 PMI 标注

PMI 标注不是 op（不产出 Shape），是 Shape 实例方法（复用 `asm1.solve()` / `part0.setName()` 的成员调用语句形态）。

**关键文件**：`packages/core/src/api/pmi/methods.ts`（新增）

```ts
/** Shape PMI 方法签名（运行时由 attachPmiMethods 挂载） */
export interface ShapePmiMethods {
  /**
   * 添加一个尺寸公差标注。
   * @param dim - 尺寸公差标注。
   * @returns this（可链式调用）。
   */
  addDimension(dim: Omit<PmiDimension, 'kind'>): this

  /**
   * 添加一个几何公差标注（特征控制框）。
   * @param gdt - GD&T 标注。
   * @returns this（可链式调用）。
   */
  addGdt(gdt: Omit<PmiGdt, 'kind'>): this

  /**
   * 添加一个基准标注。
   * @param datum - 基准标注。
   * @returns this（可链式调用）。
   */
  addDatum(datum: Omit<PmiDatum, 'kind'>): this

  /**
   * 添加一个表面粗糙度标注。
   * @param finish - 表面粗糙度标注。
   * @returns this（可链式调用）。
   */
  addSurfaceFinish(finish: Omit<PmiSurfaceFinish, 'kind'>): this

  /**
   * 添加一个文本注释。
   * @param note - 注释标注。
   * @returns this（可链式调用）。
   */
  addNote(note: Omit<PmiNote, 'kind'>): this

  /**
   * 获取该 Shape 上的全部 PMI 标注。
   * @returns PMI 标注集合（只读副本）。
   */
  getPmi(): PmiSet

  /**
   * 清除全部 PMI 标注。
   * @returns this（可链式调用）。
   */
  clearPmi(): this
}
```

### 3.2 脚本示例

```js
// .fai.js 示例：创建带 PMI 的零件
const part0 = cad.box(30, 30, 30)
  .addDatum({
    identifier: 'A',
    datumType: 'datumPlane',
    target: cad.faceRef(part0, 1),  // 底面
  })
  .addDatum({
    identifier: 'B',
    datumType: 'datumPlane',
    target: cad.faceRef(part0, 2),  // 侧面
  })
  .addDimension({
    dimType: 'diameter',
    targets: [cad.faceRef(part0, 3)],  // 圆柱面
    upperTolerance: 0.021,
    lowerTolerance: 0,
    formatSpec: '%.2f H7',
  })
  .addGdt({
    gdtType: 'perpendicularity',
    target: cad.faceRef(part0, 3),
    tolerance: 0.05,
    datums: ['A'],
  })
  .addSurfaceFinish({
    target: cad.faceRef(part0, 1),
    parameter: 'Ra',
    value: 1.6,
  })
  .addNote({
    text: '未注公差按 GB/T 1804-m',
  })
```

### 3.3 查询 PMI

PMI 查询走 `cad` 命名空间的普通函数（不是 op）。

**关键文件**：`packages/core/src/api/pmi/query.ts`（新增）

```ts
/**
 * 查询 Shape 上指定类型的 PMI 标注。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name pmiItems
 * @returns PmiItem[] 匹配的 PMI 标注列表。
 * @param shape - 被查询的形状。type:Shape required:true
 * @param filter - 可选过滤条件。type:object required:false
 * @example
 * const dims = cad.pmiItems(part0, { kind: 'dimension' })
 */
export function pmiItems(
  shape: Shape,
  filter?: { kind?: PmiItem['kind']; targetType?: TopoRef['kind'] }
): PmiItem[]

/**
 * 查询附着在指定拓扑元素上的全部 PMI 标注。
 * @group 查询
 * @inputs 2
 * @async false
 * @qual ok
 * @name pmiOn
 * @returns PmiItem[] 附着在该拓扑元素上的标注列表。
 * @param shape - 被查询的形状。type:Shape required:true
 * @param ref - 拓扑引用（面/边/顶点）。type:TopoRef required:true
 * @example
 * const annos = cad.pmiOn(part0, cad.faceRef(part0, 3))
 */
export function pmiOn(shape: Shape, ref: TopoRef): PmiItem[]

/**
 * 查询基准标识 -> 基准标注的映射。
 * @group 查询
 * @inputs 1
 * @async false
 * @qual ok
 * @name pmiDatums
 * @returns Record<string, PmiDatum> 基准标识 -> 基准标注。
 * @param shape - 被查询的形状。type:Shape required:true
 * @example
 * const datums = cad.pmiDatums(part0)
 */
export function pmiDatums(shape: Shape): Record<string, PmiDatum>
```

---

## 4. PMI 与拓扑引用的绑定

### 4.1 绑定机制

PMI 标注的 `target` / `targets` 字段使用 `TopoRef`（已有系统）：

| TopoRef 类型 | 适用 PMI 标注 | 说明 |
|---|---|---|
| `FaceTopoRef` | 尺寸（面）、GD&T（面）、基准（面）、表面粗糙度 | 最常见的 PMI 目标 |
| `EdgeTopoRef` | 尺寸（边）、GD&T（边）、基准（轴） | 圆柱面轴向边等 |
| `VertexTopoRef` | 尺寸（点间距离）、基准（点） | 角度标注的顶点 |
| `DerivedFaceTopoRef` | GD&T（倒角/圆角面） | fillet/chamfer 过渡面 |

### 4.2 改参重放后的稳定性

TopoRef 的核心价值是**跨历史身份**：改参重放后，`(origin, role)` 坐标仍能解析到「同一个面/边/点」。

```
原始脚本执行：
  box(30, 30, 30) -> faceRef(3) -> FaceTopoRef{origin:'s1', role:'right', hint:{...}}
  addGdt({target: FaceTopoRef{...}, tolerance: 0.05})

改参重放（尺寸从 30 改为 50）：
  box(50, 50, 50) -> 拓扑序号变化，但 (origin='s1', role='right') 仍指右侧面
  addGdt({target: FaceTopoRef{...}, tolerance: 0.05}) -> 自动附着新右侧面
```

### 4.3 mesh 链路的处理

| 链路 | PMI 附着 | 说明 |
|---|---|---|
| BREP 链 | `TopoRef` 正常工作 | origin/role 解析到 BREP 句柄 |
| mesh 链 | `TopoRef` 退化 | FaceTopoRef 的 origin/role 为 null（mesh 无血统），PMI 附着退化 |
| mesh 退化处理 | PMI 不抛错，保留为纯数据 | 标注的 TopoRef.target 只保留 hint（几何兜底），身份字段为 null |

mesh 链的 PMI 保留为**纯数据标注**（不参与 STEP AP242 semantic PMI 导出，但可通过 JSON/3MF 元数据传递）。

---

## 5. STEP AP242 PMI 导出

### 5.1 导出链路

```
Shape.pmi (PmiSet)
    v 映射
ExportEntry.pmi (PmiSet)
    v 步骤 1：XCAF Doc 构建
exportStepFromSolids(kernel, entries)
    v 步骤 2：PMI 写入 XCAF Doc
writePmiToXCAF(doc, label, pmiSet)
    v 步骤 3：STEP 导出
doc.exportSTEP()
    v 步骤 4（可选）：文本层后处理（AP242 头修正）
rewriteStepHeader()
```

### 5.2 XCAF PMI 写入

**关键文件**：`packages/core/src/brep/export/step-pmi.ts`（新增）

需要 occt-wasm 提供 `XCAFDoc_DimTolTool` 的绑定。写入流程：

```ts
/**
 * 将 PmiSet 写入 XCAF 文档（附着在指定 label 上）。
 * 需要 occt-wasm 提供 XCAFDoc_DimTolTool API。
 * @platform occt - XCAF PMI 写入是 occt-only 平台面。
 */
export function writePmiToXCAF(
  kernel: BrepEngineApi,
  doc: XCAFDocument,
  label: LabelTag,
  pmi: PmiSet,
  faceLabelMap: Map<FaceTopoRef, LabelTag>,  // TopoRef -> XCAF label 映射
): void {
  for (const item of pmi.items) {
    switch (item.kind) {
      case 'dimension':
        writeDimension(kernel, doc, item, faceLabelMap)
        break
      case 'gdt':
        writeGdt(kernel, doc, item, faceLabelMap)
        break
      case 'datum':
        writeDatum(kernel, doc, item, faceLabelMap)
        break
      // surfaceFinish / note -> 写 UDA（用户定义属性）或跳过
    }
  }
}
```

### 5.3 TopoRef -> XCAF Label 映射

STEP AP242 的 PMI 通过 XCAF label 关联几何。导出时需要建立 TopoRef -> XCAF Label 的映射：

```
StepExportEntry.solid (BrepHandle)
    v 遍历子形状
kernel.getSubShapes(solid, 'face') -> [handle1, handle2, ...]
    v 与 Shape 的命名表比对
RoleTable[stmtId][role] -> face ordinal
    v 建立映射
FaceTopoRef{origin, role} -> XCAF label (subShape label)
```

### 5.4 STEP AP 版本

当前 faijs 的 STEP 导出默认按 OCCT 默认 AP 版本输出。PMI 导出需要 AP242 Edition 2+：

```ts
// StepExportEntry 增加可选字段
export interface StepExportEntry {
  // ... 现有字段 ...
  /** PMI 标注集合（AP242 semantic PMI）。需要 BREP 链 + AP242。 */
  pmi?: PmiSet
  /** STEP AP 版本（有 PMI 时自动升级为 AP242） */
  apVersion?: 'AP203' | 'AP214' | 'AP242'
}
```

### 5.5 mesh 链路的导出处理

| 链路 | PMI STEP 导出 | 说明 |
|---|---|---|
| BREP 链 | 写入 AP242 semantic PMI | `XCAFDoc_DimTolTool::SetDimension` 等 |
| mesh 链 | 跳过 PMI 实体 | mesh 重建实体无 TopoRef 血统，PMI 无法关联几何 |

mesh 链的 PMI 可通过 3MF 元数据传递（`<metadatagroup>` 带厂商前缀），不写 STEP 实体。

---

## 6. STEP AP242 PMI 导入

### 6.1 导入链路

```
STEP 文件
    v ReaderStep (STEPCAFControl_Reader)
TDocStd_Document (OCAF)
    v 读取 XCAF PMI 实体
readPmiFromXCAF(doc)
    v TopoRef 映射
PmiSet (附着在导入的 Shape 上)
```

### 6.2 读取流程

```ts
/**
 * 从 XCAF 文档读取 PMI 标注。
 * @platform occt - XCAF PMI 读取是 occt-only 平台面。
 */
export function readPmiFromXCAF(
  kernel: BrepEngineApi,
  doc: XCAFDocument,
  label: LabelTag,
  // XCAF label -> TopoRef 反向映射（由导入器建立）
  labelToTopoRef: Map<LabelTag, TopoRef>,
): PmiSet | undefined
```

### 6.3 AP242 PMI 实体映射

| STEP AP242 实体 | faijs PmiItem | 说明 |
|---|---|---|
| `DIMENSIONAL_SIZE` | `PmiDimension` (linear) | 线性尺寸 |
| `DIMENSIONAL_LOCATION` | `PmiDimension` (angular) | 角度尺寸 |
| `GEOMETRIC_TOLERANCE` + 子类型 | `PmiGdt` | 几何公差 |
| `DATUM_FEATURE` | `PmiDatum` | 基准 |
| `PLUS_MINUS_VALUE_RANGE` | PmiDimension.upperTolerance/lowerTolerance | 公差范围 |
| `LIMITS_AND_FITS` | PmiDimension.formatSpec | 配合公差（ISO 286） |

### 6.4 导入缺失 PMI 的处理

如果 STEP 文件不含 PMI 实体（AP203/AP214 或无 PMI 的 AP242），则 `readPmiFromXCAF` 返回 `undefined`，不创建空 PMI 集合。

---

## 7. ExecutionResult 中的 PMI

### 7.1 运行时暴露

PMI 信息通过 `ExecutionResult` 暴露给宿主（与 naming/kinematics/detectedUnits 同款通道）：

```ts
// runtime-state.ts 扩展
export interface ExecutionResult {
  // ... 现有字段 ...
  /** 各 part 的 PMI 标注集合（宿主据此渲染 3D PMI 标签） */
  pmi?: ReadonlyArray<{ part: PartName; items: readonly PmiItem[] }>
}
```

### 7.2 宿主消费

宿主（3D 编辑器 / 查看器）从 `ExecutionResult.pmi` 读取 PMI 标注：
- 根据 `TopoRef` 解析到当前快照的面/边/顶点序号
- 在 3D viewport 中渲染 PMI 标签（尺寸线、FCF 框、基准符号等）
- 渲染方式由宿主自行决定（faijs 不负责 PMI 的 3D 可视化）

---

## 8. 3MF / FCStd 格式中的 PMI 传递

### 8.1 3MF

3MF 不支持 PMI 实体。PMI 通过 3MF `<metadatagroup>` 传递：

```xml
<metadatagroup>
  <metadata name="faijs:pmi" preserve="1">
    {"kind":"dimension","dimType":"diameter","targets":[{"kind":"face","origin":"s1","role":"cyl","hint":{...}}],"upperTolerance":0.021,"lowerTolerance":0}
  </metadata>
</metadatagroup>
```

### 8.2 FCStd（FreeCAD 兼容）

如果需要 FCStd 互操作（导入/导出 FreeCAD 文件），PMI 按以下方式处理：

- **导入 FCStd**：读取 TechDraw DrawViewDimension 的 XML 属性 -> 映射为 PmiDimension（仅名义值+公差，References3D 需解析为 TopoRef）
- **导出 FCStd**：PmiDimension -> 序列化为 DrawViewDimension 的 XML 属性（但 FreeCAD 不识别 3D PMI，会丢失 TopoRef 关联）

### 8.3 JSON / fai-zip

faijs 的自有容器格式 `fai-zip`（`io/fai-zip/`）天然支持 PMI：PmiSet 是 JSON 可序列化的，直接写入容器的 metadata 段。

---

## 9. API 签名注册与符号表

### 9.1 三源一致

PMI 查询函数需注册到符号表（与现有 op 一致的三源一致流程）：

| 源 | 文件 | 说明 |
|---|---|---|
| arg-spec | `api/pmi/arg-spec.ts` | 参数 schema（kind 'faijs'） |
| script-face | `api/generated/script-face.ts` | re-export |
| manifest | `api/generated/script-face-manifest.ts` | manifest 条目 |
| symbol-table | `lang/symbol-table.generated.ts` | `cad.pmiItems` / `cad.pmiOn` / `cad.pmiDatums` |

### 9.2 PMI 方法不进符号表

Shape 的 `addDimension` / `addGdt` 等**成员方法**不是 op，不进符号表（与 `setName` / `setMeta` / `solve` 同款成员调用语句形态）。

---

## 10. 实施计划

### Phase 1：数据模型与脚本面（最小可用）

| 步骤 | 内容 | 文件 |
|---|---|---|
| 1.1 | PMI 类型定义 | `api/pmi/types.ts`（新增） |
| 1.2 | Shape PMI 方法 | `api/pmi/methods.ts`（新增） -> `attachPmiMethods` |
| 1.3 | PMI 查询函数 | `api/pmi/query.ts`（新增） |
| 1.4 | ExecutionResult 扩展 | `runtime-state.ts`（扩展 pmi 字段） |
| 1.5 | arg-spec + 符号表注册 | `api/pmi/arg-spec.ts` + 生成器 |
| 1.6 | 测试 | `test/api/pmi/pmi-types.test.ts` 等 |

### Phase 2：STEP AP242 导出

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 2.1 | occt-wasm XCAFDoc_DimTolTool 绑定（上游） | occt-wasm 仓 |
| 2.2 | TopoRef -> XCAF Label 映射 | Phase 1 |
| 2.3 | PmiSet -> XCAF PMI 写入 | 2.1 + 2.2 |
| 2.4 | AP 版本自动升级（有 PMI -> AP242） | 2.3 |
| 2.5 | 测试（STEP 导出+回读往返） | 2.4 |

### Phase 3：STEP AP242 导入

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 3.1 | XCAF Label -> TopoRef 反向映射 | Phase 2 |
| 3.2 | XCAF PMI -> PmiSet 读取 | 3.1 |
| 3.3 | 导入测试（商业 CAD 生成的 AP242 PMI） | 3.2 |

### Phase 4：3MF / FCStd 传递

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 4.1 | 3MF metadatagroup 读写 | Phase 1 |
| 4.2 | FCStd TechDraw 尺寸互操作 | Phase 1 |

### Phase 5：GD&T 高级特性

| 步骤 | 内容 | 依赖 |
|---|---|---|
| 5.1 | 基准目标（datum target） | Phase 1 |
| 5.2 | 复合公差（composite tolerance） | Phase 1 |
| 5.3 | 投影公差带 | Phase 1 |
| 5.4 | 不对称公差带 | Phase 1 |

---

## 11. 与 FreeCAD 对比

| 方面 | FreeCAD | faijs（本方案） |
|---|---|---|
| PMI 层面 | 仅 2D 图纸（TechDraw） | 3D 原生（附着在拓扑元素上） |
| 3D 模型上的公差 | 无 | PmiDimension / PmiGdt |
| 拓扑引用 | References3D（LinkSubList，序号） | TopoRef（origin+role，跨历史稳定） |
| 改参重放 | 名义值重算，公差不变 | 同 FreeCAD（名义值动态、公差静态） |
| GD&T 符号 | Unicode 字符拼在格式串中 | 结构化 PmiGdt 对象 |
| STEP PMI 导出 | 不写 | AP242 semantic PMI |
| STEP PMI 导入 | 不读 | AP242 semantic PMI |
| FCF（特征控制框） | 无独立对象 | PmiGdt 结构化对象 |
| 基准系统 | 无 | PmiDatum 结构化对象 |
| ISO 286 配合公差 | 查表工具（2D） | 可在 PmiDimension.formatSpec 中编码 |
| 3D PMI 可视化 | 无 | 宿主负责（ExecutionResult.pmi 暴露） |

---

## 12. 关键设计决策

### 12.1 为什么 PMI 不是 op

PMI 标注不产出 Shape，不消耗 Shape，不参与几何运算链。它是**附着的元数据**，与 `setName` / `setMeta` 同类——Shape 实例方法，不是 op。

### 12.2 为什么用 TopoRef 而不是序号

FreeCAD 用 `References3D`（LinkSubList）指向 3D 模型的子特征（如 `Edge3`），用的是序号——序号在改参/重放后会漂移。faijs 的 TopoRef 用 `(origin, role)` 作为跨历史身份坐标，改参重放后仍能解析到同一个面/边/顶点。

### 12.3 为什么名义值不存储

名义值从 3D 几何动态重算（与 FreeCAD 同理），保证几何修改后尺寸值自动更新。公差值是工程规范，不随几何变化自动修改（用户手动设定）。

### 12.4 为什么 mesh 链不导出 STEP PMI

mesh 链的 TopoRef 退化为 null（mesh 无血统），无法建立 TopoRef -> XCAF Label 映射。STEP PMI 需要 semantic 关联（PMI 实体引用几何 label），无关联的 PMI 实体无意义。mesh 链的 PMI 通过 JSON/3MF 元数据传递。

### 12.5 为什么需要 occt-wasm 上游改动

当前 occt-wasm 5.6.0 的 `XCAFDocument` 接口只有 `addShape` / `addChild` / `setName` / `setColor` / `exportSTEP` / `getLabelInfo` 等方法，不暴露 `XCAFDoc_DimTolTool`。需要上游增加：
- `XCAFDoc_DimTolTool::SetDimension(label, ...)`
- `XCAFDoc_DimTolTool::SetGeomTolerance(label, ...)`
- `XCAFDoc_DimTolTool::SetDatum(label, ...)`
- `XCAFDoc_DimTolTool::GetDimTols()`
- `STEPCAFControl_Reader::SetDimTolMode(true)` 读取 PMI

---

## 13. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| occt-wasm 不提供 DimTolTool 绑定 | Phase 2/3 阻塞 | Phase 1 先落地纯数据 PMI（不依赖 STEP 往返） |
| STEP AP242 PMI 实体在不同 CAD 间兼容性差 | 导出的 PMI 在其他 CAD 可能不显示 | 测试矩阵覆盖 NX / CATIA / Creo |
| TopoRef -> XCAF Label 映射在某些布尔操作后丢失 | PMI 标注在布尔运算后可能脱靶 | 利用 RoleTable + hint 兜底解析 |
| FCStd 互操作时 3D PMI 信息丢失 | 导出 FCStd 降级为 2D 尺寸 | 文档说明限制；FCStd 互操作不是主线 |
| PMI 显示/渲染不在 faijs 范围内 | 宿主需自行实现 3D PMI 可视化 | 提供 ExecutionResult.pmi 数据通道 + 渲染建议 |

---

## 14. 文件清单

### 新增文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/api/pmi/types.ts` | PMI 类型定义（PmiDimension / PmiGdt / PmiDatum / ...） |
| `packages/core/src/api/pmi/methods.ts` | Shape PMI 方法签名 + attachPmiMethods |
| `packages/core/src/api/pmi/query.ts` | PMI 查询函数（pmiItems / pmiOn / pmiDatums） |
| `packages/core/src/api/pmi/arg-spec.ts` | arg-spec 注册 |
| `packages/core/src/brep/export/step-pmi.ts` | STEP AP242 PMI 写入 |
| `packages/core/src/api/pmi/index.ts` | PMI 模块入口 |
| `packages/core/test/api/pmi/pmi-types.test.ts` | 类型与序列化测试 |
| `packages/core/test/api/pmi/pmi-methods.test.ts` | Shape 方法测试 |
| `packages/core/test/api/pmi/pmi-query.test.ts` | 查询函数测试 |
| `packages/core/test/brep/step-pmi-export.test.ts` | STEP PMI 导出测试 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `packages/core/src/shape.ts` | 扩展 SolidShape 增加 pmi 字段 + attachPmiMethods |
| `packages/core/src/runtime-state.ts` | ExecutionResult 增加 pmi 字段 |
| `packages/core/src/brep/export/step.ts` | StepExportEntry 增加 pmi 字段 |
| `packages/core/src/brep/export/export-model.ts` | ExportEntry 增加 pmi 字段，传递到 StepExportEntry |
| `packages/core/src/brep/export/step-flat.ts` | 扁平导出传递 pmi |
| `packages/core/src/api/api-namespace.ts` | 注册 PMI 查询函数到 cad 命名空间 |
| `packages/core/src/api/index.ts` | re-export PMI 模块 |
| `packages/core/src/lang/symbol-table.generated.ts` | 新增 pmiItems / pmiOn / pmiDatums 符号 |
| `packages/core/src/api/generated/script-face.ts` | re-export PMI 查询函数 |
| `packages/core/src/api/generated/script-face-manifest.ts` | PMI 查询函数 manifest 条目 |
