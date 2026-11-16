# Agent Note：扫掠公开面收敛为 `sweep` + `sweepRaw`（含三引擎能力实测）

Status: implemented

2026-11-16。承接 `2026-11-16-pipe-along-multi-segment-sweep.zh.md`（四段式扫掠）与本次
「API 合并 + 引擎探测」两步。

## 问题

仓里有四条扫掠路径，名字各说各的，差别全在**内核**而不在用户意图：

| 旧符号 | 内核入口 | 定义域 |
|---|---|---|
| `cad.pipe` | occt `MakePipe` | 单边 / 同类型 G1；face 截面 → 实体，wire/edge → 壳；**无控制面、无落位** |
| `cad.sweep` | L1 中立（occt `sweepPipeShell` / brepkit NURBS / smlib 平面路径） | 只取外环（孔丢失）、无落位 |
| `cad.sweepAdvanced` | occt `sweepFull` 全套控制面 | law / auxSpine / support / withContact… |
| `cad.sweepAlong` | 策略执行器（事实→策略→执行→判据） | 真正的「按意图干活」那条 |

同一个「截面沿中心线扫出管」的意图，用户从名字里看不出该选谁。仓库内也没有任何脚本用
`pipe`（只有 3 个测试 + 文档示例）⇒ 删除零能力损失。

## 决策（用户 2026-11-16 批准，明确「不需要兼容性」）

公开面只留**两个**：

- `cad.sweep(section, spine, SweepOptions{strategy, autoPlace, volumeTolerance, strict})`
  —— 唯一入口：脊柱事实 → 策略（single / miter / segments / closed）→ 执行 → C1/C2/C3。
- `cad.sweepRaw(profile, spine, SweepRawOptions)` —— 内核控制面逃生口（原 `sweepAdvanced`）。

删掉 `cad.pipe`（定义域 = `sweep` 的 `single` 策略；带孔 face 由逐环扫 + `cut` 覆盖，
`MakePipe` 裸管线留在 `sweepRaw({ mode:'simple' })`），删掉 `cad.sweepAlong`（并入
`sweep`），`sweepAdvanced` 改名 `sweepRaw`。**不留兼容别名**。

## 引擎能力矩阵（全部实测，不是静态推断）

`packages/core/test/api/sweep-engines.test.ts`：同脚本三引擎实跑，4×4 截面。

| 用例 | occt | smlib | brepkit |
|---|---|---|---|
| S1 直线 25（截面在起点） | 400 | 400 | 400 |
| S2 截面在 z=0、脊柱 z=90..140（autoPlace） | 800 | 800 | 800 |
| S4 两段共线 G1 | 400 | 400 | 400 |
| S5 L 形 90° 折角（miter） | 320 | `E_SWEEP_ENGINE_CAP` | `E_SWEEP_ENGINE_CAP` |
| S6 带孔截面（8/4） | 3015.93 | 3015.93 | 体积对（3015.93）但 C1 面积读数失真 ⇒ 判据误报 |
| K1 内核级：平面真弧 r=10/90° | — | 251.33（= 面积×弧长） | — |
| K2 内核级：闭合整圆 r=10 | 1005.31 | 1005.31（= 面积×周长） | — |

由此定表（`sweep.ts#STRATEGIES_BY_ENGINE`，引擎能力的唯一判定点）：

| 引擎 | single | miter | segments | closed | C2 |
|---|---|---|---|---|---|
| occt | ✔ | ✔ | ✔ | ✔ | ✔ |
| smlib | ✔ | ✘ | ✘ | ✔ | ✘（`shapeOrientation` unsupported） |
| brepkit | ✔ | ✘ | ✘ | ✘ | ✘ |

## 三个只有实测才会暴露的事实

1. **smlib 内核自己就把截面搬到路径起点**（`SmApiCreateSweepAlongPlanarPath` 的
   `moveProfile=true`）：叠加我们的 autoPlace **不会搬两次**，S2 与 occt 同为 800。
