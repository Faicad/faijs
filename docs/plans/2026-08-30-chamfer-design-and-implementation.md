# 倒角（Chamfer）技术实现文档

> 状态：方案（未实施）｜适用范围：`faijs`（`C:\my\Faicad\faijs`）与 `../3d_editor`（`C:\my\Faicad\3d_editor`）
>
> 本文**只写技术实现**。调研结论不以分析报告形式铺开，只压缩为 §1 的「约束事实」——每条带 `文件:行号`，可逐条复核；§2 起全部是可照做的实现规范（接口、算法、公式、文件清单、测试点）。
>
> `docs/plans/` 免除双语配对（AGENTS.md），本文为单文件中文文档。

---

## 0. 需求原文

以下为用户在本会话提出的原始需求，逐字保留：

> 我需要给本项目和../3d_editor项目实现"倒角"功能。
>
> 实现每一个功能的时候的步骤如下：
> 1. 分析C:\git\new\onshape\onshape-std-library-mirror项目这个功能是如何实现的。找到对应的代码，比如钣金对应的是 chamfer.fs。
> 2. Filter对应的是这个功能是否在3d_editor中激活的条件，也就是顶部工具栏对应图标是否激活。
> 3. 参数体系（definition）对应到faijs与3d_editor的接口参数。
> 4. 查看C:\git\OpenCascade\brepjs项目，了解它是如何实现这个功能的。也可以参考它设计faijs的api。
> 5. 查看C:\git\OpenCascade\occt-wasm项目，了解它提供的底层接口。
>
> 根据得到的所有信息，进行公开的设计和开发：
> 1. 定义倒角的api接口
> 2. 在faijs项目里实现接口并完成测试。
> 3. 在3d_editor项目里完成UI部分，比如添加顶部工具栏，添加倒角参考的面板，添加倒角预览的功能，最后用户点击确定后，生成faijs脚本，其中调用faijs提供的api接口，把UI层参数传入，并执行脚本。

追加约束（用户原话）：

> 3d_editor 的预览有很多种方式，要看情况。不复杂的任务完全可以实际执行，耗时的任务可能只是蒙层。要看实际情况，决定当前的功能应该如何实现预览。

用户步骤 → 本文章节映射：

| 用户步骤 | 章节 |
| --- | --- |
| ① 分析 onshape-std-library-mirror 的 chamfer.fs | §1.1 |
| ② Filter = 3d_editor 中功能能否激活（顶部工具栏图标） | §1.2（Filter 语义）+ §5.2（激活映射） |
| ③ 参数体系（definition）→ 两端接口参数 | §1.3 + §2.2（对照表） |
| ④ brepjs 如何实现 / 参考设计 faijs API | §1.4 |
| ⑤ occt-wasm 提供的底层接口 | §1.5 |
| 开发①定义 API | §2 |
| 开发②faijs 实现并测试 | §3 + §4 |
| 开发③3d_editor UI | §5 |

---

## 1. 约束事实（调研结论，全部已实地核实）

### 1.1 Onshape 特征壳（调研步骤 ①）

`chamfer.fs` 是**纯特征壳**：自己不做几何，全部委托内核 `opChamfer`。

| 事实 | 位置 |
| --- | --- |
| 特征壳注释：「The chamfer feature directly performs an opChamfer operation.」 | `chamfer.fs:21-23` |
| 主体只有两行：`opChamfer(context, id, definition)` | `chamfer.fs:180`、`chamfer.fs:194` |
| 参数名 → 内核参数的**唯一权威映射** | `chamfer.fs:199-203` |

`chamfer.fs:199-203` 原文（这是「哪一侧量哪个尺寸」的唯一权威依据）：

```
const activeParameterIds = {
    ChamferType.EQUAL_OFFSETS: {width1: 'width', width2: 'width'},
    ChamferType.TWO_OFFSETS: {width1: 'width1', width2: 'width2'},
    ChamferType.OFFSET_ANGLE: {width1: 'width', angle: 'angle'}
}[definition.chamferType];
```

即内核只认三个量：`width1`（第一个面上的距离）、`width2`（第二个面上的距离）、`angle`。`OFFSET_ANGLE` 模式下 **`width` 就是 `width1`**，`angle` 是倒角面与第一个面的夹角。

其余事实：

| 事实 | 位置 |
| --- | --- |
| `ChamferType` = `EQUAL_OFFSETS` / `TWO_OFFSETS` / `OFFSET_ANGLE` / `RAW_OFFSET`（隐藏） | `chamfertype.gen.fs:9-19` |
| `ChamferMethod` = `FACE_OFFSET` / `APEX_RANGE`（钣金用） | `chamfermethod.gen.fs:9-15` |
| `oppositeDirection`（布尔，默认 false）仅在 `OFFSET_ANGLE` / `TWO_OFFSETS` 下出现 | `chamfer.fs:56-62`；默认值 `chamfer.fs:112` |
| `tangentPropagation`（布尔，默认 false） | `chamfer.fs:87-88`；默认值 `chamfer.fs:112` |
| `directionOverrides`（Query，默认 `qNothing()`） | `chamfer.fs:77-83`；默认值 `chamfer.fs:112` |
| 距离边界 `BLEND_BOUNDS` = `[1e-5, 0.005, 500]` m，mm 默认 `5.0` | `valueBounds.fs:346-355` |
| 角度边界 `CHAMFER_ANGLE_BOUNDS` = `[0.1, 45, 179.9]` degree | `edgeBlendCommon.fs:23-26` |
| `APEX_RANGE` 组合语义（距离如何在两面上换算）**在标准库源码中无法确证** —— 内核黑盒 | `chamfer.fs` 全文无换算代码 |

### 1.2 Filter 语义 → 3d_editor 激活条件（调研步骤 ②）

Onshape `chamfer.fs:28-33` 的 Filter：

```
(ActiveSheetMetal.NO && ((EntityType.EDGE && EdgeTopology.TWO_SIDED) || EntityType.FACE))
|| (EntityType.EDGE && SheetMetalDefinitionEntityType.VERTEX)
&& ConstructionObject.NO && SketchObject.NO && ModifiableEntityOnly.YES
```

逐项映射到 3d_editor：

| Onshape 条件 | 3d_editor 对应判定 | 现状锚点 |
| --- | --- | --- |
| `ModifiableEntityOnly.YES` | 存在当前可编辑的 part 目标 | `useToolbarTarget()`（单一入口） |
| `ConstructionObject.NO && SketchObject.NO` | 3d_editor 无草图/构造几何概念 → 恒真 | — |
| `EntityType.EDGE && EdgeTopology.TWO_SIDED` | 该 part 的拓扑运行时存在且 `edges.length > 0` | `ViewportContainer.tsx:418-422`（`hasEdges`） |
| `EntityType.FACE`（选面 = 选其全部边） | V1 不做，仅选边 | 边拾取已存在：`useTopologyPicking.ts:266-295` |
| 钣金分支（`ActiveSheetMetal` / `SheetMetalDefinitionEntityType`） | 无钣金概念 → 整支删除 | — |
| `AdditionalBoxSelectFilter: EntityType.EDGE` | 框选只收边 | 与上面同一条 |

结论：3d_editor 的激活条件 = **① 有可编辑 part 目标** 且 **② 该 part 有可用边拓扑**。这与 Onshape 的 Filter 语义同构（去掉钣金与面选择两支）。

### 1.3 definition 参数体系 → 两端接口参数（调研步骤 ③）

| Onshape definition | 3d_editor store 字段 | faijs `cad.chamfer` 参数 | 备注 |
| --- | --- | --- | --- |
| `entities`（Query，边集合） | `chamferEdges: ChamferEdgeSelection[]` | `edges: EdgeAnchor[]` | 见 §2.3 边身份选型 |
| `chamferType` | `type` | `type` | `EQUAL_OFFSETS`→`'equal'`；`TWO_OFFSETS`→`'twoDistances'`；`OFFSET_ANGLE`→`'distanceAngle'`；`RAW_OFFSET`（隐藏）不暴露 |
| `width`（EQUAL / OFFSET_ANGLE） | `width` | `width` | 默认 1 mm（Onshape 默认 5 mm，faijs 侧取 1 mm 更贴合小零件；见 §7 R6） |
| `width1`（TWO_OFFSETS） | `width1` | `width1` | 绑定「参考面」侧，见 §2.3 |
| `width2`（TWO_OFFSETS） | `width2` | `width2` | |
| `angle`（OFFSET_ANGLE） | `angle` | `angle` | 度，默认 45 |
| `oppositeDirection` | —— | —— | **不暴露为参数**。语义 = 把参考面切到另一侧；由 anchor 的 `reference` 字段表达（§2.3）。UI 的「反向」按钮 = 换 `reference`（或等价地交换 `width1`/`width2`） |
| `tangentPropagation` | —— | —— | **不暴露**。OCCT `BRepFilletAPI_MakeChamfer::Add*()` 天然沿切向边传播且无法关闭；mesh 路径由共线链合并实现同样效果（§3.3）。不做「接受参数但忽略」的伪实现 |
| `directionOverrides` | —— | —— | 多倒角交汇处的手动定向，V1 不做 |

### 1.4 brepjs（调研步骤 ④）

| 事实 | 位置 |
| --- | --- |
| `chamfer(kernel, Module, shape, edges, distance)` 是**薄转发**：`resolveUniformRadius` 后直接 `k.chamfer(shape, vec, d)` | `src/kernel/occtWasm/modifierOps.ts:34-47` |
| `chamferDistAngle(...)` 同为薄转发 | `src/kernel/occtWasm/modifierOps.ts:49-62` |
| **没有任何几何算法**——全部在 wasm 内核里；brepjs 侧没有可抄的 mesh 路径 | 同上 |
| 抄什么：① API 命名（`chamfer` / `chamferDistAngle`）；② 「(边集合, 标量)」的参数形态 | — |
| **不抄什么**：brepjs 的边身份用 OCCT 句柄（`KernelShape`）——faijs 不能抄，见 §2.3 选型 | — |

