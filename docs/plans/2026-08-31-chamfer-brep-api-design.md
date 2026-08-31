# 倒角（Chamfer）技术实现方案 — BREP 路径 + 拓扑边接口

> 状态：方案（未实施）
> 本文只写技术实现。调研结论以「文件:行号」形式给出，可逐条复核。
> 与本文并存的前一版 `docs/plans/2026-08-30-chamfer-design-and-implementation.md` **不作修改、不作废**，
> 本文在两处关键结论上取代它：① `edges` 的接口形态（§1.7 / §2）；② 非对称倒角的三角换算方向（§3.5）。

---

## §0 需求原文

用户关于本功能的完整要求（逐字）：

> 我需要给本项目和../3d_editor项目实现"倒角"功能。实现每一个功能的时候的步骤如下：
> 1. 分析C:\git\new\onshape\onshape-std-library-mirror项目这个功能是如何实现的。找到对应的代码，比如钣金对应的是chamfer.fs 。
> 2. Filter对应这个功能是否在3d_editor中激活的条件，也就是顶部工具栏对应图标是否激活。
> 3. 参数体系（definition）对应到faijs与3d_editor的接口参数。
> 4. 查看C:\git\OpenCascade\brepjs项目，了解它是如何实现这个功能的。
> 5. 查看C:\git\OpenCascade\occt-wasm项目，了解它提供的api。
> 根据得到的所有信息，进行公开的设计和开发：1. 定义倒角的api接口 2. 在faijs项目里实现接口并完成测试。3. 在3d_editor项目里完成UI部分，比如添加顶部工具栏，添加倒角参考的面板，添加倒角预览的功能，最后用户点击确定后，生成faijs脚本，其中调用faijs提供的api接口，把UI层参数传入，并执行脚本。
> 现在，请按照上面的要求，先写一份技术实现文档。

关于预览的补充约束（原话）：

> 3d_editor 的预览有很多种方式，要看情况。不复杂的任务完全可以实际执行，耗时的任务可能只是蒙层。要看实际情况，决定当前的功能应该如何实现预览。

本次重写的两条硬要求（原话）：

> 1. 必需调研清楚brepjs里面拓扑相关的代码，倒角时的edge到底如何定义。整个文档里，最核心的就是要把这个接口定义下来。你这里的edges定义明显错的离谱。
> 2. 本项目现在支持brep only的操作。这个倒角，目前只需要支持brep。而且未来，绝大部分操作都只支持brep。倒角可用的前提是，模型是brep的，拓扑边存在。而且3d_editor项目只支持拓扑边的选择。

---

## §1 约束事实（调研结论）

### 1.1 brepjs 的拓扑体系：边到底如何定义

brepjs 的拓扑引用系统集中在 `src/topology/shapeRef/`。它的核心命题写在 `shapeRefTypes.ts` 的 `EdgeRef` 文档注释里（`C:/git/OpenCascade/brepjs/src/topology/shapeRef/shapeRefTypes.ts:85-93`）：

> A stable reference to an edge, identified by the roles of its two adjacent faces — its lineage. **An edge *is* the intersection of its two faces**, so this resolves by finding the edge shared by the current faces of those roles (`sharedEdges`). Identity rides on the already-stable face roles rather than the edge's own hash, so it survives edits that re-hash the edge — and it sidesteps the kernel's unreliable `generated`-face hashes entirely.

数据结构（`shapeRefTypes.ts:94-100`）：

```ts
export interface EdgeRef {
  readonly origin: string                       // 产生该几何的步骤 id
  readonly faceRoles: readonly [string, string] // 边的两个相邻面的 role
  readonly hint: EdgeHint                       // tiebreaker
}

export interface EdgeHint {                     // shapeRefTypes.ts:79-84
  readonly entityType: 'edge'
  readonly length?: number | undefined
  readonly midpoint?: Vec3 | undefined          // 边两端顶点的中点
}
```

**关键分层**：`faceRoles` 是**身份（identity）**，`hint` 只是**并列时的裁决者**，不是身份本身。`shapeRefTypes.ts:76-78` 的注释说得很直白：hint 是 "a tiebreaker for the rare case where an edge's two faces share more than one edge"。

解析算法（`edgeRefFns.ts:111-139`）——三段式，无隐式兜底：

1. 两个 role 各自解析到当前面集合 `facesA` / `facesB`；任一方为空 → `not-found`。
2. 对每一对 `(a, b)` 取 `sharedEdges(a, b)`，按 `getHashCode` 去重得到候选集。
3. 候选数 = 1 → `confidence: 'exact'`；候选数 > 1 → 用 `bestByHint` 按 `length + midpoint` 打分选最优，若最优与次优分差 < `HINT_MARGIN = 1e-6`（`edgeRefFns.ts:47`）则判 `ambiguous` 而不是随便挑一条；候选数 = 0 → `not-found`。

`BrokenEdgeRef.reason` 只有 `'ambiguous' | 'not-found'` 两种，源码注释解释了为什么没有 `'deleted'`（`shapeRefTypes.ts:109-111`）：边引用跟踪的是它的两个面，不是边自身的 hash，所以边消失表现为「两个面之间没有公共边」，与「从未解析成功」无法区分。

**边的身份由谁产生**：`createEdgeRef(origin, edge, shape, roles)`（`edgeRefFns.ts:91-103`）——用 `facesOfEdge(shape, edge)` 取两边，再经 `roleOfFace` 反查 role 名；任一面还没有 role → 返回 `undefined`（不可引用）。

**role 从哪来**：`assignRoles(shape, operationType)`（`shapeRefFns.ts:105-131`）。已知图元走语义命名（box 按外法向给 `box:top/bottom/front/back/left/right`，cylinder/cone 给 `:top/:bottom/:lateral`，sphere 给 `sphere:surface`），其它一律退化为位置名 `opType:face_0`。role 随演化推进：`updateRoles(roles, origin, evolution)`（`:176-198`）。

**为什么 brepjs 不用 hash / 序号**：`updateRoles` 的注释（`:169-172`）给出实测结论——

> Note: `evolution.generated` is intentionally not consumed here — on the OCCT kernels its hashes refer to an intermediate shape, not the final result, so naming generated faces produces roles that never resolve (**verified: 0 live generated hashes across cut/fuse on occt-wasm**).

即：OCCT 的 `generated` hash 在 occt-wasm 上是**完全不可用**的（0 个存活）。这是 brepjs 转向 role lineage 的**实测依据**，不是偏好。

### 1.2 brepjs 的倒角：edges 落到内核时是什么

两条路径，结论一致——**落到内核的是 OCCT 边句柄，不是引用对象**：

| 层次 | 入口 | edges 的形态 | 落到内核 |
|---|---|---|---|
| 函数式 API | `chamferDistAngle(shape, edges: Edge[], distance, angleDeg)`（`src/topology/chamferAngleFns.ts:32-37`） | `Edge[]`（brepjs 包装对象） | `edges.map(e => e.wrapped)` → `kernel.chamferDistAngle(...)`（`:77-78`） |
| CSG IR | `ChamferNode { target, ref: EdgeRef, distance }`（`src/csg/types.ts:191-196`） | 序列化 `EdgeRef` | 求值时解析成 `Edge` 再取 `.wrapped` |

