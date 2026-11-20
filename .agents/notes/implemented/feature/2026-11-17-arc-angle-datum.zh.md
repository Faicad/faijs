# Agent Note：圆弧角度基准归一（`cad.circleArc` 双引擎同一条弧）+ `cad.tangentArc` 开到 smlib

Status: implemented

2026-11-17。承接 `2026-11-16-sweep-api-consolidation.zh.md`（公开面收敛为 `sweep` + `sweepRaw`）。

[English](2026-11-17-arc-angle-datum.md) | 中文

## 问题

1. **两个引擎各有自己的角度零点。** `cad.circleArc(center, normal, r, a0, a1)` 在 occt 与
   smlib 上对同组入参给出**不同的弧**，参数化方向也可能相反。用户可复现的症状：
   `cad.wireFromEdges([cad.circleArc(...), cad.edge([0,0,0],[-10,0,0])])` 当脊柱做 `cad.sweep`
   —— 一个引擎扫出 16 × 25.708 的实心弯管，另一个扫出 0（弧与直腿根本没接上）。
2. **`cad.tangentArc` 只有 occt。** 它直接绑 occt 原生 `GC_MakeArcOfCircle`，smlib 无对应原语，
   于是 `engines: ['occt']`；但「过起点、按给定切向出发、终于终点」在数学上是唯一确定的圆，
   这不该是平台能力问题。

## 关键判断（都是读码 / 实测得出）

- `smlibKernel.ts:1231 shapeOrientation` 直接 `return unsupported(...)` ⇒ 之前「根治要按
  shapeOrientation 定走向」的思路不成立，也不必要。
- `smlibKernel.ts:135 circlePlacementMatrix` 已经在用 canonical 帧：
  `ref = |n.x| < 0.999 ? +X : +Y`、`u = normalize(ref 在圆面内的投影)`、`v = n × u`。
  **这套帧就是现成契约**——把它抬到 L1，smlib 侧行为零改动，只有 occt 被纠过来。
- 实测 occt 的角度映射可写成 `θ(α) = δ + σ·α`（σ = +1 纯旋转、σ = −1 反射）：
  n = +X 时 δ = +90°、σ = +1；n = +Y 时 σ = −1（同一套逻辑两种形态）。
  ⇒ 不必猜引擎内部，**实测两端就能反解出 δ/σ**，再反解入参重建。

## 决策（用户 2026-11-17 批准「好的，开始实施」）

### 1. 角度基准升为 L1 唯一契约

```
n̂ = unit(normal)
ref = |n̂.x| < 0.999 ? (1,0,0) : (0,1,0)     // fall back to +Y when the normal nearly aligns with +X
u  = unit(ref − (ref·n̂) n̂)                   // world +X projected into the circle plane
v  = n̂ × u
P(θ) = center + radius (cosθ·u + sinθ·v)      // θ in radians
```

语义：**0° = 世界 +X 在圆面内的投影，绕法向逆时针为正**，参数起点恒等于 `a0` 那个点、
方向与入参一致（跨度正负决定走向）。

### 2. op 内「先建 → 量 → 反解 → 重建 → 验两端」

`api/curve-sketch/index.ts` 的 `neutralCircleArc`：

1. 先按契约建一次 trial（`makeCircleArc`，保留解析原语的精度，`curveType` 仍是 canonical）；
2. 用 `curveParameters` + `curvePointAtParam` 量出 trial 两端，与契约点逐点比（两端都比）；
3. 量 `θ(first)` / `θ(last)`，在 `[raw, raw ± 2π]` 里取与请求跨度同量级的分支；
4. `σ = sign(θl − θf) === sign(span) ? +1 : −1`、`δ = θf − σ·a0`；
5. 用 `build(σ(a0 − δ), σ(a1 − δ))` 重建，再验两端；
6. 过则 `release(trial)` 返回重建；不过则 `release(rebuilt)` 抛 `E_CIRCLEARC_DATUM`（带实测 δ/σ）。

