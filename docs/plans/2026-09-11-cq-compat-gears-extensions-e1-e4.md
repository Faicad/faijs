# cq-compat 齿轮扩展原语 E1–E4 开发计划（独立 PR）

日期：2026-09-11
状态：**已落地 / 已验证**（2026-09-11）—— 4 个 op 已在 `workplane.ts` 实现并导出，11 个单元测试全绿，全包 122 测试无回归；parity（run-cand 镜像）已执行：E3 `splitFace` 3 用例 PASS，E1/E2/E4 按根因登记 BLOCKED（见 §13 实施记录、§14 parity 结果）。**E1 `splineFace` 已按其 §4.5 验收补齐（默认 S2 `row-approx-loft`，实测 4.2e-11 / 5.6e-7），详见 §4.6。**
上游需求源：`docs/plans/2026-09-11-fai-cq-gears-port.md` §4（fai_cq_gears 移植依赖 cq-compat，本文件是该依赖的 cq-compat 侧落地拆分）
适用范围：仅 `@faicad/cq-compat` 包内改动，随 cq-compat 独立 PR 合入；fai_cq_gears 侧消费见上游方案。

---

## 0. 用户原话（逐字）

> 必须重新写这份方案，让 cq_gears 的移植依赖 cq-compat。
> 好的，把 E1–E4 拆成 cq-compat 侧的开发计划，写成独立的开发计划文件。

---

## 1. 目标与范围

为让 fai_cq_gears 能在 **1:1 翻译 cq_gears 的 CadQuery `Workplane` 调用** 时不再触碰裸 `occt-wasm`，需在 cq-compat 补齐 4 个齿轮必需、但 cq-compat 当前**未导出**的原语。这 4 个原语在 CadQuery 标准库中本就存在（`Face.makeSplineSurface` / `Workplane.makeHelix` / `face.split` / `Workplane.twistExtrude`），因此它们是 cq-compat 的**标准 CadQuery op 镜像**，天然接入 cq-compat 现有 parity 框架。

| 编号 | 新增 op（cq-compat 导出名） | 对应 CadQuery 标准库 op | 服务的齿轮类 | 优先级 |
|---|---|---|---|---|
| **E1** | `splineFace(wp, grid, opts?)` | `Face.makeSplineSurface(points, tol)` | 直齿/斜齿齿面（S2 策略若 `loft` 精度不足时触发） | 高 |
| **E2** | `helix(wp, pitch, height, radius, opts?)` | `Workplane().makeHelix(...)` / `Part.makeHelix` | Worm（蜗杆螺旋线） | 高 |
| **E3** | `splitFace(wp, plane)` | `face.split(plane)` / `split(keepTop)` | BevelGear / Rack / Worm 端面裁切 | 高 |
| **E4** | `twistExtrude(wp, profile, angle, height, opts?)` | `Workplane().twistExtrude(...)` | HerringboneGear / SpurGear(`missing_teeth`) | 中 |

**不在本计划范围**：fai_cq_gears 的 15 个齿轮类翻译、T1/T2 端到端比对、CLI 白名单（`@faicad/fai-cq-gears` 进 `CLI_ALLOWED_LIBS`）——这些在上游方案。本计划只交付 4 个 cq-compat op 及其在 cq-compat 内的验证。

---

## 2. 依赖与前置（实测事实，非假设）

### 2.1 内核方法已原生存在（关键，决定本计划是薄封装）
2026-09-11 在 `node_modules/occt-wasm/dist/index.d.ts` 实测，以下方法**已在 occt-wasm 的 `OcctKernel` 类型上声明**，可直接调用，**无需扩展 vendored 层或 faijs-core 的 BrepEngineApi**：

| 方法 | 签名（occt-wasm） | 文件:行 |
|---|---|---|
| `split` | `split(shape: ShapeHandle, tools: ShapeHandle[]): ShapeHandle` | `index.d.ts:112` |
| `makeHelixWire` | `makeHelixWire(origin: Vec3, axis: Vec3, pitch: number, height: number, radius: number): ShapeHandle` | `index.d.ts:189` |
| `bsplineSurface` | `bsplineSurface(controlPoints: Vec3[], rows: number, cols: number): ShapeHandle` | `index.d.ts:390` |

> 注：fai_cq_gears 第 1 版 `src/kernel.ts:41-92` 已把这三个方法封装进 `RawOcctKernel` 接口并逐条 `assertRawKernel()` 验证存在性（`RAW_KERNEL_METHODS`，kernel.ts:100-130）。本计划复用同一组内核方法，但**在 cq-compat 内**经 `getKernel()` 调用，而非 fai_cq_gears 自己 `initOcctWasm()`。

### 2.2 内核单例约定（必须遵守，否则 ShapeHandle 不兼容）
- cq-compat 统一用 `getKernel()` from `@faicad/faijs-core/occt-kernel/occtKernel`（workplane.ts:17 导入，workplane.ts:483/527/2256/2643/2975/3910 等多处 `getKernel() as unknown as OcctKernel`）。
- **禁止**在 E1–E4 里 `initOcctWasm()` 另起实例（fai_cq_gears kernel.ts:22-23 已论证：ShapeHandle 是实例 arena 下标，跨实例句柄失效）。
- fai_cq_gears 第 2 版方案 §6.3 明确：wasm 初始化与单例归 cq-compat 负责，fai_cq_gears 只经 cq-compat API 取内核。