CSG IR 层是 brepjs **可重放**的那一层：`ChamferNode.ref` 的类型注释（`src/csg/types.ts:192-194`）明确写 ——

> Serializable lineage ref naming the edge by its two adjacent face roles. Pure data, so it hashes like any other field; **resolution against the materialized target happens inside evaluation**.

序列化形态即 `EdgeRef` 的原样三字段（`src/csg/serialize.ts:208-219` + 反序列化 `:860-885`，含 `faceRoles` 必须恰好两个字符串的校验 `:865-867`）。

**结论**：brepjs 在「持久化/重放」这一层，边的身份 = `{ origin, faceRoles: [roleA, roleB], hint }`；在「调用内核」这一层，边 = OCCT 句柄。两者之间的桥梁是 `resolveEdgeRef`。

### 1.3 faijs 现有的拓扑边体系

faijs 已有完整拓扑运行时，与 brepjs 的对应关系如下：

| brepjs | faijs | 位置 |
|---|---|---|
| `Face` 的 role 名（语义） | **无对应物** | faijs 没有 role 表 |
| `ShapeRef.role` | `FaceId`（`o1.f3`） | `packages/core/src/topology/types.ts:121`（`FaceRow.id`） |
| `EdgeRef.faceRoles` | `Reference.adjacentSelectors` | `types.ts:193`（`PickData.adjacentSelectors`） |
| `EdgeHint.length` | `EdgeRow.length` / `PickData.length` | `types.ts:150`、`types.ts:208` |
| `EdgeHint.midpoint` | `EdgeRow.center`（折线顶点算术平均） | `types.ts:151` |
| `resolveEdgeRef` | **无对应物** | 需新建 |

**faijs 的边 id 就是 `EdgeId = o1.e{ordinal}`**，生成点在 `packages/core/src/occt-kernel/topologyExt.ts:819`：

```ts
edgeRows.push([
  asEdgeId(`${occId}.e${ordinal}`), occId, shapeId, ordinal, curveType, roundVal(edgeLen),
  roundPoint(center), bboxArray(bb), 0, 0, 0, 0, params, segmentStart, segmentCountFinal,
])
```

`ordinal = ei + 1`，`ei` 是 `kernel.getSubShapes(shape, 'edge')` 的数组下标（`topologyExt.ts:604`）。该文件顶部注释（`:599-603`）说明了枚举方法的性质：

> `getSubShapes` uses `TopExp::MapShapes` + `NCollection_IndexedMap` — the same enumeration method as `wireframe()` and `meshShape()`, so ordinals are consistent with kernel-generated faceGroups/edgeGroups.

**faijs 已经有「边→面」关系**，且已暴露到 `Reference` 上：

- 关系表在 `topologyExt.ts:646-665` 构建（`edgeFaceOrdinals`），写入 `edgeFaceRowsData`（`:903-911`）。
- 引用构造时，边类型的 `buildReference` 传入 `relationRows: edgeRelations, targetRows: faces, startKey: 'faceStart', countKey: 'faceCount'`（`build-selector-runtime.ts:679-694`），产出 `adjacentSelectors`（面 selector 数组）。

**faijs 已有「序号式拓扑引用」的 op 先例**：`packages/stdlib/src/geom.ts:28-33` ——

```ts
if (faceOrdinal !== undefined) {
  const solid = brepOf(of) as BrepHandle | undefined
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (solid && kernel) {
    const faces = kernel.getSubShapes(solid, 'face')
    if (faceOrdinal < faces.length) { const face = faces[faceOrdinal]; ... }
```

即：**序号 + `getSubShapes` 取句柄**，这是 faijs 既有范式。但该范式**只做了「取」，没有做「校验」**——序号指向错了就直接拿到错的那个面。本文 §2.4 补上校验。

### 1.4 3d_editor 的边选择现状

- 边拾取已实现：`src/engine/hooks/useTopologyPicking.ts:266-301`（`mode === 'edge'` 分支，含遮挡剔除 `hit.distance > occlusionDepth + 0.01`）。
- 拾取结果 → `edgeReferenceFromIntersection(hit, runtime)`（`src/lib/topology/picking.ts:43-57`）→ `runtime.edgeReferenceByRowIndex.get(rowIndex)` → 返回完整 `Reference`。
- 选中态：selection-store 存 **id 字符串数组**，元素是 `ReferenceId = 'topology|edge|o1.e7'`，并配 `selectedRefScopedIds: Map<ReferenceId, ScopedId>` 记录文件归属（`src/stores/core/selection-store.ts:42-72`；id 格式见 `packages/core/src/identity.ts` 品牌表 `ReferenceId` 行）。
- **3d_editor 已有「用 selector 数组引用一批边」的消费先例**：`collectEdgeRows(runtime, selectedIds)`（`src/engine/components/core/CurvatureCombCore.ts:191-219`）——`referenceMap.get(id)` → `ref.rowIndex`；若选中的是面，还用 `proxy.faceEdgeRows` 展开成该面的所有边。

**结论**：3d_editor 侧天然握有 `'topology|edge|o1.e7'` 与 `Reference.adjacentSelectors`，两者可直接序列化进 faijs 脚本，零额外计算。

### 1.5 occt-wasm 提供的能力（已安装 3.8.4）

`node_modules/occt-wasm/dist/index.d.ts`：

```
:136  chamfer(solid, edges: ShapeHandle[], distance: number): ShapeHandle
:137  chamferDistAngle(solid, edges: ShapeHandle[], distance: number, angleDeg: number): ShapeHandle
:469  chamferWithHistory(solid, edges, distance, inputFaceHashes, hashUpperBound): EvolutionData
```

代码生成配置（`C:/git/OpenCascade/occt-wasm/xtask/src/codegen/config.rs`）：

- `chamfer`（`:495-508`）= `MethodKind::FilletLike`，逐边 `Add(distance, E)`，**对称**。
- `chamferDistAngle`（`:509-544`）= `MethodKind::CustomBody`，逐边 `AddDA(distance, angleRad, E, adjFace)`。参考面的选取写死在生成代码里（`:517-527`）：

```cpp
TopoDS_Face adjFace;
for (TopExp_Explorer ex(solid, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& f = TopoDS::Face(ex.Current());
    for (TopExp_Explorer ex2(f, TopAbs_EDGE); ex2.More(); ex2.Next()) {
        if (ex2.Current().IsSame(edge)) { adjFace = f; break; }
    }
    if (!adjFace.IsNull()) break;
}
```

**两条硬约束**：
1. 参考面 `F` 是「外层 `TopExp_Explorer` 枚举到的第一个含该边的面」，**调用方无法指定**。而 `AddDA(Dis, Ang, E, F)` 的 `Dis` 正是沿 `F` 面测量的距离。
2. `chamferWithHistory` 只接受 `distance`（对称），**没有距角版本**。

### 1.6 faijs 的 BREP-only op 现状