2. **smlib 吃多边路径 / 闭合路径 / 带孔截面**（S4 / K2 / S6 全部与 occt 一致）。当时的结论
   是「缺转角过渡（miter）与真弧脊柱」⇒ `closed` 开放、`miter`/`segments` 暂关。
   **该结论在当日晚些的 P0 探针里被推翻一半**，见文末「第二轮：尽量支持 smlib」。
3. **brepkit 的 `shapeType` 只区分 SOLID / FACE / COMPOUND**（`brepkitKernel.ts:1478`），wire
   一律报 COMPOUND。所以脊柱判据不能用类型字符串，必须用**结构**判（有 `edge`、且没有
   `face`）——否则 brepkit 上所有合法脊柱都会被误杀成 `E_SWEEP_SPINE_NOT_WIRE`。

## 顺带发现并修掉的两个缺陷

- 单独一条 **edge 截面**（`cad.circleArc` 的输出）直送内核 → occt
  `BRepFill_Section: bad shape type of section`。现在在 `sweepRingsOnce` 里把 edge 包成 wire，
  产物是**实体**（旧 `pipe` 的「edge → 壳」口径随 `pipe` 一起消失）。
- 折线脊柱（16/40 段近似弧）不再需要「靠体积守卫事后报警」：策略层选 `miter` 后体积精确
  （A2b/A5 实测），`strategy:'single'` 仍能复现旧的 2/π 偏差（A2 保留为守卫用例）。

## 未解决 / 需要后续

- `docs/ops-api-inventory.md(.zh.md)` **无法重生成**：生成器 `scripts/gen-ops-api-inventory.ts`
  已 deprecated，且当前因「逐 op 章节集 ≠ 符号表 op 集（171 vs 172，缺 `validateSolid`）」直接
  抛错（与本改动无关的既有缺口）。本次按生成器口径**手工同步**了 pipe / sweep / sweepRaw
  三章、op 清单与命名表；补上 `validateSolid` 章节后应重新生成一次并丢弃手工差异。
- `smlib` 上 `cad.circleArc` 没有实现 ⇒ 弧脊柱（`single` 真弧、`segments`）在 op 级不可达。
  **已在第二轮补上**（`circleArc` / `edge` 走 L1 中立路径，`engines: ['occt','smlib']`）。
- brepkit 带孔 face 的 `getSurfaceArea` 读不出净面积（读到 16，真值 150.8）。brepkit 是即将
  放弃的旧内核，不修；用例钉住现状（删 brepkit 时一并删）。

## 验证

```
npx vitest run test/api/sweep-engines.test.ts test/api/sweep-along.test.ts \
  test/api/sweep-guard.test.ts test/api/sweep-kernel-behavior.test.ts \
  test/api/sweep-hollow-pipe.test.ts test/api/sweep-loft.test.ts \
  test/api/sweep-revolve-guard.test.ts test/api/occt-s4-solid-offset.test.ts \
  test/brep/engine/engine-switch-smlib.test.ts \
  test/brep/engine/multi-engine-op-parity.test.ts test/api/occt-s4-c4-disposition.test.ts
```
11 文件 / 156 用例全绿；`npx tsc --noEmit` 无 sweep 相关错误（55 条既有错误全在
`test/probe-revolve-*` / `revolve-degenerate` / `smlib-kernel/circular-pattern-step`）；
`check-api-test-coverage --package=core`（baseline 已重生成）通过。


## 第二轮：尽量支持 smlib（P0 天花板探针 + 放宽能力表）

用户要求「至少支持 occt/smlib（smlib 是未来必需内核）」，于是先量 smlib 内核的真实天花板，
再按实测放宽 `STRATEGIES_BY_ENGINE`。全部数字都来自 `test/api/sweep-engines.test.ts` 的
`P0a–P0i`（内核级）与 `S1–S9`（op 级）。

### P0 内核级实测（4×4 截面，`squareFace`）