### 2.3 cq-compat op 注册范式（照抄即可）
- op 是 `workplane.ts` 内的 `export function <op>(wp: Workplane, ...): Workplane` 纯函数，对 carrier 做不可变 `clone(wp, {...})`（参考 `spline`，workplane.ts:1717-1755）。
- 内核调用范式：`const kernel = getKernel() as unknown as OcctKernel`（workplane.ts:483）。
- 导出：在 `src/index.ts:17` 的 `export { ... } from './workplane'` 块内追加 4 个名字（参照 `loft` 在 index.ts:33、`spline` 在 index.ts:64 的位置）。
- **repo-wide 门禁**：`verify-export-jsdoc` 每次提交全仓扫描，任何导出缺 JSDoc 即拒。新 op 在 `workplane.ts` 定义处必须写完整 JSDoc（含 `@param`/`@returns`/语义说明），参照 `spline` 的 JSDoc（workplane.ts:1704-1716）。

---

## 3. 通用实现范式（每个 E 都遵循）

1. **加 op 函数**：在 `packages/cq-compat/src/workplane.ts` 新增 `export function <op>(wp: Workplane, ...): Workplane`，末尾 `return clone(wp, { shape: <newShape> })`（或视语义改 pending/selector）。
2. **调内核**：`const k = getKernel() as unknown as OcctKernel`，调用 §2.1 的原生方法；返回 `ShapeHandle` 经 `fromHandle(...)` / `brepOf(...)`（workplane.ts:15-16 已导入）包成 faijs `Shape`。
3. **错误处理**：内核返回非空 `ShapeHandle` 才包；失败抛 `[cq-compat] <op>: ...` 错误信息（参照 spline 的 `throw new Error('[cq-compat] spline: ...')`，workplane.ts:1723/1767/1777）。
4. **导出**：在 `src/index.ts:17` 块追加名字。
5. **JSDoc**：定义处写完整 JSDoc（门禁硬要求）。
6. **单元测试**：`src/<op>.test.ts`，`beforeAll` 内 `await initOcctWasm()`（参照 cq-compat.test.ts:9/98），断言几何量化指标（见各 E 验收）。
7. **parity 镜像**：在 `packages/cq-compat/tests/test_cadquery/` 加 CadQuery 标准库 op 的 Python 镜像脚本 + 对应 TS 消费，跑 `npx tsx tests/run-cand.ts --only <substring>`。
8. **构建**：改 src 后先 `npm run build -w @faicad/cq-compat`（run-cand 消费 dist，见工作记忆 parity 流程）。

---

## 4. E1 — `splineFace`（齿面 B-spline 曲面）

### 4.1 签名（推荐）
```ts
/**
 * Build a B-spline surface face from a regular point grid and set it as the
 * workplane's current shape. Equivalent to CadQuery `Face.makeSplineSurface`.
 * @param wp - Workplane (plane/origin used only for diagnostics; points are world coords)
 * @param grid - rows×cols grid of world-space points (row-major flat array length = rows*cols*3)
 * @param opts - { rows: number; cols: number; tolerance?: number }
 * @returns Workplane with the spline face as `.shape`
 */
export function splineFace(
  wp: Workplane,
  grid: [number, number, number][],
  opts: { rows: number; cols: number; tolerance?: number },
): Workplane
```

### 4.2 OCCT 调用
```ts
const k = getKernel() as unknown as OcctKernel
const faceHandle = k.bsplineSurface(grid, opts.rows, opts.cols)  // index.d.ts:390
```
- 参数顺序与 fai_cq_gears `kernel.ts:43-44` 的 `bsplineSurface(points, rows, cols)` 一致。
- **Deg/Tol 对齐风险**（重点）：CadQuery `Face.makeSplineSurface` 内部 `GeomAPI_PointsToBSplineSurface` 显式传 `DegMin=3, DegMax=8, Tol3D=1e-2`（fai_cq_gears `spline-face.ts:8` 注释）。occt-wasm `bsplineSurface` 的默认 Deg/Tol 是否一致**必须实测**；若不一致，需在 cq-compat 侧增加显式参数或在 vendored 层包一层 `GeomAPI_PointsToBSplineSurface(..., 3, 8, 1e-2)`，否则齿面精度达不到 §4.5。

### 4.3 实现步骤
1. 校验 `grid.length === rows*cols` 且 `rows>=2 && cols>=2`，否则抛错。
2. 调 `k.bsplineSurface(grid, rows, cols)`。
3. `brepOf(faceHandle)` → `Shape`，`clone(wp, { shape })`。
4. 在 `index.ts:17` 块导出。

