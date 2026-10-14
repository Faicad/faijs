# brepkit ↔ L1 spline/helix 原语接入 与 gears/warehouse 收敛方案

> 方案出处：deepseek-V4.1-Flash + WorkBuddy
> 日期：2026-10-13

---

## 0. 目标与范围

把几何内核层（`packages/core`）已经存在、但**没有接进 L1 中立面 `BrepEngineApi`** 的样条/螺旋类原语接出来，使 `faijs-fasteners`（warehouse）与 `faijs-gears` 两个包在 **brepkit 引擎下也能建模**，而不是只能用 raw occt。

三个层次的目标：

1. **L1 契约**（`packages/core/src/brep/engine/primitives.ts`）：新增样条/螺旋族中立方法。
2. **两侧适配器**：`occt-kernel/occt-primitives.ts`（occt）与 `brepkit-kernel/brepkitKernel.ts`（brepkit）各实现一次；映射真源 `gen-engine-method-map.ts` 的 HAND_MAP 补条目。
3. **包侧收敛**：`faijs-fasteners/src/kernel.ts` 的 `WarehouseKernel`、`faijs-gears/src/kernel/gears.ts` 的 `GearKernel` 由「Omit + 私有扩展重声明」收敛为 `BrepEngineApi` 的真子集；包内调用点改走 L1 名。

**范围外**：`packages/core` 之外的 cd/ 应用层；`faijs` 现有 raw occt 注入路径（`test-setup.ts`）的最终废弃时机。

---

## 1. 现状（代码事实）

### 1.1 三层结构

```
包源码 (faijs-fasteners / faijs-gears)
  │  requireKernel() / getGearKernel()
  ▼
getBackends().kernel.brep                     ← host 注入点
  │
  ├─ occt 侧：createOcctPrimitives()          packages/core/src/occt-kernel/occt-primitives.ts
  └─ brepkit 侧：createBrepkitPrimitives()    packages/core/src/brepkit-kernel/brepkitKernel.ts
                                                 （经 brep/engine/adapters/brepkit.ts 注册）
```

- `BrepEngineApi` 定义于 `packages/core/src/brep/engine/primitives.ts:1-353`，编译期三处守卫：
  - `occt-kernel/occt-primitives.ts:510` `_AssertOcctApi`
  - `brep/engine/adapters/brepkit.ts:91` `_AssertBrepkitApi`
  - `brep/engine/adapters/brep-mock.ts:491` `_AssertBrepMockApi`
- 映射真源：`packages/core/scripts/gen-engine-method-map.ts`（HAND_MAP 在脚本内，第 47 行起；校验在第 262 行），产物 `packages/core/src/api/surface/engine-method-map.json`。当前条目状态统计：`aligned` 17 / `dialect` 86。
- brepkit 声明面快照：`packages/core/src/api/surface/brepkit-wasm-surface.json`（生成器 `scripts/gen-brepkit-surface.ts`；快照标 `version: 3.4.18`，**已装运行时为 `brepkit-wasm@4.1.49`**——快照需重生成）。
- op → 内核方法依赖：`scripts/gen-capability-map.ts` → `src/api/surface/capability-map.json`，断言在 `test/api/surface/capability-map.test.ts`。
- op 引擎收窄声明：`src/api/surface/arg-spec.ts`（`engines?: readonly BrepEngineId[]`，第 107 行附近），经 `src/api/internal/compat-op.ts:175` 透传给 `defineOp.engines`。

### 1.2 L1 已有什么（与本次相关）

