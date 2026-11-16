# 三维空间曲线扫掠的完整支持（分析 + 方案）

> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy
>
> 状态：已实施（P0–P5）
>
> 日期：2026-11-16

## 0. 结论

OCCT 对三维曲线扫掠是**完备**的：单段任意空间曲线、同类型多边 wire、G1 接缝、斜接（miter）/圆角过渡、恒法向、引导线、缩放律都算得准确。所有「丢体积、丢内腔、位置错、静默少料」都发生在 faijs 的 API 层，共 6 条互不重叠的根因，每条都有可复现的实验数字。

方案把扫掠拆成四段：**脊柱事实（facts）→ 策略（strategy）→ 执行（executor）→ 判据（guard）**。新的唯一入口 `cad.sweepAlong(profile, spine, opts)` 对任意三维路径一次调用给出解析体积与正确外廓；任何几何塌陷都变成带可执行指示的显式失败，而不是静默少料。

## 1. 判据口径

等截面沿路径扫掠的体积恒等式（Pappus）：V = 截面积 × 脊柱长度。本文所有表格以此为分母。统一取 r=6 的圆截面（面积 113.0973 mm²）和 R10/90° 弧（弧长 15.7080 mm，解析体积 1776.53 mm³），这样表格里「/解析值」一列可以直接比对。

判据不能只看体积：截面塌陷的产物 bbox 会丢掉管半径的展开（体积只差 1.7%，见 R5），而混合边类型在截面未落位时体积差 78%、bbox 只少一条腿（见 R3）。体积与 bbox 必须同时看，这也是第 6.7 节判据套件的出发点。

## 2. 实测矩阵

| 脊柱 | 入口 / 选项 | 体积 | /解析值 | bbox |
|---|---|---|---|---|
| 单段真弧 R10/90° | `pipe` / `sweepAdvanced` 各种 orientation | 1776.53 | 1.0000 | 12×16×16 |
| 同一条弧切成 2 段（同类型多边） | `pipe` | 1776.53 | 1.0000 | 12×16×16 |
| 共线两段直线 | `pipe` | 2261.95 | 1.0000 | — |
| 弧 + 同向直腿（真 G1、混合类型） | `pipe` | 645.56 | 0.2220 | 12×16×16（腿整段丢失） |
| 同上，腿长 5 时 | `pipe` | 1211.04 | 0.5171 | 12×16×16 |
| 同上 | `sweepAdvanced` frenet + 落位 | 1841.58 | 0.6334 | 12×12×20 |
| 同上 | `pipeAlong`（逐段 + union） | 2907.50 | 1.0000 | 12×16×26 |
| 折线 4 段（近似同一弧） | 默认 | 1131.00 | 0.6366（2/π） | z 只到 10 |
| 折线 16 段 | 默认 | 1185.11 | 0.6671 | 12×22×10.6 |
| 折线 4 段 | `rightCorner`，截面未落位 | 1699.89 | 0.9569 | 12×18.3×15.54 |
| 折线 4 段 | `rightCorner` + 落位 | 1765.14 | 0.9936 | 12×17.06×17.06 |
| 折线 16 段 | `rightCorner`，截面未落位 | 1674.36 | 0.9425 | 12×16.59×15.97 |
| 折线 16 段 | `rightCorner` + 落位 | 1775.82 | 0.9996 | 12×16.29×16.29 |
| 折线 4 段 | `pipeAlong`（逐段 + union） | 1593.28 | 0.8968 | 12×17.06×17.06 |
| 折线 16 段 | `pipeAlong` | 1563.59 | 0.8801 | 12×16.29×16.29 |
| 90° 折角 | 默认 | 1131.00 | 0.5000 | z = 路径 Δz |
| 90° 折角 | `rightCorner` | 2261.95 | 1.0000 | 展开正确 |
| 45° 折角 | `transformed` / `rightCorner` / `roundCorner` | 1930.7 / 2261.95 / 2255.8 | 0.8536 / 1.0000 / 0.9970 | — |
| 15° 折角 | 默认（5% 守卫放行） | — | 偏 1.70% | z = 路径 Δz（未展开） |
| 17 点折线 → `approximatePoints` → 扫掠 | `pipe` | 1776.53 | 1.0000 | 正常 |
| 17 点折线 → `interpolateWithTangents` → 扫掠 | 任意入口 | **wasm worker 直接退出** | — | — |
| 带孔 face（外 R8 / 内 R4） | `pipe` | 3016（净面积×20） | 1.0000 | — |