### 4.4 参考素材（fai_cq_gears 第 1 版，可反向移植思路）
- `packages/fai_cq_gears/src/kernel.ts:43-44` — `bsplineSurface` 声明与语义。
- `packages/fai_cq_gears/src/spline-face.ts` — 三策略（S1 `grid-approx` / S2 `row-approx-loft` / S3）探索；**S2 最优**（直齿面积偏差 4.2e-11、斜齿 5.6e-7，见尖峰报告 `docs/analysis/2026-09-08-fai-cq-gears-spike.md` §3）。E1 直接做点阵 B-spline 曲面（≈ S1 `grid-approx`），若精度不足再让 fai_cq_gears 退回 `loft`(S2) 或扩 E1 参数。

### 4.5 验收（量化）
- **单元测试**：用 `spur-basic` 齿面点阵（来自 fai_cq_gears `fixtures/reference/`）构造 `splineFace`，面积与 CadQuery `Face.makeSplineSurface` 参考面积偏差：直齿 ≤ 4.2e-11、斜齿(helix15) ≤ 5.6e-7。
- **parity**：`run-cand --only face_spline` 对照 CadQuery 标准库 `Face.makeSplineSurface` 输出，目标 PASS（或 PASS-NT）。

### 4.6 实施结果（as-built，2026-09-11）

> **§4.2/§4.4 的「直接调 `bsplineSurface`」路线未达 §4.5 验收**，已改为双策略并默认 S2。

实测：occt-wasm `bsplineSurface` 只收 `(points, rows, cols)`，**没有** DegMin/DegMax/Tol3D 入口，只能按内核默认拟合；对 `spur-basic` 齿面网格相对面积偏差 **2.269e-4**，比 §4.5 要求的 4.2e-11 差 7 个数量级（§11 风险 1 命中）。

因此 `splineFace` 现支持 `opts.strategy`：

| strategy | 实现 | 实测（齿面网格 vs `makeSplineApprox`） |
|---|---|---|
| `'row-approx-loft'`（**默认**） | 每行 `approximatePoints(row, tol=1e-2)` → `makeWire` → `loft(wires,false,false)` → 取唯一 face | **直齿 4.2e-11 / 斜齿 5.6e-7**，采样点最大距离 2.646e-6 mm ✅ 满足 §4.5 |
| `'grid'`（opt-in） | `bsplineSurface(flat, rows, cols)` | 相对面积偏差 2.269e-4 ❌ 不满足 |

**验证证据（2026-09-11，`packages/fai_cq_gears` 内一次性探针）**：对 `spur-basic` + `spur-helix15` 的全部齿面段，`cq.splineFace`（S2 默认）与 fai_cq_gears 第 1 版已验证的 `buildSplineFace(..., 'row-approx-loft')` **面积逐位相同**（`areaRel = 0.00e+0`），对 cq 参考采样点的最大距离 `2.646e-6`（= 尖峰 §3 的 S2 值）。即 E1 现在**继承 S2 的标定精度**。

**为何这不是「换语义」而是「补齐验收」**：§4 的 E1 验收数字（4.2e-11 / 5.6e-7）本就是尖峰报告 §3 的 **S2** 实测值，§4 的「裸内核实现线索」也已列 `approximatePoints` / `interpolatePoints`。原实现只取了 `bsplineSurface`（≈S1），是未走完 §4 的线索。

**parity 归因不变**：E1 的镜像仍登记 `blocked`，但 `blockedBy` 的**主因是 `comparator:non-solid-metrics`**（face 无体积/质心），而非曲面算法差异——S2 在齿面网格上已与 `makeSplineApprox` 等价；`grid` 策略的 ≈2.3e-4 偏差是它自己的 opt-in 行为。

---

## 5. E2 — `helix`（螺旋线 wire）

### 5.1 签名（推荐）
```ts
/**
 * Create a helical wire on the workplane (origin = wp origin, axis = wp normal).
 * Equivalent to CadQuery `Workplane().makeHelix(pitch, height, radius, ...)`.
 * @param wp - Workplane (origin + normal define the helix axis)
 * @param pitch - axial advance per full turn (mm)
 * @param height - total helix height (mm)
 * @param radius - helix radius (mm)
 * @param opts - { opts? } (reserved for phase offset / left-handed)
 * @returns Workplane with the helix wire as pending/shape
 */
export function helix(
  wp: Workplane,
  pitch: number,
  height: number,
  radius: number,
  opts?: { leftHanded?: boolean },
): Workplane
```

### 5.2 OCCT 调用
```ts
const k = getKernel() as unknown as OcctKernel
const wireHandle = k.makeHelixWire(wp.origin, wp.normal, pitch, height, radius)  // index.d.ts:189
```
- 参数顺序与 fai_cq_gears `kernel.ts:79-81` 的 `makeHelixWire(origin, axis, pitch, height, radius)` 完全一致。
- 左旋：若 `opts.leftHanded`，把 `axis` 取反（`-normal`）。

### 5.3 实现步骤
1. 调 `k.makeHelixWire(...)`。
2. `brepOf(wireHandle)` → `Shape`，`clone(wp, { shape })`（或作为 pending wire 供后续 loft/sweep 消费；fai_cq_gears Worm 用"沿 helix 多截面 loft"，见上游方案 §8.3）。
3. `index.ts:17` 导出。