| L1 方法 | 位置 | occt 原生 | brepkit 原生 | status |
|---|---|---|---|---|
| `interpolatePoints(points, degree)` | `primitives.ts:300` | `interpolatePoints(points)` | `interpolatePoints(coords, degree)` | dialect |
| `makeBSplineEdge(poles, weights, knots, mults, degree, periodic?)` | `primitives.ts:209` | `makeBSplineEdge` | `makeNurbsEdge` | dialect |
| `loft(sections, ruled, endPoint?)` | `primitives.ts:73` | `loft(wires, isSolid, ruled)` | `loft(faces)` / `loftSmooth` / `loftWithOptions` | dialect |
| `sweep(profile, spine)` | `primitives.ts:57` | `sweepPipeShell` | `sweep` | dialect |
| `sew(shapes, tolerance?)` | `primitives.ts:77` | `sew` | `sewFaces` | dialect |
| `sewAndSolidify(faces, tolerance?)` | `primitives.ts:79` | `sewAndSolidify` | `sewFaces`+`makeSolid` | dialect |
| `getNurbsCurveData(edge)` | `primitives.ts:299` | `getNurbsCurveData` | `getEdgeNurbsData` | dialect |
| `shapeType(shape)` | `primitives.ts:245` | `getShapeType` | brepkit `shapeType`（**对 face 返 `COMPOUND`**） | 见 §6.5 |

### 1.3 缺口：包需要、L1 没有、brepkit 能背的

包侧实际消费面（对 `faijs-fasteners/src` 与 `faijs-gears/src` 全量 grep `kernel.<m>(` / `kern.<m>(` / `k.<m>(` 得到）：

- **fasteners**（经 `WarehouseKernel`，`kernel.ts:46-112`）：`makeHelixWire` `approximatePoints` `interpolatePoints` `interpolatePointsWithTangents` `bsplineSurface` `sew` `makeSolid` `revolve` `thicken` `makeNonPlanarFace` `draftPrism` `reverseShape` `getSurfaceArea` `vertexPosition` `rotate` `mirror` `tessellate` `loft` `getNurbsCurveData`。
- **gears**（经 `GearKernel`，`kernel/gears.ts:35-93`，44 个方法）：`bsplineSurface` `approximatePoints` `interpolatePoints` `makeHelixWire` `loft` `thicken` `makeNonPlanarFace` `makeSolid` `split` `makeCircleArc` `getShapeType` `isFace` `isWire` `isShell` `isEdge` `subShapeCount` `healWire` `healFace` `outerWire` `projectPointOnFace` `buildSolidFromFaces` `makeFaceOnSurface` `rotate` `revolve` 等。

对「L1 有没有」与「brepkit 原生能不能背」做交集，得到缺口分三类：

**A. brepkit 原生可背（本次接入主体）**

| 中立名（待新增） | occt 原生（实测签名） | brepkit 原生（实测签名，4.1.49） |
|---|---|---|
| `bsplineSurface(points, rows, cols)` | `bsplineSurface(controlPoints: Vec3[], rows, cols)` | `interpolateSurface(coords, rows, cols, degree_u, degree_v)` 或 `approximateSurfaceLspia(coords, rows, cols, degU, degV, nCpsU, nCpsV, tol, iter)` |
| `approximatePoints(points, tolerance?)` | `approximatePoints(points, tolerance?)` | `approximateCurveLspia(coords, degree, num_control_points, tolerance, max_iterations)` |
| `makeSolid(shell)` | `makeSolid(shellId)` | `solidFromShell(shell)` |
| `thicken(shape, thickness, tolerance)` | `thicken(shapeId, thickness, tolerance)` | `thicken(face, thickness)` |
| `makeNonPlanarFace(wire)` | `makeNonPlanarFace(wire)` | `makeFaceFromWire(wire)` |
| `makeCircleArc(center, normal, radius, a0, a1)` | `makeCircleArc(center, normal, radius, startAngle, endAngle)` | `makeCircleArc3d(start, end, center, axis)` |
| `rotate(shape, axis, angleRad)` | `rotate(id, px,py,pz, dx,dy,dz, angle)` | 无 → 适配器组 Rodrigues 矩阵 + `transformSolid` |
| `subShapeCount(shape, type)` | L1 `getSubShapes().length` | 同（组合实现） |