证据文件：`packages/core/test/api/sweep-kernel-behavior.test.ts`（25 条断言）、`packages/core/test/api/sweep-hollow-pipe.test.ts`（22 条断言）。除样条崩溃那一行（会杀进程，按第 5 节只留记录）外，表中每一行都能在测试里找到同名用例。

## 3. 六条根因

### R1 截面没落在脊柱起点坐标系

`pipe` / `sweep` / `sweepAdvanced` 都不会把截面搬到脊柱起点：内核 `MakePipe` / `MakePipeShell` 只按调用方给的位置扫。截面留在原点而脊柱从 (0,0,90) 沿 +Y 出发时，四个变体的实测是：

| 变体 | 体积 | 位置 |
|---|---|---|
| `pipe` | 守卫拦下 | 完全不搬 |
| `withContact` 单独 | 守卫拦下 | 只滑到贴住脊柱，不转正 |
| `withCorrection` 单独 | 正确 | 转了但没搬，管留在原点 y[-50,0] |
| 两者合用 | 正确 | y[0,50] z[90,102]，唯一正解 |

这条根因不只是「位置错」：截面不垂直于起点切向时，扫掠体会被拉斜，体积偏差随拐角变浅而变小，于是又被 R5 的守卫放过。折线 16 段的落位/未落位对比（0.9996 vs 0.9425）就是这一条的量化。

### R2 G0 脊柱沿用内核默认的 `Transformed`

`transitionMode` 的默认值是内核的 `Transformed`，它在 G0（有折角）脊柱上的语义是「截面只平移不旋转」，产物是压扁的平移体：折线 4 段 0.6366、16 段 0.6671、90° 折角 0.5000。同一几何换成 `rightCorner`（斜接）就是 0.9936 / 0.9996 / 1.0000。内核本来会斜接，是默认值让它退化。

### R3 混合边类型 + 截面未落位：单次扫掠只给 A×(弧长 − 腿长)

弧 + 同向直腿（真 G1、无折返、边序与方向都正确）在**截面停在原点**（不在脊柱起点）时交给单次扫掠，体积是 A×(弧长 − 腿长)：腿长 10 → 645.56（0.2220），腿长 5 → 1211.04。把同一条脊柱的截面落位后，*同一次*扫掠就是精确的 2907.50（`sweep-kernel-behavior.test.ts` K9：`sweepAdvanced({ autoPlace: true })`），逐段扫（`sweepAlong` 的 `segments`）同样精确。所以缺的是落位（R1），不是内核在混合边类型上的符号能力。

即便如此 `sweepAlong` 对「混合边类型 + 全 G1」仍选 `segments`：逐段扫没有未经验证的假设（每段都是单一曲线），而单次扫在这类脊柱上只验证过 K9 那一种落位路径。

### R4 带孔截面只取外环（已修）

`toProfileWireView` 只返回外环，带孔 face 被扫成实心棒。内核 `pipe(face)` 原生接受带孔 face（净面积×长度，精确），`sweepPipeShell(face)` 则直接拒收（`BRepFill_Section: bad shape type of section`）。已在 `toProfileRingsView` + 逐环扫 + `cut` 修好，记录在 `test/api/sweep-hollow-pipe.test.ts` F1/F3。

### R5 体积是唯一判据