### 5.4 参考素材
- `packages/fai_cq_gears/src/kernel.ts:79-81,121` — `makeHelixWire` 声明 + `RAW_KERNEL_METHODS` 登记。

### 5.5 验收
- **单元测试**：构造参数化 helix（pitch=2, height=10, radius=5），断言：起点在 wp.origin、终点轴向坐标 = height（误差 ≤ 1e-6）、每圈轴向增量 = pitch（误差 ≤ 1e-6）。
- **parity**：`run-cand --only helix` 对照 CadQuery `Workplane().makeHelix`，目标 PASS/PASS-NT。

---

## 6. E3 — `splitFace`（用平面裁切面）

### 6.1 签名（推荐）
```ts
/**
 * Split a face (or solid's face) by a plane and keep the chosen side.
 * Equivalent to CadQuery `face.split(plane)` / `split(keepTop)`.
 * @param wp - Workplane whose `.shape` is the face/solid to split
 * @param plane - splitting plane as [origin: Vec3, normal: Vec3]
 * @param keep - 'top' | 'bottom' (side of normal to keep); default 'top'
 * @returns Workplane with the split fragment as `.shape`
 */
export function splitFace(
  wp: Workplane,
  plane: { origin: [number, number, number]; normal: [number, number, number] },
  keep?: 'top' | 'bottom',
): Workplane
```

### 6.2 OCCT 调用
```ts
const k = getKernel() as unknown as OcctKernel
// 1) build the cutting plane as an infinite face (or large box/half-space)
const planeFace = k.makePlaneFace(plane.origin, plane.normal)   // 需确认 occt-wasm 是否有 makePlaneFace；否则用大 box + k.split
// 2) split
const fragments = k.split(wp.shape, [planeFace])                // index.d.ts:112 → compound of fragments
// 3) pick top/bottom fragment by signed distance to plane
```
- `split(shape, tools)` 返回 **compound of fragments**（index.d.ts:110-112 注释明确）。E3 必须把 compound 拆成 top/bottom 两片，按 `keep` 选一片。
- **缺口风险**：occt-wasm 是否有"无限平面 face"构造？若没有，用「大尺寸 box（半空间近似）」作 tool，或先确认 `makePlaneFace`/`makeInfinitePlane` 是否在 `index.d.ts`。**实施第一步先 grep `index.d.ts` 确认 plane 构造方法**，再定实现。
- fai_cq_gears `kernel.ts:70` 的 `split(shape, tools)` 签名与 occt-wasm 一致，可作类型参考。

### 6.3 实现步骤
1. 确认 plane 构造方法（grep `index.d.ts`）。
2. 构造 cutting tool（plane face 或大 box）。
3. `k.split(shape, [tool])` → compound。
4. 遍历 compound 子面，按到 plane 的有符号距离分 top/bottom，取 `keep` 侧。
5. `brepOf` → `Shape`，`clone`。
6. `index.ts:17` 导出。

### 6.4 参考素材
- `packages/fai_cq_gears/src/kernel.ts:70` — `split` 声明。
- 上游方案 §8.1/§8.3：BevelGear / Rack / Worm 端面裁切走 E3（首选），兜底才是"加长后 half-space cut"（拓扑变、T2 须 `strictTopology:false`）。

### 6.5 验收
- **单元测试**：对一个已知 box top face 用水平面 split，断言：返回子面拓扑正确（face/edge 数合理）、被切前后体积守恒（split 不增不减体积，误差 ≤ 1e-9）。
- **parity**：`run-cand --only split_face` 对照 CadQuery `face.split(plane)`，目标 PASS/PASS-NT。

---

## 7. E4 — `twistExtrude`（扭转拉伸）

### 7.1 签名（推荐）
```ts
/**
 * Extrude a 2D profile while twisting it about the extrusion axis by `angle`
 * over `height`. Equivalent to CadQuery `Workplane().twistExtrude(profile, angle, height, ...)`.
 * @param wp - Workplane (profile pending as wp.shape or pendingRect/circle)
 * @param angle - total twist angle over height (deg)
 * @param height - extrusion height (mm)
 * @param opts - { steps?: number; isFrenet?: boolean }
 * @returns Workplane with the twisted solid as `.shape`
 */
export function twistExtrude(
  wp: Workplane,
  angle: number,
  height: number,
  opts?: { steps?: number; isFrenet?: boolean },
): Workplane
```

### 7.2 实现路线（二选一，优先 A）
- **路线 A（优先，复用现有 loft）**：cq-compat `loft` 已支持 **twisted loft**（证据：`loft.test.ts:90` `testTwistedLoft__s`）。把 profile 在 `[0, angle]` 区间离散为 N 个旋转截面（绕 extrusion 轴），用 `loft(sections, false, false)` 放样即得扭转体。N 由 `opts.steps` 控制（默认建议 ≥ `ceil(|angle|/π)*surfaceSplines`，参照 fai_cq_gears `profile.ts:248` 的 surfSplines 公式）。
- **路线 B（兜底，自构）**：若 loft 逼近达不到 CadQuery `twistExtrude` 精度，用 `k.bsplineSurface`（E1）+ side walls 自建扭转网格面 → sew → makeSolid（参照 fai_cq_gears `geom-build.ts` 的 sew 思路）。