| 探针 | 脊柱 | 结果 |
|---|---|---|
| P0a | 空间 3D 样条（4 控制点，出平面） | V=570.705 = 16 × 35.669 ⇒ **空间 G1 也成立**（入口名虽叫 AlongPlanarPath） |
| P0b | 真弧 r=10 90° + 相切直腿（一条 wire 两类边） | V=411.327 = 16 × 25.708 ⇒ 混合边 G1 一次扫掠就够 |
| P0c | 圆 **wire** 截面（非 face） | V=314.159 = 4π × 25，type=SOLID ⇒ wire 截面产实体 |
| P0d | 带孔 face + 闭合圆路径 | V=4021.230 = **64** × 62.83 ⇒ 孔环被内核忽略（净面积应 51.43） |
| P0e | 螺旋线（pitch 10 / h 20 / r 8） | V=1639.964 = 16 × 102.498 ⇒ 空间脊柱成立 |
| P0f | 平面 L 折角（G0，路径长 20） | V=320.000 **精确** ⇒ 内核自己就是斜接，不是塌陷 |
| P0g | 同上，几何细查 | bbox x=[-2,10] z=[0,12]、faces=8、manifold=true ⇒ 角料不多不少 |
| P0h | 逐段扫 + fuse（弧段 251.327 + 直段 160） | fused=411.327 ⇒ segments 的等价执行成立 |
| P0i | **空间** G0 折角（z 段 + 斜向段） | V=**0**、manifold=**false** ⇒ 内核吐退化碎片 |

三条修正掉的旧判断：
1. `miter` **可以**给 smlib —— 平面 G0 折角实测精确（320）；
2. `segments` **可以**给 smlib —— 逐段扫 + fuse 实测与一次扫一致；
3. `addHolesInFace` 的孔环在内核里**没有**被扫掠识别（旧推断「孔会被识别」是错的），
   所以 `sweepRingsOnce` 的逐环 + `cut` 是唯一正确路径（S6 的 3015.93 由此而来）。

### 改了什么

- `api/sweep.ts`：`STRATEGIES_BY_ENGINE.smlib = ['single','miter','segments','closed']`；
  新增 **smlib 专属前置拒绝**：`strategy === 'miter' && !facts.planar` → `E_SWEEP_ENGINE_CAP`
  （消息点明「空间 G0 折角会扫出 V=0/非流形，去 occt 或让脊柱共面 / 换真弧」）；
  `capsAvailable` 扩到 smlib（C2 端面法向在 smlib 上恢复生效）。
- `api/internal/spine-analysis.ts`：新增 `SpineFacts.planar`（每个面/边采样点做共面判定；
  `line` 取两端、`arc` 取三点、`other` 取 5 点 —— 单条空间样条只取 3 点会被误判为共面），
  `SpineEdgeFacts` 增加 `mid` / `samples`，`describeSpine` 输出 `non-planar`。
- `api/internal/sweep-guard.ts`：`shapeOrientation` 查询单独 try/catch —— 读不到朝向的引擎
  （smlib）不再整面跳过。C2 判的是 `|dot|`，符号无关，所以不实现朝向也能判。
- `api/curve-sketch/index.ts`：`circleArc` / `edge` 改走 L1 中立路径
  （`makeCircleArc` / `makeLineEdge`），`engines: ['occt','smlib']`。
- `smlib-kernel/smlibKernel.ts`：
  ① `makeCircleArc` 入参按 L1 契约当**弧度**（旧实现当度，`0..2π` 会被解释成 0..360° 之外的
  离谱跨度；`engine-switch-smlib` 的内核探针因此改成弧度写法）；
  ② `meshShape` 对 Curve / Edge 句柄短路返回空网格（否则 `cad.circleArc` 的产物在
  `solidToShape` 里 `smw_tessellate` 报 `not a live solid id`）。
- 文档：`docs/ops-api-inventory.md(.zh.md)` 的 `circleArc` / `edge` 注记改为「中立 op」，
  `wireFromEdges` 的「至少 2 条」改为「至少 1 条（2026-11-14 放宽）」。