**B. brepkit 原生没有对应 1D 原语，需「近似构造」（需拍板，见 §7）**

| 中立名 | 现状 | brepkit 可用的近似手段 |
|---|---|---|
| `makeHelixWire(origin, axis, pitch, height, radius)` | 仅 occt（`api/helix.ts` 直连 `getOcctKernel().makeHelixWire`，op 声明 `engines:['occt']`） | `helicalSweep` 是**扫掠成体**不是 1D wire；替代路径 = 解析螺旋采样折线 → `interpolatePoints` 造 NURBS edge → `makeWire` |
| `interpolatePointsWithTangents(points, startTan, endTan)` | 仅 occt | `approximateCurveLspia` / `interpolatePoints`（丢弃切向约束） |

**C. brepkit 真缺（保持 occt-only，不接）**

`draftPrism`（brepkit 无，已知 W5 cross/R 沉孔缺口）、`healWire` / `healFace`（`engine-method-map` 已标 occt-only）、`split(shape, tools)`（brepkit `split` 是平面二分，**同名不同义**，map 已标 occt-only）、`projectPointOnFace`（brepkit 只有 `pointToFaceDistance`）、`outerWire`、`getShapeType`、`isFace/isWire/isShell/isEdge`、`buildSolidFromFaces`（可组合 `sew`+`makeSolid` 实现——见 §3.2）、`makeFaceOnSurface`。

> 结论：**gears 无法整体抬进 brepkit**——它的 `split`/`healWire`/`projectPointOnFace`/`getShapeType` 依赖落在 C 类。可达的是「按零件分档」：只用 A/B 类的方法组合的齿轮（如 spur/ring 的 `row-approx-loft` 路径）可抬升，用 C 类的（bevel 的 split、worm 的 heal）保持 occt-only。

---

## 2. Phase A：L1 契约新增

在 `packages/core/src/brep/engine/primitives.ts` 的 `BrepEngineApi` 内新增（放在「曲线构造」族附近）：

```ts
// ── 样条面 / 曲线逼近构造（本轮新增：spline/helix 族）──
/** 点阵 (rows×cols) → B 样条曲面 → Face。语义锚 = occt GeomAPI_PointsToBSplineSurface。 */
bsplineSurface(points: BrepVec3[], rows: number, cols: number): BrepHandle
/** 点列 → 逼近 B 样条曲线（tolerance 为逼近容差）。语义锚 = occt GeomAPI_PointsToBSpline。 */
approximatePoints(points: BrepVec3[], tolerance?: number): BrepHandle
/** 点列 + 两端切向 → 插值三次 B 样条曲线。语义锚 = occt GeomAPI_Interpolate(scale=True)。 */
interpolatePointsWithTangents(points: BrepVec3[], startTangent: BrepVec3, endTangent: BrepVec3): BrepHandle
/** 右手圆柱螺旋线（1D wire）。origin/axis 定轴，pitch 每圈推进、height 总高、radius 半径。 */
makeHelixWire(origin: BrepVec3, axis: BrepVec3, pitch: number, height: number, radius: number): BrepHandle

// ── 体构造补缺（包侧消费面遗漏项）──
/** shell → solid。 */
makeSolid(shell: BrepHandle): BrepHandle
/** 面加厚（tolerance 仅 occt 消费，brepkit 忽略）。 */
thicken(shape: BrepHandle, thickness: number, tolerance?: number): BrepHandle
/** 任意 wire → face（含非平面 wire）。语义锚 = occt makeNonPlanarFace。 */
makeNonPlanarFace(wire: BrepHandle): BrepHandle
/** 圆心+法向+半径+起止角 → 圆弧 edge。 */
makeCircleArc(center: BrepVec3, normal: BrepVec3, radius: number, startAngle: number, endAngle: number): BrepHandle
/** 绕任意轴旋转（右手，弧度）。 */
rotate(shape: BrepHandle, axis: { point: BrepVec3; direction: BrepVec3 }, angleRad: number): BrepHandle
/** 指定类型子形状数量（组合实现）。 */
subShapeCount(shape: BrepHandle, type: BrepSubShapeType): number
```

