# Agent Note：fai_cq_warehouse W5 螺钉 —— `Edge.Center()` 是圆弧质心、`fillet2D` 的圆弧邻边要精确解、螺旋外螺纹上 GProps 求积混叠

状态：已落地

[English](2026-09-14-fai-cq-warehouse-screw-geometry.md) | 中文

## 问题

`@faicad/fai-cq-warehouse` 是把 `cq_warehouse`（CadQuery 库）移植到 TypeScript。W5 是螺钉族（12 类）。每类的造法是：在 XZ 平面画头型轮廓 → 旋转 → 与「拉伸出的 plan（六角头用六边形）」或「plan 减驱动槽」求交 → 视类融合法兰轮廓 → 最后并上杆部和可选的真实螺旋螺纹。过程中暴露三个坑，后两个相对 W3/W4 是新的：

1. **cq 的 `edges(">Z")` / `vertices(">X")` 排序键是 `Edge.Center()`，而对圆边它就是「圆弧质心」，不是圆心。** `RaisedCounterSunkOvalHeadScrew` 用 `profile.toPending().edges(">Z").vertices(">X").vals()` 选圆角落点。它的椭圆顶弧（r = 12）**圆心**在 z = `−9.165350`，而**质心**在 z = `2.386`。把圆心当排序键会选错边，圆角会倒到轴线角点上，几何完全错。其余边的最大 `Edge.Center()` z 只有 `1.4173`（`vLineTo` 中点）/`≤1.5`（直线边），谁也赢不过——前提是你得把弧的键算成质心。
2. **`Wire.fillet2D(radius, vertices)` 不能把圆弧邻边近似成它的弦。** 闭式 `t = r/tan(θ/2)` 只在**两条邻边都是直线**时精确。在 RCOS 的「椭圆弧 → 锥面母线」角上，它给出一个**落在弧外**的点：实测 `|p1 − 圆心| = 12.000988` 而 `rf = 12`，`p1.x = 5.363082` 而 cadquery 给 `5.361036`——误差 `2.0e-3`，是顶点锁容差的 400 倍。精确解就是圆角圆心的构造：两条距离约束（直线 `(C − a)·n = r`；圆 `|C − Q| = R ∓ r`），弧侧切点 = `Q + R·unit(C − Q)`。
3. **螺旋外螺纹会让 `BRepGProp` 求积混叠，而且一阶矩比体积差一个量级。** `screw-shcs-m6-iso4762-threaded`（`simple=false`，杆长 25）在同一 occt-wasm 内核上测得两侧 GProps 体积相对差 `4.149e-4`、GProps 质心差 `5.472e-2` mm——但**每一侧都与自己的三角化对不上**：A 侧差 `1.221e-2` mm，B 侧差 `5.779e-2` mm（B 侧 y 分量 GProps 给 `−0.055304`、三角化给 `+0.002484`）。与 W3/W4 同根，但因螺纹段长达约 20 mm 而放大一个量级。

## 决定

### `edgeCenter` 复刻圆弧的 `Edge.Center()`

`screw.ts` 用 `centre + (2R·sin(Δ/2)/Δ)·unit(弧中点方向)`（Δ = 有向张角）实现 `edgeCenter(seg)`，`>Z` / `>X` 选择器建在它之上。`screw.test.ts` 的回归锁钉住 RCOS 的数字（三点外接圆圆心 z = `−9.165350`、弧质心 z = `2.386`，并断言质心同时胜过 `vLineTo` 中点 `1.4173` 与弧自身的端点）。

### `filletAt` 走精确解

`filletAt(prev, next, r)` 现在接收两个**段**（不再只收切向），因此能判断邻边类型：