### 1.5 occt-wasm（调研步骤 ⑤）

已安装版本：**3.8.4**（`node_modules/occt-wasm/package.json`）。

| 事实 | 位置 |
| --- | --- |
| 只提供三个倒角入口：`chamfer` / `chamferDistAngle` / `chamferWithHistory` | `node_modules/occt-wasm/dist/index.d.ts:136-137, 469` |
| `chamfer(solid, edges, distance)` = `MethodKind::FilletLike` → 逐边 `maker.Add(distance, TopoDS::Edge(get(eid)))`，即**对称倒角** | `xtask/src/codegen/config.rs:495-508` + `xtask/src/codegen/emitter.rs:97-138`（模板生成 `maker.Add({scalar_args}, TopoDS::Edge(get(eid)))`） |
| `chamferDistAngle(solid, edges, distance, angleDeg)` = `MethodKind::CustomBody`，内层双层 `TopExp_Explorer` 取**第一个**含该边的面作为参考面，再 `AddDA(distance, angleRad, edge, adjFace)` | `xtask/src/codegen/config.rs:509-544` |
| 参考面的枚举顺序 = 外层 `TopExp_Explorer(solid, TopAbs_FACE)` 的**第一个**含该边的面 | `xtask/src/codegen/config.rs:518-527` |
| `chamferWithHistory` **只支持对称**（内部就是 `maker.Add(distance, edge)`）；非对称没有 history 变体 | `xtask/src/codegen/config.rs:4512-4536` |
| **没有** `Add(Dis1, Dis2, E, F)` 的双距包装，也不暴露「指定相邻面」 | 全仓 grep 无 |

关键约束（决定了 §3.2 的设计）：

1. **非对称倒角只能通过 `chamferDistAngle` 表达**，必须把「两个距离」等价换算成「距离 + 角度」（§2.4 公式）。
2. `chamferDistAngle` 的参考面**不由调用方指定**，由 OCCT 枚举顺序隐式决定 → faijs 侧必须用同一顺序复现枚举（§3.2 步骤 4），并由测试 T-A3 钉死（§4）。
3. 非对称倒角拿不到面演化数据（`chamferDistAngle` 无 history 变体）。**这与现状一致**：faijs 的 `drillBrep` / `splitBrep` / `extrudeBrep` 都不用 `*WithHistory`；`cutWithHistoryBrep` 等封装目前只被自身测试消费（`packages/core/src/brep/face-evolution-impl.test.ts:19-20`，生产路径零调用）。

### 1.6 faijs 现状锚点

| 事实 | 位置 |
| --- | --- |
| `defineOp({ mesh?, brep?, capabilities?, outputs? })`；几何输入由 `args.filter(isShape)` 自动收集 | `packages/core/src/define-op.ts:114-170` |
| `dispatchPath` 静态判定；**无运行时 try-catch 回退**（AGENTS.md 红线） | `packages/core/src/cad-runtime/backend-dispatch.ts:76-131` |
| `BrepEngineApi` = BREP 引擎契约面；`BrepHandle` 中立句柄 | `packages/core/src/brep/engine/primitives.ts:26-152` |
| 编译期完整性守卫 `AssertSatisfiesBrepEngineApi`（新增接口方法 → 适配器不实现则 tsc 报错） | `packages/core/src/brep/engine/primitives.ts:163-175`；OCCT 侧 `adapters/occt.ts:59-60` |
| `initOcctWasm()` **直接返回原始 `OcctKernel` 实例**并 cast 成 `BrepEngineApi`（没有手写转发表） | `packages/core/src/occt-kernel/occtKernel.ts:87-113` |
| ⟹ `chamfer` / `chamferDistAngle` **运行时已可用**，只需补进 `BrepEngineApi` 接口 + `brep-mock.ts` | — |
| `BrepEngineApi` 已有可用原语：`getSubShapes(shape, type)`、`isSame`、`curveParameters(edge)→{first,last}`、`curvePointAtParam`、`curveTangent`、`surfaceType(face)`、`surfaceNormal(face,u,v)`、`getSurfaceCenterOfMass(face)`、`getBoundingBox` | `primitives.ts:82-118` |
| `BrepSubShapeType` 含 `'edge'` / `'face'` | `brep/engine/types.ts:106` |
| mesh 侧布尔原语：`union/subtract/intersect(a,b,...rest)`，均为 async（走 CSG worker） | `packages/core/src/mesh/boolean.ts:20-43` |
| mesh 侧查询：`boundingBox` / `bboxCenter` / `volume` / `faceAt` | `packages/core/src/mesh/query.ts:17,40,56,81` |
| `Shape = { positions: Float32Array; indices: Uint32Array }` | `packages/core/src/mesh/types.ts:36-39` |
| `cad` 命名空间聚合对象（新增 op 需挂到这里） | `packages/core/src/mesh/index.ts:35-101` |
| 库函数模板（照抄结构）：参数自校验 → `xxxBrepPath` / `xxxMeshPath` → `defineOp` 声明 → 完整 JSDoc | `packages/stdlib/src/drill.ts:35-43, 135-192, 194-231` |
| `assertVec3` / `assertPositiveNumber` / `assertOneOf` / `assertNumber` 已存在 | `packages/stdlib/src/assert.ts:16,27,51,95` |
| `codegen.fmtValue` 支持**任意嵌套** array / object（object 键不加引号） | `packages/core/src/lang/codegen.ts:52-66` |
| 当前版本号 **0.5.11**（`package.json`） | 发布新版本号 0.5.12 |

注册与生成文件链（新增 op 必须全部走一遍）：

| 步骤 | 命令 / 文件 |
| --- | --- |
| ① 装配进 cad 命名空间 | `packages/stdlib/src/internal-stdlib.ts:15-56`（import + 返回对象） |
| ② 包入口导出 | `packages/stdlib/src/index.ts:14-38` |
| ③ 符号表（源码 = internal-stdlib） | `npx tsx packages/core/scripts/gen-symbol-table.ts` → `packages/core/src/lang/symbol-table.generated.ts`（脚本内 `OUTPUT` 见 `gen-symbol-table.ts:28`） |
| ④ `CAD_NAMESPACE_FUNCTIONS` 集合（一致性测试） | `packages/core/src/lang/op-set-consistency.test.ts:26-32` |
| ⑤ `mesh/api.d.ts`（生成文件，禁手改） | `npx tsx packages/core/scripts/gen-api-dts.ts`（脚本内 `outputPath` 见 `gen-api-dts.ts:20`；**函数目录在该脚本内，需手工加条目**） |
| ⑥ ops 手册（从 stdlib JSDoc 抽取） | `npx tsx scripts/gen-ops-api-inventory.ts` |

### 1.7 3d_editor 现状锚点

| 事实 | 位置 |
| --- | --- |
| `FeatureDef` 结构（type / ops / commandType / buildArgs / buildCode / getIconKey / deriveLabel / editor） | `src/engine/features/types.ts:87-150` |
| `FeatureIconKey` 联合类型（新增 `'chamfer'`） | `src/engine/features/types.ts:27-33` |
| `deriveOutputs(callee, inputNames, outputCount, currentCode)` + `formatCodeLine`（re-export 自 faijs） | `src/engine/features/types.ts:152-178` |
| 注册表：`registerFeature` 断言 type / op / commandType 三者唯一 | `src/engine/features/index.ts:31-56`；集中注册 `:104-118` |
| `ActiveToolMode` 联合类型（新增 `'chamfer'`） | `src/stores/core/tool-store.ts:11` |
| `COMMAND_TYPES` 数组（新增 `'chamfer'`）；`CommandParams` 扁平结构 | `src/engine/version-store/Command.ts:12-34, 36-107` |
| 工具栏 Filter 范式（`muted = selectableCount > 1 && selectedCount === 0`） | `src/engine/components/drill-hole/DrillHoleToolbar.tsx:13-38` |
| `shouldUseFastPreview`（≥10000 三角走 ghost） | `src/engine/components/drill-hole/drill-preview-mode.ts`（导出见 `LiveDrillPreview.tsx:24`） |
| 预览链路：`geometryBinding.saveG0/getG0/bindPreviewGeometry/clearPreview` + 200ms 防抖 + `requestIdRef` 陈旧丢弃 | `src/engine/components/drill-hole/LiveDrillPreview.tsx:70-71, 146-230, 342-348`；`src/engine/version-store/GeometryBinding.ts` |
| **预览直接调 faijs stdlib**：`import { drill } from '@faicad/faijs/stdlib'` | `src/engine/components/drill-hole/LiveDrillPreview.tsx:10`（新增 chamfer 走同一子路径 `@faicad/faijs/stdlib`） |
| 边拾取已实现：`useTopologyPicking.ts:266-295`（mode `'edge'`，`raycaster.params.Line.threshold`） | — |
| 边引用解析：`edgeReferenceFromIntersection(intersection, runtime) → Reference \| null` | `src/lib/topology/picking.ts:43-57` |
| `Reference` 结构含 `id / pickData.center / pickData.segmentStart / pickData.segmentCount / pickData.params / pickData.adjacentSelectors` | `packages/core/src/topology/types.ts:166-213`（faijs 侧） |
| `SelectorRuntime.proxy.edgePositions`（Float32Array）可按下标取端点坐标 | `packages/core/src/topology/types.ts:240-256`；`build-selector-runtime.ts:605-610` |
| 拓扑来源四档：`stepRuntimes` / `glbRuntimes` / `primitiveRuntimes` / `meshRuntimes` | `src/stores/core/topology-store.ts:85-90`；来源表注释 `:13-16` |
| `hasEdges` 判据（任一 runtime 的 `edges.length > 0`） | `src/components/viewport/ViewportContainer.tsx:418-422` |
| **mesh 模式下 primitive 拓扑只在创建时生成一次，后续 op 不刷新** | `src/engine/script-engine/ScriptEngine.ts:616-624`（`if (!getSelectorRuntime(...))` 才生成） |
| BREP 模式下每次语句执行后重建拓扑 | `ScriptEngine.ts:1003, 1176, 1348`（`_rebuildBrepTopology`） |
| 已有**纯 mesh 特征检测**模块（平面/圆柱/边检测 + 假拓扑），可异步在 worker 跑 | `src/lib/mesh-feature-detection/index.ts`；`build-mesh-topology-async.ts` |
| mesh 假拓扑构建调用点（>10000 三角直接跳过） | `src/components/viewport/ViewportContainer.tsx:511-572`（阈值判定在 `:558`） |
| 工具栏挂载点 | `src/layouts/DesktopLayout.tsx:1434`（`<DrillHoleToolbar />`） |
| locale 文件共 **20 个**：`src/locales/{ar,de,en,es,fr,hi,id,it,ja,ko,nl,pl,pt,ru,sv,th,tr,uk,vi,zh}.json` | `src/locales/` |
| 消费 faijs 方式：`package.json:24-26` → `file:../faijs/faicad-faijs-<ver>.tgz`（当前 0.5.11） | — |

