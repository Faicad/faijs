# occt-wasm 5.6 能力 op 化方案

> 日期：2026-10-07
> 状态：**待拍板**（未动工）
> 事实基线：本方案全部结论来自**当前源码核实**，`C:/my/Faicad/faijs` + `node_modules/occt-wasm@5.6.0` + `C:/git/OpenCascade/{occt-wasm,OCCT}`。不引用任何历史 plan 作事实依据。

---

## 0. 对上一版方案的更正

已作废的 `2026-10-06-occt-wasm-api-wiring-plan.md`（本文件的前身，口径错误，已删除）提出「新增 L2 平台直通面，生成式 1:1 覆盖 204 个 occt-wasm 方法」。**这个方案是错的，作废。** 错在三处：

| # | 上一版主张                            | 错在哪                                                                                                                |
| - | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1 | 接入 = 在 faijs 里再包一层 occt-wasm API | 库层面用户自己就能 `getOcctKernel()` 直调，**包一层没有价值**。接入的真正含义是「提供 faijs **脚本**能调用的 op」。                                       |
| 2 | 用生成式直通面把 204 个方法全暴露              | 这批方法里大量是 wasm 胶水（`tessellate`）、批量内部优化（`*_Batch`）、原始序列化（`toBREPBinary`）——它们**不是建模语义**，做成 op 只会污染脚本面。                |
| 3 | 未接线 = 缺口，要用门禁逼平                  | **不接线从来不是疏忽**，是为了保证引擎可切换。正确做法不是"补接线"，而是**带 `engines: ['occt']` 声明地新增 op**——声明后 brepkit 模式在**执行前**静态拒绝，可切换性反而被显式化了。 |

**正确目标一句话**：把 occt-wasm 里**有建模语义**的能力，做成 faijs 脚本可调用的 op；只有 occt 能实现的，声明 `engines: ['occt']` 成为平台 op；将来 brepkit 补齐，把声明删掉，op 自动降级为中立 op。

---

## 1. 目标与口径

### 1.1 什么叫"接入"

一个 occt-wasm 能力被"接入"，当且仅当：**faijs 脚本里能写出一行调用它的语句**，且这行走完 `check()`（符号存在）+ `dimension`（量纲）+ `dispatchPath`（引擎路由）三道门后能产出 Shape。

判据不是"faijs 的 TS 源码里出现过这个 API 名"，而是**脚本作者能不能触达**。前者是库内部实现细节，后者才是能力面。

### 1.2 一个 op 的三种身份

`defineOp` 的 `engines` 字段是**引擎白名单**（`packages/core/src/define-op.ts:127`），语义为"本 op 的实现只能跑在这些 BREP 引擎上"：

| 身份        | 声明                  | 实现约束                     | brepkit 模式下                           |
| --------- | ------------------- | ------------------------ | ------------------------------------- |
| **中立 op** | 不写 `engines`        | 只用 L1 契约 `BrepEngineApi` | 正常执行                                  |
| **平台 op** | `engines: ['occt']` | 可直调 `getOcctKernel()`    | **执行前静态报错**（`dispatchPath` 判定，不是运行时崩） |
| **未接入**   | —                   | 无 op 触达                  | 脚本里根本没有这个符号                           |

**关键点**：`engines` 声明不会破坏引擎可切换，它是引擎可切换的**表达方式**。声明了 `['occt']` 的 op，在 brepkit 装配下会拿到一个明确的、可测试的静态错误；不声明而偷偷调 occt 原生方法，才是真正破坏可切换性（运行时才炸）。

### 1.3 降级路径：去 occt 化

用户要求：「如果未来 brepkit 也实现了对应的功能，则删除 engine 声明」。

仓库里已有四次同类降级的实证（都是"补 brepkit 实现 → 移除 `engines:['occt']` → 退化为能力路由"）：