**边界**：`|a1 − a0| = 360°` 的闭合圆不纠（几何只有一种解释，接缝位置随引擎）；`> 360°` 直接
拒（裁剪圆边表达不了多圈），报 `E_CIRCLEARC_SPAN`。容差 `tol = max(1e-9, 1e-7·radius)`。

**为什么不用三点弧替代**：小跨度下三点近共线、圆心反解病态；解析原语在小弧上更准。
**为什么不放弃解析原语**：`curveType` 要报 canonical arc（而不是 bspline）。

### 3. `tangentArc` 改中立几何，`engines` 扩到 `['occt','smlib']`

圆唯一：圆心必在「过起点、垂直切向」的直线上，又要到两端等距 ⇒

```
ĥ = unit(component of the chord along the direction in ⟂t̂)     x = |d|² / (2 |d⊥|)
c = start + x·ĥ
axis = unit(cross(start − c, t̂))
rVec = start − c,  eVec = end − c
φ = atan2(dot(cross(rVec,eVec), axis)/r², dot(rVec,eVec)/r²),  φ ≤ 0 → φ + 2π
mid = c + rotateAbout3(rVec, axis, φ/2)
```

有向角 φ ∈ (0, 2π) 自动覆盖长弧（不再是「走短弧」的隐式假设）。然后走 L1 `makeArcEdge`
三点弧落到引擎；三点弧若两个方向都不以 `start` 为参数起点，`E_TANGENTARC_ORIENTATION`。

错误码：`E_TANGENTARC_DEGENERATE`（切向为零 / 起点=终点）、`E_TANGENTARC_COLLINEAR`
（切向与弦共线 ⇒ 圆退化成直线）、`E_TANGENTARC_ORIENTATION`。

## 实测几何（canonical 帧，可直接当测试尺子）

| 入参 | 起点 → 终点 | 端向 |
|---|---|---|
| axis +X、c=(0,-10,0)、r=10、0→90 | (0,0,0) → (0,-10,10) | 起 +Z、末 −Y |
| axis +Y、c=(0,0,10)、r=10、0→90 | (10,0,10) → (0,0,0) | 起 +X、末 −Z |
| axis −Y、r=R、0→90 | (R,0,0) → (0,0,R) | 起 +Z |
| axis −Y、r=R、180→360 | (−R,0,0) → (R,0,0) | 两端 ∓Z（U 形底弯） |
| 闭合 0→360 | 不变 | — |

## 改动清单

- `packages/core/src/api/curve-sketch/index.ts`：新增 `dot3/cross3/unit3/asTriple/asBrep/dist3/
  curveEndsOf/circleFrame/framePoint/rotateAbout3/neutralCircleArc/tangentArcMidPoint`；
  `circleArcBrep` 只调 `neutralCircleArc`；`tangentArcBrep` 走 `makeArcEdge` + 端点方向兜底；
  `tangentArc.engines = ['occt','smlib']`；两个 op 的 JSDoc `@note` 重写（基准唯一、闭合接缝
  随引擎、跨度上限、错误码）。
- `packages/core/test/api/curve-arc-engines.test.ts`（新建，28 用例）：6 组 `ARC_CASES`
  （n=+Z 0..90 / n=+Y 0..90 / n=+Y 0..30 / n=+Y −90..90 / n=+X 0..90 / n=(1,1,1) 20..200）
  × 2 引擎断言「参数起点 = a0 点、终点 = a1 点」+ 弧长 = r×跨度 + 跨引擎逐点对拍 +
  闭合弧长 + `E_CIRCLEARC_SPAN` + 用户症状回归（两引擎体积都 = 16×25.708、不为 0）+
  tangentArc 几何（半圆 5π、四分之一 5π/2、起点切向 = 入参切向）+ 两个错误码 + smlib 当脊柱。
  期望值在测试侧**独立重算** canonical 帧，不复用 op 内实现（当另一把尺子）。