**不在 L1 新增的**：`draftPrism`、`healWire`、`healFace`、`split`、`projectPointOnFace`、`outerWire`、`makeFaceOnSurface`、`getShapeType`、`isFace/isWire/isShell/isEdge`——它们是 occt 单方能力或已有 L1 名可替代，包侧改走 `getOcctKernel()` 平台面（`engines` 声明）或在包内用 L1 组合（§5）。

**签名对齐（不许静默）**：现有两处包/L1 签名冲突必须在接线时显式归一，不得 drop-in：

1. `loft`：L1 = `loft(sections, ruled, endPoint?)`；`WarehouseKernel`/`GearKernel` = `loft(wires, isSolid?, ruled?)`。包侧调用形如 `kernel.loft(wires, false, false)`（`kernel/gears.ts:390`）——第 2 个 `false` 在 L1 是 `ruled=false`、第 3 个 `false` 会被当成 `endPoint=false`（非 `undefined`），occt 适配器会走 `loftWithVertices(..., end=false)` 分支而崩。**必须改成命名参数或调整调用点为 L1 口径**。
2. `interpolatePoints`：L1 = `(points, degree)`（brepkit 语义）；包 = `(points, periodic?)` / `(points, {periodic?, tolerance?})`（occt 语义）。两包当前都以 `Omit<BrepEngineApi, 'interpolatePoints'>` 的方式**覆盖**了 L1 名。接线后要么统一语义、要么在 L1 增一个显式区分度的名字（如 `interpolatePointsCubic(points, periodic?)`）。

---

## 3. Phase A/B：两侧适配器接线

### 3.1 occt 侧（`packages/core/src/occt-kernel/occt-primitives.ts`）

新增方法直接直连 `OcctKernel`（签名已在 §1.3 A 表核对）：

| 中立名 | 直连实现 | 注意 |
|---|---|---|
| `bsplineSurface` | `k.bsplineSurface(points, rows, cols)` | occt 原生吃 `Vec3[]`（非扁平数组），适配器无需变换 |
| `approximatePoints` | `k.approximatePoints(points, tolerance ?? 1e-2)` | 容差缺省需显式给，勿依赖内核默认 |
| `interpolatePointsWithTangents` | `k.interpolatePointsWithTangents(points, startTangent, endTangent)` | 直连 |
| `makeHelixWire` | `k.makeHelixWire(origin, axis, pitch, height, radius)` | 左手由包侧镜像实现，L1 只暴露右手 |
| `makeSolid` | `k.makeSolid(shell)` | |
| `thicken` | `k.thicken(shape, thickness, tolerance ?? 0)` | |
| `makeNonPlanarFace` | `k.makeNonPlanarFace(wire)` | |
| `makeCircleArc` | `k.makeCircleArc(center, normal, radius, a0, a1)` | occt `makeCircleArc` 与 L1 同形 |
| `rotate` | `k.rotate(shape, axis, angleRad)` | |
| `subShapeCount` | `k.getSubShapes(shape, type).length` | 组合 |

### 3.2 brepkit 侧（`packages/core/src/brepkit-kernel/brepkitKernel.ts`，`createBrepkitPrimitives()` 内）