- `clone`：`engines:['occt']` → 能力路由 `copyShape`（`test/brep/engine/brepkit-clone-fix.test.ts:4`）
- `translate` / `scale`：移除 `engines:['occt']` 改中立（D 批，`brepkit-batchD-fix.test.ts:13`）
- `rotate` / `applyMatrix`：`engines:[occt]` → 能力路由（`brep/engine/adapters/occt.ts:142`）
- `chamfer`：`engines:['occt']` → `capabilities:['chamfer']`（`brepkit.ts:82`）

所以本方案的 op 分两类落法，**必须先判再写**：

```
该功能在 brepkit 契约里有没有对应能力？
├─ 有 → 走中立 op：只用 BrepEngineApi，不写 engines
└─ 没有 → 走平台 op：写 engines: ['occt']，实现可直调 occt 原生
         并在 arg-spec 的 reason 里记一句"brepkit 补 X 后可去 engines"
```

### 1.4 与 BREP 优先原则的关系

前一版《kernel op 实现方案》定的原则是「能用 BREP 就用 BREP」。本方案是它的**落地通道**：新 op 的实现体必须走 OCCT BREP（`occt-kernel/*` 或平台直通的 BREP 算法），Manifold 只作 mesh 路径的 fallback，不得用于需要精确 STEP 的建模语义。

---

## 2. 现状事实（源码核实）

### 2.1 上游面：occt-wasm 5.6.0

`node_modules/occt-wasm/dist/index.d.ts`，`OcctKernel` 类公开方法 **211** 个。全包公开面 349 条（含 `OcctWorker` 32、`XCAFDocument` 14、函数 18、枚举 8、常量 9、类型 58）。

### 2.2 L1 契约：`BrepEngineApi` = 102 成员

`packages/core/src/brep/engine/primitives.ts:34`。这是**引擎中立**的能力边界——op 不声明 `engines` 时，只能碰这 102 个成员：

```
release dispose makeBox makeBoxFromCorners makeCylinder makeSphere makeCone makeRectangle
makeEllipsoid makeTorus makeVertex extrude revolveVec sew sewAndSolidify shell hullFromPoints
fuse cut common intersect fuseAll sectionByPlane splitByPlane chamfer chamferDistAngle fillet
filletVariable filletWithHistory translate scale transform located locate generalTransform copy
copyShape composeTransform mirror linearPattern circularPattern gridPattern makeLineEdge makeArcEdge
makeBezierEdge makeBSplineEdge makeCircleEdge curveSplit makeWire makeFace makeCompound
addHolesInFace buildTriFace meshShape wireframe getSubShapes subShapeHashes hashCode isSame isSolid
shapeType shapeOrientation edgeToFaceMap adjacentFaces sharedEdges curveType curvePointAtParam
curveTangent curveParameters curveIsClosed curveLength surfaceType surfaceNormal pointOnSurface
uvBounds surfaceCenterOfMass getFaceCylinderData getNurbsCurveData interpolatePoints defeature
draft removeHolesFromFace reverseShape projectEdges getBoundingBox getVolume getCenterOfMass
getSurfaceArea getLength isValid unifySameDomain healSolid fixShape fixFaceOrientations
removeDegenerateEdges importStep exportStep importStl fromBREP cutWithHistory fuseWithHistory
intersectWithHistory
```

**这 102 个成员就是"中立 op 能触达的天花板"。** 211 − 102 的差集里，凡是 occt 有而契约没有的能力，要么扩契约（brepkit 也要实现），要么做成 `engines:['occt']` 平台 op。

### 2.3 脚本面 op 全集

- `packages/core/src/lang/symbol-table.generated.ts`：faijs 原生 op **95** 个（`box` / `sphere` / `chamfer` / …）
- `packages/core/src/api/surface/arg-spec.ts`：`scriptFace: true` 条目 **48** 个（brepjs 投影增量，`torus` / `fuse` / `convexHull` / `twistExtrude` / …）

