# Agent Note：圆弧角度基准归一（`cad.circleArc` 双引擎同一条弧）+ `cad.tangentArc` 开到 smlib

Status: implemented

2026-11-17。承接 `2026-11-16-sweep-api-consolidation.zh.md`（公开面收敛为 `sweep` + `sweepRaw`）。

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
ref = |n̂.x| < 0.999 ? (1,0,0) : (0,1,0)     // 法向几乎贴着 +X 轴时退到 +Y
u  = unit(ref − (ref·n̂) n̂)                   // 世界 +X 在圆面内的投影
v  = n̂ × u
P(θ) = center + radius (cosθ·u + sinθ·v)      // θ 为弧度
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
ĥ = unit(弦在 ⟂t̂ 方向的分量)      x = |d|² / (2 |d⊥|)
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

## 未做 / 后续

- `ellipseEdge` / `ellipseArc` 仍 `['occt']`。方案已明确：精确有理二次 NURBS + L1
  `makeBSplineEdge`，需先用 P0 探针验证 smlib `makeCanonicalCurve` 接受 degree-2 rational；
  已知代价是 `curveType` 会报 bspline、侧面变 NURBS 面。用户尚未就「是否现在做」拍板。
- smlib 侧缺口不变：`shapeOrientation`、`getSubShapes(face)`、`curveSplit` 仍 P1 未实现。