| 中立名 | brepkit 实现 | 方言消化 |
|---|---|---|
| `bsplineSurface` | `kernel.interpolateSurface(flat, rows, cols, degU, degV)` | 度数是中立签名没有的，适配器给缺省（如 3/3）；**勿用** `approximateSurfaceLspia`（那是逼近，语义不同）——除非 §7 决策点 1 选逼近口径 |
| `approximatePoints` | `kernel.approximateCurveLspia(flat, degree=3, numCps, tolerance, maxIter)` | `numCps` 取 `points.length`（或 `max(degree+1, ceil(n/2))`）；`degree` 缺省 3 |
| `interpolatePointsWithTangents` | 近似：`interpolatePoints`（丢切向） | **必须在实现内注释偏差来源**，并进 §6.3 band |
| `makeHelixWire` | 采样螺旋折线（`turns = height/pitch`，按圈数×每圈段数取点）→ `interpolatePoints` → `makeWire([edge])` | 偏差 = 采样弦高；`helicalSweep` 不可用于 1D（它出体） |
| `makeSolid` | `kernel.solidFromShell(shell)` | 与 `sewAndSolidify` 复用同一条路径 |
| `thicken` | `kernel.thicken(face, thickness)` | `tolerance` 参数丢弃 → 适配器只接受 `tolerance` 缺省/0，否则抛错（不静默） |
| `makeNonPlanarFace` | `kernel.makeFaceFromWire(wire)` | |
| `makeCircleArc` | `kernel.makeCircleArc3d(start, end, center, axis)` | 由 (center, normal, radius, a0, a1) 算起止点与绕轴方向 |
| `rotate` | Rodrigues 3×4 矩阵 → `transform`（`toKernelMatrix` 唯一转换点） | 与 `test/faijs/engine-compat/harness.ts` 的 `rotate` 桩同算法 |
| `subShapeCount` | `getSubShapes(shape, type).length` | |
| `buildSolidFromFaces`（若纳入） | `makeSolid(faces)` 组合（`sewFaces`+`solidFromShell`） | occt 侧直连 `buildSolidFromFaces` |

同时 `brep/engine/adapters/brep-mock.ts` 需补同名桩（否则 `_AssertBrepMockApi` 编译失败）。

### 3.3 映射真源（`packages/core/scripts/gen-engine-method-map.ts`）

在 HAND_MAP 追加条目（`status` 取 `dialect`，单侧 null 表示适配器组合实现）：

```ts
{ core: 'bsplineSurface', occt: 'bsplineSurface', brepkit: 'interpolateSurface', status: 'dialect',
  note: 'occt 吃 Vec3[] 且自动定阶；brepkit 吃扁平分度 (degU,degV) → 适配器补缺省阶数' },
{ core: 'approximatePoints', occt: 'approximatePoints', brepkit: 'approximateCurveLspia', status: 'dialect',
  note: 'brepkit 需 degree/numCps → 适配器给缺省；tolerance 走 Lspia 变体' },
{ core: 'interpolatePointsWithTangents', occt: 'interpolatePointsWithTangents', brepkit: null, status: 'dialect',
  note: 'brepkit 无切向约束原语 → 适配器退化为 interpolatePoints（丢切向），偏差进 band' },
{ core: 'makeHelixWire', occt: 'makeHelixWire', brepkit: null, status: 'dialect',
  note: 'brepkit 无 1D 螺旋 wire → 适配器采样折线 + interpolatePoints 造 NURBS edge' },
{ core: 'makeSolid', occt: 'makeSolid', brepkit: 'solidFromShell', status: 'dialect' },
{ core: 'thicken', occt: 'thicken', brepkit: 'thicken', status: 'dialect',
  note: 'brepkit 无 tolerance 参数' },
{ core: 'makeNonPlanarFace', occt: 'makeNonPlanarFace', brepkit: 'makeFaceFromWire', status: 'dialect' },
{ core: 'makeCircleArc', occt: 'makeCircleArc', brepkit: 'makeCircleArc3d', status: 'dialect' },
{ core: 'rotate', occt: 'rotate', brepkit: null, status: 'dialect',
  note: 'brepkit 经适配器组 Rodrigues 矩阵 + transformSolid' },
{ core: 'subShapeCount', occt: null, brepkit: null, status: 'dialect',
  note: '两侧适配器组合实现（getSubShapes 长度）' },
```