- `defineOp({ brep })`（不提供 `mesh`）是**架构上合法**的：`packages/core/src/define-op.ts:127` 的注释写明 `{ brep }` (brep-only, D1b)，`:148-153` 只要求「至少有一个实现」。
- 分派行为（`packages/core/src/cad-runtime/backend-dispatch.ts`）：
  - `mode='brep'`：无 brep 实现 → `E_BREP_UNSUPPORTED`（`:82-84`）；输入非 BREP → `E_BREP_UNSUPPORTED`（`:85-88`）；缺能力 → 报错不回退（`:90-96`）。
  - `mode='auto'`：`impls.brep && inputs.every(hasBrep)` → `'brep'`（`:111`）；否则若无 mesh 实现 → 抛 `MeshUnsupportedError('E_MESH_UNSUPPORTED: input is not BREP and function has no mesh implementation')`（`:112-118`）。
- **`stdlib` 目前没有任何 BREP-only op**（对 `packages/stdlib/src/*.ts` 逐个 `defineOp({...})` 块扫描：所有块都同时含 `mesh:` 与 `brep:`）。倒角将是**第一个**，需要在测试中专门覆盖 §1.6 的报错分支。
- 引擎能力位：`capabilities.directEdit: true`（`packages/core/src/brep/engine/adapters/occt.ts:37`）。倒角归入 `directEdit` 类。
- `initOcctWasm()` **直接返回原始 `OcctKernel` 并 cast**（`packages/core/src/occt-kernel/occtKernel.ts:87-113`），没有手写转发表 → `chamfer` / `chamferDistAngle` 运行时**已可用**，只需在 `BrepEngineApi` 接口上补声明 + 在 `brep-mock.ts` 补桩。

### 1.7 前一版 `edges` 定义错在哪

前一版给出的形态：

```js
edges: [
  { point: [10, 10, 0], direction: [0, 0, 1], reference: [10, 9, 0] },
  { point: [10, -10, 0], direction: [0, 0, -1] },
]
```

逐条对照 §1.1–§1.4 的事实，错误有三类：

1. **用几何坐标去「猜」边，而不是用拓扑去「指」边**。一条边上有无穷多个点，`point: [10,10,0]` 定位不了任何一条边；它是端点的坐标，而端点由**三条**边共享。方向同理——长方体的 4 条竖棱 `direction` 完全相同。这是把「身份」退化成了「模糊查询条件」，与 brepjs「边 = 两面之交」的确定性定义正好相反。
2. **`reference` 字段语义混乱**。它同时想表达「参考面在哪一侧」和「翻转方向」，两件事压进一个坐标点；而且第二条边直接省略了它——同一个字段时有时无，接口无法稳定实现。
3. **与数据提供方不匹配**。3d_editor 只能给出拓扑边（§1.4），它手里是 `'topology|edge|o1.e7'` 和 `adjacentSelectors`；faijs 拓扑运行时也已经有 `EdgeId` / `edgeFaceRows`（§1.3）。前一版定义要求 3d_editor 把已有的精确身份**降质**成浮点坐标，再由 faijs 反过来猜——绕一圈且不稳定。

本文 §2 的接口改为：**以 faijs 拓扑 id 为身份，以 brepjs 的 lineage 思想做校验**。

---

## §2 接口定义（本文核心）

### 2.1 签名

```js
part0_v1 = await cad.chamfer(part0, {
  edges: ['o1.e7', 'o1.e11'],
  type: 'equal',
  width: 1,
})
```

```
cad.chamfer(input: Shape, params: ChamferParams): Promise<Shape>
```

单输入单输出，与 `drill` / `engrave` 同构（`deriveOutputs` 走 `'auto'` 终端映射）。

### 2.2 `edges` 的类型

```ts
/** 边 id 简写形态：`'o1.e7'`（EdgeId，见 packages/core/src/identity.ts 品牌表）。 */
export type ChamferEdgeId = string

/**
 * 一条参与倒角的边的完整引用。
 *
 * 身份 = `edge`（拓扑 id）。`faces` 是 lineage（边 = 两面之交，抄 brepjs
 * EdgeRef.faceRoles 的思想）；`length` / `midpoint` 是 hint，只在歧义时裁决，
 * 不是身份的一部分。
 */
export interface ChamferEdgeRef {
  /** 边的拓扑 id，主键。 */
  edge: ChamferEdgeId
  /** 该边的两个相邻面（FaceId），顺序取自 faijs edgeFaceRows。 */
  faces?: [string, string]
  /** hint：边长（mm）。 */
  length?: number
  /** hint：边中点 [x, y, z]。 */
  midpoint?: [number, number, number]
}

/** 简写（只有 id）与完整形态都接受。 */
export type ChamferEdgeSelector = ChamferEdgeId | ChamferEdgeRef
```

**为什么身份是 `EdgeId`（序号）而不是 brepjs 的 role lineage**：

1. **faijs 没有 role 表，且不需要**。brepjs 用 role 是因为它面对「改一个参数、局部重建」的交互式重放，需要用语义名（如 `box:top`）在重建后的形状里重新找到同一个面（§1.1）。faijs 的 `.faijs` 是**纯文本源码、确定性全量重放**：同一份脚本重放出同一条构造序列，OCCT 的 `TopExp::MapShapes` 枚举顺序随之确定 → `ordinal` 稳定。
2. **3d_editor 只提供 selector**（§1.4）。它给出 `'topology|edge|o1.e7'`，转成 `'o1.e7'` 是字符串切片；反过来要求它产出 role 名，需要 faijs 先建一套 role 分配 + 演化推进机制——那是 brepjs 为解决它自己的问题造的轮子。
3. **`EdgeId` 是 faijs 既有品牌类型**，与 `FaceId` / `OccurrenceId` 同族，装配场景下 `o1` 前缀携带 occurrence 归属。

> ⚠️ 上述第 1 条的「ordinal 稳定」是**推断，不是已验证事实**。它必须由 §4 的 T-A2 实测钉死；若不成立，退路见 §7 R1。

**为什么 `faces` / `length` / `midpoint` 是可选而不是必填**：它们是**校验与回退**用的，不是身份。3d_editor 生成时全部填写（它天然握有这些数据，零成本）；手写脚本时只写 id 也能工作。这与 brepjs 的分层一致（`faceRoles` 必填、`hint` 必填但可为空对象）。

### 2.3 参数表

```ts
export interface ChamferParams {
  /** 参与倒角的边。非空。 */
  edges: ChamferEdgeSelector[]
  /**
   * - `'equal'`         —— 等距倒角（对称），用 `width`
   * - `'twoDistances'`  —— 双距，用 `width1` / `width2`
   * - `'distanceAngle'` —— 距角，用 `width` / `angle`
   */
  type: 'equal' | 'twoDistances' | 'distanceAngle'
  /** type='equal' 的倒角宽度；type='distanceAngle' 时是沿参考面的距离。mm，> 0。 */
  width?: number
  /** type='twoDistances'：沿 faces[0] 测量的距离。mm，> 0。 */
  width1?: number
  /** type='twoDistances'：沿 faces[1] 测量的距离。mm，> 0。 */
  width2?: number
  /** type='distanceAngle'：倒角面与参考面的夹角。度，(0, 90)。 */
  angle?: number
}
```

参数命名对齐 Onshape `chamfer.fs` 的参数映射（唯一权威在 `C:/git/new/onshape/onshape-std-library-mirror/chamfer.fs:199-203`）：