两个清单回答不同问题、互不为超集，**禁止互相反推**（arg-spec.ts 头部 A6 口径）。cad 脚本面 = 两者并集。

### 2.4 平台直通现状：`getOcctKernel()` 43 处 / 20 文件

```
api/brep-mirror/{booleanFns,healingFns,sweepFns,threadFns,topologyFns}.ts
api/brep-topology.ts  api/helix.ts  api/internal/l3-bridge.ts
api/loft.ts  api/punch-hole.ts  api/replicate.ts  api/split.ts  api/thicken.ts
brep/brep-ops.ts  brep/engine/adapters/occt.ts  brep/engine/primitives.ts
brep/export/step.ts  brep/face-evolution.ts  brep/handle-bridge.ts
occt-kernel/occt-primitives.ts
```

这 20 个文件里的 op **都应当声明 `engines: ['occt']`**（或改用 L1 契约后不声明）。

### 2.5 `engines` 声明现状：arg-spec 仅 1 处

`packages/core/src/api/surface/arg-spec.ts:2011`：

```ts
{
  name: 'thread', source: 'brep-mirror/threadFns.ts#threadBrepOp', selfhost: true,
  kind: 'brep-op', engines: ['occt'], module: 'operations',
  ...
}
```

**这是全仓唯一的正确范例**（`threadFns.ts` 确实调 `getOcctKernel()`）。对比 2.4 的 20 个文件——声明严重滞后于实现，本方案必须消掉这个落差。

### 2.6 上一版扫描器的数字，已作废

上一版报「未接线 206（值级 158），`OcctKernel` 86」。**这个数字连同它的口径一起作废**——它数的是"faijs 源码里有没有被调用"，答的是库内部问题，不是脚本可达性。

按本版口径（§3）重算的实测结果（occt-wasm 5.6.0，`npm run scan:occt-ops`）：

| 级别 | 数量 |
|---|---|
| L1 契约可达（中立 op 可用） | **100** |
| L2 平台可达（已声明 `engines`） | **8** |
| L3 平台裸调（**未声明 `engines`**） | **3** |
| L4 不可达（新 op 候选） | **105** |
| `OcctKernel` 方法总数 | 211 |

L4 的 105 就是 §4 的候选池。它比上一版的 86 大，因为口径更严：上一版把"在 `occt-kernel/` 里被调用过"算作已接线，而 `occt-kernel/` 是**契约实现层**，op 只有走对应契约成员才真正触达——不是所有契约实现层的方法都有 op 在用。

---

## 3. 四级可达性模型（本方案的判定口径）

一个 occt-wasm 方法对脚本作者的可达性分四级，扫描器按此输出：

| 级别                | 判据                                                              | 含义                    | 处置           |
| ----------------- | --------------------------------------------------------------- | --------------------- | ------------ |
| **L1 — 契约可达**     | 该方法被 `occt-kernel/occt-primitives.ts` 用于实现某个 `BrepEngineApi` 成员 | 任何中立 op 都能用           | 无需动作         |
| **L2 — 平台 op 可达** | 该方法被某个**带 `engines:['occt']`** 的 op 实现链调用                       | occt 装配下脚本可用          | 补齐声明即可       |
| **L3 — 平台裸调**     | 被调了，但所在 op **没声明** `engines:['occt']`                           | **违规**：brepkit 下运行时才炸 | 补声明 or 改走 L1 |
| **L4 — 不可达**      | 无任何 op 触及                                                       | 脚本完全用不到               | op 化候选（§4）   |

### 3.1 判定算法