- 既有套件按新基准修几何（每个用例原意不变：G1 仍 G1、G0 仍 G0、断裂仍断裂）：
  `spine-analysis`（ARC 端点、ARC_PLUS_LEG、ARC_BROKEN 腿）、`sweep-along`（S4/S8 腿、R1/R3
  断裂腿）、`sweep-hollow-pipe`（`U_SPINE` 底弯 180→360、G0e 重写为契约用例、F2b 回 0→90）、
  `sweep-kernel-behavior`（K1c/K9 spine 腿改沿 −Y 续接、K1c bbox 断言换到 y 轴）、
  `smlib-p2-ops`（`makeCircleArc` 传弧度而非度）。

## 证据

- 相关套件 134/134 通过（`curve-arc-engines` 28、`spine-analysis` 25、`sweep-along` 25、
  `sweep-hollow-pipe` 21、`sweep-kernel-behavior` 28、`smlib-p2-ops` 32）；
  另 6 个引用圆弧的套件 107/107 通过（`occt-s4-curve-sketch`(-contract)、`wire-from-edges`、
  `sweep-engines`、`dxf-import`、`engine-switch-smlib`）—— 说明 +Z 法向的常见草图面完全不变。
- 旋转不变性：`sweep-along` S8 的混合+G0 斜接体积比 = `1.0044100166799876`，与旧几何逐位同值
  （几何整体绕弧法向转 90° 后测量值不变 ⇒ 基准改动没有改变斜接行为）。
- `npx tsc --noEmit`：30 条既有错误，`curve-sketch` 与本轮改动零新增。
- `npx tsx scripts/check-api-test-coverage.ts --package=core`：gate 通过
  （L1 1024 exports / 183 已知缺口、L2 154 / 93，baseline 未变）。

## 踩坑记录（下一轮会用上）

- 观察 `kind:'curve'` 产物走 `result.outputs` 会在 smlib 上炸
  `[smlib-kernel] getSubShapes(face): not implemented in P1`（`buildTopologyFromMesh →
  buildSelectorManifestCore`）——**与弧本身无关**，是 runtime topology 收集阶段不支持 smlib 的
  曲线产物。解法：直调 op（`import { circleArc } from 'src/api/curve-sketch'`）再 `brepOf(shape)`。
- 直调 op 前必须 `configureBackends({ contractVersion, config:{mode:'auto', brepEngineId},
  kernel:{ brep: brep.primitives, ... } })`；op 返回 **Promise**，必须 `await`，否则 `brepOf`
  拿到 Promise、错误也不会被 try/catch 捕获。
- 折角腿必须**沿半径向外**：一度把腿改到朝圆心方向，两段扫掠体互相重叠、union 体积掉 6.8%
  （2709 vs 2907）被 5% 默认容差拦下。S4/S8 现在分别是「相切续接」与「+Z 向外 90° 折角」。
- 新几何下弧恰好从原点起、截面（XY 面）与脊柱起点重合 ⇒ `sweepRaw` 默认路径自己就能转正，
  「未落位丢体积」这条证据必须把脊柱整体沿 +Z 挪 10 才复现（K1c 已这么改）。

## P0 探针结果：椭圆族（有理二次 NURBS）可行性

`packages/core/test/smlib-kernel/smlib-p0-rational-ellipse.test.ts`（16 用例全绿，1.5s）。
构造方式：圆的一段弧（半角 45°）用权重 `(1, cos45°, 1)` 的 degree-2 有理 Bezier；椭圆取
圆的仿射像（权重在仿射变换下不变）；> 90° 的跨度按 ≤90° 切段、degree 2 ⇒ 接缝重数 2。
判据用**测试侧手算的有理 Bezier 公式**（`B(t) = [(1−t)²P₀ + 2t(1−t)wP₁ + t²P₂] / [(1−t)² +
2t(1−t)w + t²]`）与 Simpson 数值积分当独立尺子。