---

## 2. faijs 倒角 API 契约

### 2.1 签名

```ts
// 源码形态（.faijs 是合法 JS 子集）
const part0_v1 = await cad.chamfer(part0, {
  edges: [
    { point: [10, 10, 0], direction: [0, 0, 1], reference: [10, 9, 0] },
    { point: [10, -10, 0], direction: [0, 0, -1] },
  ],
  type: 'equal',        // 'equal' | 'twoDistances' | 'distanceAngle'
  width: 1,             // type='equal' | 'distanceAngle'
  // width1 / width2    // type='twoDistances'
  // angle              // type='distanceAngle'
})
```

```ts
// TS 契约（packages/stdlib/src/chamfer.ts）
export interface EdgeAnchor {
  /** 边中点（part 局部坐标，mm）。必填。 */
  point: [number, number, number]
  /** 边方向（单位向量）。可选，用于消歧（平行边、对称件）。 */
  direction?: [number, number, number]
  /**
   * 参考面提示：落在该面上的一点（part 局部坐标，mm）。可选。
   * 语义：type 为 'twoDistances' / 'distanceAngle' 时，width1 / width 在
   * 「质心离 reference 更近的那个相邻面」上测量。
   * 缺省回落到确定性默认：两个相邻面质心的字典序 (x,y,z) 较小者。
   * —— 对应 Onshape 的 oppositeDirection：换到另一个面即"反向"。
   */
  reference?: [number, number, number]
}

export type ChamferType = 'equal' | 'twoDistances' | 'distanceAngle'

export interface ChamferParams {
  edges: EdgeAnchor[]
  type?: ChamferType            // 默认 'equal'
  width?: number                // 默认 1（mm）
  width1?: number               // 默认 1（mm）
  width2?: number               // 默认 1（mm）
  angle?: number                // 默认 45（度）
  /** 特征边判定阈值（度）。mesh 路径专用，默认 5。 */
  minDihedral?: number
}
```

返回值：`Promise<Shape>`（mesh 路径走 CSG worker，必然 async）。

### 2.2 参数矩阵与合法性

| `type` | 必填 | 忽略 | 语义 |
| --- | --- | --- | --- |
| `'equal'` | `width` | `width1` / `width2` / `angle` | 两面对称，各切 `width` |
| `'twoDistances'` | `width1` / `width2` | `width` / `angle` | `width1` 量在参考面，`width2` 量在另一面 |
| `'distanceAngle'` | `width` / `angle` | `width1` / `width2` | `width` 量在参考面，`angle` = 倒角面与参考面的夹角（度） |

合法性校验（`assertChamferParams`）：

| 校验 | 规则 | 错误码 |
| --- | --- | --- |
| V1a | `edges` 是长度 ≥ 1 的数组；每个元素 `point` 通过 `assertVec3` | `CHAMFER_BAD_EDGES` |
| V1b | `direction` / `reference` 若提供则通过 `assertVec3`；`direction` 通过 `assertNonZeroVec3` | `CHAMFER_BAD_EDGES` |
| V2a | `type` 通过 `assertOneOf(['equal','twoDistances','distanceAngle'])` | `CHAMFER_BAD_TYPE` |
| V2b | 按上表：必填项缺失 → 报错；**忽略项被显式传入 → 也报错**（不接受静默忽略） | `CHAMFER_PARAM_CONFLICT` |
| V3a | `width` / `width1` / `width2` ∈ (0, 500] mm，下限 0.01 mm | `CHAMFER_WIDTH_OUT_OF_RANGE` |
| V3b | `angle` ∈ [0.1, 179.9] 度 | `CHAMFER_ANGLE_OUT_OF_RANGE` |

> V3 的区间取自 Onshape `BLEND_BOUNDS`（`valueBounds.fs:346-355`）与 `CHAMFER_ANGLE_BOUNDS`（`edgeBlendCommon.fs:23-26`），单位换算到 mm（faijs 契约：mm、度）。

### 2.3 边身份（EdgeAnchor）选型

**这是倒角的核心难点**：`.faijs` 是纯文本源码，必须能从零重放；mesh-only 零件没有 BREP 拓扑。

| 方案 | 能否序列化进 `.faijs` | mesh-only 零件可用 | 结论 |
| --- | --- | --- | --- |
| A. OCCT 句柄（`BrepHandle`） | ✗ 会话内有效，跨重放失效 | ✗ | **否**（brepjs 的做法不能抄） |
| B. selector id（拓扑表行号 / `ReferenceId`） | ✓ 文本 | ✗ 引擎执行期无拓扑运行时；且行号随几何变化而漂移 | **否** |
| **C. 几何锚点（point + 可选 direction + 可选 reference）** | ✓ 纯数字 | ✓ 由 `extractFeatureEdges` 从三角网格现场算 | **选 C** |

**匹配规则**（两条链共用同一套，保证 parity）：

```
候选集：
  BREP 链 = kernel.getSubShapes(solid, 'edge')，逐条 curveParameters → curvePointAtParam(first/last) → 中点/方向
  mesh 链 = extractFeatureEdges(shape)（§3.3），逐条已有 point/direction/length

matchTol = max(0.01, 1e-3 × bboxDiagonal)          // mm；bboxDiagonal 为输入零件包围盒对角线
dirTol   = sin(5°)                                  // 方向容差

对每个 anchor：
  1. 取 |mid(e) - anchor.point| 最小的候选边 e*
  2. 若提供了 anchor.direction：先按 |sin(angle(t_e, anchor.direction))| <= dirTol 过滤，再取距离最小者
  3. 若 d(e*) > matchTol                                  → CHAMFER_EDGE_NOT_FOUND（报出 point 与实际最近距离）
  4. 若次近候选 d(e2) 满足 d(e2) - d(e*) < 0.01 × d(e*) 且方向也不分胜负 → CHAMFER_EDGE_AMBIGUOUS
  5. 不同 anchor 匹配到同一条候选边 → 去重（保留第一个），不报错
```

`reference` 的解析（仅 `twoDistances` / `distanceAngle` 需要）：

```
该边的两个相邻面 F_a / F_b，质心 C_a / C_b    // BREP: getSurfaceCenterOfMass；mesh: 面片质心
若提供 anchor.reference：取 |C - reference| 较小者为参考面
否则：取 (C.x, C.y, C.z) 字典序较小者为参考面
```

### 2.4 双距 ↔ 距角换算（精确等价，非近似）

设：棱上一点 `A`，单位边方向 `t`，材料侧二面角 `β`（度），参考面距离 `dF`，另一面距离 `dO`，倒角面与**参考面**的夹角 `θ`（度，在材料侧测量）。

由三角形 `A-Q_F-Q_O` 的正弦定理（`AQ_F = dF`，`AQ_O = dO`，顶角 `β`，`θ` 是 `Q_F` 处的内角）：

```
(1)  dO = dF · sin(θ) / sin(β + θ)
(2)  θ  = atan2( sin β , dF/dO − cos β )
```

自检（手算，实现时写进单测）：

| β | dF | dO | θ = atan2(sinβ, dF/dO − cosβ) | 回代 dO = dF·sinθ/sin(β+θ) |
| --- | --- | --- | --- | --- |
| 90° | 1 | 1 | atan2(1, 1−0) = **45°** | 1·sin45/sin135 = **1.0** ✓ |
| 90° | 2 | 1 | atan2(1, 2−0) = **26.565°** | 2·sin26.565/sin116.565 = **1.0** ✓ |
| 90° | 1 | 2 | atan2(1, 0.5−0) = **63.435°** | 1·sin63.435/sin153.435 = **2.0** ✓ |
| 60° | 1 | 1 | atan2(0.8660, 1−0.5) = **60°** | 1·sin60/sin120 = **1.0** ✓ |

注意 `θ` 与 `180° − β − θ` 是一对互补定义（`Q_F` 处的内角 vs `Q_O` 处的内角）。**OCCT `AddDA(Dis, Ang, E, F)` 中 `Ang` 究竟取哪一个，本文不下断言**——由测试 T-A3（§4）用实际几何钉死；若实测为互补角，则在 §3.2 的换算出口统一取 `θ' = 180° − β − θ`（一处改动，不改算法结构）。

### 2.5 错误码

全部以 `[stdlib/chamfer] ` 前缀抛出（`Error`），不做静默降级、不做运行时回退：