| Onshape `ChamferType` | Onshape 参数 | 本文参数 |
|---|---|---|
| `EQUAL_OFFSETS` | `{ width1: 'width', width2: 'width' }` | `type: 'equal'`, `width` |
| `TWO_OFFSETS` | `{ width1: 'width1', width2: 'width2' }` | `type: 'twoDistances'`, `width1` / `width2` |
| `OFFSET_ANGLE` | `{ width1: 'width', angle: 'angle' }` | `type: 'distanceAngle'`, `width` / `angle` |

**不暴露的参数**（不做「接受但忽略」的伪实现）：

- `tangentPropagation`：OCCT `BRepFilletAPI_MakeChamfer.Add*()` 沿切向边自动扩展成 contour，occt-wasm 未暴露关闭开关 → 无法支持。
- `chamferMethod`（`FACE_OFFSET` / `APEX_RANGE`）：`APEX_RANGE` 的语义在 `chamfer.fs` 中无法确证，且 occt-wasm 无对应入口。

边界值沿用 Onshape：`BLEND_BOUNDS = [1e-5, 0.005, 500]` m（`valueBounds.fs:346-355`，mm 制下默认 5.0）、`CHAMFER_ANGLE_BOUNDS = [0.1, 45, 179.9]` degree（`edgeBlendCommon.fs:23-28` 的同族常量）。本文取 `width* > 0` 且 `angle ∈ (0, 90)`，与 occt-wasm `chamferDistAngle` 的校验区间一致（`src/topology/chamferAngleFns.ts` 中 brepjs 侧同区间）；UI 侧的软边界另见 §5.4。

### 2.4 边的解析算法

对 `edges` 中每一项，在输入 part 的 OCCT solid 上解析出 `BrepHandle`：

**第 1 步 — 主键直取（快路径）**

```
ordinal = parseInt(edge.split('.e')[1], 10)        // 'o1.e7' → 7
edgeHandles = kernel.getSubShapes(solid, 'edge')
if (ordinal < 1 || ordinal > edgeHandles.length) → E_CHAMFER_EDGE_NOT_FOUND
candidate = edgeHandles[ordinal - 1]
```

**第 2 步 — lineage 校验**

若 `faces`（两个 `FaceId`）存在，取 `faceHandles = kernel.getSubShapes(solid, 'face')`，解析出两个面句柄，再用 `getSubShapes(face, 'edge')` + `kernel.isSame` 判断 `candidate` 是否同时属于这两个面。

- 通过 → 采纳 `candidate`。
- 不通过 → 进入第 3 步。

**第 3 步 — hint 重定位**

在两个面的公共边集合（`kernel.getSubShapes(f0,'edge') ∩ getSubShapes(f1,'edge')`，用 `isSame` 判等）里，按 `|length - hint.length| + |midpoint - hint.midpoint|` 打分选最优（打分函数与 brepjs `bestByHint` 同构，`edgeRefFns.ts:55-79`）。若最优与次优分差 < `1e-6` → `E_CHAMFER_EDGE_AMBIGUOUS`。

**禁止静默**：第 2、3 步是**校验与纠错**，不是「猜不到就随便挑」。任何一步无法定案都必须抛错（错误码见 §2.5）——这与 `geom.ts:28-60` 现状（序号错了就静默拿到错的面）相反，是本文要求补上的缺口。

**为什么允许第 3 步存在**：它不是 AGENTS.md 红线所禁的「BREP/mesh 路径运行时回退」——那是**引擎选择**，这是**引用解析**，且 faijs 已有同构先例（`geomQuery` 的 ordinal → anchor 兜底，`geom.ts:28-63`）。区别在于本文要求每次兜底都可判定、不可判定时报错。

### 2.5 错误码

| 错误码 | 触发条件 |
|---|---|
| `E_CHAMFER_NO_EDGES` | `edges` 为空数组 |
| `E_CHAMFER_BAD_EDGE_REF` | `edge` 不是 `'o1.eN'` 形态的字符串 |
| `E_CHAMFER_EDGE_NOT_FOUND` | ordinal 越界，或 lineage 两面在当前 solid 中无公共边 |
| `E_CHAMFER_EDGE_AMBIGUOUS` | hint 重定位时并列最优（分差 < 1e-6） |
| `E_CHAMFER_EDGE_MISMATCH` | 只给了 `faces` 但没给 hint，且主键校验失败（信息不足，无法重定位） |
| `E_CHAMFER_BAD_TYPE` | `type` 不在三种枚举内 |
| `E_CHAMFER_BAD_WIDTH` | 所需宽度缺失或非正数 |
| `E_CHAMFER_BAD_ANGLE` | `angle` 缺失或不在 (0, 90) |
| `E_CHAMFER_REFLEX_EDGE` | 凹棱（材料侧二面角 β ≥ 180°），见 §3.5 范围界定 |
| `E_CHAMFER_NO_BREP` | 输入 part 无 BREP 句柄（等价 `brepOf()` 返回空） |

`E_MESH_UNSUPPORTED` 不由 chamfer 自己抛——它由 `dispatchPath` 在输入非 BREP 时抛出（`backend-dispatch.ts:112-118`），是 BREP-only op 的既有行为。

---

## §3 faijs 实现（BREP only）

### 3.1 文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `packages/stdlib/src/chamfer.ts` | 新增 | 参数校验、edge 解析、BREP 实现、`defineOp({ brep })` |
| `packages/stdlib/src/internal-stdlib.ts` | 改 | import `chamfer` 并加入 `createInternalStdlib()` 返回对象 |
| `packages/core/src/brep/engine/primitives.ts` | 改 | `BrepEngineApi` 加 `chamfer` / `chamferDistAngle` |
| `packages/core/src/brep/engine/adapters/brep-mock.ts` | 改 | 补两个桩方法（编译期守卫要求） |
| `packages/core/src/lang/op-set-consistency.test.ts` | 改 | `CAD_NAMESPACE_FUNCTIONS` 加 `'chamfer'` |
| `packages/core/scripts/gen-api-dts.ts` | 改 | `API_ENTRIES` 加 `chamfer` 条目 |
| `packages/core/src/mesh/api.d.ts` | 重新生成 | 跑 `npx tsx packages/core/scripts/gen-api-dts.ts`（**禁止手改**） |
| `packages/tests/faijs/chamfer/` | 新增 | 端到端用例（§4.2） |

不需要新建 `mesh/chamfer.ts`，也不需要挂 `cad.chamfer` —— 倒角是 BREP-only，没有 mesh 实现（§1.6）。

### 3.2 `BrepEngineApi` 扩展

在 `packages/core/src/brep/engine/primitives.ts` 的「造型运算」段（`extrude` / `loft` 之后）插入：

```ts
  // ── 倒角（directEdit 能力）──
  /** 等距倒角：逐边 `BRepFilletAPI_MakeChamfer::Add(distance, E)`。 */
  chamfer(solid: BrepHandle, edges: BrepHandle[], distance: number): BrepHandle
  /**
   * 距角倒角：`AddDA(distance, angleRad, E, F)`。
   * ⚠️ F 由内核自选（外层 TopExp_Explorer 第一个含该边的面），调用方不可指定。
   */
  chamferDistAngle(
    solid: BrepHandle, edges: BrepHandle[], distance: number, angleDeg: number,
  ): BrepHandle
```