| 项 | 实测 | 结论 |
|---|---|---|
| A 有理是否真被求值（smlib） | 7 个采样点与手算 1e-9 一致；`|P(0.5)| = 1`；圆 90° 弧长 = π/2（1e-6）；权重填 1 的对照弧长 1.623225（真圆 1.570796） | ✅ 内核**真按有理求值**（不是丢权重退化成抛物线） |
| B 椭圆是否精确（smlib） | `(x/a)² + (y/b)² = 1` 在 7 点上 1e-9；四分之一椭圆弧长 12.110560123 vs 解析 12.110560276（相对 1.3e-9） | ✅ 精确 |
| B `curveType` | smlib：rational-circle = `bspline`、rational-ellipse = `bspline`；occt：rational = `bspline`、原生 `makeEllipseArc` = `ellipse` | ⚠️ **语义降级确认，且两引擎对称**（都报 bspline） |
| B 参数域 | 单段 `[0,1]`；两段拼合 `[0,2]` | 角度 ↔ 参数不是一一对应，需映射表 |
| C 两段拼 180° | 域 [0,2]、接缝点 (0,5)、半椭圆弧长 24.221120625 vs 解析 24.221120551（相对 3e-9） | ✅ 可拼多段 |
| C 当脊柱扫掠（smlib） | r=1 圆截面，体积比 = **1.000001233**（解析 38.046447 / 实测 38.046494） | ✅ 可用，精度比预想的好（1e-6 级） |
| C 当 boolean 操作数（smlib） | `cut(box27000, tube)` → 26980.978，去掉 19.022 | ✅ 可用 |
| C 侧面曲面类型（smlib） | 3 个面：`{bspline: 1, plane: 2}` | ⚠️ 侧面确实是 NURBS 面（原判断成立） |
| O3 occt 长度积分 | 有理 vs 原生 相对偏差 **4.647e-6**（点几何仍 1e-9 级，见 O1） | ⚠️ 下游「面积 × 长度」判据要放宽到 1e-4 级，或与原生椭圆弧长度对拍 |

**两个额外事实**：

1. L1 原语面（`brep/engine/primitives.ts`）**根本没有椭圆**——`makeEllipseEdge` /
   `makeEllipseArc` 是 raw `OcctKernel` 方法，op 直接 `getOcctKernel()` 调、绕过 L1 契约。
   所以椭圆族不是「适配器缺一个映射」，而是**契约层缺能力**；但也不必新增 L1 方法 ——
   直接用已有的 `makeBSplineEdge` 即可，两引擎都已实现。
2. smlib 的 `makeBSplineEdge` 适配器本就透传权重
   （`w = weights.some(x => x !== 1) ? weights : undefined` → `k.makeCanonicalCurve(..., w, degree, 6)`）。

**落地判断（已被下一节取代，保留作过程记录）**：方案 A（双引擎统一有理二次 + L1 侧几何识别补语义）
技术可行、几何精度足够；唯一真实代价是 `curveType` 降级（两引擎对称）和 occt 长度积分 5e-6。
语义补回的做法与本轮 `circleArc` 同一条思路：L1 自己采样反解（圆心/长短轴/起止角），把
`kind:'arc'` 从「引擎报的类型」改成「L1 认出来的几何」。

> ⚠️ 上述「L1 侧几何识别补语义」在评审中被否决：用采样猜内核类型再覆盖 `curveType` 属**伪造内核
> 事实**（与「用测量纠正构造」性质不同），且会触碰 `occt-primitives.ts` 的 no-cross-layer-assertion-lies
> 红线。定案见下文「定案：方案 A / 步骤 1」。

# 定案：方案 A / 步骤 1「几何可用、语义如实」