| 情形 | 构造 |
|---|---|
| 直线 + 直线 | 经典 `t = r/tan(θ/2)` —— 保持逐位不变，已对 `csk-m6-iso10642` 复验（`t = 0.597511` → 裁剪点 `5.402489` vs A 侧 `5.402482`） |
| 直线 + 圆弧、圆弧 + 直线 | 把直线参数化为 `C = a + s·d + r·n`（n = 料内侧单位法向，取侧由角平分线初值 `C₀ = corner + bis·r/sin(θ/2)` 判定），代入 `\|C − Q\| = R ∓ r` 得 s 的二次式；取垂足离角点更近的根；弧侧切点 = `Q + R·unit(C − Q)` |
| 圆弧 + 圆弧 | W5 不可达 —— 抛错 |
| 任一边是样条 | 抛错（上游从不倒样条角） |

圆角弧的中点取 `C + r·unit(corner − C)`；在两直线角上它退化为旧的 `C − bis·r`。

### 头型与派生量逐字移植，包括怪癖

12 个 `head_profile` / `head_plan` / `flange_profile` / `countersink_profile` 钩子逐行复刻。两处上游怪癖**故意保留并用测试锁死**：

- `CheeseHeadScrew` 写 `polarLine(k / cos(degrees(5)), 5 - 90)`。`math.degrees(5)` = `286.4789` 被当**弧度**喂给 `cos`，得 `−0.8287276` → **负长度** `−1.20648k`；配上 `−85°` 方向，几何上等价于沿 5° 内倾母线**向上**走。「修正」成 `cos(radians(5))` 会把端点放到 `(5.341, −3.9)`，而不是 `y = 4.688102`。上游公式按 `Math.cos((5 * 180) / Math.PI)` 照抄。
- `SetScrew` 无头（`custom_make`）：上游是 `circle(min_radius).polygon(6, e).extrude(t).faces(">Z").workplane().circle(min_radius).extrude(length−t).mirror()`。这里把 wire 嵌套成孔会失败，故用等价实现 `cut(cylinderBetween(min_radius, −length, 0), hexPrism(e, −t, 0))`；体积逐位吻合（A 侧 `200.625411`）。

`buildScrew` 同时返回上游的派生量集合：`headHeight`、`headDiameter`、`maxThreadLength`、`threadLength`、`socketClearance`、`headOffset`、`minHoleDepth`、`minHoleDepthStraight`。

### 一条逐例容差 override，配反向守卫

`compare.ts` 只加一条 W5 条目，`match: /^screw-shcs-m6-iso4762-threaded$/`，`volumeRelativeTolerance: 2e-3`（= 实测 `4.149e-4` × 4.8）、`linearTolerance: 2e-1`（= 实测 `5.472e-2` × 3.7），与 W3 线程族（×4.4）、W4 螺纹螺母（×4.37）同政策。`linearTolerance` 放得宽，是因为该量在这个量级上本身就是噪声（它自身的自偏差就有 `5.8e-2` mm）；几何等价由网格收敛独立证明。其余 27 例在**全局**默认 `1e-6` 下即等价，未动。

## 证据

| 项 | 指标 | 值 |
|---|---|---|
| spine 用例 `screw-shcs-m6-iso4762`（光杆） | A 侧体积 | `900.6842796` —— 与 B 侧完全一致 |
| 短对照：同类 `simple=true` | 体积 / 质心差 | `1.010e-15` 相对 / `5.135e-11` mm |
| 螺纹例，网格收敛 | 三角化体积相对差 | 弦高 `2e-3` → `2.133e-4`；`8e-4` → `5.818e-6`（**↓37×**） |
| 螺纹例，网格收敛 | 三角化质心差 | 弦高 `2e-3` → `1.554e-3` mm；`8e-4` → `4.203e-5` mm（**↓37×**） |
| 螺纹例 | 自偏差（GProps vs 自身三角化） | A `1.221e-2` mm / B `5.779e-2` mm |
| RCOS 圆角 | 弧侧切点 | 精确解 `5.3610355, 1.5705238` vs A 侧 dump `5.361036, 1.570524`；弦近似给 `5.363082` |