### 7.3 实现步骤（路线 A）
1. 取 profile wire（wp.shape 或 pendingRect/circle → `face` → outerWire）。
2. 生成 N+1 个截面：每个绕 extrusion 轴旋转 `angle*i/N`，并沿轴平移 `height*i/N`。
3. `loft(sections, false, false)`（复用 workplane.ts 现有 `loft`）。
4. `clone(wp, { shape })`，`index.ts:17` 导出。

### 7.4 验收
- **单元测试**：对照 CadQuery `Workplane().twistExtrude` 的已知体（方截面、angle=90°、height=10），体积偏差 ≤ 1e-3（T1 同精度）。
- **parity**：`run-cand --only twist_extrude` 对照 CadQuery 标准库，目标 PASS/PASS-NT。
- **下游解锁**：fai_cq_gears HerringboneGear 的 2 个回归用例 T2 通过（上游方案 §8.2，E4 落地后）。

---

## 8. 测试策略

### 8.1 单元测试（vitest，快速反馈）
- 每个 E 加 `packages/cq-compat/src/<op>.test.ts`，复用共享 harness `gear-test-harness.ts` 的 `setupNativeKernel()`（内部 `registerOcctBrepEngine()` + `configureBackends({kernel:{brep:getKernel()}})`，使 `fromHandle` 可用且与原生单例同实例；**不要**用 `initOcctWasm()` 另起实例，也不要用 `createRuntime` 直接调 op——见 §13.2）。
- 基类形状经原生 `getKernel()` 构造（`makeBox`/`makeRectangle`+`translate`/`makeCircleEdge`+`makeWire`+`makeFace`），避免走 `cad.*` 后端。workplane 根用 literal（`mkWP()`，非 `cq.workplane('XY')`）。
- 断言见各 E §5/§6/§7 验收；E4 额外有 "no profile → throws" 守卫用例。
- 跑：`npm run test -w @faicad/cq-compat`（或 `npx vitest run src/<op>.test.ts`）。

### 8.2 parity 镜像（run-cand，对照 CadQuery 2.8.0 标准库）
- 在 `packages/cq-compat/tests/test_cadquery/` 加 4 个 Python 镜像脚本，分别用 CadQuery 标准库 `Face.makeSplineSurface` / `Workplane().makeHelix` / `face.split` / `Workplane().twistExtrude` 生成 reference STEP。
- 跑：`npx tsx tests/run-cand.ts --only <substring>`（substring 如 `face_spline` / `helix` / `split_face` / `twist_extrude`）。
- **流程硬约束**：run-cand 消费 dist；改 src 后**先** `npm run build -w @faicad/cq-compat` 再 run-cand（工作记忆 parity 流程）。
- 参考值生成用 `C:\Users\ylt\cadquery-env\Scripts\python.exe out/probe.py <step>`（上游方案 §1.5 已记录；旧路径 `C:\Users\yuan_\cq-editor\python.exe` 由执行方二选一）。

---

## 9. 验收门禁（本 PR 必须全绿）

1. **JSDoc 门禁**：`verify-export-jsdoc` repo-wide 扫描通过（4 个新导出 op 在 `workplane.ts` 定义处均有完整 JSDoc）。
2. **构建**：`npm run build -w @faicad/cq-compat` 通过。
3. **单元测试**：`npm run test -w @faicad/cq-compat` 中 4 个新 `<op>.test.ts` 全绿。
4. **parity**：4 个新 `run-cand` case 达到 PASS 或 PASS-NT（参考 occt-wasm Deg/Tol 对齐后精度）。
5. **改动边界**：`git diff` 核验除 `workplane.ts` + `index.ts` + 新测试/镜像文件外，`packages/cq-compat/src/**` 无其它逻辑改动；**不触碰 `packages/core` / `packages/fai_cq_gears`**（fai_cq_gears 消费侧改动在上游方案、独立 PR）。
6. **内核单例**：4 个 op 全部经 `getKernel()`，无 `initOcctWasm()` 另起实例（grep 核验）。

---

## 10. 与 fai_cq_gears 的接口契约

- fai_cq_gears 消费方式（上游方案 §4）：`import { splineFace, helix, splitFace, twistExtrude } from '@faicad/cq-compat'`。
- **临时 shim 删除条款**（上游方案 §4 末段）：fai_cq_gears `src/kernel.ts` 可能在 E1–E4 合入前保留 `// TEMP-SHIM: delete when cq-compat E{n} lands` 薄桥；本 PR 合入后，fai_cq_gears 侧必须删除对应 shim，使 `grep -rn "occt-wasm\|initOcctWasm\|RawOcctKernel" packages/fai_cq_gears/src` 除已删 shim 外零命中（上游方案 §11 验收第 2 条）。
- 版本配合：本 PR 合入并发布 cq-compat 后，fai_cq_gears 的 `package.json` devDependency `@faicad/cq-compat` 指向更新版本，方可解锁对应齿轮类。

---

## 11. 风险与待拍板