用户拍板的边界：**不覆盖 `curveType`、不让 occt 降级、不动既有体积/长度判据容差、不建采样识别层**；
跨引擎对拍**比采样几何不比类型标签**。

## 实施内容（全部已落地并绿）

| 位置 | 改动 |
|---|---|
| `src/brep/engine/primitives.ts` | L1 契约面**新增** `makeEllipseEdge` / `makeEllipseArc`（弧度、canonical 帧写在 JSDoc 里，含两引擎语义差异与「走向按 `shapeOrientation` 读」）|
| `src/occt-kernel/occt-primitives.ts` | 原生 `gp_Elips` 直连 + `ellipseArcOcct` 轴基对齐：探针量出内核 XDirection → 解出旋转角 ρ → 建弧后绕 `(center, n̂)` 转回 ρ（刚性运动，**仍报 `ellipse`**）；验两端 + 验参数中点；方向相反时 `reverseShape` |
| `src/smlib-kernel/smlibKernel.ts` | `rationalEllipseNodes` 精确有理二次（段数 `ceil(|跨度|/90°)`、权重 `cos(Δ/2)`、内接缝重数 2）+ `circlePlacementMatrix` 落到平面；负跨度靠极点逆序，天然 CW |
| `src/brepkit-kernel/brepkitKernel.ts` | 两方法 `fail('...brepkit has no analytic ellipse (engine retired)')`（引擎已定死退役；op 声明里不含 brepkit，正常路径不经过） |
| `src/brep/engine/adapters/brep-mock.ts` | 两方法极小桩（tag 带 a/b），维持 guard 测试可用 |
| `src/api/curve-sketch/index.ts` | 两 op 去掉 `getOcctKernel()`，改走 `getBrepApi()`；`engines: ['occt','smlib']`；新增 `E_ELLIPSEARC_ZERO_SPAN` / `E_ELLIPSEARC_SPAN` |
| `test/api/curve-ellipse-engines.test.ts` | 新建 32 用例：两端点/采样点在椭圆上、弧长对解析积分、CW、倾斜法向、`a=b` 退化圆、跨引擎对拍、`curveType` 护栏（occt=`ellipse` / smlib=`bspline`，含倾斜法向旋转后仍 `ellipse`）、错误码 |
| `test/topology/naming/{mesh-primitive,resolve,roles,score}.test.ts` | fake kernel 按仓库既有纪律补最小桩（**不改** `as BrepEngineApi`，保住上下文类型） |
| `docs/ops-api-inventory.{md,zh.md}` | 3.10 / 3.11 两段 `@note` 从「平台 op 仅 occt」改为中立 op + 语义差异 + 实测长度差 |

## 本轮新增实测（datum 探针 D/E，21/21 绿 → 本文件同名的 `smlib-p0-rational-ellipse.test.ts`）

| 事实 | 数值 |
|---|---|
| occt `makeEllipseEdge`（n=+Z, a=10,b=5） | params `[0, 2π]`、closed、0/90/180/270° = (10,0)/(0,5)/(−10,0)/(0,−5) ⇒ **与 canonical 帧天然一致**；但**闭合曲线 `curveLength` 偏粗：48.505863 vs 解析 48.442241（1.3e-3）** |
| occt `makeEllipseArc` 0→90° | params `[0, π/2]`、端点精确、长度 12.110560 = 解析 ⇒ 参数就是角度 |
| occt 负终止角 `0→−90°` | 被归一成 `[0, 4.7124]`（+270°）⇒ **不可用负角表达 CW** |
| occt 倾斜法向 `n=+X` / `+Y` | 0° 点都落在 `+Z` ⇒ 内核 XDirection 与契约帧 `u` 整体旋转（实测 ρ 任意），且 `gp_Elips` 要求 `a>=b` ⇒ **不能靠对调半径**，只能旋转对齐 |
| smlib 闭合有理椭圆（4 段 90°） | closed、params `[0,4]`、长度 **48.442242**（≈解析 48.442241）⇒ 比 occt 闭合查询更准 |
| smlib 反向弧（90°→0，CW） | first (0,5) / last (10,0) / mid (7.071,3.536)、`(x/a)²+(y/b)²−1 = 2.22e-16`、长度 12.110560 ⇒ **极点逆序即 CW** |