`brep-mock.ts` 补对应桩（形态照抄同文件 `cut` / `cutWithHistory` 的桩）。`occt.ts:59-60` 的 `AssertSatisfiesBrepEngineApi` 会在编译期列出缺失项。

### 3.3 与 occt-wasm 的对接

无需新增转发代码：`initOcctWasm()` 直接返回原始 `OcctKernel`（`occtKernel.ts:87-113`），而 occt-wasm 3.8.4 的 `index.d.ts:136-137` 已有这两个方法且签名与 §3.2 一致。加完接口声明后即通过编译期守卫。

### 3.4 edge selector 解析

`packages/stdlib/src/chamfer.ts` 内：

```ts
const EDGE_ID_RE = /^o\d+(?:\.o\d+)*\.e(\d+)$/

/** 'o1.e7' → 7；非法形态 → null。 */
function edgeOrdinalOf(id: string): number | null { ... }

/** §2.4 三步解析，返回 OCCT 边句柄；失败抛对应错误码。 */
function resolveEdge(
  kernel: BrepEngineApi, solid: BrepHandle,
  sel: ChamferEdgeSelector,
  caches: { edges: BrepHandle[]; faces: BrepHandle[] },
): BrepHandle { ... }
```

要点：

- `caches`（`getSubShapes` 结果）在**一次 chamfer 调用内复用**，避免 N 条边做 2N 次枚举。
- 句柄释放：`getSubShapes` 返回的子句柄用完后 `kernel.release`（照 `geom.ts:38-42` 的既有写法）。
- 解析全部成功后再进入倒角；**不允许部分成功**（一批边里某条解析失败 → 整体报错，不静默跳过）。

### 3.5 非对称倒角的三角换算

**问题**：occt-wasm 只暴露 `AddDA(Dis, Ang, E, F)`，没有 `Add(Dis1, Dis2, E, F)`。双距必须换算成距角。

**几何关系**（垂直于边的截面内）：设材料侧二面角为 β，倒角面截参考面 F 于距棱 `dF` 处、截另一面 O 于距棱 `dO` 处，倒角面与 F 的夹角为 θ。三角形 `棱-Q_F-Q_O` 中，棱处内角 = β，`Q_O` 处内角 = 180° − β − θ。正弦定理：

```
dO / sin θ = dF / sin(β + θ)
        ⇓
dO = dF · sin θ / sin(β + θ)
        ⇓ （反解）
θ = atan2(dO · sin β,  dF − dO · cos β)
```

> ⚠️ **前一版文档此处方向写反了**（写成 `dO = dF·sin(β+θ)/sin θ`、`θ = atan2(sin β, dO/dF − cos β)`），其自检用例恰好选了 β=90°、dF=dO 的对称情形，两个方向的错误公式在该点给出相同结果，因此自检没有抓住。下面给出**能抓住该错误**的自检表。

**自检表**（`dO_check` = 把算出的 θ 代回前式，必须等于 `dO`）：

| 用例 | dF | dO | β (°) | θ (°) | dO_check |
|---|---|---|---|---|---|
| 立方体等距 | 1 | 1 | 90 | 45.0000 | 1.000000 |
| 立方体 2:1 | 2 | 1 | 90 | **26.5651** | 1.000000 |
| 立方体 1:2 | 1 | 2 | 90 | **63.4349** | 2.000000 |
| 60° 二面角 2:1 | 2 | 1 | 60 | 30.0000 | 1.000000 |
| 120° 二面角 3:1 | 3 | 1 | 120 | 13.8979 | 1.000000 |

「立方体 2:1」一行是**反向检测器**：错误公式在该行会给出 63.4349° 而不是 26.5651°。T-A1 必须包含此行。

**β 的求法**：取两相邻面的外法向 `n1`, `n2`（`kernel.surfaceNormal(face, 0.5, 0.5)`，照 `geom.ts:47-52`），外法向夹角 `γ = acos(clamp(n1·n2, -1, 1))`，则材料侧二面角 `β = 180° − γ`。校验：立方体棱 `n1·n2 = 0` → `γ = 90°` → `β = 90°` ✓。

**范围界定 —— 只支持凸棱**：β ≥ 180°（凹棱）时倒角语义切换为「加材料填角」，截面几何关系不再是上述三角形。本文 V1 对凹棱抛 `E_CHAMFER_REFLEX_EDGE`。理由：与其给出一个看似支持、实则几何关系错误的路径，不如明确报错。凹棱支持列为后续项（§7 R5）。

**`dF` 对应哪一侧**：由内核选定的参考面 `F` 决定（§1.5 约束 1）。因此实现必须**先复现内核的选面顺序**：

```ts
/** 复现 occt-wasm config.rs:517-527 的双层枚举，返回内核会选中的参考面在
 *  getSubShapes(solid,'face') 中的下标；找不到 → null。 */
function kernelReferenceFaceIndex(
  kernel: BrepEngineApi, solid: BrepHandle, edge: BrepHandle, faces: BrepHandle[],
): number | null {
  for (let fi = 0; fi < faces.length; fi++) {
    for (const fe of kernel.getSubShapes(faces[fi], 'edge')) {
      if (kernel.isSame(fe, edge)) return fi
    }
  }
  return null
}
```

然后：

- `faces[0]` 的 ordinal 等于该返回值 → `dF = width1`，`dO = width2`；
- `faces[1]` 的 ordinal 等于该返回值 → `dF = width2`，`dO = width1`；
- 都不等 → 抛 `E_CHAMFER_EDGE_MISMATCH`（说明 §3.4 的 lineage 与内核视图不一致，是 bug 信号，不静默）。

> ⚠️ 该复现依赖「`getSubShapes` 顺序 == 内核 `TopExp_Explorer` 顺序」。`topologyExt.ts:599-603` 的注释支持这一点（同为 `TopExp::MapShapes`），但**必须实测**（T-A3）。若实测不成立，退路：放弃 `twoDistances`，只保留 `equal` + `distanceAngle`（§7 R2）。

### 3.6 `chamferBrep` 主流程

```ts
function chamferBrep(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/chamfer] no BREP kernel')
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('[stdlib/chamfer] E_CHAMFER_NO_BREP: input is not BREP')

  // 1. 校验参数（type / width* / angle / 非空）
  // 2. 枚举一次 edges / faces 句柄缓存
  // 3. 逐条解析 edges → BrepHandle[]（§2.4）
  // 4. 按 type 分派：
  //    equal          → kernel.chamfer(solid, edgeHandles, width)
  //    distanceAngle  → kernel.chamferDistAngle(solid, edgeHandles, width, angle)
  //    twoDistances   → 对每条边：算 β、定 F、换算 θ
  //                     → 按 θ 分组，同 θ 的边一批调 chamferDistAngle
  // 5. fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}
```

要点：