15° 折角时截面全程没转，几何完全错误，但体积只偏 1.70%，5% 守卫静默放行。体积是标量，无法区分「截面转了、料对了」和「截面没转、净位移凑巧接近」。

### R6 没有脊柱预检

断裂（相邻边端点不重合）、折返（转角接近 180°）、退化（零长边）三种脊柱都没有前置检查。折返最危险：实测 180° 折返时第二段整条落在第一段管体内部，`intersect` 等于第二段全部、`cut` 等于第一段减第二段，于是 `union` 返回第一段是**正确**结果，但用户看到的是「union 吃掉了一块」。这类脊柱必须前置拒绝，不能靠后置判据猜。

## 4. 被推翻的三条旧结论

| 旧结论 | 实测 | 真实原因 |
|---|---|---|
| 相切「弧 + 直腿」丢 85.5% | 那条测试脊柱的直腿接在弧的**起点**上（弧的自然走向是 (0,-10,10)→(0,-20,0)），是折返而非相切 | 几何本身错，不是扫掠丢料 |
| `withContact` 对真弧无效 | `withContact + withCorrection` 合用有效（位置与体积都对） | 单个开关各管一半，缺一不可 |
| `union` 会静默吞掉一个实体 | 共面同向接缝 union = 两块相加（2261.95，4 面）；正交相交落在 (max, sum) 之间；折返时 `intersect` = 第二段全部 | 折返脊柱的包含关系，union 行为正确 |

这三条旧结论在 `sweep-kernel-behavior.test.ts` 里都留了防回退断言（K1c、K5、K7），并且钉的是「当前错误值」与「应有正确值」两个数。

## 5. 能力边界

| 能力 | OCCT | 绑定层暴露 | faijs 现状 | 结论 |
|---|---|---|---|---|
| 任意三维曲线作脊柱 | 完备 | `sweepFull` / `sweepPipeShell` / `MakePipe` | 三条路径都在 | 够用 |
| 多边 wire（同类型） | 完备 | 同上 | 正确（1.0000） | 够用 |
| 多边 wire（混合类型） | 完备 | 落位缺失时算错（R3） | 落位后精确；`segments` 为已验证路线 | 逐段扫 |
| G0 斜接 / 圆角过渡 | 完备 | `transitionMode` | 有入口，默认值错（R2） | 改默认 |
| 截面落位（contact + correction） | 完备 | `withContact` / `withCorrection` | 未组合成开关（R1） | 补开关 |
| 闭合脊柱 | 支持 | 同 sweepFull | 环面体积 = 面积 × 周长（K8a） | 实现为 `closed` 策略 |
| 变截面（多次 `Add`） | 支持 | 未暴露 | 无 | 不在本方案 |
| 缩放律 / 引导线 / 支撑面 | 完备 | 已暴露 | `sweepAdvanced` 有 | 保持 |
| 插值样条脊柱 | 支持 | 扫掠时 wasm 进程崩溃 | 无保护 | 前置拒绝 + 上游报告 |

## 6. 设计

### 6.1 分层

```
src/api/internal/spine-analysis.ts   脊柱事实（纯几何，不扫掠）
src/api/internal/sweep-strategy.ts   事实 → 策略（纯函数）
src/api/solid-offset/index.ts        sweepAlong：策略执行器 + 孔环 cut
src/api/internal/sweep-guard.ts      判据套件 C1–C4
```

每一层只回答一个问题：脊柱长什么样、该怎么扫、扫出来的东西是否可信。判据不依赖执行细节，执行不依赖判据阈值。

### 6.2 脊柱事实（`spine-analysis.ts`）