STEP 比对：32 个参考用例中 **28 / 28 EQUIVALENT**（另 4 例为下面显式记录的 PH 缺口）。包内测试：`src/screw.test.ts` **70 / 70**，整包 `npx vitest run` **234 / 234**（8 文件）。

完整表格——逐类规格矩阵、RCOS 弧质心选择器表、fillet2D 对照、螺纹例 GProps vs 三角化矩阵、网格收敛扫描、容差四步标定、复现命令——见 `docs/analysis/2026-09-14-cq-warehouse-screw-probe.md`。

## 已知缺口

- **`PanHeadWithCollarScrew`（din967，2 例）与 `RaisedCheeseHeadScrew`（iso7045，2 例）。** 两类的**唯一** `fastener_type` 都是 PH（cross）沉孔，其 30° 锥度切割器在臂宽退化后：cadquery 的 `LocOpe_DPrism` 会续生锥面，而 `draftPrism` 自交并抛 `E_RECESS_TAPER_UNSUPPORTED`（见 `recess.ts` 文件头）。4 个 manifest 用例全部断言抛错，且**头型轮廓仍被逐顶点锁住**——缺口只在 recess。
- **还有四个头驱动槽已实现但 W5 用不到。** 与 W4 的 D1 同款情形：驱动槽是给螺钉头的，W5 只用到了七个里的三个（`slot`、hexalobular、cross）。剩下的一律保持未覆盖，不做近似。

## 考虑过的替代方案

- **把圆心当 `>Z` 的键**（直觉读法）。否决：实测 `−9.165350` vs 质心 `2.386`，质心才是选对的那个。把错值锁进测试会让整个 RCOS 类都错，而且错的形态仍是一个看着合理的实体。
- **保留弦近似，改成放宽顶点容差。** 直接否决：`2.0e-3` 正是被测的误差，「修法」等于停止测量。精确解十行代码，与 cadquery 六位全等。
- **移植时顺手「修正」`degrees(5)` 的单位 bug。** 否决：端点会跑到 `(5.341, −3.9)`，即不再与参考一致。这是上游行为，测试同时断言「修正版」会给出错值。
- **放宽全局 `volumeRelativeTolerance` 以覆盖螺纹螺钉。** 否决：为一个测量伪差放宽全部 33 类的闸门；其余 27 个螺钉用例在 `1e-6` 下本来就已经一致。
- **因为 `SetScrew` 没有头就跳过它。** 否决：它是方案要求单列的两类之一（内六角窝是最易错的特征），故实现了 `custom_make` 路径并用体积验证。

## 影响

- `scripts/kernel-screw-probe.ts` 成为永久证据载体（三段：螺纹例 GProps vs 三角化含自偏差、光杆对照、网格收敛扫描）。`scripts/probe-screw-head-profiles.py` 是永久的 A 侧边序列 dumper——两者替代了临时 `_probe-*` 草稿文件。
- 12 类的头型钩子现在被逐顶点锁在 A 侧 dump 上，所以将来改动 `filletAt`、`edgeCenter` 或 `arcCenter` 会立刻红，而不是悄悄把头型挪走。
- **`primitives.filletCorner2D`（W4 沉淀，`recess.ts` 在用）与 `screw.filletAt` 是两份独立的圆角实现，本次只修了后者。** 前者的文档明确限定「**两直线夹角**处」，其唯一调用点喂进去的是显式 12 顶点多边形——所以它当前没有圆弧邻边暴露，故未改。W6/W7 若要在 polygon-wire 语境里给带圆弧邻边的角倒圆，必须先把 `filletCorner2D` 升级，并把两份合并，不得并存（「一个事实一个家」）。
- manifest 增一例（`screw-pancollar-m4-din967`），使 `PanHeadWithCollarScrew` 也有 ≥2 规格；参考集现为 71 例，螺钉子集 32 例。
- `npx tsc --noEmit` 仍报既存的 `packages/cq-compat/src/workplane.ts:4548` 错误（无变化，与本包无关）。本包 `npx eslint src scripts --ext .ts` 干净。