- **步骤 4 的 `twoDistances` 按 θ 分组**：不同边的 β 可能不同 → θ 不同 → 必须分组调用（每个 θ 一次 `chamferDistAngle`）。但 OCCT 的 `MakeChamfer` 是一次构建多条边，分组意味着多次构建 → 后续构建的输入是前次的结果，边的 ordinal 会变。**因此必须用「解析一次句柄 → 分批应用 → 每批后重新解析剩余边」的循环**，或对单一边集逐个构建。前者复杂度高，后者简单：V1 采用**逐边构建**（每条边一次 `chamferDistAngle`），代价是 N 次调用，正确优先。N 通常是个位数到几十，性能可接受；若实测成为瓶颈再优化。

- **不产生断链**：双链齐备（`fromBrep` 登记槽），与 `drill` 同构，不同于 mesh-only 的 `knurl`。倒角**不会**让 part 退化成 mesh。

- **不使用 `chamferWithHistory`**：它只支持对称（§1.5 约束 2），且 faijs 生产路径目前没有任何 op 消费 `*WithHistory`（`cutWithHistoryBrep` 等仅被 `brep/face-evolution-impl.test.ts` 消费）。保持一致。

### 3.7 `defineOp` 声明与 JSDoc

```ts
export const chamfer = defineOp({
  brep: (input: Shape, params: Record<string, unknown>) => chamferBrep(input, params),
  capabilities: 'directEdit',
})
```

JSDoc 头部注释照 `packages/stdlib/src/drill.ts:194-219` 的既有格式写全（`@group` / `@inputs` / `@async` / `@qual` / `@name` / `@returns` / 每个 `@param` 的 `type:` 标注 / `@example`）——`gen-api-dts.ts` 与 `ops-api-inventory` 依赖这些标注。

`capabilities: 'directEdit'` 的效果：`mode='brep'` 且引擎缺该能力 → `E_BREP_UNSUPPORTED`（`backend-dispatch.ts:90-96`）；`mode='auto'` 缺能力 → 因为无 mesh 实现，抛 `E_MESH_UNSUPPORTED`（`:97-109`）。

### 3.8 生成文件链

改动落盘后按顺序跑：

1. `npx tsx packages/core/scripts/gen-api-dts.ts` → 重写 `packages/core/src/mesh/api.d.ts`（**生成文件，禁止手改**）。
2. `npm run build`（符号表随包构建更新；入口 `packages/core/scripts/gen-symbol-table.ts:22-40`，输入 = `stdlib/src/internal-stdlib.ts`）。
3. 更新 `op-set-consistency.test.ts` 的 `CAD_NAMESPACE_FUNCTIONS`（`:24-33`），否则该用例会因 `missing: ['chamfer']` 失败。

---

## §4 测试方案

### 4.1 分层（对齐 AGENTS.md「开发完成后的测试步骤」）

| 层 | 命令 | 覆盖 |
|---|---|---|
| 1 | `npm run lint` | — |
| 2 | `npx tsc --noEmit`（含 `--workspaces`） | 编译期守卫 `_AssertOcctApi` 覆盖 §3.2 新方法 |
| 3 | `npx vitest run`（core / stdlib / mech-lib） | T-A1（纯函数，无 wasm） |
| 4 | `npm run test -w @faicad/faijs-tests` | T-A2…T-A6（需 `initOcctWasm()`，`beforeAll` 里初始化，照 parity 测试） |
| 5 | `npm run build` | 生成链一致性 |
| 6 | `npx playwright test <name>.spec.ts`（3d_editor） | T-E1…T-E3 |

**为何端到端必须放 `packages/tests/`**：`packages/core/src/mesh/mesh-api.test.ts` 明示依赖 CSG worker 的 op 在 core 单测不可用；倒角依赖 wasm，同类。

### 4.2 测点

- **T-A1 三角换算（纯函数，无 wasm）**：§3.5 自检表 5 行全部断言；特别断言「立方体 2:1 → 26.5651°」这一行（反向检测器）。另断言 `β = 180° − acos(n1·n2)` 在立方体棱上得 90°。
- **T-A2 ordinal 稳定性（关键假设）**：同一份脚本连续执行两次，断言 `getSubShapes(solid,'edge')` 的 `EdgeId` 序列完全一致；再改上游 `box` 尺寸后重放，断言**结构相同**的 box 的 `EdgeId` 序列仍一致。
- **T-A3 参考面枚举一致性（关键假设）**：在两侧尺寸不同的长方体上取一条棱，断言 §3.5 的 `kernelReferenceFaceIndex` 返回值 == `chamferDistAngle` 实际参考的那个面（判定方法：`twoDistances` 取 `width1=1, width2=3`，执行后实测倒角面到 `faces[0]` / `faces[1]` 的距离）。
- **T-A4 `equal` 端到端**：box → `chamfer(edges: ['o1.e1'], type:'equal', width:1)` → 断言 BREP 句柄仍在（未断链）、面数 +1、体积减少量在解析值容差内。
- **T-A5 `twoDistances` / `distanceAngle`**：`width1=1, width2=3` 后实测两侧距离分别为 1 / 3；`width=2, angle=30` 后实测沿参考面距离 2、夹角 30°。
- **T-A6 错误路径**：空 `edges`、`'o1.ex'` 非法形态、ordinal 越界、`width <= 0`、`angle = 0 / 90`、凹棱（`E_CHAMFER_REFLEX_EDGE`）、**非 BREP 输入**（`E_MESH_UNSUPPORTED`，验证 `dispatchPath` 分支）。
- **T-A7 一致性门禁**：`op-set-consistency` 用例通过；符号表含 `chamfer`。
- **T-A8 句柄释放**：连续执行 N 次后无泄漏报告（照既有 brep 测试的写法）。
- **T-A9 完整性**：`edges` 含 2 条边，其中第 2 条解析失败 → 整体报错，且**不产生任何几何修改**。

### 4.3 3d_editor 侧

- **T-E1 工具栏激活条件**（§5.2 三态）。
- **T-E2 生成脚本**：选 2 条边 → 断言生成的 faijs 行含完整形态的 `edges`（含 `faces` / `length` / `midpoint`）。
- **T-E3 预览往返**：预览显示 → 改宽度 → 预览更新 → 确定 → 脚本执行 → 场景几何与预览一致。

---

## §5 3d_editor 实现

### 5.1 参数体系 → 接口参数

UI 参数（`chamfer-store.ts`）→ faijs args：

| UI | faijs 参数 |
|---|---|
| `selectedReferenceIds: string[]`（`'topology|edge|o1.e7'`） | `edges: ChamferEdgeRef[]`（见 §5.5 转换） |
| `type: 'equal' \| 'twoDistances' \| 'distanceAngle'` | 同名 |
| `width` / `width1` / `width2` / `angle` | 同名，单位 mm / 度 |

### 5.2 Filter：顶部工具栏图标的激活条件

三态，照 `src/engine/components/drill-hole/DrillHoleToolbar.tsx:20-47` 的既有范式（`muted` 语义见 `src/components/ToolbarButton.tsx:22-27`）：