| 错误码 | 触发 |
| --- | --- |
| `CHAMFER_BAD_EDGES` | V1a / V1b |
| `CHAMFER_BAD_TYPE` | V2a |
| `CHAMFER_PARAM_CONFLICT` | V2b |
| `CHAMFER_WIDTH_OUT_OF_RANGE` | V3a |
| `CHAMFER_ANGLE_OUT_OF_RANGE` | V3b |
| `CHAMFER_NO_INPUT` | 输入 Shape 为空 |
| `CHAMFER_MESH_NOT_MANIFOLD` | mesh 路径：检测到非流形边（≥3 面共边）或边界边 |
| `CHAMFER_EDGE_NOT_FOUND` | anchor 匹配不到边 |
| `CHAMFER_EDGE_AMBIGUOUS` | 匹配置信度不足 |
| `CHAMFER_CURVED_EDGE_UNSUPPORTED` | 边不是直线（圆弧等）；V1 不支持 |
| `CHAMFER_NON_PLANAR_ADJACENT_FACE` | 相邻面非平面（圆柱面等）；V1 不支持 |
| `CHAMFER_OVERCUT` | V5 体积判据失败（倒角切到邻近特征） |
| `CHAMFER_BREP_FAILED` | OCCT 侧抛异常，原样上抛（**禁止 catch 后回落 mesh**） |

---

## 3. faijs 实现

### 3.1 文件清单

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `packages/core/src/brep/engine/primitives.ts` | 改 | `BrepEngineApi` 增 2 个方法（§3.2.1） |
| `packages/core/src/brep/engine/adapters/brep-mock.ts` | 改 | 补 2 个 mock 实现（否则 tsc 守卫报错） |
| `packages/core/src/brep/brep-ops.ts` | 改 | 新增 `chamferBrep`（§3.2.2） |
| `packages/core/src/mesh/feature-edges.ts` | **新增** | `extractFeatureEdges`（§3.3.1） |
| `packages/core/src/mesh/chamfer.ts` | **新增** | `chamfer`（§3.3.2） |
| `packages/core/src/mesh/index.ts` | 改 | `cad` 对象挂 `chamfer`（mesh 路径） |
| `packages/stdlib/src/chamfer.ts` | **新增** | `defineOp` 声明 + 双路径 + JSDoc（§3.4） |
| `packages/stdlib/src/internal-stdlib.ts` | 改 | import + 装配 |
| `packages/stdlib/src/index.ts` | 改 | `export { chamfer } from './chamfer'` |
| `packages/core/src/lang/symbol-table.generated.ts` | 改（生成） | 重跑 `gen-symbol-table.ts` |
| `packages/core/src/lang/op-set-consistency.test.ts` | 改 | `CAD_NAMESPACE_FUNCTIONS` 加 `'chamfer'`（第 31 行 `drill, extrude, engrave, knurl,` 那一行） |
| `packages/core/src/mesh/api.d.ts` | 改（生成） | 在 `gen-api-dts.ts` 的函数目录加条目后重跑 |
| `docs/ops-api-inventory.md` | 改（生成） | 重跑 `gen-ops-api-inventory.ts` |

> `occtKernel.ts` **不需要改**：`initOcctWasm()` 直接返回原始 `OcctKernel`（`occtKernel.ts:87-113`），`chamfer` / `chamferDistAngle` 运行时已可用，只需补接口声明。

### 3.2 BREP 链

#### 3.2.1 `BrepEngineApi` 扩展

在 `packages/core/src/brep/engine/primitives.ts` 的「造型运算」段（`loft` 之后、「布尔与分割」之前，即第 47-49 行之间）插入：

```ts
  // ── 造型运算 ──
  /**
   * 对称倒角（OCCT BRepFilletAPI_MakeChamfer::Add(Dis, E)，逐边）。
   * @param edges 目标边句柄（须属于 solid）
   * @param distance 两侧等距（mm）
   */
  chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle
  /**
   * 距角倒角（OCCT ::AddDA(Dis, Angle, E, F)）。
   * ⚠️ 参考面 F **不由调用方指定**：occt-wasm 内部按
   * `TopExp_Explorer(solid, TopAbs_FACE)` 顺序取第一个含该边的面
   * （xtask/src/codegen/config.rs:518-527）。调用方必须用同一顺序复现
   * 枚举以决定 distance 落在哪一侧（见 brep-ops.ts resolveReferenceFace）。
   * @param distance 参考面上的距离（mm）
   * @param angleDeg 倒角面与参考面的夹角（度）
   */
  chamferDistAngle(
    solid: BrepHandle,
    edges: BrepHandle[],
    distance: number,
    angleDeg: number,
  ): BrepHandle
```

`brep-mock.ts` 对应补（放在该文件的 IO 段之后、面演化段之前，形态照抄 `cutWithHistory: (a,b,_h,_u) => ...`，`packages/core/src/brep/engine/adapters/brep-mock.ts:288-311`）：

```ts
    chamfer: (solid, _edges, _distance) => alloc({ kind: 'solid', bbox: bboxOf('solid', [10, 10, 10]), tag: 'chamfer(mock)' }),
    chamferDistAngle: (solid, _edges, _distance, _angleDeg) => alloc({ kind: 'solid', bbox: bboxOf('solid', [10, 10, 10]), tag: 'chamferDistAngle(mock)' }),
```

（mock 只需满足类型守卫，不产生真实几何；`brep-mock` 不参与 parity 测试。）

#### 3.2.2 `chamferBrep`（`packages/core/src/brep/brep-ops.ts`）

新增函数，紧随 `drillBrep`（第 262 行）之后。签名：

```ts
export interface ChamferEdgeResolved {
  handle: BrepHandle
  mid: THREE.Vector3
  dir: THREE.Vector3      // 单位向量
  betaDeg: number         // 材料侧二面角
  faceRef: BrepHandle     // 参考面（由 anchor.reference 或默认规则选定）
  faceOther: BrepHandle
  centerRef: THREE.Vector3
  centerOther: THREE.Vector3
}

export function chamferBrep(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  params: {
    edges: EdgeAnchor[]
    type: ChamferType
    width: number
    width1: number
    width2: number
    angle: number
  },
): BrepHandle
```

执行六步：

**步骤 1 — 收集候选边**

```
const candidates = kernel.getSubShapes(solid, 'edge')
for (const e of candidates) {
  const cp = kernel.curveParameters(e)                       // { first, last }
  const p0 = v3(kernel.curvePointAtParam(e, cp.first))
  const p1 = v3(kernel.curvePointAtParam(e, cp.last))
  const mid = p0.clone().add(p1).multiplyScalar(0.5)
  const dir = p1.clone().sub(p0).normalize()                 // 退化（p0≈p1）则跳过
  const straight = kernel.curveType(e) === 'line'            // 非直线 → CHAMFER_CURVED_EDGE_UNSUPPORTED
}
```

**步骤 2 — 匹配 anchor**（规则同 §2.3，两条链共用 `matchAnchors()` 工具函数，放在 `packages/core/src/mesh/chamfer.ts` 里由两侧 import，保证一致）

**步骤 3 — 解析每条边的两个相邻面（复现 OCCT 枚举顺序）**

```
function adjacentFacesInOcctOrder(kernel, solid, edge): BrepHandle[] {
  const out: BrepHandle[] = []
  for (const f of kernel.getSubShapes(solid, 'face')) {          // 外层：与 occt-wasm 一致
    for (const fe of kernel.getSubShapes(f, 'edge')) {           // 内层
      if (kernel.isSame(fe, edge)) { out.push(f); break }
    }
    if (out.length === 2) break                                   // 只要前两个
  }
  return out
}
```

> 该顺序**必须与 occt-wasm `chamferDistAngle` 内部一致**，否则 `distance` 会落在错误的面上。由 T-A3 钉死（§4）。

**步骤 4 — 计算二面角 β 与凸凹性**

```
对参考面 F 与另一面 F'：
  要求 kernel.surfaceType(F) === 'plane' 且 surfaceType(F') === 'plane'   // 否则 CHAMFER_NON_PLANAR_ADJACENT_FACE
  n_F = normalize(kernel.surfaceNormal(F, 0, 0))     // 平面法线与 UV 无关
  n_O = normalize(kernel.surfaceNormal(F', 0, 0))
  C_F = kernel.getSurfaceCenterOfMass(F)             // 面质心
  C_O = kernel.getSurfaceCenterOfMass(F')
  A   = 边中点；t = 边方向
  m_F = normalize((C_F − A) − ((C_F − A)·t)·t)       // 面内、垂直边、指向面内
  m_O = normalize((C_O − A) − ((C_O − A)·t)·t)

  convex = (n_F·(m_F + m_O) < 0) && (n_O·(m_F + m_O) < 0)
  γ      = acos(clamp(m_F · m_O, -1, 1))             // 弧度，∈ [0, π]
  β      = convex ? γ : (2π − γ)                      // 材料侧二面角
```

自检（写进单测）：立方体棱 → `n_F=(1,0,0)`、`n_O=(0,1,0)`、`m_F=(0,-1,0)`、`m_O=(-1,0,0)` → `convex = (−1<0)&&(−1<0) = true`，`γ = 90°`，`β = 90°` ✓。

**步骤 5 — 按 type 分派**

```
type === 'equal':
    kernel.chamfer(solid, edgeHandles, width)                       // 一次调用，全部边
type === 'twoDistances':
    (dF, dO) = 由 width1/width2 与参考面归属决定
              —— 若参考面就是 anchor.reference 所指的面：dF = width1, dO = width2
              —— 否则：                                  dF = width2, dO = width1
    θ  = atan2(sin β, dF/dO − cos β)                     // §2.4
    逐边分组：把 θ 与 β 相同的边合并到同一次调用
    调用 chamferDistAngleForEdge(e)  // 见步骤 6
type === 'distanceAngle':
    dF = width；θ = angle（用户直接给的）
    逐边调用
```

**步骤 6 — `chamferDistAngle` 的参考面对齐**

`chamferDistAngle` 只会把 `distance` 落在 **OCCT 枚举得到的第一个面** `Fenum = adjacentFacesInOcctOrder(solid, edge)[0]` 上。因此：

```
if (kernel.isSame(Fenum, faceRef)) {
    // 用户指定的参考面 == OCCT 的参考面：直接传 (dF, θ)
    kernel.chamferDistAngle(solid, [e], dF, deg(θ))
} else {
    // OCCT 会量在另一面上：把"另一面的距离"作为 distance，
    // 角度换成另一面处的内角 θ_O = 180° − β − θ
    dO = dF · sin θ / sin(β + θ)                     // §2.4 (1)
    θ_O = π − β − θ
    kernel.chamferDistAngle(solid, [e], dO, deg(θ_O))
}
```