### 新出现的已知差异（未修，记录在案）

`cad.circleArc([0,0,10],[0,1,0],10,0,90)` 在 occt 上从 (0,0,0) 走到 (10,0,10)
（`Geom_TrimmedCurve` 的反向裁剪），在 smlib 上从 (10,0,10) 走到 (0,0,0)。**弧本身几何相同、
方向相反**：单边脊柱（S8）两边都给 251.33，但拼「弧 + 相切直腿」时腿必须按各引擎自己的
终点接（`S9` 因此拆成 `S9_SMLIB` 一份；occt 侧不在此用例里量，segments 在 occt 上由
`sweep-along` 的真弧用例覆盖）。`spine-analysis` 用 `curveParameters` first→last 定走向，
对「反向裁剪」的边会把切向读反 —— 这是既有的 occt 语义细节，改成读 `shapeOrientation`
才能根治，属独立改动。

### 验证（第二轮）

```
npx vitest run test/api/sweep-engines.test.ts test/api/sweep-along.test.ts \
  test/api/sweep-guard.test.ts test/api/sweep-revolve-guard.test.ts \
  test/api/sweep-loft.test.ts test/api/sweep-hollow-pipe.test.ts \
  test/api/sweep-kernel-behavior.test.ts        # 7 文件 / 139 用例
npx vitest run test/api/wire-from-edges.test.ts \
  test/brep/engine/engine-switch-smlib.test.ts \
  test/api/occt-s4-curve-sketch.test.ts test/api/occt-s4-curve-sketch-contract.test.ts   # 4 文件 / 50 用例
```
全部绿；`npx tsc --noEmit` 无本次改动相关错误（30 条既有错误全在 `test/probe-revolve-*` /
`test/api/revolve-degenerate.test.ts` / `test/smlib-kernel/circular-pattern-step.test.ts`）；
`npx tsx scripts/check-api-test-coverage.ts --package=core` 通过（L1 183 / L2 93 baseline 未变）。
顺带修了 `wire-from-edges.test.ts` 一条**过期断言**（单边自 2026-11-14 起合法，不再报 TOO_FEW）。

### 附：空间 G0 折角「策略层自补」的可行性已实测（P0j / P0k）

- **P0j（朴素做法不够）**：逐段扫后直接 `fuse`，平面 90° 折角 V=**304.000**、空间 90°
  V=**305.373**（精确值 320）。缺的 16 mm³ 正是两段在转角处的重叠（x∈[0,2]、z∈[8,10]、
  y∈[-2,2]）——`fuse` 把重叠吞掉，外侧没有斜接补料。**体积只差 5%，正好压在 C1 默认容差
  界上，所以不能靠守卫兜底**；形状（外侧 V 缺口 + 内侧尖角）也不是想要的。
- **P0k（自补配方成立）**：每段在转角端过量延伸 δ=2.5，再用转角**角平分面**
  （法向 = 两条单位切向之和）把过量部分切掉、各留自己一侧，最后 `fuse`：
  平面 90° V=**320.000**、faces=**8**（与内核自己那次 miter 的面数完全一致）；
  空间 90° V=**319.988**、manifold=true、faces=**19**（接缝没并成单一平面，是待压的余量）。
  只用到了 `makeLineEdge` / `sweep` / `splitByPlane` / `fuse`，不需要内核的 transitionMode。
- 两条结论都已断言化（`P0j` 钉住 304/305.373，`P0k` 钉住 320/319.988 与平面 8 面）。

## 第三轮：空间 G0 折角的斜接已在策略层实装（smlib 与 occt 同值）

上一轮 P0k 只证明了「配方可行」，这一轮把它接进了 `api/sweep.ts`。

### 实现