```ts
interface SpineEdgeFacts {
  kind: 'line' | 'arc' | 'other'
  start: Vec3; end: Vec3
  tStart: Vec3; tEnd: Vec3        // 单位切向
  length: number
  radius?: number                 // kind === 'arc'
}
interface SpineCorner { index: number; point: Vec3; turn: number }   // 弧度
interface SpineFacts {
  edges: SpineEdgeFacts[]
  totalLength: number
  closed: boolean
  gaps: { index: number; dist: number }[]
  corners: SpineCorner[]          // 只收 G0 节点（turn > 1e-3）
  maxTurn: number
  fold: boolean                   // 任一 turn > 175°
  mixed: boolean                  // 边类型不止一种
  degenerate: number[]            // length < 1e-9 的边下标
}
```

判定口径与依据：

| 项 | 口径 | 依据 |
|---|---|---|
| 断裂 | 相邻边端点距离 > 1e-6 × totalLength | OCCT 顶点合并精度就是 1e-7 量级，取相对量避免大零件误判 |
| G0 / G1 | 转角 > 1e-3 rad（0.057°）记 G0 | 1e-3 rad 下斜接与过渡的几何差别已不可见，但 `Transformed` 的退化仍在 |
| 折返 | 转角 > 175° | 实测 180° 折返产出自交实体且 union 退化为包含（R6） |
| 退化 | 边长 < 1e-9 | 零长边让 `curveTangent` 无定义 |

实现只用既有 L1 接口，不新增内核能力：`getSubShapes(wire,'edge')` → 每条边 `curveType`（line / circle / bspline …）、`curveParameters`、`curvePointAtParam(first·last)`、`curveTangent(first·last)`、`getLength`。半径只在 `curveType === 'circle'` 时用三点圆拟合（start / 中点 / end）算出来，仅用于错误信息与 6.3 的密集锐角判定，不参与任何几何构造。

### 6.3 策略（`sweep-strategy.ts`）

```ts
type SweepStrategy = 'single' | 'miter' | 'segments' | 'closed'
function selectStrategy(f: SpineFacts, opts): { strategy: SweepStrategy } | { reject: OpError }
```

| 脊柱事实 | 策略 | 内核调用 | 实测保证 |
|---|---|---|---|
| 单边（直线 / 弧） | `single` | `sweepFull` + `frenet` + 落位 | 1.0000 |
| 多边、同类型、全 G1 | `single` | 同上 | 1.0000（弧×2 实测） |
| 多边、全直线（含 G0 折角） | `miter` | `sweepFull` + `frenet` + `rightCorner` + 落位 | 0.9936（4 拐角）/ 0.9996（16 拐角） |
| 多边、混合类型、全 G1 | `segments` | 逐段 `pipe` + 共面接缝 `fuse` | 1.0000（混合 G1 实测） |
| 多边、混合类型、有 G0 | 拒绝 | — | `E_SPINE_MIXED_CORNER` |
| 闭合 | `closed` | `sweepFull` + 首尾 `fuse` | 实施时先补探针再定 |
| 有断裂 / 折返 / 退化 | 拒绝 | — | 见 6.2 |

单边样条（B 样条）也能扫（3 点小曲率实测正常），但「过密采样点的高曲率插值样条」会让 wasm 进程崩溃，属第 5 节的绑定层边界：策略层不把它当默认可选路径，也不做静默降级。

`opts.strategy` 可强制覆盖；默认 `'auto'`。策略是显式的、可解释的：`segments` 在折线上只有 0.88–0.90（逐段圆管的接缝留下 V 形缺口），`miter` 才接近解析值，所以「全直线折线」必须走斜接而不是沿用旧的逐段 union。

拒绝时错误信息必须给出可执行修法，而不是只说「不支持」：混合类型 + G0 的提示是「把这个角拆成两段各自 G1 的路径，或改用单一类型的脊柱（真弧优于采样折线）」；断裂给两端的坐标与距离；折返给转角与拐点坐标。

### 6.4 截面落位（`autoPlace`）

判定：算截面 bbox 中心到脊柱起点的距离 d、截面平面法向 n、脊柱起点切向 t。
- d ≤ 1e-6 × 截面 bbox 对角线 且 |dot(n, t)| ≥ cos(1°) ⇒ 已落位，**不动**（避免二次变换引入误差）；
- 否则 `withContact: true, withCorrection: true` 交给内核落位；
- 截面不是平面 / 不是闭合环 ⇒ `E_SECTION_NOT_PLANAR` / `E_SECTION_OPEN`。