> 两条分支在数学上产生**同一张倒角面**（同一条 `Q_F-Q_O` 直线），只是参数化方式不同。这是必要的，因为 OCCT 不暴露「指定参考面」的入口（§1.5）。

**清理**：逐边/逐批调用后 `kernel.release()` 所有临时句柄；最终返回最后一步的结果句柄。错误一律上抛，包成 `CHAMFER_BREP_FAILED`，**不 try-catch 回退 mesh**（AGENTS.md 红线）。

#### 3.2.3 stdlib BREP 路径

照 `drill.ts:135-164` 的形态：

```ts
function chamferBrepPath(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/chamfer] no BREP kernel')
  const inputSolid = brepOf(input) as BrepHandle | undefined
  if (!inputSolid) throw new Error('[stdlib/chamfer] input is not BREP')
  const resultSolid = chamferBrep(kernel, inputSolid, normalizeChamferParams(params))
  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}
```

**注意：chamfer 不断链。** 它同时提供 mesh 与 brep 两条实现（与 `drill` 同构），因此 `dispatchPath` 在 BREP 存活时选 brep，产物用 `fromBrep(...)` 登记 BREP 句柄 → 后续操作仍可继续走 BREP 精确路径。这一点与 `knurl`（mesh-only，必然断链）不同，需在 JSDoc 中写明。

### 3.3 mesh 链

mesh 路径不借用任何 BREP 能力，全部由三角网格现场推导。

#### 3.3.1 `extractFeatureEdges`（`packages/core/src/mesh/feature-edges.ts`，新增）

```ts
export interface MeshPatch {
  /** 该面片包含的三角形下标 */
  triangles: number[]
  /** 面积加权平均法线（单位，朝外） */
  normal: [number, number, number]
  /** 质心 */
  centroid: [number, number, number]
  /** 面片内所有三角形法线与平均法线的最大夹角（度） */
  flatnessDeg: number
}

export interface FeatureEdge {
  /** 合并后的中点 */
  point: [number, number, number]
  /** 合并后的单位方向（直线链） */
  direction: [number, number, number]
  /** 链的总长度（mm） */
  length: number
  /** 材料侧二面角（度）；<180 凸，>180 凹 */
  dihedralDeg: number
  convex: boolean
  /** 两侧面片（顺序不定，由调用方按 reference 选参考面） */
  patches: [MeshPatch, MeshPatch]
  /** 直线度残差（度）：链上各段方向的最大夹角；> tol 说明是折线 */
  straightnessDeg: number
}

export function extractFeatureEdges(
  shape: Shape,
  opts?: { minDihedralDeg?: number; weldTol?: number; planarAngleDeg?: number },
): { edges: FeatureEdge[]; patches: MeshPatch[] }
```

算法（5 步，全部 O(n) 或 O(n log n)）：

1. **顶点焊接**：位置量化到 `weldTol = max(1e-5, 1e-4 × bboxDiagonal)` mm，建 `Map<string, vertexId>`，产出 `triVerts: Uint32Array(3 × triCount)`。
2. **半边结构**：`Map<`${min(v0,v1)}_${max(v0,v1)}`, number[]>` 收集每条无向边关联的三角形。
   - `size === 1` → 边界边（开放网格）→ 记 `boundaryCount++`
   - `size >= 3` → 非流形 → 记 `nonManifoldCount++`
   - 只有 `size === 2` 的参与后续
   - 若 `boundaryCount > 0 || nonManifoldCount > 0` → 抛 `CHAMFER_MESH_NOT_MANIFOLD`（附带计数；Manifold 输出的网格恒流形，不流形说明是未经 reconcile 的三角汤）
3. **逐边二面角**：两侧三角形法线 `nA`、`nB`（未归一化的叉积累加，再归一），`φ = acos(clamp(nA·nB))`。`φ < minDihedralDeg`（默认 5°）→ 平滑边，跳过；否则是特征边。
4. **全局面片分割**：一次 flood-fill，从任意未归属三角形出发，沿**非特征边**（φ < 阈值）扩展，同类法线（夹角 < `planarAngleDeg`，默认 1°）才并入。得到 `patches[]`。每条特征边据此拿到两侧面片索引。
   > 这一步是 O(F) 单次全局扫描，而不是「每条边做一次 flood-fill」（那会是 O(E×F)）。
5. **共线链合并**：把共享端点、方向夹角 < 1°、二面角相差 < 1°、凸凹性相同、且**两侧面片对相同**的相邻特征边串成链。链输出合并后的 `point`（加权中点）/ `direction`（首尾方向）/ `length` / `straightnessDeg`。
   > 这一步对应 Onshape 的 `tangentPropagation` 与 OCCT `Add*()` 的切向传播；同时保证锚点匹配稳定（不会因为网格细分把一条边切成十段）。

#### 3.3.2 mesh 倒角主流程（`packages/core/src/mesh/chamfer.ts`，新增）

```ts
export async function chamfer(shape: Shape, params: ChamferParams): Promise<Shape>
```

**关键设计决策：先一次性解析全部边，再合并工具，最后只跑 2 次布尔。**

理由：如果「解析边 1 → 布尔 → 再解析边 2」，第二次解析会落在已被第一次切掉的几何上，`A` / `t` / 面片质心全部失效。因此必须：

```
阶段 A（几何解析，全部基于原始输入 shape，只读）：
  const { edges } = extractFeatureEdges(shape, { minDihedralDeg })
  const matched = matchAnchors(edges, params.edges, matchTol)      // §2.3
  for (const m of matched) {
    校验 straightnessDeg < 1°              否则 CHAMFER_CURVED_EDGE_UNSUPPORTED
    校验 两侧 patch.flatnessDeg < 1°       否则 CHAMFER_NON_PLANAR_ADJACENT_FACE
    A = m.point; t = m.direction
    n1 = patch1.normal; C1 = patch1.centroid
    n2 = patch2.normal; C2 = patch2.centroid
    m1 = normalize((C1−A) − ((C1−A)·t)t)
    m2 = normalize((C2−A) − ((C2−A)·t)t)
    convex = (n1·(m1+m2) < 0) && (n2·(m1+m2) < 0)
    γ = acos(clamp(m1·m2));  β = convex ? γ : 2π−γ
    参考面 = 由 anchor.reference 或默认规则（§2.3）选定 → (dF, dO)
    Q_F = A + dF · m_F ;  Q_O = A + dO · m_O
    工具棱柱 = 截面三角形 (A, Q_F, Q_O) 沿 t 拉伸 [s_min − e, s_max + e]，e = max(dF, dO)
    放入 convexTools（convex）或 reflexTools（reflex）
  }

阶段 B（合并工具）：
  const cutTool  = convexTools.length ? await mergeAll(convexTools) : null   // union 逐个合并
  const addTool  = reflexTools.length ? await mergeAll(reflexTools) : null

阶段 C（布尔，最多 2 次）：
  let out = shape
  if (cutTool) out = await subtract(out, cutTool)
  if (addTool) out = await union(out, addTool)

阶段 D（V5 体积校验）：
  ΔV_expected = Σ_convex 0.5·dF·dO·sin(β)·length  −  Σ_reflex 0.5·dF·dO·sin(β)·length
              （convex 减材料，reflex 加材料）
  ΔV_actual   = volume(shape) − volume(out)
  if (|ΔV_actual − ΔV_expected| > 0.2 × |ΔV_expected|) → CHAMFER_OVERCUT
```

**凸/凹的布尔方向**（这是 mesh 路径的核心，必须写对）：

| 边类型 | β | 倒角效果 | 布尔 |
| --- | --- | --- | --- |
| 凸棱（外角，如立方体的棱） | < 180° | 削掉外角 | `subtract(shape, tool)` |
| 凹棱（内角，如槽底棱、L 形内拐角） | > 180° | 填平内拐角（**加材料**） | `union(shape, tool)` |

自检（写进单测）：L 形件内拐角 `A=(1,1,0)`，`m_F=(1,0,0)`，`m_O=(0,1,0)`，`n_F=(0,1,0)`，`n_O=(1,0,0)` → `m_F+m_O=(1,1,0)`，`n_F·(m_F+m_O)=1 > 0` → `convex=false` → `β = 360° − 90° = 270°` ✓ → 走 union ✓。

**工具棱柱的构造**（必须是合法 Manifold 实体）：

```
输入：A（棱上一点）、t（单位方向）、Q_F、Q_O、s_min、s_max、e = max(dF, dO)
1. 截面多边形（3 点）：P = [A, Q_F, Q_O]，位于垂直于……不一定垂直，无所谓，只要不退化
2. 绕序修正：以 t 为拉伸轴，令截面法线 nc = normalize(cross(Q_F − A, Q_O − A))；
   若 nc · t < 0 则反转 P（保证拉伸体的面法线朝外）
3. 拉伸区间：[s_min − e, s_max + e]，其中 s_min/s_max 是链上所有端点到 A 沿 t 的投影最小/最大值
4. 顶点：对每个 P_i 生成 (P_i + t·(s_min−e)) 与 (P_i + t·(s_max+e))
5. 三角化：3 个侧面四边形 + 2 个端面三角形；索引绕序按外向统一处理
6. 退化保护：若 |cross(Q_F−A, Q_O−A)| < 1e-9 × |Q_F−A| × |Q_O−A|（三点共线）→ CHAMFER_BAD_EDGES
```

**为什么延伸 `e = max(dF, dO)` 是安全的**：对立方体棱而言，工具棱柱被 `x ≤ 1`、`y ≤ 1` 两个半空间自然限制（这两个半空间正是立方体自身的面），延伸只会让倒角面跑满整条棱，不会切到相邻特征。对一般形状，由 V5 体积判据兜底。

### 3.4 stdlib 声明与 JSDoc

`packages/stdlib/src/chamfer.ts` 全文骨架：