## 踩坑

- `Edit` 的 `old_string` 带行尾换行、`new_string` 不带时，会把「注释行 + 下一行代码」粘成一行：
  本轮两次踩到（`// …describe(` 与 `…,    // 螺旋线`），第一次直接 `[PARSE_ERROR] Unexpected token`。
  替换注释行时**必须显式保留换行**。
- 只验两端点不够：跨度 135° 的 CW 弧与 225° 的 CCW 补弧两端点完全重合 ⇒ 必须同时验**参数中点**，
  否则会把长弧放过去（本轮 occt CW 用例就是这么抓出来的）。
- `shapeOrientation` 在 smlib 仍是 `unsupported` ⇒ 读取走向的辅助函数必须容错（smlib 的 CW 是
  真实反向参数化，按参数顺序解本来就是对）。

## 未做 / 后续

- occt 闭合椭圆长度查询偏 1.3e-3：按「不降级」原则**不改** occt 构造，改为在文档/测试里声明
  长度容差随引擎走；下游若用「面积 × 长度」当下游判据，椭圆族按 1e-3 级容差。
- `docs/api-contract.zh.md` §7.11 仍把 brepkit 当对等引擎、且 L1/L2 口径与 `scripts/check-api-test-coverage.ts`
  不同 —— 术语冲突尚未修（用户指出过该术语过时）。
- smlib 侧缺口不变：`shapeOrientation`、`getSubShapes(face)`、`curveSplit` 仍 P1 未实现。

## Alternatives considered

- **用三点弧替代解析弧原语** —— 否决：小跨度下三点近共线、圆心反解病态；解析原语在小弧上
  更准，且 `curveType` 必须报 canonical arc（不能降成 bspline）。
- **按 `shapeOrientation` 读走向来纠正弧方向** —— 否决：smlib 的 `shapeOrientation` 未实现
  （`unsupported`），不能作为跨引擎基准；实测反解 δ/σ 在两个引擎上都可用，不依赖它。
- **L1 侧采样识别补回椭圆语义（覆盖 `curveType`）** —— 评审否决：用采样猜内核类型再覆盖
  `curveType` 属伪造内核事实（与「用测量纠正构造」性质不同），会触碰 `occt-primitives.ts` 的
  no-cross-layer-assertion-lies 红线；用户拍板的边界是「几何可用、语义如实」。

## Consequences

- `cad.circleArc` 在 canonical 帧下于 occt 与 smlib 产出同一条弧（0° = 世界 +X 在圆面内的
  投影、逆时针为正）；两引擎逐点一致，用户症状（sweep 0 vs 16×25.708）双端修复。
- 闭合圆（跨度 360°）接缝位置仍随引擎；跨度 > 360° 以 `E_CIRCLEARC_SPAN` 拒绝；基准失败抛
  `E_CIRCLEARC_DATUM`（带实测 δ/σ）。
- `cad.tangentArc` 成为中立 op（`engines: ['occt','smlib']`），支持有向角长弧，含三个
  `E_TANGENTARC_*` 错误码。
- 椭圆族以 L1 `makeEllipseEdge` / `makeEllipseArc` 落地，遵循「几何可用、语义如实」：occt 报
  `ellipse`，smlib 的有理构造报 `bspline`；跨引擎判据必须比采样几何而非类型标签，椭圆族
  长度容差按 1e-3 级（occt 闭合椭圆长度查询偏粗）。
- 所有引用圆弧的既有套件已按新基准重定几何；旋转不变性已验证（S8 斜接体积比在整体转 90°
  后逐位不变）。