| 条件 | 图标状态 | 说明 |
|---|---|---|
| 当前 part 有 BREP 句柄 **且** 已选中 ≥1 条拓扑边 | 可点击 | 正常路径 |
| 当前 part 有 BREP 句柄，未选边 | 可点击但进入后提示先选边 | 进工具模式，由面板引导 |
| 当前 part **无** BREP 句柄（mesh-only：STL/SDF/knurl 之后的 part） | `muted` + tooltip 说明 | **倒角在此 part 上不可用**（§2.5 `E_MESH_UNSUPPORTED`） |

第三态是本文的重点：倒角是 BREP-only，必须在 UI 层就拦住，而不是让用户点完再报错。

### 5.3 边选择的启用

- 复用 `useTopologyPicking`（`mode === 'edge'`，`src/engine/hooks/useTopologyPicking.ts:266-301`），无需新增拾取代码。
- 边拾取对象是否可用取决于 `hasEdges`（`src/components/viewport/ViewportContainer.tsx:418-422`）。
- **⚠️ 拓扑陈旧问题（既有缺陷，影响所有选边/选面功能）**：mesh 模式下 `src/engine/script-engine/ScriptEngine.ts:616-624` 只在 primitive 创建时生成一次 `primitiveRuntimes`，后续 `drill` / `split` 等 op **不刷新**；BREP 模式下每次执行后 `_rebuildBrepTopology`（`:1003` / `:1176` / `:1348`）会刷新。倒角是 BREP-only 操作，其选边场景**恰好落在会刷新的那一侧**——这是 BREP-only 定位顺带带来的好处，但 chamfer 面板仍应在打开时校验当前 runtime 的 freshness，必要时走 `buildMeshTopologyRuntimeAsync` 对当前显示 mesh 重算（>10000 三角跳过，阈值照 `ViewportContainer.tsx:558`）。

### 5.4 面板

- 类型选择（三种）+ 对应数值输入，边界按 Onshape `BLEND_BOUNDS`（mm 制默认 5.0，软上限 500）。
- 选中边列表（可增删，显示 `Reference.label`）。
- 确定 → `recordFeature` 走通用路径（`terminalMapping: 'auto'`）。

### 5.5 脚本生成

`features/chamfer.ts` 的 `buildArgs`：把每个选中的 `ReferenceId` 转成完整形态的 `ChamferEdgeRef`：

```
'topology|edge|o1.e7'  ──strip──▶  edge: 'o1.e7'
reference.adjacentSelectors       ──▶  faces: ['o1.f2', 'o1.f5']
reference.pickData.length         ──▶  length
reference.pickData.center         ──▶  midpoint
```

`pickData.center` 是折线顶点算术平均（`topologyExt.ts:795`），与 brepjs `EdgeHint.midpoint`（两端点中点，`edgeRefFns.ts:24-29`）**定义不同**。两者都只用于打分排序，量级相当即可；但跨实现比较时不可混用，需在 JSDoc 中写明本字段口径。

生成行由 `formatCodeLine({ callee: 'chamfer', inputs, outputs, args })` 产出（`packages/core/src/lang/codegen.ts:241` 的 `formatCodeLine`；`fmtValue` 支持嵌套 array/object，可直接序列化 §2.2 的对象形态）。

### 5.6 预览策略（对应用户「看情况」的约束）

倒角走 OCCT，成本集中在 `BRepFilletAPI_MakeChamfer` + `meshShape` 三角化。静态分派：

| 条件 | 策略 |
|---|---|
| `edgeCount ≤ 8` **且** 当前 part 三角数 `≤ 10000` | **真实执行**：直接调 `import { chamfer } from '@faicad/faijs/stdlib'`，走与 `LiveDrillPreview` 相同的 `geometryBinding` 链路（`saveG0` / `bindPreviewGeometry` / `clearPreview`，200ms 防抖 + `requestIdRef` 陈旧丢弃） |
| 否则 | **ghost 蒙层**：只对选中边附近做局部可视化提示，参数改动不实时重算 |

阈值 10000 与 `ViewportContainer.tsx:558`、`shouldUseFastPreview` 的既有阈值保持一致，不另立标准。真实执行分支必须与最终提交走**同一个** `chamfer` 函数（同一条 BREP 路径），避免预览与结果几何不一致。

### 5.7 文件清单

| 文件 | 动作 |
|---|---|
| `src/engine/features/chamfer.ts` | 新增（`buildArgs` / `buildCode` / `deriveLabel` / `editor`，照 `src/engine/features/drill.ts` 全文结构） |
| `src/engine/features/index.ts` | 改（注册） |
| `src/engine/features/types.ts` | 改（`FeatureIconKey` 加 `'chamfer'`，`:27-31`） |
| `src/stores/tools/chamfer-store.ts` | 新增（`type` / `width*` / `angle` / 选中边，照 `drill-store.ts:19-60`） |
| `src/engine/components/chamfer/ChamferToolbar.tsx` | 新增（三态 Filter，照 `DrillHoleToolbar.tsx:20-47`） |
| `src/engine/components/chamfer/ChamferPanel.tsx` | 新增 |
| `src/engine/components/chamfer/ChamferPreview.tsx` | 新增（§5.6 双分支） |
| `src/stores/core/tool-store.ts` | 改（`ActiveToolMode` 加 `'chamfer'`） |
| `src/engine/version-store/Command.ts` | 改（`CommandType` 与 `COMMAND_TYPES` 加 `'chamfer'`，`:1-35`） |
| `src/layouts/DesktopLayout.tsx` | 改（挂载，`<DrillHoleToolbar />` 在 `:1434`） |
| `src/locales/*.json`（20 个） | 改（新增文案键） |
| 图标映射（`FeatureTreePanel` / `TimelinePanel`） | 改（`'chamfer'` → 图标组件） |

---

## §6 里程碑

| # | 内容 | 验收 |
|---|---|---|
| M1 | **先钉两个关键假设**：T-A2（ordinal 稳定性）、T-A3（参考面枚举一致性）。两者都是纯调研型测试，可在写实现前跑 | 结论写入本文 §7 对应风险条目；若不成立，先定退路再动手 |
| M2 | faijs：`BrepEngineApi` 扩展 + mock + 编译期守卫通过 | `npx tsc --noEmit` 全绿 |
| M3 | faijs：`chamfer.ts`（解析 + `equal` + JSDoc + `defineOp`）+ T-A1 / T-A4 / T-A6 | `npx vitest run` + `npm run test -w @faicad/faijs-tests` 绿 |
| M4 | faijs：`twoDistances` / `distanceAngle`（依赖 M1 结论）+ T-A5 | 同上 |
| M5 | faijs：生成链（`gen-api-dts` / 符号表 / `op-set-consistency`）+ 全量受影响测试 | `npm run lint` → `tsc` → `vitest` → `test -w` → `build` 逐层绿 |
| M6 | faijs 发版（版本号 +1）+ `npm run pack`；3d_editor 更新 `package.json` 依赖 | 3d_editor `npm install` 后能 import 到 `chamfer` |
| M7 | 3d_editor：store + feature + 工具栏三态 Filter + 面板 | T-E1 / T-E2 |
| M8 | 3d_editor：预览双分支 + 确定提交 | T-E3 |

纪律：每步先跑自己写的测试 → 再跑可能受影响的测试 → **全绿后才准跑 `scripts/ci.ps1`**；严禁通过跑 CI 找 bug；跑过一次 CI 后只重跑失败项。