```ts
/**
 * stdlib chamfer — 倒角库函数
 *
 * 设计文档：docs/plans/2026-08-30-chamfer-design-and-implementation.md §2–§3
 *
 * dispatchPath 静态判定 brep/mesh。
 * BREP 路径：OCCT BRepFilletAPI_MakeChamfer（对称 chamfer / 距角 chamferDistAngle）。
 * mesh 路径：特征边提取 + 工具棱柱 + Manifold 布尔。
 * ⚠️ 本 op 双链齐备，**不会造成 BREP 断链**（与 knurl 等 mesh-only op 不同）。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { chamferBrep, solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { fromBrep, brepOf } from '@faicad/faijs-core/shape'
import { defineOp } from '@faicad/faijs-core/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import { assertNumber, assertOneOf, assertVec3, assertNonZeroVec3 } from './assert'

export type { EdgeAnchor, ChamferType, ChamferParams } from './chamfer-types'

/** 参数自校验（V1–V3；stdlib 被直接 import 时的防御层，与 drill.ts:35 同构）。 */
export function assertChamferParams(params: Record<string, unknown>): void { /* §2.2 */ }

function chamferBrepPath(input: Shape, params: Record<string, unknown>): Shape { /* §3.2.3 */ }

async function chamferMeshPath(input: Shape, params: Record<string, unknown>): Promise<Shape> {
  if (!input) throw new Error('[stdlib/chamfer] no input geometry')
  return cad.chamfer(input, params as never)
}

/**
 * 给选中的棱边倒角（对称 / 双距 / 距角三种尺寸模式）。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name chamfer
 * @note `edges` 用**几何锚点**描述边（point + 可选 direction + 可选 reference），
 *       不用句柄也不用 selector id —— .faijs 是纯文本源码，必须可从零重放，
 *       且 mesh-only 零件没有 BREP 拓扑可引用。
 * @note `type='twoDistances'|'distanceAngle'` 时，尺寸量在「参考面」上：
 *       参考面 = 质心离 `reference` 更近的那个相邻面；未提供 `reference` 时
 *       取两面质心字典序较小者（确定性默认）。换到另一侧 = Onshape 的 oppositeDirection。
 * @note 凸棱削材料（β<180°），凹棱填材料（β>180°），两者都支持。
 * @note V1 限制：仅支持**直线边**且两侧相邻面均为**平面**；圆弧边与圆柱面相邻
 *       会抛 CHAMFER_CURVED_EDGE_UNSUPPORTED / CHAMFER_NON_PLANAR_ADJACENT_FACE，不静默降级。
 * @returns Shape 倒角后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.edges - 倒角边锚点数组，至少 1 个。type:[EdgeAnchor] required:true
 * @param params.type - 尺寸模式：equal 等距 / twoDistances 双距 / distanceAngle 距角。type:'equal' | 'twoDistances' | 'distanceAngle' 默认 'equal'
 * @param params.width - 等距模式的倒角宽度（mm）；距角模式下为参考面上的距离。type:number 默认 1
 * @param params.width1 - 双距模式：参考面上的距离（mm）。type:number 默认 1
 * @param params.width2 - 双距模式：另一面上的距离（mm）。type:number 默认 1
 * @param params.angle - 距角模式：倒角面与参考面的夹角（度）。type:number 默认 45
 * @param params.minDihedral - 特征边判定阈值（度），仅 mesh 路径使用。type:number 默认 5
 * @example
 * const p = await cad.chamfer(part0, { edges: [{ point: [10, 10, 0] }], type: 'equal', width: 1 })
 * const p = await cad.chamfer(part0, { edges: [{ point: [10, 10, 0], direction: [0, 0, 1] }], type: 'twoDistances', width1: 2, width2: 1 })
 * const p = await cad.chamfer(part0, { edges: [{ point: [10, 10, 0], reference: [10, 9, 0] }], type: 'distanceAngle', width: 2, angle: 30 })
 */
export const chamfer = defineOp({
  mesh: async (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/chamfer] no input geometry')
    assertChamferParams(params)
    return chamferMeshPath(input, params)
  },
  brep: (input: Shape, params: Record<string, unknown>) => {
    if (!input) throw new Error('[stdlib/chamfer] no input geometry')
    assertChamferParams(params)
    return chamferBrepPath(input, params)
  },
})
```

类型（`EdgeAnchor` / `ChamferType` / `ChamferParams`）放在同文件导出即可，无需单独 `chamfer-types.ts`（`packages/stdlib/src/index.ts` 只需 `export { chamfer } from './chamfer'`；类型导出按现有惯例补 `export type { EdgeAnchor, ChamferType, ChamferParams } from './chamfer'`）。

---

## 4. 测试方案

按 AGENTS.md 的分层纪律：**每次开发完先跑自己写的测试 → 再跑可能被影响到的测试 → 全绿后才准跑 `scripts/ci.ps1`**；严禁通过跑 CI 找 bug。

### 4.1 分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 纯函数单测 | `packages/core/src/mesh/feature-edges.test.ts`（新增） | 焊接 / 半边 / 二面角 / 面片分割 / 链合并 |
| 纯函数单测 | `packages/core/src/mesh/chamfer.test.ts`（新增） | 三角恒等式（§2.4）、凸凹判定、棱柱构造、V5 体积判据 |
| BREP 单测 | `packages/core/src/brep/brep-ops-chamfer.test.ts`（新增） | `beforeAll` 里 `initOcctWasm()`（与既有 parity 测试同款） |
| stdlib 单测 | `packages/stdlib/src/chamfer.test.ts`（新增） | `assertChamferParams` 的错误码矩阵（**不碰几何、不依赖 CSG worker**） |
| 端到端 | `packages/tests/faijs/chamfer/`（新增，含 `.faijs` fixture） | **必须放这里**：`packages/core/src/mesh/mesh-api.test.ts:7-9` 明示依赖 CSG worker 的 op（布尔/分割/钻孔/拉伸）在 node 环境的 core 单测里不可用 |
| parity | `packages/tests/faijs/chamfer/parity.test.ts` | BREP vs mesh 一致性 |

### 4.2 用例清单

| ID | 内容 | 判据 |
| --- | --- | --- |
| **T-A1** 三角恒等式 | §2.4 四组自检数值 | `θ` 与回代 `dO` 误差 < 1e-9 |
| **T-A2** 凸凹判定 | 立方体外棱（β=90,convex）与 L 形内拐角（β=270,reflex） | `convex` / `β` 精确匹配 |
| **T-A3** ⚠️ OCCT 参考面顺序 | 长方体 `box(20, 10, 10)`，取一条 `x` 向棱（两侧面尺寸不同）；用 `twoDistances: width1=4, width2=1` 跑 BREP 路径，然后**测量**结果：用 `getSubShapes(result,'face')` + `getSurfaceCenterOfMass` 找出新生成的倒角面，量它到原两面的距离 | 落在哪一面必须与 §3.2.2 步骤 3/6 的复现枚举一致；同时钉死 `AddDA` 的角度约定（§2.4 末段）。**若不一致，改 §3.2.2 步骤 6 的分支或取互补角，不改判据** |
| **T-A4** 特征边提取 | 立方体 mesh（12 三角） | 12 条凸棱、β 全 90°、`length` 全等于边长、`patches` 全 planar |
| **T-A5** 共线链合并 | 立方体一个面被细分成 4×4 网格 | 该方向的棱仍合并成 1 条（不是 4 条） |
| **T-A6** mesh 对称倒角 | 立方体 1 条棱，`width=1` | 体积减少 = `0.5·1·1·sin90°·length` ± 1% |
| **T-A7** mesh 非对称倒角 | 立方体 1 条棱，`width1=2, width2=1` | 倒角面到两面的距离分别为 2 / 1（用三角形顶点到面的距离量） |
| **T-A8** mesh 凹棱倒角 | L 形件内拐角，`width=1` | **体积增加** = `0.5·1·1·sin270°…` 取绝对值 = `0.5·length` ± 1% |
| **T-A9** V5 过切检测 | 立方体棱 `width = 6`（超过半边长） | 抛 `CHAMFER_OVERCUT`，不静默产生坏几何 |
| **T-B1** 错误码矩阵 | 每个错误码一个用例 | `expect(() => …).toThrow(/CHAMFER_XXX/)`；测试内 spy `console.error` 并断言（满足 AGENTS.md stderr 零容忍） |
| **T-C1** 参数冲突 | `type:'equal'` 同时传 `width1` | `CHAMFER_PARAM_CONFLICT` |
| **T-P1** parity | 立方体 1 条棱、3 种 type × 若干尺寸，BREP 与 mesh 各跑一遍 | 体积差 < 2%；倒角面到两面的距离各自 < 0.05 mm |
| **T-E1** 端到端 fixture | `packages/tests/faijs/chamfer/basic.faijs`：`box → chamfer → exportStep` | 产出的 STEP 含新增平面倒角面（BREP 链下断言 `ADVANCED_FACE` 数 +1） |
| **T-E2** 断链回归 | `box → chamfer → drill` | chamfer 不断链：drill 仍走 BREP 路径 |
| **T-E3** mesh-only 回归 | `load('*.stl') → chamfer` | 走 mesh 路径，不报错 |

### 4.3 影响面回归（改完后必须补跑）

- `packages/core/src/lang/op-set-consistency.test.ts`（符号表一致性）
- `packages/core/src/brep/brep-ops.test.ts`、`brep-ops-features.test.ts`
- `packages/core/src/brep/engine/` 下所有测试（`BrepEngineApi` 变更 → mock 必须跟上）
- `packages/stdlib/src/**/*.test.ts`
- `packages/tests/faijs/` 下与 drill / knurl / split 相关的 fixture（确认 chamfer 未引入断链回归）

---

## 5. 3d_editor 实现