1. **【已证实→已解】`bsplineSurface` Deg/Tol 默认值**：实测 occt-wasm **没有** DegMin/DegMax/Tol3D 入口，只按内核默认拟合 → 齿面网格偏差 2.269e-4，达不到 §4.5。**解法**：E1 默认改为 S2 `row-approx-loft`（每行 `approximatePoints(tol=1e-2)` + `loft`），实测 4.2e-11 / 5.6e-7 ✅；`bsplineSurface` 保留为 opt-in `strategy:'grid'`。不需要扩 vendored 层。详见 §4.6。
2. **【中】E3 plane 构造方法**：occt-wasm 是否提供无限平面 face（`makePlaneFace`/`makeInfinitePlane`）须先 grep `index.d.ts` 确认；无则用大 box 近似，T2 可能需 `strictTopology:false`。
3. **【中】E4 路线 A 精度**：loft 逼近 `twistExtrude` 是否达 CadQuery 精度，不达标则走路线 B（自构扭转面，工作量更大）。
4. **【低】cadquery-env 版本**：2.8.0 下 cq_gears 0.62 须先验证可 import（上游方案 §1.5 红线）；重生成 reference 须同版本并记 sha。
5. **并行关系**：E1–E4 相互独立，可并行开发；但都依赖 §2.2 内核单例约定，建议统一在 `workplane.ts` 一个 PR 内合入，避免多次触碰同一文件引发 conflict。

---

## 12. 命令速查

```bash
# 构建（run-cand 消费 dist，必须先 build）
npm run build -w @faicad/cq-compat

# 单元测试
npm run test -w @faicad/cq-compat

# parity 增量（仅跑某 E）
npx tsx tests/run-cand.ts --only face_spline
npx tsx tests/run-cand.ts --only helix
npx tsx tests/run-cand.ts --only split_face
npx tsx tests/run-cand.ts --only twist_extrude

# 门禁（提交前必跑，repo-wide）
# verify-export-jsdoc 由 lefthook pre-commit 自动触发；手动可跑对应 lint
```

---

## 13. 实施记录（2026-09-11，实测结论，给 fai_cq_gears 移植与后续原生 op 复用）

### 13.1 落地文件
- `packages/cq-compat/src/workplane.ts`：§齿轮扩展区（workplane.ts:4082 起）新增 4 个 `export async function`：
  `splineFace`（bsplineSurface）、`helix`（makeHelixWire）、`splitFace`（halfSpace + split + getSubShapes 选片）、`twistExtrude`（原生 rotate/translate 扫截面 + loft）。
- `packages/cq-compat/src/index.ts`:87-90 导出块追加 4 个名字。
- 单元测试：`splineFace.test.ts` / `helix.test.ts` / `splitFace.test.ts` / `twistExtrude.test.ts`（共 9 用例）。
- 共享测试 harness：`gear-test-harness.ts`（非 `.test.ts`，不被 vitest 当作用例；被 4 个 spec 复用）。

### 13.2 关键实测事实（与原计划的偏差，必须记）
1. **【Vec3 是 `{x,y,z}` 对象，不是 `[x,y,z]` 元组】**（最重要，否则几何全 NaN）。
   occt-wasm 的 JS 包装层读 `origin.x/.y/.z`（dist/index.js:169/396/485）与 `#flattenPoints` 读 `p.x/.y/.z`（dist/index.js:1479）。cq-compat 内部用元组，故 4 个 op 经本地 `v3(t)` 把元组转 `{x,y,z}` 再传 `makeHelixWire`/`halfSpace`/`bsplineSurface`/`rotate`（**`rotate` 的 `axis` 是 `{ point:{x,y,z}, direction:{x,y,z} }`**）。
2. **【`fromHandle` 需要 `configureBackends` 已注入 meshable 内核】**。
   `fromHandle` → `meshHandle` → `getBackends().kernel.brep.meshShape(handle, ...)`（handle-bridge.ts:95/117）。`registerOcctBrepEngine()` 只初始化原生单例 + 注册引擎，**不**调 `configureBackends`，故直接调 op 会抛 "backends not configured"。
   结论：`beforeAll` 里 `await registerOcctBrepEngine()` 后必须再 `configureBackends({ contractVersion, config:{mode:'brep',brepEngineId:'occt'}, kernel:{ brep: getKernel(), csg:undefined, sdf:undefined }, fonts/texture/assets/events: undefined })`。`getKernel()`（occt-kernel 单例）`meshShape` 已存在（dist/index.d.ts:298），且与 op 内部用的同一原生实例，**句柄一致**。
   ⚠️ 不要用 `createRuntime(ports,'brep')`：`claimBackends` 把 `kernel.brep` 设为 `this.brepChain?.kernel` getter，而 brep 链仅在 `runtime.execute` 内惰性初始化；直接调 op（不走 execute）时该 getter 返回 null → "OCCT kernel not available"。