`autoPlace` 默认 `true`（`sweepAlong`）、默认 `false`（`sweepAdvanced`，保持既有行为）。`sweepAdvanced` 在体积判据失败时于消息里追加一条落位提示（距离与夹角），把「为什么不对」直接说出来。

### 6.5 API 契约（`cad.sweepAlong`）

```ts
cad.sweepAlong(profile: Shape, spine: Shape, opts?: SweepAlongOptions): Shape
```

```ts
interface SweepAlongOptions {
  strategy?: 'auto' | 'single' | 'miter' | 'segments'   // 默认 'auto'（见 6.3）
  autoPlace?: boolean                                   // 默认 true（见 6.4）
  orientation?: 'frenet' | 'fixed' | 'fixedUp'          // 默认 'frenet'
  transitionMode?: 'rightCorner' | 'roundCorner' | 'transformed'  // 仅 miter 生效，默认 'rightCorner'
  volumeTolerance?: number                              // (0,1)，默认 0.05；只影响 C1
  strict?: boolean                                      // 默认 true；false 时 C2/C3 降为 runtime notice
}
```

契约要点：

- **输入**：`profile` 可以是 wire / edge / face（face 的全部环都参与，外环扫实体、孔环 cut 出内腔）；`spine` 必须是单条 wire（多段由内部按 6.2 分析）。
- **输出**：solid（`kind:'solid'`），水密；`segments` 策略下接缝已 fuse 成单块。
- **幂等**：同一输入重复调用得到同一体积（判据常量化，不含随机采样）。
- **确定性失败**：6.9 的每个错误码只对应一种根因，不做「失败后静默换个策略」——策略由脊柱事实决定，切换必须显式给 `strategy`。
- **命名**：`naming: { kind:'kernel', newFaces:{ via:'byAdjacency' } }`，与 `union` / `sweep` 同口径。
- **保留拒绝**：`closed: true` 在闭合脊柱探针通过前继续以专用错误码拒绝（探针见 P1 验收）。

### 6.6 执行器

- `single` / `miter`：一次 `sweepFull`，`orientation:'frenet'`，`transitionMode` 由策略定；截面按 6.4 落位。
- `segments`：逐段读起点与切向 → 12 元仿射矩阵摆正截面 → `makeFace` → `pipe` → 孔环 `cut` → 与累积体 `fuse`。该策略只在全 G1 上启用（6.3），接缝必然是共面同向端面，实测合并成单块、4 面、体积精确；G0 接缝的 V 形缺口不进这条路径。
- `closed`：`sweepFull` 一次成形，首尾接缝 `fuse` 收口；实施前必须先跑探针确认内核在闭合脊柱上的行为（见 7 的 P1 验收）。

落位矩阵与逐段策略沿用现有 `pipeAlong` 的实现（`solid-offset/index.ts` 的 `sectionFrameMatrix`），不重写。

### 6.7 判据套件（替换单一体积判据）

| 判据 | 内容 | 抓什么 | 为什么别的判据抓不住 |
|---|---|---|---|
| C1 体积 | 期望 = 截面积 × 脊柱长度；容差按策略：`single` 1%、`miter` 1.5%、`segments` 按「全 G1 必须 ≥ 99%，含 G0 允许 ≥ 85%」 | 丢料、符号错、段丢失 | — |
| C2 端面法向 | 起点/终点的平面端面法向与对应切向 \|dot\| ≥ cos(1°) | 截面没转（塌陷）、落位错 | 15° 折角体积只偏 1.7%，C1 放行；C2 直接给出 0.966 |
| C3 bbox 包含 | `bbox(result) ⊇ bbox(spine)` | 整段丢失、产物被截断 | 只做廉价的粗筛，不承担主要判据 |
| C4 前置 | 6.2 的断裂 / 折返 / 退化 / 混合 + G0 | 自交、退化、语义无解 | 后置判据在自交几何上没有稳定读数 |