生成器校验规则（脚本第 262-270 行）要求：`aligned` 两侧名字必填；`dialect` 允许单侧 null；`platform` 仅 `occt-only`/`brepkit-only` 需要。上表全部满足。

**前置**：先跑 `npx tsx packages/core/scripts/gen-brepkit-surface.ts` 重生成 `brepkit-wasm-surface.json`（当前快照 `3.4.18`，需对齐已装 `4.1.49`），否则 HAND_MAP 里引用的 brepkit 名可能校验不过。再跑 `gen-engine-method-map.ts` 写回 `engine-method-map.json`。

---

## 4. Phase C：静态能力声明与 op 收窄解除

L1 名就位后，capability map 才能把「调用链落在这些原语的 op」静态算成 `['occt','brepkit']`。

1. **重生成 capability map**：`npx tsx packages/core/scripts/gen-capability-map.ts` → `src/api/surface/capability-map.json`；`test/api/surface/capability-map.test.ts` 会钉住「条目数 == arg-spec `kind:'brep-op'` 条目数」。
2. **解除 op 的 occt 收窄**：
   - `src/api/helix.ts`：今日直连 `getOcctKernel().makeHelixWire`（第 25/63 行）且 `engines:['occt']`（第 103 行）。改为走 `getBrepApi().makeHelixWire(...)`，并删掉 `engines` 字段 → 变成全平台中立 op。
   - `src/api/brep-operations/threadFns.ts`：`loft` 已进 L1，但该文件仍注释「loft 是 occt-only」——需按实际映射核对后决定是否解除。
   - `src/api/screw.ts`（第 188 行 `engines` 声明）、`src/api/split.ts`、`src/api/thicken.ts`、`src/api/draft.ts`：逐条用 §1.3 分类重判——落 A/B 类的解除，落 C 类的保留。
3. **契约测试**：`test/brep/engine/multi-engine-op-parity.test.ts` 与 `engine-switch-*.test.ts` 覆盖新解的 op。

---

## 5. Phase D：包侧收敛

### 5.1 `faijs-fasteners`

- `src/kernel.ts:46-112`：`WarehouseKernel` 由「`Omit<BrepEngineApi,'interpolatePoints'|'getNurbsCurveData'>` + 19 个私有扩展」收敛为 `BrepEngineApi` 真子集。已进 L1 的成员（`makeHelixWire` `approximatePoints` `bsplineSurface` `makeSolid` `thicken` `makeNonPlanarFace` `rotate` `interpolatePointsWithTangents`）从扩展里删掉，改用 L1 名；`revolve` 改 `revolveVec`；`tessellate` 改 `meshShape`；`loft` 改 L1 签名口径。
- 仅剩的私有扩展 = C 类：`draftPrism`（occt-only；`recess.ts` 的 taper 缺口已在文件头记录）。
- `src/test-setup.ts:19`：host 注入从 raw occt（`initOcctWasm()`）改为注入 `createOcctPrimitives()`（L1 适配器），使包侧与 L1 面一致；brepkit 侧注入 `createBrepkitPrimitives()`。
- `test/kernel-conformance.test.ts:26-45` 的 `PROBED` 清单：已进 L1 的名字从「私有扩展 probe」移除（它们由 L1 守卫保证）；`draftPrism` 等 C 类保留。

### 5.2 `faijs-gears`