3. **【`rotate` 参数是弧度，不是度】**。CadQuery `twistExtrude(angle=deg)`，原生 `kernel.rotate(shape, axis, angleRad)` 收弧度。E4 内部 `angle*t*Math.PI/180` 转换；旋转轴 `axis={ point: wp.origin, direction: wp.normal }`（绕 workplane 原点处的 extrusion 轴，profile 原地扭转不漂移）。
4. **【`splitFace` 选片用 bbox 中心符号距离，非布尔差探针】**。plan §6.4 的 ref 退化 compound 思路被 `getSubShapes(compound,'solid'|'face')` 取片 + 符号距离筛选替代，单平面裁切稳健；多平面/复杂 case 仍可能需 reviewer 关注（与 parity 流程一致）。
5. **【E4 走路线 A（loft）已验证可行】**：profile 是 face（非 wire）也能被 `loft` 的 `collectLoftSections` 经 `wp.shape` faces → outerWire 消费；矩形截面 90°/h=10 扭转体体积 > 0、Z 向高度 ≈ 10。
6. **【测试基类约束】**：`makeRectangle(w,h)` 直接返回面（无需 makeWire+makeFace）；单 circle edge 经 `makeFace` 会 "construction failed"（圆边不被 OCCT 当作闭合 wire 接收），故 profile 用 `makeRectangle` + `translate` 居中。

### 13.3 验收结果（本 PR 门禁）
- 构建：`npm run build -w @faicad/cq-compat` 通过（6 dist 文件，无 stderr）。
- 类型：`tsc --noEmit -p packages/cq-compat/tsconfig.json` 通过（含 4 个测试文件 + harness）。
- 单元：4 个新 `<op>.test.ts` **9/9 全绿**。
- 回归：`npm run test -w @faicad/cq-compat` 全包 **122/122 通过**（15 文件），无回归。
- 内核单例：4 op 全部经 `getKernel()`，无 `initOcctWasm()` 另起实例（grep 核验）。
- parity（run-cand，§8.2）：**已执行**（2026-09-11，本机 cadquery-env）。E3 `splitFace` 3 个用例 **PASS**（本包 parity 35.23% → **35.69%**，PASS +3）；E1/E2/E4 经实测**不可由现有比较器判分**，已按框架约定登记 `blocked`（见 §14）。

### 13.4 给 fai_cq_gears 消费方的提示
- 消费签名见 `index.ts` 导出：`splineFace(wp,grid,{rows,cols,tolerance?})` / `helix(wp,pitch,height,radius,{leftHanded?})` / `splitFace(wp,plane,{origin,normal},keep?)` / `twistExtrude(wp,angle,height,{steps?})`。
- 上游方案 §10 的 "临时 shim 删除条款" 现可触发：fai_cq_gears `src/kernel.ts` 的 `// TEMP-SHIM: delete when cq-compat E{n} lands` 桥接应在本 PR 合入后删除，使 `grep -rn "occt-wasm\|initOcctWasm\|RawOcctKernel" packages/fai_cq_gears/src` 零命中。

---

## 14. parity 镜像执行记录（2026-09-11，run-cand + compare）

### 14.1 结果汇总

本包 `out/report.json`：**PASS 228 / PASS-NT 4 / FAIL 1 / ERROR 0 / BLOCKED 417 / refCases 650 → parity 35.69%**（执行前基线 225 / 4 / 1 / 420 → 35.23%）。

| op | 镜像 | 状态 | 本质（实测证据） |
|---|---|---|---|
| E3 `splitFace` | `TestCadQuery__testSplitKeeping{Bottom,Half,Both}__result.fai.js` | **PASS ×3** | volDiffPct 1.9e-6、centroid 7e-9、bbox 2e-7、bool [0,0]、拓扑 f8/e18/v12 全等 |
| E4 `twistExtrude` | `…testTwistExtrude__r.fai.js.blocked` | BLOCKED | 几何机器精度一致（volDiffPct 2.6e-5 %、centroid 3.6e-14、顶点全等、拓扑 f6/e12/v8），但布尔差单向失败 |
| E2 `helix` | `…testMakeHelix__r.fai.js.blocked` | BLOCKED | 内存中 wire 精确（len 51.250548550 vs ref 51.250549089），导出后劣化 |
| E1 `splineFace` | `TestFace__testSplineApproxPoly__r.fai.js.blocked` | BLOCKED | 与 `Face.makeSplineApprox` 在多项式网格上逐位一致（area 1608.303209872） |

判定原则：**根因是内核/比较器限制 → `blocked`（根因写进 `blockedBy`）；根因是 cq-compat 几何差异 → `FAIL`**。故 E4 与 E1/E2 一并 blocked 而非 fail（几何本身已证等价）。登记落在 `tests/mark-blocked.ts` 的 `BY_KEY`（`manual:true`），镜像文件改名为 `<name>.fai.js.blocked` 并删除对应 `out/cand/*.step`（与 `test_loft_to_vertex__c` 同一手法，见 `tests/mark-blocked.ts:73` 注释）。

### 14.2 E3 `splitFace` — 真正拿到 PASS 的 3 个用例

镜像复刻上游链 `CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).cutThruAll()` → `faces(">Y").workplane(-0.5).split(...)`：