```
① 解析 occt-kernel/occt-primitives.ts 的 createOcctPrimitives() 返回值
   → map: BrepEngineApi 成员名 → { occt 方法集合 }
   （成员名必须 ∈ 102 契约集，否则是私有辅助，不计）

② 解析脚本面 op 全集（95 原生 + 48 投影）
   → 每个 op 的实现模块（arg-spec.source 的 `模块#导出` 或 api-namespace 映射）
   → 沿 import 边做传递闭包（**排除** occt-kernel/* 与 brep/engine/*，那是契约实现层不是链路）
   → map: op → { 直调 occt 方法 } ∪ { 调用的 BrepEngineApi 成员 }

③ 交叉：
   L1 = ∪(① 的值)
   L2 = { m | ∃ op 声明 engines:['occt'] 且 (m ∈ op 直调集 ∨ m ∈ ①[op 用到的契约成员]) }
   L3 = { m | ∃ op 未声明 engines 且 m ∈ op 直调集 }
   L4 = 全部 211 − L1 − L2 − L3
```

**为什么要分层排除**：若把 `occt-kernel/*` 算进 op 的链路，任何用了 `getBrepApi().makeBox()` 的 op 都会"触达"全部 102 个契约成员背后的 occt 方法——覆盖率会被高估到失真。契约实现层只能按①的成员粒度展开，不能整体并入链路。同理 `brep/engine/*` 是注册表与调度层，也不是 op 链路。

### 3.2 为什么不用正则

（沿用上一版已验证的结论）正则在本仓两头都错：`.rotate(` 是 geometry2d 蓝图方法、`.tessellate(` / `.isFace(` 是 faijs 自己的 `BrepEngineApi` 同名方法 → 误判已接线；内核实例有 `kernel` / `k` / `getOcctKernel()` / `getBackends().kernel.brep` 一堆别名 → 误判未接线。**必须用 TypeScript 类型检查器按符号声明位置判定。**

---

## 4. op 化清单

候选池 = 新扫描器（§7）报出的 L4 **105** 个方法。按"是否值得成为脚本 op"分四批。**判定标准只有一条：有没有独立建模语义（脚本作者会想单独写这一行）。**

### P0 — 高价值，明确缺 op（建议先做）

| occt 方法               | 建议 op 名             | 建模语义      | 关联缺口                                                       | 引擎归属    |
| --------------------- | ------------------- | --------- | ---------------------------------------------------------- | ------- |
| `sweepFull`           | `sweep`（扩现 op 参数）   | 带 law 的扫掠 | **twist 挤出根因**（现 `sweepFns` 一律用无 law 参数的 `sweepPipeShell`） | occt 专属 |
| `makeHelixWireHanded` | `helix`（加 `handed`） | 带旋向螺旋线    | 解除 `TWIST_NEGATIVE_ANGLE_UNSUPPORTED`                      | occt 专属 |
| `offsetWire2D`        | `offset2d`          | 2D 轮廓偏置   | OpenSCAD `offset()`                                        | occt 专属 |
| `buildSolidFromFaces` | `solidFromFaces`    | 面集 → 实体   | **polyhedron 的关键环节**                                       | occt 专属 |
| `bsplineSurface`      | `surface`           | 点阵插值曲面    | heightmap / `surface()`                                    | occt 专属 |
| `sectionPlane`        | `sectionPlane`      | 平面截面      | 剖切视图                                                       | occt 专属 |
| `booleanOp`           | （内部用，不单独成 op）       | 通用布尔      | —                                                          | 不 op 化  |

### P1 — 有独立语义，值得成 op

| occt 方法                                                                                | 建议 op 名                           | 语义                    |
| -------------------------------------------------------------------------------------- | --------------------------------- | --------------------- |
| `makeEdge` / `makeCircleArc` / `makeEllipseArc` / `makeEllipseEdge` / `makeTangentArc` | `edge*` 族                         | 边长构造（草图）              |
| `makeFaceOnSurface` / `makeNonPlanarFace`                                              | `faceOnSurface` / `nonPlanarFace` | 曲面上建面                 |
| `makeSolid`                                                                            | `makeSolid`                       | 壳 → 实体                |
| `pipe`                                                                                 | `pipe`                            | 管（区别于 sweep）          |
| `draftPrism`                                                                           | `draftPrism`                      | 拔模棱柱                  |
| `alignX` / `alignY` / `alignZ`                                                         | `align*`                          | 对齐定位                  |
| `distanceBetween`                                                                      | `distanceBetween`                 | 距离测量（query）           |
| `getInertia`                                                                           | `inertia`                         | 惯性张量（query）           |
| `sectionPlane` 之外：`projectPointOnEdge` / `projectPointOnFace` / `classifyPointOnFace`  | 同名 query                          | 点投影/分类                |
| `surfaceCurvature`                                                                     | `surfaceCurvature`                | 曲率查询                  |
| `exportStl`                                                                            | `exportStl`                       | STL 导出（现只有 importStl） |
| `toSVG` / `toPNG` / `toMultiviewSVG` / `toMultiviewPNG`                                | `view*` 族                         | **工程图视图导出**           |

### P2 — 有语义但低频，按需

`thickenWithHistory` / `shellWithHistory` / `offsetWithHistory` / `mirrorWithHistory` / `rotateWithHistory`（带历史版本，供血缘追踪更准）、`intersectionCells`（干涉）、`describe`（形状描述）、`iterShapes` / `subShapeCount` / `shapeCount`（拓扑遍历）、`isEdge` / `isFace` / `isShell` / `isVertex` / `isWire` / `isCompSolid` / `isCompound` / `isEqual`（类型判定）、`liftCurve2dToPlane`（2D 抬升）、`cutAll`。

### 不做 op — 明确排除

| 类别      | 方法                                                                                                                                                         | 理由                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| wasm 胶水 | `tessellate`、`hasTriangulation`、`meshBatch`、`queryBatch`                                                                                                   | 渲染/性能内部路径，无建模语义                          |
| 批量优化    | `rotateBatch` / `scaleBatch` / `translateBatch` / `mirrorBatch` / `transformBatch` / `filletBatch`                                                         | 同一 op 的批量版本，脚本层用循环/数组 op 表达，不为每个批量变体造 op |
| 原始序列化   | `toBREP` / `toBREPBinary` / `fromBREPBinary`                                                                                                               | 内部持久化，脚本面已有 `exportStep` / `importStep`  |
| 曲线编辑    | `curveDegreeElevate` / `curveKnotInsert` / `curveKnotRemove` / `curveIsPeriodic` / `approximatePoints` / `interpolatePointsWithTangents` / `buildCurves3d` | NURBS 底层编辑，非建模流程                         |
| 缓存      | `cacheStep` / `loadCached`                                                                                                                                 | 性能内部机制，不是 op                             |

**排除不是丢弃**：这些仍可被 op 实现内部调用（属 L1/L2 可达），只是不单独占一个脚本符号。

---

## 5. 新增 op 的规范

### 5.1 arg-spec 条目（唯一人工维护点）

`packages/core/src/api/surface/arg-spec.ts`，照 `thread`（:2011）的写法：

```ts
{
  name: 'offset2d',
  source: 'brep-mirror/offsetFns.ts#offset2dBrep',   // 实现位置 模块#导出
  selfhost: true,
  kind: 'brep-op',
  engines: ['occt'],                                  // ← 平台 op 自证；brepkit 补 offsetWire2D 后删此行
  module: 'operations',
  geometryArgs: [0],
  reason: '2D 轮廓偏置 → Solid；occt offsetWire2D 无 brepkit 对应，声明 engines 待降级',
  args: 'offset2d(profile: Shape, delta: number, options?: Offset2DOptions): Shape',
  params: ['profile', 'delta', 'options'],
  formClass: 'A',
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
  scriptFace: true,                                   // ← 没有这行，脚本里就没有这个符号
}
```


必填字段：`name` / `source` / `kind` / `naming` / `scriptFace`。`engines` 按 §1.3 决策树决定写不写。

### 5.2 `naming` 怎么选（六值封闭，`topology/naming/lineage.ts:77`）

| kind        | 适用                                                        | 例                         |
| ----------- | --------------------------------------------------------- | ------------------------- |
| `kernel`    | 内核给历史：boolean / fillet / chamfer / shell / offset / 刚体变换  | `offset2d`、`sectionPlane` |
| `construct` | 输出面↔输入有构造规则：extrude / revolve / sweep / loft / primitives | `sweep`、`surface`         |
| `identity`  | 1:1 映射：copy / clone / locate                              | —                         |
| `subdivide` | 一片→多片：split / section                                     | `sectionPlane`（若按剖分语义）    |
| `replicate` | 第 k 份第 i 面 ← 第 i 面，需 `k`                                  | `linearPattern` 等         |
| `unmodeled` | 算不出来，必须给 `reason`                                         | `convexHull`（现状）          |

`kind: 'kernel'` 时执行期会补挂 `faceEvolution` 到血缘节点（`define-op.ts:471`）。

### 5.3 实现体：BREP 优先

```ts
// packages/core/src/api/brep-mirror/offsetFns.ts
import { defineOp } from '../../define-op'
import { getOcctKernel } from '../../brep/engine/primitives'   // 平台直通

export const offset2dBrep = defineOp({
  name: 'offset2d',
  engines: ['occt'],        // 与 arg-spec 必须一致，否则声明与实现脱节
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } },
  brep: (profile, delta, options) => {
    const k = getOcctKernel()
    return k.offsetWire2D(/* … */)   // OCCT BREP，非 mesh
  },
})
```

**硬约束**：

- 实现必须走 OCCT BREP 算法，不得用 Manifold 结果回填（精确 STEP 要求）。
- `engines` 必须在 **arg-spec 条目** 和 **`defineOp` 调用** 两处同时声明。`assertLibConforms`（`define-op.ts:546`）只校验 `defineOp` 侧；arg-spec 侧靠扫描器报告的 L3 段（§7）暴露差异，由人修正。
- 只给 `brep` 不给 `mesh` 是合法的（D1b，`define-op.ts:170`）——纯 occt 能力不必硬凑 mesh 实现。

### 5.4 `engines` vs `capabilities` 决策树

两者正交、可并存（`define-op.ts:122` 明确撤销了互斥）。判定次序：`engines` 先，`capabilities` 后。

```
实现只用 BrepEngineApi 的 102 个成员？
├─ 是 → 不写 engines（中立 op）；按需写 capabilities 声明所需能力
└─ 否（直调 occt 原生）→ 写 engines: ['occt']
                         └─ 若该能力在 BrepMethodKind 里有真名（如 'sweepPipeShell'）
                            可同时写 capabilities，让能力门再做一次校验