- `src/kernel/gears.ts:35-93`：`GearKernel` 同上收敛。A 类成员改 L1 名；`revolve` → `revolveVec`；`loft` 调用点（`kernel/gears.ts:390`）改 L1 签名；`getShapeType`/`isFace`/`isWire`/`isShell`/`isEdge`/`subShapeCount` 用 L1 `shapeType` + `subShapeCount` 替代（注意 §6.5 的 brepkit `shapeType` 缺陷）。
- `src/kernel/gears.ts:119` 的 `getGearKernel()`：注入式 backend 优先 + `initOcctWasm()` 兜底的现状保留（包内单测不配置 backend）；兜底分支在包侧全部改完后可评估删除。
- **按零件分档**（依赖 C 类方法者保持 occt-only）：
  - 只用 A/B 类：`spur` / `ring`（`row-approx-loft` / `row-interp-loft` / `grid-approx` 三策略全走 `bsplineSurface`/`approximatePoints`/`interpolatePoints`+`loft`+`sew`+`makeSolid`）。
  - 用 `split`（gear `kernel/gears.ts` 中 5 处调用）：`bevel` / `crossed_helical` 等 → occt-only。
  - 用 `healWire`/`projectPointOnFace`：`worm` 等 → occt-only。
  - 包内处用 `getOcctKernel()` 平台面 + op 声明 `engines:['occt']`，**保留现行为**（不得因「看起来能换」而换掉线上默认分支）。
- `faijs-gears` 的 B-spline 策略默认值 `DEFAULT_GEAR_SPLINE_FACE_STRATEGY = 'row-approx-loft'`（`kernel/gears.ts:325`）不变。

---

## 6. 测试与验收

### 6.1 L1 契约测试（core）

- 在 `packages/core/test/brep/engine/` 新增/扩展：每个新 L1 方法在 occt 与 brepkit 两侧各跑一次「存在性 + 契约 smoke（句柄非空、bbox 数值、volume/area > 0）」。
- `multi-engine-op-parity.test.ts` 补 `helix` / `loft` 双引擎对照。

### 6.2 包侧引擎一致性（`packages/tests/faijs/engine-compat/`）

复用现有 harness（`harness.ts`，含 `revolve`/`makeSolid`/`rotate` 测试桩、`expectTopoEqual`、`assertConsistent`、`buildOn`、`measureOcct`）。本轮新增 `/ 翻转`：

- 新增 `helix.test.ts`：occt ↔ brepkit 螺旋线 wire 的 bbox / 长度 / 端点一致性，偏差进 band。
- `thread.test.ts` / `gears.test.ts`：现有「brepkit 缺口断言（`r.ok===false`）」在 L1 接线到位后**翻转为一致性断言**（T1 `solid` 数 + T2 体积/面积/bbox/质心）。
- `splitting` 依赖型零件（bevel/worm）保持 occt-only 回归。

### 6.3 偏差钉（沿用既有口径）

已知偏差件（螺旋采样、切向丢失、brepkit 曲面拟合）按双钉固定「当前偏差上限 + 目标 0」；band 只能收紧不能放大。

### 6.4 命令与运行环境

- 全部用系统 `pwsh` + 系统 node（`C:\Program Files\nodejs\node.exe`），不加 `NODE_OPTIONS`。
- core：`npx vitest run --config packages/core/vitest.config.ts`（以实际配置为准）。
- engine-compat：`npx vitest run --config packages/tests/vitest.engine-compat.config.ts`。

### 6.5 已知风险

1. **brepkit `shapeType` 对 face 返 `COMPOUND`**（`brepkit-kernel/brepkitKernel.ts:1307` 附近）→ `isFace`/`getShapeType` 语义不可靠。包侧改用 `getSubShapes(shape,'face').length`/`isSolid` 等 L1 组合判型，**不要**把 `shapeType` 当成可靠的类型判别。
2. **brepkit `makeWire` 静默丢边**（乱序输入）→ gears 的 `connectEdgesToWires`（`kernel/gears.ts:196`）用端点配对有序化后再 `makeWire`；复杂多弧闭合 wire（如 sprocket）在 brepkit 侧仍可能退化。
3. **`interpolatePointsWithTangents` / `makeHelixWire` 的 brepkit 侧是近似**（非同一算法），偏差必须实测后钉 band，不能假设零偏差。
4. **`thicken` 的 `tolerance`**：brepkit 无此参数，适配器须显式拒绝非零容差（不静默丢弃）。
5. **loft/interpolatePoints 的签名冲突**（§2 末）若不修，接线会产生静默几何错误。