- `planMiterJoints(facts, radius)`：每个 G0 折角算出**角平分面法向**
  `n = t̂_prev + t̂_next` 与延伸量 `delta = 1.05 × 半宽 × tan(θ/2)`（必须略大于斜接面在
  段轴上截出的 `extent`，否则 `splitByPlane` 只"擦过"而不真切）。延伸量再受
  `0.98 × min(相邻两段长)` 约束；**延伸会越过相邻折点**时抛
  `E_SPINE_MITER_SELF_INTERSECT`（造不出来的折角不静默产残件）。
- `sweepWithBuiltJoints(...)`：逐段扫（直线段延长同一条线；弧/样条在端点沿切向接一小段
  直线，误差 O(δ²/2R)）→ 每段用 `splitByPlane` 在折角处只留自己一侧（探针点用该段参数
  中点，必然落在自己一侧）→ `fuse` 依次合并。截面的逐段落位复用 `sectionPlacementMatrix`
  （落位到**延伸后的起点**），孔环仍走 `sweepRingsOnce` 的逐环扫 + `cut`。
- 接线：`strategy === 'miter' && engineId !== 'occt'` 走自补路径；**平面**折角在 smlib 上
  仍走内核（更便宜、面数更少、本来精确）。`assertEngineCan` 里那条 smlib 空间折角的
  `E_SWEEP_ENGINE_CAP` 删除 —— 现在不再拒绝，而是造出来。

### 实测（`test/api/sweep-engines.test.ts`）

| 用例 | 结果 |
|---|---|
| S7 空间折角（3 段 / 2 处折角，长 30） | smlib **480.0000000**（16×30），与 occt 同值；此前是 `E_SWEEP_ENGINE_CAP` |
| S10 显式 `{strategy:'miter'}` | **480.0000000**（覆写同样走自补，不回退内核） |
| S11 `strict` 缺省（C2 端面法向 + C3 bbox） | 通过 —— 自补体的端面法向与 bbox 判据成立 |
| S5 平面折角 | 仍 **320**，smlib 走内核斜接（未改路径） |
| P0i 内核单次扫掠 | 仍 V=0 / 非流形（钉住内核边界，作为"为什么必须自补"的对照） |

### 已知边界（记录在案，未做）

- **强制 `strategy:'segments'` 且脊柱带 G0 折角**仍在「逐段扫 + 直接 fuse」，会留 V 缺口
  （occt 侧 `sweep-along.test.ts` R5 把这个错值钉在 0.85–0.93）。自补配方目前只接在
  `miter` 上；要让 `segments` 也正确，把同一个 `sweepWithBuiltJoints` 接过去即可（
  但 `miter` 与 `segments` 的语义会合并，需另行决定是否保留 `segments` 这个词）。
- 弧段带折角的脊柱走不到这条路径：`mixed + corner` 在策略层已被
  `E_SPINE_MIXED_CORNER` 拒绝，所以实际生效的全是直线折角；弧段延伸逻辑留着是给将来
  放开混合折角用的。
- 空间折角的 fuse 接缝没有完全并成单一平面（P0k 内核级 faces=19），体积精确、C2/C3 通过，
  但面数比 occt 多 —— 属于可以后续压的质量余量。

## 第四轮：合并「逐段」执行器 —— `segments` 也吃 G0 折角，`E_SPINE_MIXED_CORNER` 摘除

### 为什么合并

原来有两条几乎重复的逐段代码：`segments` 分支（逐段扫 + 直接 fuse，只在全 G1）与
`sweepWithBuiltJoints`（逐段扫 + 过量延伸 + 角平分面裁 + fuse）。差别只有一处：接缝裁不裁。

合并后只剩一个执行器：**脊柱拆段 → 每段单扫 → 按折角计划裁接缝（计划可能为空）→ 依次 fuse**。
`planMiterJoints` 在没有 G0 折角时返回空表 ⇒ δ=0、不切 ⇒ 与原 `segments` 逐位等价。

### 实测（合并后的行为变化）