C2 的实现路径：遍历结果的全部面 → `uvBounds` 取中点 → `surfaceNormal` → `shapeOrientation` 为 reversed 时取反 → 在平面面里找 bbox 含脊柱起点/终点的那个 → 与切向比对。两个端面都查；找不到平面端面（如闭合扫掠）时跳过 C2，由 C1 + C3 承担。

阈值取 1° 的理由：落位正确时实测偏差在 1e-7 量级，15° 塌陷的 \|dot\| 是 0.966（差 2.6°），cos(1°) = 0.99985 有充分余量，又不会因数值噪声误报。

### 6.8 旧 op 收敛

| op | 变更 | 理由 |
|---|---|---|
| `sweepAlong`（新） | 唯一完整入口：策略 + 落位 + 孔环 + 判据套件 | 一次调用覆盖全部三维路径 |
| `pipeAlong` | 重命名为 `sweepAlong` | 覆盖任意截面与三种策略，「pipe」这个名字已经把能力说窄了；该 op 尚未发布，重命名不构成破坏（若发布包已含它，则保留 `pipeAlong` 别名一个 minor） |
| `pipe` | 多边或带 G0 折角的脊柱直接拒绝（`E_PIPE_SPINE_UNSUPPORTED`）；单边行为不变 | `MakePipe` 没有过渡入口，这类脊柱只可能长出平板；单边是它的正确用途 |
| `sweep`（L1） | 能力不动；判据换成 C1–C4；错误消息带脊柱事实 | L1 是两内核交集，不能塞 occt 专属选项，但必须把「为什么错」说清 |
| `sweepAdvanced` | `transitionMode` 增加 `'auto'` 并设为默认（G0 → `rightCorner`，G1 → 内核默认）；新增 `autoPlace`（默认 false） | 默认值必须给正确几何，显式给 `'transformed'` 可回到旧行为 |

### 6.9 错误码

| 码 | 触发 | 消息必须包含 |
|---|---|---|
| `E_SPINE_DISCONTINUOUS` | 相邻边端点不重合 | 哪两条边、两端坐标、距离 |
| `E_SPINE_FOLD` | 转角 > 175° | 拐点坐标、转角 |
| `E_SPINE_DEGENERATE` | 零长边 | 边下标 |
| `E_SPINE_MIXED_CORNER` | 混合边类型 + G0 | 建议的两条修法 |
| `E_PIPE_SPINE_UNSUPPORTED` | `pipe` 收到多边或带 G0 折角的脊柱 | 脊柱事实、为什么 `MakePipe` 做不到、指向 `sweepAlong` |
| `E_SWEEP_VOLUME_MISMATCH` | C1 | 期望值、实际值、偏差、脊柱事实（边数 / 拐角数 / 最大转角 / 是否混合） |
| `E_SPINE_MITER_SELF_INTERSECT` | 相邻拐点距离 < 2×截面外接半径（斜接必自交） | 拐点坐标、距离、建议的截面半径或拐点间距 |
| `E_SWEEP_CAP_NORMAL` | C2 | 端点、端面法向、切向、夹角 |
| `E_SWEEP_TOL_INVALID` | 容差越界 | 合法区间 |

## 7. 实施步骤

每一步单独可验收，不合并跑 CI。

**P0 脊柱事实**
新增 `internal/spine-analysis.ts` 与 `test/api/spine-analysis.test.ts`（纯几何，不扫掠）。用例覆盖：单边直线 / 单边弧 / 同类型多边 G1 / 混合多边 G1 / 折线 1·4·16 拐角 / 断裂 / 折返 / 零长边 / 闭合。验收：每类事实的字段值与手算一致，断裂与折返被标出。