---

## 7. 待定决策点（需拍板）

1. **`bsplineSurface` → brepkit 走插值还是逼近？**
   - (a) `interpolateSurface`（插值过点，与 occt `PointsToBSplineSurface` 的「过点」语义更近）；
   - (b) `approximateSurfaceLspia`（带 tol/迭代的可控逼近）。
   - 影响：齿面形状与偏差量级；建议先按 (a) 接线，用 `grid-approx` 策略的齿轮做对照实测后再决定是否切 (b)。

2. **`makeHelixWire` 的 brepkit 近似策略**：
   - (a) 采样折线 → `interpolatePoints` → NURBS edge（光滑近似）；
   - (b) 采样折线 → 多段 `makeLineEdge` + `makeWire`（折线，无 NURBS）。
   - 影响：螺纹在 brepkit 下的光滑度与偏差 band。

3. **`interpolatePointsWithTangents` 在 brepkit 侧是否接入**：
   - (a) 接入并退化为 `interpolatePoints`（丢切向，接受偏差）；
   - (b) 保持 occt-only（`PanHead` 头型相关零件留 occt）。
   - 影响：`screw` 的 `PanHeadWithCollar` / `RaisedCheeseHead` 能否在 brepkit 下建。

4. **`projectPointOnFace` / `outerWire` / `getShapeType` / `isFace` 等 C 类**：
   - (a) 包侧保留 `getOcctKernel()` 平台路径（现状）；
   - (b) 用 L1 组合尽力替代（如 `projectPointOnFace` 用 `pointToFaceDistance` + 迭代）。
   - 影响：gears 能否进一步减少 occt 依赖。

5. **`faijs-fasteners/src/test-setup.ts` 的 host 注入**是否本轮就从 raw occt 切到 L1 适配器（会影响该包全部现有单测）。

---

## 8. 落地顺序与文件清单

| 序 | 动作 | 文件 |
|---|---|---|
| 1 | 重生成 brepkit 声明面快照 | `scripts/gen-brepkit-surface.ts` → `src/api/surface/brepkit-wasm-surface.json` |
| 2 | L1 契约新增（§2） | `src/brep/engine/primitives.ts` |
| 3 | occt 侧实现 + mock 桩 | `src/occt-kernel/occt-primitives.ts`、`src/brep/engine/adapters/brep-mock.ts` |
| 4 | brepkit 侧实现 | `src/brepkit-kernel/brepkitKernel.ts` |
| 5 | 映射真源条目 + 重生成 | `scripts/gen-engine-method-map.ts` → `src/api/surface/engine-method-map.json` |
| 6 | capability map 重生成 + 断言 | `scripts/gen-capability-map.ts`、`test/api/surface/capability-map.test.ts` |
| 7 | op 收窄解除 | `src/api/helix.ts`、`src/api/brep-operations/threadFns.ts`、`src/api/screw.ts` 等 |
| 8 | 包侧类型收敛 + 调用点改 L1 名 | `packages/faijs-fasteners/src/kernel.ts`、`packages/faijs-gears/src/kernel/gears.ts` |
| 9 | 包侧一致性/回归测试 | `packages/tests/faijs/engine-compat/*.test.ts`、`packages/faijs-fasteners/test/kernel-conformance.test.ts` |

**验收**：

- `_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi` 三处编译期守卫全过。
- core 引擎契约与 parity 测试全绿。
- engine-compat 套件中：A/B 类零件由「缺口断言」翻转为「一致性断言」并全绿；C 类零件维持 occt-only 回归全绿。
- `capability-map.test.ts` 三方一致断言通过；解除收窄的 op 其 `engines` 不再含 `occt`。