### 5.1 文件清单

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/engine/features/chamfer.ts` | 新增 | `FeatureDef`（§5.6） |
| `src/stores/tools/chamfer-store.ts` | 新增 | 状态机（§5.3） |
| `src/engine/components/chamfer/ChamferToolbar.tsx` | 新增 | 顶部工具栏按钮 + Filter 三态（§5.2） |
| `src/engine/components/chamfer/ChamferPanel.tsx` | 新增 | 倒角参数面板（§5.4） |
| `src/engine/components/chamfer/LiveChamferPreview.tsx` | 新增 | 预览（§5.5） |
| `src/engine/components/chamfer/chamfer-preview-mode.ts` | 新增 | ghost 分支（边高亮 + 偏移虚影线） |
| `src/stores/core/tool-store.ts` | 改 | `ActiveToolMode` 加 `'chamfer'`（第 11 行） |
| `src/engine/features/types.ts` | 改 | `FeatureIconKey` 加 `'chamfer'`（第 32 行 `'load' | 'knurl'` 之后） |
| `src/engine/features/index.ts` | 改 | import + `registerFeature(chamferFeature)` |
| `src/engine/version-store/Command.ts` | 改 | `COMMAND_TYPES` 加 `'chamfer'`；`CommandParams` 加 chamfer 参数段 |
| `src/layouts/DesktopLayout.tsx` | 改 | 挂载 `<ChamferToolbar />`（`<DrillHoleToolbar />` 在 `1434` 行）与 `<ChamferPanel />` |
| `src/locales/*.json`（20 个） | 改 | `chamfer.*` 键 |
| `package.json` | 改 | faijs tgz → `faicad-faijs-0.5.12.tgz` |

### 5.2 Filter → 工具栏激活三态

沿用 `DrillHoleToolbar.tsx:13-38` 的 mute 范式，判据来自 §1.2：

```ts
const targetIds = useToolbarTarget()                              // ① 可编辑 part 目标
const runtime = useTopologyStore((s) =>
  targetIds[0] ? s.getSelectorRuntime(asFileId(fileIdOf(targetIds[0]))) ?? null : null)
const hasEdges = (runtime?.edges.length ?? 0) > 0                 // ② 有可用边拓扑

const needSelection = selectableCount > 1 && selectedCount === 0  // 与 drill 完全一致
const muted = needSelection || targetIds.length === 0 || !hasEdges
```

| 态 | 条件 | 行为 |
| --- | --- | --- |
| 正常 | 有唯一目标 part 且 `hasEdges` | 可点击，进入 chamfer 模式 |
| 置灰 A | `selectableCount > 1 && selectedCount === 0` | 点击 toast「请先选择一个对象」（与 drill 一致） |
| 置灰 B | 有目标但 `!hasEdges` | tooltip「该模型无可用边（无拓扑数据）」 |

**⚠️ mesh 模式下拓扑陈旧问题**（§1.7 已核实）：`ScriptEngine.ts:616-624` 只在 primitive 创建时生成一次 `primitiveRuntimes`，后续 drill/split 等操作**不刷新**。因此 chamfer 面板打开时，若 `executionMode === 'mesh'` 且该 part 已被编辑过，必须**用当前显示 mesh 重算假拓扑**：

```ts
// 与 ViewportContainer.tsx:511-572 同款调用，只换输入来源（当前 part mesh 而非整文件）
const runtime = await buildMeshTopologyRuntimeAsync(mergedGeometry, scopedId, { scale: 1 })
```

判定规则（静态，不回退）：

```
BREP/auto 模式 → 直接用 stepRuntimes（每次执行后 _rebuildBrepTopology 已刷新，ScriptEngine.ts:1003/1176/1348）
mesh 模式      → 若 primitiveRuntimes 命中且该 part 自创建以来**未被修改过** → 直接用
                 否则 → 用当前 mesh 走 buildMeshTopologyRuntimeAsync 重算（>10000 三角则跳过并置灰，
                       与 ViewportContainer.tsx:558 的既有阈值保持一致）
```

### 5.3 store（`src/stores/tools/chamfer-store.ts`）

```ts
export type ChamferType = 'equal' | 'twoDistances' | 'distanceAngle'

export interface ChamferEdgeSelection {
  /** 拓扑 Reference.id，仅 UI 期使用（不写进脚本） */
  referenceId: string
  /** 写进 faijs 脚本的锚点 */
  anchor: { point: Vec3; direction?: Vec3; reference?: Vec3 }
  length: number          // mm
  convex: boolean
  dihedralDeg: number
  label: string           // Reference.label，面板里显示
}

interface ChamferStore {
  isActive: boolean
  targetFileId: string | null
  targetScopedId: string | null

  edges: ChamferEdgeSelection[]
  type: ChamferType
  width: number      // 默认 1
  width1: number     // 默认 1
  width2: number     // 默认 1
  angle: number      // 默认 45

  isPreviewComputing: boolean
  error: string | null          // 承载 CHAMFER_* 错误码，面板上以人话显示
  panelPosition: { x: number; y: number }

  setTarget / addEdge / removeEdge / clearEdges / setType / setWidth / ...
  commit(): Promise<void>       // 生成脚本 + 执行（§5.6）
  cancel(): void
}
```

**从 `Reference` 到 `EdgeAnchor` 的转换**（`useTopologyPicking.ts:290` 拿到 `ref`）：

```ts
function anchorFromReference(ref: Reference, runtime: SelectorRuntime, hit?: PickIntersection) {
  const { segmentStart, segmentCount } = ref.pickData
  const pos = runtime.proxy.edgePositions
  // 端点：segmentStart 起 segmentCount 段，每段两个索引
  const a = readVec3(pos, runtime.proxy.edgeIndices[segmentStart * 2])
  const b = readVec3(pos, runtime.proxy.edgeIndices[(segmentStart + segmentCount) * 2 - 1])
  return {
    point: ref.pickData.center ?? mid(a, b),      // 均保留 4 位小数（脚本可读性 + 重放稳定）
    direction: normalize(sub(b, a)),
    reference: hit ? hit.point.toArray() : undefined,   // 射线命中的点 → 落在哪个面上 → 参考面
  }
}
```

> `hit.point` 是射线与三角面片的交点，天然落在用户「看到的」那个面上 —— 这正是 Onshape `oppositeDirection` 要表达的「从哪一面量起」。

### 5.4 面板（ChamferPanel）

- 已选边列表（可逐条移除，显示 `label` + 长度 + 凸/凹 + 二面角）
- 尺寸模式下拉：`等距 / 双距 / 距角`（i18n 三项）
- 数值输入：按 §2.2 矩阵显隐；范围钳制沿用 §2.2 V3（0.01–500 mm；0.1–179.9°）
- 双距/距角模式下的「反向」按钮（对应 Onshape `oppositeDirection`）：把选中边的 `anchor.reference` 挪到另一面（实现：把 `reference` 换成另一面质心坐标；UI 层只需 `reference: otherFaceCentroid`）
- 错误条：把 `CHAMFER_*` 错误码映射成人话（如 `CHAMFER_NON_PLANAR_ADJACENT_FACE` → 「倒角边两侧需为平面（圆柱面暂不支持）」）
- 「确定 / 取消」

### 5.5 预览策略（对应用户追加约束）

用户原话：「3d_editor 的预览有很多种方式，要看情况。不复杂的任务完全可以实际执行，耗时的任务可能只是蒙层。」

**决策：按规模静态分派，两条分支，不做运行时 try-catch 回退。**

| 分支 | 触发条件 | 做法 |
| --- | --- | --- |
| **A. 真实执行** | `tri ≤ 10000` **且** `edges.length ≤ 8` | 直接调 faijs stdlib：`import { chamfer } from '@faicad/faijs/stdlib'`，在 G0 几何上算，结果经 `geometryBinding.bindPreviewGeometry(scopedId, geo, mesh)` 绑定。**与 `LiveDrillPreview.tsx:141-230` 完全同构**（含 `manifoldMeshToGeo` / `deriveNormals` / 世界↔局部矩阵往返） |
| **B. ghost 蒙层** | `tri > 10000` **或** `edges.length > 8` | 不计算几何：选中边用粗线高亮 + 沿两侧按 `width` 画偏移虚影线（O(edges) 成本）+ 半透明蒙层。沿用 `shouldUseFastPreview` 与 `drill-preview-mode.ts` 的 `getOrCreatePreviewGroup` / `clearPreviewGroup` 工具 |

理由（写进代码注释）：mesh 路径每次倒角 = 阶段 A 的 O(n) 解析 + 最多 2 次 Manifold 布尔。10k 三角量级的 Manifold 布尔在 10–30 ms 量级，8 条边以内的解析开销可忽略 → 完全够实时；超过这个量级（或边数过多导致工具棱柱合并链变长）才需要降级。阈值 10000 与 `ViewportContainer.tsx:558`、`shouldUseFastPreview` 的既有阈值保持一致，不另立标准。

两者共用：`geometryBinding.saveG0/getG0/clearPreview` + 200 ms 防抖 + `requestIdRef` 陈旧丢弃（`LiveDrillPreview.tsx:70-71` 范式）。

### 5.6 脚本生成（点击「确定」后）

`CommandParams` 新增段（全部加 `chamfer` 前缀，避免与既有扁平键冲突，如 `angle` 过于通用）：

```ts
// Chamfer params
chamferType?: 'equal' | 'twoDistances' | 'distanceAngle'
chamferWidth?: number
chamferWidth1?: number
chamferWidth2?: number
chamferAngle?: number
chamferEdges?: Array<{
  point: [number, number, number]
  direction?: [number, number, number]
  reference?: [number, number, number]
}>
```

`src/engine/features/chamfer.ts`（照 `src/engine/features/drill.ts` 逐段对应）：

```ts
export function buildArgs(params: CommandParams): Record<string, JsonValue> {
  const edges = (params.chamferEdges ?? []).map((e) => {
    const a: Record<string, JsonValue> = { point: round4(e.point) }
    if (e.direction) a.direction = round4(e.direction)
    if (e.reference) a.reference = round4(e.reference)
    return a
  })
  const type = params.chamferType ?? 'equal'
  const base: Record<string, JsonValue> = { edges, type }
  if (type === 'equal')          base.width  = params.chamferWidth ?? 1
  if (type === 'twoDistances') { base.width1 = params.chamferWidth1 ?? 1
                                 base.width2 = params.chamferWidth2 ?? 1 }
  if (type === 'distanceAngle'){ base.width  = params.chamferWidth ?? 1
                                 base.angle  = params.chamferAngle ?? 45 }
  return base
}