- **`makeUnitCube()` 只居中 XY，Z 跨 `[0,1]`**（上游 helpers 参数名是 `xycentered`，Z 不居中）。镜像必须写 `cq.box(w0,1,1,1,{centered:[true,true,false]})`，否则整体沿 Z 偏移 0.5（实测 centroidDiff 0.5、bboxDiff 0.5）。
- 切分平面 = `>Y` 面（y=0.5）沿其 +Y 法向偏移 −0.5 → **y=0 平面、法向 +Y**；上游 `keepBottom` = 保留 **−法向侧（y<0）**，与 cq-compat `splitFace(...,'bottom')` 语义一致（`'top'` = +法向侧）。
- **`testSplitKeepingBoth__result` 的 ref 只含 `objects[0]`（top 半边）**：上游 `split(keepTop=True, keepBottom=True)` 把两半入栈，但 ref harness 只导出 `val()=objects[0]`（`tests/README.md`「多体用例约定」）。实测该 ref 与 `testSplitKeepingHalf__result` 几何完全相同（都是 y∈[0,0.5] 的 top 半边），故镜像按 objects[0] 复刻 top 半边。

### 14.3 E1/E2/E4 — 为何不可判分（根因，供后续原生 op 复用）

1. **E4 `twistExtrude`（`kernel:boolean-near-coincident-bspline`）**。上游走 `Solid.extrudeLinearWithRotation` → `BRepOffsetAPI_MakePipeShell(spine).SetMode(auxSpine=helix, False).MakeSolid()`；cq-compat 用「离散旋转截面 + 平滑 loft」逼近（顶点与 ref 逐位一致，体积差 2.6e-7）。两实体近乎重合时 `BRepAlgoAPI_Cut` **单向失败**：`A−B=2.6e-4`（正确），`B−A=999.99`（=整体积，`isValid=true`）。实测与截面数无关（4/8/16/32/64/128 在 in-process 下 0/1000 抖动），且**经 STEP 往返后稳定复现**，故非构造问题。occt-wasm 的 `sweepOriented(..., SweepMode.Auxiliary, ..., auxSpine)` 复刻上游算法反而更差（vol 999.83，偏离 0.17 %），故保留 loft。
2. **E2 `helix`（`kernel:step-export-wire-fidelity`）**。内存 wire 精确；`kernel.exportStep` 写出的 helix B 样条控制点明显少于 CadQuery（24 vs 85 个 CARTESIAN_POINT），往返后长度 51.2505491 → **44.1568406**、bbox 偏 5.4e-3。**影响面**：所有以裸 wire/曲线为导出对象的 parity 用例（面/实体用例不受影响，因为几何承载在面上）。
3. **E1 `splineFace`（`comparator:non-solid-metrics`，主因改判）**。**主因是比较器**：面是非实体，`volume`/`centre-of-mass` 无定义（实测 volPct 575 %、centroid 9.5e15），而 bbox（4.4e-16）与拓扑（f1/e4/v4）全等。**曲面算法差异已不再是主因**：E1 默认改用 S2 `row-approx-loft` 后，在齿面网格上与 `Face.makeSplineApprox` 等价到 4.2e-11 / 5.6e-7（§4.6）。历史背景（保留备查）：`grid` 策略走的 occt-wasm `bsplineSurface` 文档称「control points」、实测对网格**插值**（3×3 中心 pole z=10 → `pointOnSurface(0.5,0.5).z=10`），而 `makeSplineApprox` 是 `GeomAPI_PointsToBSplineSurface(DegMin=1, DegMax=3, Tol3D=1e-2)` 的≤3 次**逼近**；二者仅在网格落在多项式曲面上逐位一致（双线性 41×41 两侧 area 均 1608.303209872；2×2 双曲抛物面均 1.861564180），一般波状网格发散（41×41：cand 28464 vs ref 2367）。这正是定 S2 为默认的依据。

### 14.4 对 §1/§5 的更正与遗留

- **更正**：CadQuery 2.8.0 **没有 `Face.makeSplineSurface`**（全仓 grep 零命中）；B 样条曲面只有 `Face.makeSplineApprox`。§1/§5 的「等价 `Face.makeSplineSurface`」表述作废，`splineFace` 的正确对照是 `makeSplineApprox`，且只在多项式网格域内等价（§14.3-3）。
- **对 fai_cq_gears 的影响**：`splineFace` 是「网格插值 B 样条面」，**不是** `makeSplineApprox` 的替代品；若齿廓需要≤3 次逼近曲面，occt-wasm 当前无对应原语（缺口需向 occt-wasm 或 vendored 层申请 `GeomAPI_PointsToBSplineSurface` 投影）。
- **复现 E1/E2 ref**：本 PR 未把 E1/E2 的自定义 ref 计入 `refCases`（保持与 `run-ref.py` 上游口径一致，避免口径失真）；配方写在对应 `.fai.js.blocked` 注释里，解除 block 时按配方用 cadquery-env 重新导出 STEP 并 upsert `out/ref/manifest.json`。
- **未修的内核缺口（跨 PR）**：(a) `BRepAlgoAPI_Cut` 在近重合 B 样条实体上的单向失败；(b) STEP 导出对裸 helix wire 的保真度。