| 用例 | 合并前 | 合并后 |
|---|---|---|
| 强制 `segments` + 16 段折线（occt） | 0.8801（V 缺口钉桩） | **0.9996**，与 `miter` **完全相同** |
| 强制 `segments` + 4 段折线（occt） | 0.8968 | **0.9936**，与 `miter` 完全相同 |
| 混合边 + G0 折角（弧尾 90° 折直腿，occt） | `E_SPINE_MIXED_CORNER` | **411.33 × 1.0046**（+0.46%） |
| 混合边 + G0 折角（smlib，平面 / 空间各一） | `E_SPINE_MIXED_CORNER` | `E_SWEEP_ENGINE_CAP`（布尔限制，见下） |

结论：在纯直线折线上 `segments` 与 `miter` 现在**数值完全相同**（0.9936 / 0.9996），
差别只剩「内核一次扫 vs 逐段 + 裁缝」的实现与成本。

### 代码改动

- `api/sweep.ts`：删掉 `segments` 分支，条件合并成
  `strategy === 'segments' || (strategy === 'miter' && engineId !== 'occt')`；
  新增 smlib 专属门禁 `smlib && facts.mixed && corners > 0` → `E_SWEEP_ENGINE_CAP`；
  文件头能力表、`SweepOptions.strategy`、`@throws`（`E_SPINE_MIXED_CORNER` 标为已废弃）同步。
- `api/internal/sweep-strategy.ts`：折角判定提到混合判定之前；`mixed + corners`
  从 `E_SPINE_MIXED_CORNER` 改为 `segments`（理由写进 reason 串）；文件头事实表同步。

### 为什么 smlib 上「混合边 + 折角」还要拒

实测（弧尾 90° 折直腿，4×4 截面）：
- 弧段过量延伸后 `splitByPlane` 交回的**自己那一半是空的**（V=0）—— 平面版拿到 160
  （只剩直腿），空间版 `fuse` 直接报 `smw_fuse: boolean failed`；
- 同一个球在 occt 上是好的（1.0046），所以这不是策略/几何问题，是 smlib 布尔对
  「被切过的曲面扫掠体」的边界。
⇒ 显式拒绝并写清原因，绝不产 160 这种残件。

### 顺带更新 / 转正的测试

- `sweep-along.test.ts`：原 R2（混合+折角拒绝）→ **S8**（现在能扫，实测 +0.46%）；
  原 R5（强制 segments = 0.89 错值）→ **S9**（0.9996）；R5 位置换成「折角太密 →
  `E_SPINE_MITER_SELF_INTERSECT`」这条**新的**硬边界（截面半径 4、相邻段 1.414）。
- `sweep-kernel-behavior.test.ts`：K6d 从「segments 0.88–0.90 < miter 0.99+」改成
  「两者同量级（poly4 0.9936 / poly16 0.9996，逐位相同）」。
- `sweep-engines.test.ts`：新增 S12a/S12b（smlib 混合+折角 → `E_SWEEP_ENGINE_CAP`，
  含 `boolean failed` 证据串）。

### 已知遗留（下一轮可做）

1. **弧段延伸的残差 +0.46%**：现在是「沿端点切向接一小段直段」（O(δ²/2R)）。根治要把弧段
   延伸改成**沿同一圆续弧**（用 `facts.radius` + 端点切向重建 `makeCircleArc` 的扩展弧），
   这样 occt 的混合+折角可到 1.0000；顺带也可能让 smlib 的布尔不再崩。
2. smlib 混合+折角要真正支持，得绕开 `splitByPlane`+`fuse` 这条链（例如先把弧段续弧再切，
   或用 `sectionByPlane` + 手工封端），属于独立课题。

### 验证（第四轮）

```
13 文件 / 209 用例全绿
（sweep-engines 38 / sweep-along 15 / sweep-kernel-behavior 28 / spine-analysis /
 wire-from-edges 50 批次内 / engine-switch-smlib / curve-sketch ×2 / multi-engine-op-parity）
npx tsc --noEmit → 30 条既有错误（全在 revolve 探针与 circular-pattern-step），本次文件零错误
npx tsx scripts/check-api-test-coverage.ts --package=core → 通过（L1 183 / L2 93 baseline 未变）
```