export function buildChamferCode(params: CommandParams, ctx: FeatureBuildCtx): string {
  const inputId = ctx.getLastStatementId(ctx.currentScopedId)
  const inputs = inputId ? [inputId] : []
  const outputs = deriveOutputs('chamfer', inputs, 1, ctx.currentCode)
  return formatCodeLine({
    callee: 'chamfer',
    inputs,
    outputs,
    outputDeclared: outputs[0] === inputId,
    args: buildArgs(params),
  })
}
```

生成形态（`formatCodeLine` 会依 `@async true` 自动加 `await`；`fmtValue` 支持嵌套，见 §1.6）：

```js
part0_v1 = await cad.chamfer(part0, { edges: [{ point: [10, 10, 0], direction: [0, 0, 1], reference: [10, 9, 0] }], type: 'twoDistances', width1: 2, width2: 1 })
```

`FeatureDef` 其余字段：

```ts
const def: FeatureDef = {
  type: 'chamfer',
  ops: ['chamfer'],
  commandType: 'chamfer',
  buildArgs,
  buildCode: buildChamferCode,
  getIconKey: () => 'chamfer',
  deriveLabel: chamferLabel,       // 例：`倒角 ${typeLabel} ${w}` / `倒角 ×N`
  editor: {
    toolMode: 'chamfer',
    backfill: chamferBackfill,     // 用 codeToArgs 反解 → 回填 store（照 drill.ts:87-118）
    collectArgs: chamferCollectArgs,
  },
}
```

`backfill` 的反解需还原 `chamferEdges`（`codeToArgs(codeLine).edges` → 数组），与 `drillBackfill` 处理 `clickPosition` 的方式一致（`drill.ts:97-103`）。

---

## 6. 里程碑

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M1** | faijs：契约与骨架 | §3.1 全部文件落地；`npm run typecheck` 全绿（含 `AssertSatisfiesBrepEngineApi` 守卫对新方法的检查） |
| **M2** | faijs：mesh 路径 | `extractFeatureEdges` + `chamfer`；T-A1/A2/A4/A5/A6/A7/A8/A9 全绿 |
| **M3** | faijs：BREP 路径 | `BrepEngineApi` + `chamferBrep`；**T-A3 通过并钉死 OCCT 参考面与角度约定**；T-P1 parity 通过 |
| **M4** | faijs：注册与生成文件 | 符号表 / `api.d.ts` / `ops-api-inventory` 全部重生成；`op-set-consistency` 通过；T-B1/T-C1 通过；`npm run lint` 全绿 |
| **M5** | faijs 发版 | 版本号 → 0.5.12（AGENTS.md：打包发布前必须更新版本号）；`npm run pack` 产出 `faicad-faijs-0.5.12.tgz` |
| **M6** | 3d_editor：接入 + Filter | `package.json` 依赖升 0.5.12；`chamfer-store` + `ChamferToolbar` + 图标 + `ActiveToolMode` + `FeatureIconKey` + i18n（20 个文件）；三态置灰正确 |
| **M7** | 3d_editor：面板 + 预览 | `ChamferPanel` + `LiveChamferPreview`（A/B 双分支）；A 分支在立方体上实时可见倒角 |
| **M8** | 3d_editor：提交链路 | `FeatureDef` + `CommandType` + 脚本生成；点确定后生成 `.faijs` 语句、执行、timeline 出现倒角节点；T-E1/E2/E3 通过 |
| **M9** | 回归 | 按 §4.3 跑影响面；全绿后才可跑 `scripts/ci.ps1` |

---

## 7. 风险与未决

| ID | 风险 | 处置 |
| --- | --- | --- |
| **R1** | **OCCT `AddDA` 的角度约定未确证**（§2.4）：是 `Q_F` 处内角还是其互补角 | T-A3 实测钉死；只需改 §3.2.2 步骤 6 一处。禁止"看着像"就定 |
| **R2** | **`getSubShapes(solid,'face')` 的返回顺序是否等同 `TopExp_Explorer`** 未确证 | T-A3 同时覆盖；若不一致，改为在 faijs 侧按 `(centroid.x, centroid.y, centroid.z)` 排序后复现——仍需 T-A3 验证 |
| **R3** | `chamferDistAngle` 参考面不可指定 → 非对称倒角的语义依赖 OCCT 内部枚举 | 已用 §3.2.2 步骤 6 双分支规避；但**可维护性脆弱**，occt-wasm 升级需重跑 T-A3。已在 `BrepEngineApi.chamferDistAngle` 的 JSDoc 里写明该耦合与来源行号 |
| **R4** | V1 不支持圆弧边 / 曲面相邻面（圆柱顶边倒角等） | 显式报错而非静默错误结果。V2 方案：曲面相邻时用「截面圆弧扫掠」构造工具，或 mesh 路径改走「顶点位移 + 重三角化」 |
| **R5** | mesh 路径依赖输入网格**流形**；stl 导入的三角汤会直接失败 | 抛 `CHAMFER_MESH_NOT_MANIFOLD` 并给出边计数。若实测常见的 stl 装配体确实不流形，再评估接入 `reconcileBrepInputs`（`packages/stdlib/src/reconcile.ts:32-47`）—— 但**这属于断链物化，不得做成"失败就提升"的运行时回退** |
| **R6** | `width` 默认 1 mm vs Onshape 默认 5 mm | 采用 1 mm（faijs 生态以小零件为主，且 `BLEND_BOUNDS` 的 mm 默认值 5 是 UI 初值不是约束）。若用户要求对齐 Onshape，改 `ChamferParams.width` 默认值一处 |
| **R7** | mesh 模式下拓扑陈旧（§5.2）：primitive 假拓扑不随 op 刷新 | 已给出静态判定 + 重算方案。**注意 `buildMeshTopologyRuntimeAsync` 对 >10000 三角直接跳过**（既有行为），此类零件倒角按钮置灰 |
| **R8** | 非对称倒角没有面演化数据（`chamferDistAngle` 无 history 变体） | 与现状一致：faijs 的生产路径**目前没有任何 op 使用 `*WithHistory`**（§1.5 已核实，仅测试消费）。不引入新隐患 |
| **R9** | 工具棱柱在棱的端点处延伸 `e = max(dF,dO)`，若端点邻接的是**非垂直**特征可能过切 | V5 体积判据兜底（±20%）。若实测误报率高，收紧为 `e = 0` 并接受「倒角不到棱端」的视觉缺陷 |

---

## 8. 调研足迹

| 来源 | 读过的位置 |
| --- | --- |
| `C:\git\new\onshape\onshape-std-library-mirror` | `chamfer.fs:21-23, 24-33, 35-88, 95-112, 170-224`；`chamfertype.gen.fs` 全文；`chamfermethod.gen.fs` 全文；`edgeBlendCommon.fs:20-26`；`valueBounds.fs:344-355` |
| `C:\git\OpenCascade\brepjs` | `src/kernel/occtWasm/modifierOps.ts:25-62` |
| `C:\git\OpenCascade\occt-wasm` | `xtask/src/codegen/config.rs:494-544`（chamfer / chamferDistAngle）、`:4512-4536`（chamferWithHistory）；`xtask/src/codegen/emitter.rs:97-138`（FilletLike 模板）；已安装 `dist/index.d.ts:136-137, 469`、`dist/raw-types.d.ts:143-144, 284`；版本 3.8.4 |
| `faijs`（本仓） | `packages/core/src/define-op.ts:114-170`；`cad-runtime/backend-dispatch.ts:76-131`；`brep/engine/primitives.ts:26-175`；`brep/engine/types.ts:92-107`；`brep/engine/adapters/occt.ts:25-61`；`brep/engine/adapters/brep-mock.ts:285-320`；`brep/brep-ops.ts:40-127, 255-340`；`brep/brep-topology.ts:25-110`；`occt-kernel/occtKernel.ts:80-125, 192-213`；`mesh/index.ts:35-101`；`mesh/boolean.ts:20-43`；`mesh/query.ts:17-81`；`mesh/types.ts:30-39`；`mesh/drill.ts:1-50`；`topology/types.ts:120-256`；`topology/build-selector-runtime.ts:595-700`；`lang/codegen.ts:52-98`；`lang/op-set-consistency.test.ts:20-45`；`scripts/gen-api-dts.ts:1-30`；`scripts/gen-symbol-table.ts:22-84`；`packages/stdlib/src/{drill.ts 全文, assert.ts:16-95, index.ts 全文, internal-stdlib.ts 全文}` |
| `C:\my\Faicad\3d_editor` | `src/engine/features/{types.ts:13-33,87-200, drill.ts 全文, index.ts 全文}`；`src/engine/version-store/Command.ts:1-121`；`src/engine/version-store/GeometryBinding.ts`；`src/stores/core/tool-store.ts:11-30`；`src/stores/core/topology-store.ts:13-16, 85-106, 135-175`；`src/stores/tools/drill-store.ts:1-90`；`src/engine/components/drill-hole/{DrillHoleToolbar.tsx 全文, LiveDrillPreview.tsx:1-240}`；`src/engine/hooks/useTopologyPicking.ts:1-30, 205-295`；`src/lib/topology/picking.ts:9-113`；`src/lib/mesh-feature-detection/{index.ts 全文, build-mesh-topology-async.ts:1-60}`；`src/components/viewport/ViewportContainer.tsx:380-422, 505-580`；`src/engine/script-engine/ScriptEngine.ts:595-640, 725-770, 1003-1348`；`src/layouts/DesktopLayout.tsx:1434`；`src/locales/`（20 个）；`package.json:24-26` |