```

---

## 6. 引擎降级（去 occt 化）流程

当 brepkit 补齐某项能力，按此流程把平台 op 降为中立 op：

1. brepkit adapter 实现对应的 `BrepEngineApi` 成员（或扩展契约新增成员，**两侧同时实现**）。
2. op 实现体从 `getOcctKernel().xxx()` 改为 `getBrepApi().<契约成员>()`。
3. **删除** `defineOp` 的 `engines: ['occt']` 与 arg-spec 条目的 `engines` 字段。
4. arg-spec 的 `reason` 改写，记录降级日期与依据。
5. 补一条回归测试，照 `brepkit-clone-fix.test.ts` 的写法：断言 brepkit 装配下该 op **能执行**（不再是执行前拒绝）。
6. 重跑扫描器（§7）——该 occt 方法从 L2 转入 L1。

**契约新增成员的纪律**：扩 `BrepEngineApi` 必须 occt 与 brepkit **同时**落地。只扩一侧等于把中立 op 变成事实上的平台 op，属于违规。

---

## 7. 扫描器（op 覆盖口径）

### 7.1 与上一版的差别

上一版扫描器（判定 `wired = "src 里被调用"`）是**库内部**口径，答的是"faijs 代码有没有碰过它"，不是"脚本作者能不能用它"。**该脚本及其产物已删除**（`scan-occt-wasm-surface.ts`、`occt-upstream-surface.ts`、`occt-wasm-surface.json`、`occt-wasm-wired-allowlist.json`），本版替换为独立的 `scan-occt-op-coverage.ts`，判 §3 的四级可达性。

### 7.2 改造点

**新脚本独立实现**（不复用上一版代码，上一版已删）。四段解析：

1. **`occtKernelMethods()`** — 正则抽 `node_modules/occt-wasm/dist/index.d.ts` 里 `export declare class OcctKernel` 之后的方法名，得上游全集（211）与版本号。
2. **`contractOcctMethods()`** — 遍历 `packages/core/src/occt-kernel/`（排除 `generated/`、`*.test.ts`），取该目录所有文件直调的 occt 方法之**并集** = L1。
   **为什么不做「契约成员 → 方法」的细粒度映射**：`occt-primitives.ts` 的成员体多半只是一行委托（如 `hullFromPoints: hullFromPointsCore`），真实调用在 `hullOps.ts` / `topologyExt.ts` 等同目录文件里；按成员行区间切会把绝大多数方法漏掉（**实测 L1 = 0**）。整个 `occt-kernel/` 目录就是 L1 契约的 occt 实现层，按目录聚合才对得上。
3. **`importClosure()`** — 从 arg-spec `source` 指向的模块 + `api/**` 兜底入口出发，沿相对 import 做传递闭包；**排除** `occt-kernel/` 与 `brep/engine/`（契约实现层，算进去会让覆盖率虚高到失真）。
4. **`exportRange()` + 四级归类** — 按 arg-spec `source` 的 `#导出名` 切函数行区间判定该 op 的直调（不能按文件整体统计，见 §7.5），再按 op 是否声明 `engines:['occt']` 分到 L2/L3；剩余为 L4。

### 7.3 输出

新增脚本 `packages/core/scripts/scan-occt-op-coverage.ts`：

```bash
npm run scan:occt-ops              # 报告（stdout）+ 落 occt-op-coverage.json
npm run scan:occt-ops -- --md docs/occt-op-coverage.md   # 可选：落成 md
```

产物落 `packages/core/src/api/surface/occt-op-coverage.json`（四级清单 + 契约映射 + 版本号）。

### 7.4 不做 CI 门禁（明确排除）

**不提供 `--check` / 棘轮基线 / exit 1 这类门禁。** 理由：

1. **门禁的判据不成立**。门禁能判的只有"数量变了"，但它判不了"该不该接"。L4 里绝大多数是 wasm 胶水、批量变体、底层曲线编辑——按 §4 的取舍表它们**本来就不该成 op**。用门禁逼平，等于强制给每个新增方法造一个 op。
2. **逼平的必然结局是门禁被关掉**。要么团队为消警报补一堆无意义 op（污染脚本面），要么被加进 allowlist 永久豁免——两种都让工具失去意义。这比没有门禁更糟：它制造了"已被管控"的假象。
3. **这个判断只能人来做**。"有没有独立建模语义、脚本作者会不会想单独写这一行"是设计判断，不是可枚举的规则。

所以本工具定位为**只读报告**：occt-wasm 每次升级后跑一次，人读 L4 增量、对照 §4 取舍表决定补哪些 op。JSON 快照保留历史版本，供人工 diff。

> 唯一例外：L3（调了 occt 原生却未声明 `engines`）是**真 bug**而非取舍问题——brepkit 装配下会运行时崩溃。但它是 op 实现与声明不一致，属于 S1 要一次性清零的存量，修正后靠 code review 与现有测试维护，不单设门禁。

### 7.5 三个实现陷阱（踩过，改回去就会误报）

1. **不能把 `kernel` 当默认内核变量名**。本仓大量 `const kernel = getBrepApi()` —— 那是 **L1 契约句柄**，不是 occt 原生句柄。把它的方法调用算作 occt 直调，会把中立 op 全误判成平台 op（**实测让 L3 虚报 32 条**）。内核变量名只能从 `getOcctKernel()` / `getKernel()` / `initOcctWasm()` 的赋值语句里提取。
2. **必须按 `#导出名` 切函数区间，不能按文件整体统计**。`topologyFns.ts` 一个文件里挤了 `applyMatrix` / `clone` / `locate` / `mirror` / `rotate` 五个 op，按文件统计会把其中任一处的直调算到全部五个 op 头上（L3 曾虚报 7 个 op，函数级定位后精确到 1 个）。
3. **闭包必须排除 `occt-kernel/` 与 `brep/engine/`**。它们是契约实现层；算进 op 链路后，任何用了 `getBrepApi().makeBox()` 的 op 都会"触达"全部契约成员背后的 occt 方法，覆盖率被高估到失真。

---

## 8. 分阶段实施

| 阶段            | 内容                                                                                                         | 前置               | 产出                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| **S1 声明对齐**   | 消 2.4/2.5 落差：20 个 `getOcctKernel()` 文件涉及的 op，逐个判定——能改走 L1 的改走 L1，不能的补 `engines:['occt']`                   | 无                | L3 违规归零                                    |
| **S2 扫描器改口径** | 实现 §7.2 三段解析，出 `occt-op-coverage.json` + 基线                                                                | S1（否则 L3 噪声淹没结果） | 可跑的覆盖率工具                                   |
| **S3 P0 op**  | §4 P0 六项（`sweepFull` / `makeHelixWireHanded` / `offset2d` / `solidFromFaces` / `surface` / `sectionPlane`） | S2               | 解锁 twist / polyhedron / offset / heightmap |
| **S4 P1 op**  | §4 P1 表                                                                                                    | S3               | 补齐边长构造、测量、视图导出                             |

**S1 必须先做**：现在有 20 个文件裸调 occt 却只有 1 处声明，扫描器一上来会报出成片 L3，报告读不出重点。

> 无 S5：不设 CI 门禁，理由见 §7.4。升级后的常规动作是「人跑一次报告 + 对照 §4 取舍表」。

---

## 9. 验收

1. **S1**：`grep -rl getOcctKernel packages/*/src` 的每个 op，要么不再直调 occt，要么在 arg-spec 与 `defineOp` 两处都有 `engines: ['occt']`。
2. **S2**：`npm run scan:occt-ops` 输出四级清单，L1+L2+L3+L4 = 211（`OcctKernel` 方法总数）。
3. **S3**：六个 P0 op 各有一条 `.fai.js` 脚本用例，走通 `check()` → `run()` → `exportStep()`，且 STEP 可被 OCCT 重新读入验证（精确 BREP，非 mesh 回填）。
4. **降级验证**：任一 P0 op 在 brepkit 装配下断言"执行前被静态拒绝"（证明 `engines` 声明生效，可切换性未被破坏）。

---

## 10. 风险

| 风险          | 说明                                                       | 缓解                                                  |
| ----------- | -------------------------------------------------------- | --------------------------------------------------- |
| 契约膨胀        | S1 若把大量 occt 能力塞进 `BrepEngineApi` 冒充"中立"，brepkit 侧空实现会造假 | 扩契约必须两侧同时落地（§6 纪律）；扫描器报"契约成员在 brepkit adapter 中无实现" |
| op 面污染      | 为凑覆盖率把批量/胶水方法也做成 op                                      | §4 排除表是硬边界；新增 op 必须写清"脚本作者为什么需要这一行"                 |
| 声明与实现脱节     | arg-spec 写了 `engines` 但 `defineOp` 没写（或反之）               | 扫描器交叉比对两处声明，不一致即报错                                  |
| `naming` 选错 | 血缘追踪失真（尤其 `subdivide` vs `kernel` 的 `sectionPlane`）      | 新 op 必须给 `naming` 理由；`unmodeled` 需审计测试列出            |