---

## §7 风险

| # | 风险 | 影响 | 处理 |
|---|---|---|---|
| R1 | **ordinal 稳定性未验证**（§2.2 推断 1） | 上游参数变更后 `o1.e7` 指向别的边 | M1 的 T-A2 实测。不成立则：改用 `faces` lineage 为**主键**、ordinal 降为快路径校验值（即向 brepjs 方案靠拢，代价是需要解决面的稳定性这一同构问题） |
| R2 | **参考面枚举顺序未必一致**（§3.5） | `twoDistances` 的两侧距离对调 | M1 的 T-A3 实测。不成立则：砍掉 `twoDistances`，只留 `equal` + `distanceAngle`，并在 JSDoc / UI 中说明「`distanceAngle` 的参考面由内核选定」 |
| R3 | occt-wasm 无 `Add(Dis1,Dis2,E,F)`（§1.5） | 双距必须经距角换算 | §3.5 换算 + T-A1 反向检测器 |
| R4 | `AddDA` 的 `Ang` 口径未实测 | `distanceAngle` / `twoDistances` 几何错误 | T-A5 实测（执行后量倒角面到面的距离与夹角）。若与本文假设不符，改 §3.5 的 θ 定义，不改判据结构 |
| R5 | 凹棱不支持（§3.5 范围界定） | 内拐角无法倒角 | 显式报 `E_CHAMFER_REFLEX_EDGE`；后续版本补「加材料」几何关系 |
| R6 | `chamferWithHistory` 只支持对称（§1.5） | 非对称倒角拿不到面演化 | 与现状一致——faijs 生产路径目前无任何 op 消费 `*WithHistory`。需要面演化时另立议题 |
| R7 | `twoDistances` 逐边构建的性能（§3.6） | 边数多时慢 | V1 接受；T-A8 观察，实测成为瓶颈再优化为分组批量 |
| R8 | 首个 BREP-only op（§1.6） | 下游对「无 mesh 实现」的处理未经实战 | T-A6 专门覆盖 `E_MESH_UNSUPPORTED` 分支 |
| R9 | 3d_editor 拓扑陈旧（§5.3） | mesh 模式下选到过期的边 | 面板打开时校验 freshness；必要时重算（>10000 三角跳过）。该缺陷本身超出本次范围，需在 3d_editor 侧另立议题 |

---

## §8 调研足迹

**Onshape**（`C:/git/new/onshape/onshape-std-library-mirror`）：`chamfer.fs`（Filter `:28-33`；`oppositeDirection` `:57-62`；`tangentPropagation` `:88`；默认值 `:112`；**参数映射唯一权威 `:199-203`**）、`chamfertype.gen.fs`、`chamfermethod.gen.fs`、`edgeBlendCommon.fs:23-28`（`CHAMFER_ANGLE_BOUNDS`）、`valueBounds.fs:346-355`（`BLEND_BOUNDS`）。

**brepjs**（`C:/git/OpenCascade/brepjs`）：`src/topology/shapeRef/shapeRefTypes.ts`（`EdgeHint` `:79-84`；`EdgeRef` `:94-100`；`ResolvedEdgeRef` `:102-106`；`BrokenEdgeRef` `:108-116`）、`src/topology/shapeRef/edgeRefFns.ts`（`captureEdgeHint` `:24-29`；`HINT_MARGIN` `:47`；`bestByHint` `:55-79`；`createEdgeRef` `:91-103`；`resolveEdgeRef` `:111-139`）、`src/topology/shapeRef/roleLookup.ts`（`roleOfFace` `:39-47`；`facesForRole` `:50-59`）、`src/topology/shapeRef/shapeRefFns.ts`（`assignRoles` `:105-131`；`updateRoles` `:176-198`，含 `generated` hash 实测结论 `:169-172`）、`src/topology/chamferAngleFns.ts:32-92`、`src/csg/types.ts:186-196`（`FilletNode` / `ChamferNode`）、`src/csg/serialize.ts:208-219` + `:860-885`（面 role 校验 `:865-867`）。

**occt-wasm**（`C:/git/OpenCascade/occt-wasm`）：`xtask/src/codegen/config.rs:495-544`（`chamfer` / `chamferDistAngle` 生成，含参考面双层枚举 `:517-527`）；已安装 `node_modules/occt-wasm/dist/index.d.ts:136-137`、`:469`（3.8.4）。

**faijs**：`packages/core/src/topology/types.ts`（`EdgeRow` `:145-162`；`Reference` `:166-179`；`PickData.adjacentSelectors` `:193`；`SelectorRuntime` `:214-236`）、`packages/core/src/topology/build-selector-runtime.ts`（`selectorForRow` `:305-314`；`buildAdjacencySelectors` `:318-342`；`buildReference` `:346` 起；edge references 构造 `:679-694`）、`packages/core/src/occt-kernel/topologyExt.ts`（枚举方法注释 `:599-603`；`edgeHandles` `:604`；`edgeFaceOrdinals` 构建 `:646-665`；`edgeRows` 生成 `:819`；关系表写入 `:903-911`；`center` 口径 `:795`）、`packages/core/src/identity.ts`（品牌表，含 `EdgeId` / `FaceId` / `ReferenceId` / `SelectorKey`）、`packages/core/src/brep/brep-topology.ts`（`buildSolidTopologyRuntime` `:87-124`）、`packages/core/src/brep/engine/primitives.ts`（`BrepEngineApi` `:35-166`；编译期守卫 `:169-175`）、`packages/core/src/brep/engine/adapters/occt.ts`（capabilities `:33-42`；守卫 `:59-60`）、`packages/core/src/define-op.ts:127-175`、`packages/core/src/cad-runtime/backend-dispatch.ts:76-131`、`packages/stdlib/src/geom.ts:28-63`（序号式拓扑引用先例）、`packages/stdlib/src/drill.ts`（BREP 路径模板 `:134-166`；JSDoc 范例 `:194-219`）、`packages/core/src/lang/op-set-consistency.test.ts:24-33`、`packages/core/scripts/gen-api-dts.ts:25-40`。

**3d_editor**：`src/lib/topology/picking.ts:43-57`（`edgeReferenceFromIntersection`）、`src/engine/hooks/useTopologyPicking.ts:266-301`（边拾取）、`src/stores/core/selection-store.ts:42-72`（选中态形态）、`src/engine/components/core/CurvatureCombCore.ts:191-219`（selector 数组消费先例）、`src/engine/features/types.ts`（`FeatureIconKey` `:27-35`；`FeatureDef` `:94-148`；`deriveOutputs` `:161-176`）、`src/engine/features/drill.ts`（Feature 模板全文）、`src/engine/components/drill-hole/DrillHoleToolbar.tsx:20-47`（Filter 范式）、`src/engine/components/drill-hole/LiveDrillPreview.tsx`（预览链路）、`src/engine/script-engine/ScriptEngine.ts:616-624` + `:1003/:1176/:1348`（拓扑刷新点）、`src/components/viewport/ViewportContainer.tsx:418-422` + `:558`、`src/layouts/DesktopLayout.tsx:1434`、`src/locales/`（20 个）。