**P1 `sweepAlong`（重命名 + 策略 + 落位）**
把 `pipeAlong` 拆成「策略 + 执行器」，新增 `single` / `miter`，保留 `segments`；`autoPlace` 默认 true。验收：`single` 单弧 1.0000、`miter` 折线 4 段 ≥ 0.99、折线 16 段 ≥ 0.995、混合 G1 逐段 1.0000、混合 + G0 报 `E_SPINE_MIXED_CORNER`；闭合脊柱走 `closed`：整圆一次内核扫掠给出环面体积 = 面积 × 周长（`sweep-kernel-behavior.test.ts` K8a、`sweep-hollow-pipe.test.ts` G3），因此 `closed` 是实现出来的策略，不是拒绝。

**P2 判据套件**
C1 按期到策略、C2 端面法向、C3 bbox、C4 前置接入 `sweep` / `sweepAdvanced` / `pipe` / `sweepAlong`。验收：15° 折角现在必须失败（把 K4a 的断言翻转成「必须抛 E_SWEEP_CAP_NORMAL」），30° / 45° / 90° 仍失败，单弧 / 折线斜接 / 混合逐段仍通过。

**P3 旧 op 收敛**
`sweepAdvanced` 的 `transitionMode:'auto'` 默认 + `autoPlace`；`pipe` 拒绝多边；`sweep` 的消息改造。验收：既有 `sweep-loft`、`sweep-revolve-guard`、`occt-s4-solid-offset`、`sweep-hollow-pipe` 全绿，`sweep-mesh-winding` 的两条按其折线脊柱改走 `sweepAlong`（或显式给容差），不允许注释断言。

**P4 文档与手册**
`sweepAlong` 的 JSDoc（含三维路径示例）、`sketchOnPlane` 的落位示例、`docs/api-contract.md` 的扫掠一节、Agent Note（双语 + i18n）。验收：`verify-export-jsdoc`、`verify-script-face-jsdoc`、`verify-agent-note-format`、双语配对全通过。

**P5 端到端与全量回归**
case8 的 `part-along.fai.js` 改用 `sweepAlong`（或确认 `pipeAlong` 别名可用），出 STL 体检；`npm run test -w @faicad/faijs` 全量。验收：见第 9 节。

## 8. 测试计划

| 文件 | 内容 | 关键断言 |
|---|---|---|
| `test/api/spine-analysis.test.ts`（新） | 6.2 的每类事实 | 边数、总长、拐角数、最大转角、混合/折返/断裂标志 |
| `test/api/sweep-along.test.ts`（新，由 `sweep-hollow-pipe.test.ts` 的 G 组迁移） | 三种策略 × 五类脊柱矩阵 | 每格一个解析体积 + bbox；拒绝类断言错误码与消息关键字 |
| `test/api/sweep-kernel-behavior.test.ts`（改） | 分层归因（保留，扩充） | K1c 混合缺陷双值（0.222 / 1.0000）、K6b 落位双值（0.9425 / 0.9996）、K7 union 健康 |
| `test/api/sweep-hollow-pipe.test.ts`（改） | 带孔截面 | 净面积×长度；孔环 cut 后体积不为实心 |
| `test/api/sweep-guard.test.ts`（新） | C1–C4 单点 | 15° 必须失败、1° 阈值内不误报、容差越界报 `E_SWEEP_TOL_INVALID` |
| `packages/tests`（集成） | case8 一次调用 | bbox 90×95×180、体积 34862（BREP）|

规则沿用仓库既有约定：每个缺陷测试同时钉「当前错误值」与「应有正确值」，修复后翻转断言；不写一次性探针脚本；会杀 wasm 进程的用例（插值样条）不进测试套件，只在测试文件头与本文留记录。

## 9. 验收标准

1. `sweepAlong` 在下列脊柱上体积达到解析值：单边直线、单边弧、同类型多边 G1、混合多边 G1（1.0000）；全直线折线 4 / 16 拐角（≥ 0.99 / ≥ 0.995）；三种情况 bbox 与解析外廓一致。
2. 下列输入全部显式失败，错误码与消息符合 6.8：断裂、折返、退化、混合 + G0、`pipe` 多边、15° 折角塌陷（C2）。
3. case8 一次调用：`part-along.stl` bbox 90×95×180、BREP 体积 34862.09、watertight true、非流形边 0，与五段手写版逐项一致。
4. 既有测试无回归：`occt-s4-solid-offset`、`sweep-loft`、`sweep-revolve-guard`、`sweep-hollow-pipe`、`sweep-kernel-behavior`、`validate-solid` 全绿；stderr 零容忍不变。
5. 门禁：API 覆盖（L1 引用 + L2 参数）、`verify-export-jsdoc`、`verify-script-face-jsdoc`、`verify-agent-note-format`、双语配对、eslint、typecheck 全通过。

## 10. 兼容性、风险、回退

| 变更 | 影响面 | 回退方式 |
|---|---|---|
| `sweepAdvanced` 默认 `transitionMode` 变为 `'auto'` | G0 脊柱的脚本输出会变（旧输出是塌陷体） | 显式给 `transitionMode:'transformed'` |
| `pipe` 拒绝多边脊柱 | 现有用 `pipe` 扫多边的脚本会报错 | 改用 `sweepAlong`；单边不受影响 |
| `pipeAlong` → `sweepAlong` | 本会话新增的 op，未发布 | 保留别名一个 minor |
| C2 判据新增失败面 | 原本静默通过的浅折角脚本现在报错 | 给 `volumeTolerance` 不能绕过 C2（有意如此）；要旧几何必须显式 `transitionMode:'transformed'` 且关掉 `strict`（新增开关，默认开） |

风险：
- 密集折线的斜接在极端锐角上可能自交（`roundCorner` 在 16 段上已经直接抛 `Geom_RectangularTrimmedSurface`）。策略侧对「相邻拐点距离 < 2×截面外接半径」的密集锐角直接拒绝（`E_SPINE_MITER_SELF_INTERSECT`），并提示改用真弧路径或加大拐点间距；降级到 `segments` 是错的（G0 接缝会留缺口），不做静默切换。
- C2 依赖平面端面。闭合扫掠与非平面端面（引导线扭曲）跳过 C2，靠 C1 + C3；这类几何要在 Agent Note 里写明判据覆盖不到的部分。

## 11. 不在本范围

- 变截面扫掠（内核 `MakePipeShell::Add` 多次加截面，绑定层未暴露）——需要上游先暴露接口。
- 插值样条脊柱导致的 wasm 进程崩溃——上游缺陷，本方案只做前置拒绝与记录，不绕过。
- 引导线 / 支撑面 / 缩放律的语义扩展——`sweepAdvanced` 已暴露，保持现状。
- drawing 仓库的 faijs 手册片段同步（`sync_faijs_manual.py`）——属 drawing 的发布流程，不在本仓范围。

## 12. 建模侧规则（随文档一起执行）

1. 三维路径优先用真曲线：`circleArc` / `tangentArc` 拼接，不用密采样折线。折线交给 `sweepAlong` 斜接，体积与几何都正确，但形状是多边形管。
2. 不要把 `interpolateWithTangents` 的输出当脊柱（wasm 会崩）；要平滑折线用 `approximatePoints`（实测 1.0000）。
3. 截面默认交给 `autoPlace`，不要手工 `translate` 再猜法向；确实要自定义坐标系时用 `sketchOnPlane({ origin, normal, xAxis })`，并注意只给 `normal` 时 `xAxis` 由内核推导（`normal = [0,1,0]` 会让局部 +X 落到世界 +Z，非对称截面必须显式给 `xAxis`）。
4. 见到 `E_SWEEP_CAP_NORMAL` 不要放宽容差：那是截面没转的几何错误，放宽只会让错误静默。
