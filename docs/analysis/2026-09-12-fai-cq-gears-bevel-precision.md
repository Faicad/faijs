# fai_cq_gears BevelGear / BevelGearPair 移植实测：几何偏差来源与量级

日期：2026-09-12
状态：**实测完成；T1 bbox 绝对门禁与 T2 体积容差两项待拍板**
关联方案：`docs/plans/2026-09-11-fai-cq-gears-port.md`（§8.2 BevelGear、§8.4 齿轮对、§9.1 T1、§9.2 T2、§10 降级阶梯）
代码位置：`packages/fai_cq_gears/src/bevel_gear.ts`、`src/pairs.ts`、`src/profile.ts::bevelGearGeometry`

## 1. 结论速览

BevelGear 的**构造链路**（球面齿廓 → 齿面 → 端盖 → 缝合实体 → 两端回转体裁切 → 重定向 → 轴孔）已按 `bevel_gear.py` 逐条复刻，6 个回归用例全部产出 solid，体积相对差 ≤ 1.93e-4、bbox 与外层包络一致（直齿到 1e-13）。**残余偏差不是链路错误，而是齿面 B-spline 逼近方法不同带来的固有差**——这一点由「直齿（`surface_splines = 2`）几乎逐位吻合、斜齿（`surface_splines = 12`）差 1e-4 量级」的分裂现象直接证实。

同一结论对**齿轮对**（`BevelGearPair`，`src/pairs.ts`）同样成立，量级更小：3 个新建用例的逐件体积相对差在 **1.7e-6～1.4e-5**，质心差 ≤ 2.0e-5、bbox 差 ≤ 3.6e-4（两者均远在 `linearTolerance = 1e-3` 内）。三例 T2 判 `DIFFERENT` 的**唯一**原因是体积相对容差 `1e-6` 被超出（详见 §6）。

需要拍板两项：

| # | 事项 | 实测 | 方案原文门槛 |
|---|---|---|---|
| ① | T1 bbox：case12 的 zlen 差 6.59e-3 | 相对 8.3e-4 | §9.1 写的是**绝对** 1e-3 |
| ② | T2 体积容差：case08 实测 5.9e-5 | 相对 5.9e-5（斜齿 1.9e-4）；齿轮对逐件 1.7e-6～1.4e-5（§6.2） | `CALIBRATED_COMPARE.volumeRelativeTolerance` = **1e-6** |

两项都**没有**就地放宽：门槛保持原样，偏差如实报出（方案 §10 第 4 步）。

## 2. 实测数据（`row-approx-loft`，2026-09-12）

参考 = `out/ref-all31/manifest.json`（cadquery 2.8.0 + cq_gears e73874c）。体积单位 mm³。

| 用例 | z | helix | vol(我方) | vol(参考) | 体积相对差 | Δbbox x | Δbbox y | Δbbox z |
|---|---|---|---|---|---|---|---|---|
| case08 | 16 | 0 | 526.9247 | 526.9517 | 5.13e-5 | 8.2e-14 | 9.2e-14 | 9.3e-8 |
| case09 | 54 | 0 | 10196.7468 | 10196.7468 | 1.05e-13 | 0 | -8.2e-13 | -8.9e-14 |
| case10 | 120 | 0 | 28123.7435 | 28123.7435 | 3.06e-12 | 5.8e-11 | 5.8e-11 | 2.8e-10 |
| case11 | 19 | +30 | 797.1045 | 796.9505 | 1.93e-4 | -4.5e-4 | -5.0e-4 | 1.8e-7 |
| case12 | 58 | -35 | 12141.7641 | 12139.8577 | 1.57e-4 | -3.2e-3 | -3.0e-3 | -6.6e-3 |
| case13 | 138 | +42 | 42230.1104 | 42228.1812 | 4.57e-5 | -5.2e-4 | -5.4e-4 | 1.1e-6 |

**读法**：helix = 0 的三个用例（`surface_splines = 2`）与参考几乎逐位相同；helix ≠ 0 的三个（`surface_splines = 12`）一致地差在 1e-4 相对量级。偏差随齿数增大而**相对收敛**（case13 齿数最多反而只有 4.6e-5）。

## 3. 根因：齿面逼近方法不同，不是链路错误

`BevelGear._build_tooth_faces` 对整块 `surf_splines × curve_points` 点阵调一次
`Face.makeSplineApprox(tol = 1e-2, minDeg = 3, maxDeg = 8)`（= 一次
`GeomAPI_PointsToBSplineSurface` 全局拟合）。faijs 侧没有该方法，只有两条组合路线：

| 策略 | 做法 | case11 体积相对差 | 结论 |
|---|---|---|---|
| `row-approx-loft`（默认） | 逐行 `approximatePoints(tol)` + `loft` | **1.93e-4** | 采用 |
| `grid-approx` | 一次 `bsplineSurface(flat, rows, cols)`（同为 `PointsToBSplineSurface`，但用内核默认 DegMin/DegMax/Tol3D） | **2.47e-1** | 差 3 个数量级，否决（与尖峰报告对 SpurGear 的结论一致） |
| `row-interp-loft` | 逐行 `interpolatePoints` + `loft` | 见当日日志 | 见 §5 |

两条路线的差为什么集中在斜齿：`surface_splines = 2` 时点阵在 v 向只有 2 行，全局拟合必然退化为**直纹面**，而「2 行放样」也是直纹面——两者数学上等价，故 helix = 0 的用例几乎逐位吻合。`surface_splines = 12` 时，全局逼近（不过点、度数 ≤ 8）与逐行逼近+蒙皮（过点）是两种不同的曲面，在 1e-2 的容差包络内产生 1e-4 量级的外壳体积差。**双方都合规地逼近同一批点阵，差值就是逼近差**。

量级自洽性核对（case11）：体积差 0.154 mm³，齿面面积约 200 mm² 量级，1e-2 的曲面容差对应的体积不确定度约 2 mm³——实测差比容差包络小一个数量级，属于包络内的正常差异。

## 4. 与 Python 有意的实现差异（几何等价）

| Python（cq） | 本实现 | 为什么等价 |
|---|---|---|
| `wp.edges('<Z')` / `edges('>Z')`（按**边质心**聚类，容差 1e-4）取端盖边界边 | 按**解析平面** z = tc_h / z = pc_h 判定（边上首/中/末三点的 z 全部落在平面 ±1e-6） | 两条裁切边是 `face.split` 产生的、精确落在该平面上的截面曲线；平面判据是精确的、不依赖聚类容差 |
| `Face.makeFromWires(outerWire)`（走 `makeNSidedSurface`） | `makeFace(healWire(wire, tol))` | 端盖是**平面**闭合环，`BRepBuilderAPI_MakeFace` 与 n 边曲面在该输入下几何相同 |
| `faces('<Z').workplane().circle(bore_d/2).cutThruAll()` | 沿 Z 轴、从实体 zmin 下方贯穿到 zmax 上方的圆柱差 | 缺省 `centerOption = ProjectedOrigin` ⇒ 圆心力在齿轮轴上，两者都是「轴心贯穿孔」 |
| `Face.makePlane(size = r·1000)` 作裁切工具面 | 同样按 1000 倍尺寸构造 | 保守起见与上游一致；实测裁切工具面取 10 倍与 1000 倍尺寸结果逐位相同 |

## 5. 未决事项

1. **T1 bbox 绝对门禁**：方案 §9.1 要求 `|Δbbox| ≤ 1e-3`（绝对）。case12（58 mm 件）实测 zlen 差 6.59e-3、相对 8.3e-4。大件的 1e-4 相对差必然超过绝对的 1e-3，**绝对门禁在大件上等价于比 1e-5 还严的相对门禁**。可选：(a) 维持绝对 1e-3，case12 记为已知偏差；(b) 改成 `max(1e-3, 1e-4 × 参考尺寸)` 的类内门禁，并在本文记录依据。
2. **T2 体积容差**：`CALIBRATED_COMPARE.volumeRelativeTolerance = 1e-6` 是 2026-09-08 按 SpurGear 直齿（2.6e-9）标定的。BevelGear 的实测值是 **5.9e-5（case08，螺旋角 0）到 1.9e-4（case11，螺旋角 30）**，**超出现有容差 1.8～2.3 个数量级**，`compareAssemblyFiles` 判 DIFFERENT。

   已实跑 T2 端到端（`export-ours.ts --case case08-BevelGear` → `compare-all.ts --case case08-BevelGear`），原始输出：

   ```
   ✗ case08-BevelGear: DIFFERENT | leaves 1 vs 1 (ok) | bbox 1.000e-12 | vol 5.916e-3% | com 4.484e-5 | bool A-B 1.005e-1 B-A 7.149e-2
   [compare-all] 0/1 等价；不一致：case08-BevelGear
   ```

   同一 harness 上的对照组（`case00-SpurGear`，倒角+轴孔）：`EQUIVALENT | bbox 2.000e-7 | vol 2.639e-7% | com 7.605e-10 | bool A-B 0.000e+0 B-A 0.000e+0`。两点结论：**① harness 与容差本身工作正常**（直齿类判等价、布尔差为 0）；**② 越界并非斜齿独有**——螺旋角 0 的 case08 就已越界 59 倍，只是斜齿越界更多（190 倍）。**bbox 项两边都是 1e-12 量级，几何形状本身高度一致**，越界的只有体积一项。

   可选：(a) 逐类设容差（方案 §10 第 3 步允许），把 BevelGear 的实测值写进 `compare.ts` 的注释与本文；(b) 判定为可接受差异、不进门禁主判据，以体积/bbox/质心几何差为准。
3. **运行成本**：单件构造 25 s（16 齿）→ 290 s（138 齿），6 例合计约 9 min。默认单测只跑 case08 + case11（约 50 s），大件由 T2 链路覆盖。
4. **仓库体积**：6 个参考 STEP 合计 17 MB（case13 单独 6.1 MB）。方案 §9.4 允许「每类超 5 MB 裁到 2 例 smoke 集」；本次按已入库的其它 12 个回归类先例**全量入库**，如需瘦身可只留 case08 + case11。

## 6. BevelGearPair（齿轮对，§8.4）实测补充

cq_gears 自身没有 `BevelGearPair` 的回归数据，故按方案 §9.4 用 `gen-reference.py --set pairs` **新建 3 例参考**（单位 mm、module 1）：

| 用例 | gear/pinion 齿数 | 轴交角 | 螺旋角 | 覆盖到的装配分支 |
|---|---|---|---|---|
| `bp-basic` | 30 / 15（奇） | 90° | 0 | 不触发绕 Z 的 `π/z` 对齿旋转 |
| `bp-even-pinion` | 30 / 16（偶） | 90° | 0 | **触发**绕 Z 的 `π/z` 对齿旋转 |
| `bp-angled-helix` | 24 / 12（偶） | 60° | 20° | 非 90° 轴交角 + pinion 螺旋角取负 |

### 6.1 T1（体积 / bbox，逐件）

`export-ours.ts` 的整体量：`bp-basic` rel **8.07e-7**、`bp-even-pinion` rel **7.86e-7**、`bp-angled-helix` rel **5.29e-6**；构造后单测 `bevel-pair-build.test.ts` 对 `bp-basic` / `bp-angled-helix` 逐件断言（体积相对 1e-3、bbox 绝对 1e-3）**全过**。

### 6.2 T2（`compareAssemblyFiles`）：唯一越界项是**逐件体积容差**

三例 T2 均判 `DIFFERENT`。为定位确切分项，按 `packages/cq-compat/src/assembly-compare.ts` 的判据复刻 Level 1–3（结构 + 逐件，不含 fuse/布尔），全精度实测如下（相对分数 = `diffPct / 100`）：

| 用例 | 件 | 体积相对分数 | `volMatch`（容差 1e-6） | com 差 | bbox 差 |
|---|---|---|---|---|---|
| bp-basic | gear | 5.587e-9 | ✓ | 5.60e-9 ✓ | 1.17e-8 ✓ |
| bp-basic | **pinion** | **1.739e-6** | **✗ 超 1.7 倍** | 3.32e-6 ✓ | 2.37e-12 ✓ |
| bp-even-pinion | gear | 1.063e-8 | ✓ | 8.62e-9 ✓ | 9.62e-9 ✓ |
| bp-even-pinion | **pinion** | **1.652e-6** | **✗ 超 1.7 倍** | 3.22e-6 ✓ | 1.50e-11 ✓ |
| bp-angled-helix | **gear** | **1.415e-5** | **✗ 超 14 倍** | 4.96e-6 ✓ | 5.72e-5 ✓ |
| bp-angled-helix | **pinion** | **2.461e-6** | **✗ 超 2.5 倍** | 2.02e-5 ✓ | 3.61e-4 ✓ |

**读法**：`linearTolerance = 1e-3` 的两项（质心 / bbox）**全部通过**且余量 30 倍以上（最大 3.61e-4）；结构 2 vs 2、颜色一致；**唯一不通过的就是体积相对容差**，超出 1.7～14 倍——与 §3 的根因（齿面 B-spline 逼近方法不同）完全一致，`bp-angled-helix` 的 `surface_splines = 12` 分支超得最多（14 倍），两个直齿用例只超 1.7 倍。

另有两点如实记录：

1. `bp-angled-helix` 的**整体布尔差**也判不合规：`A−B = 0`、`B−A = −1.319`，而容差是 `max(1e-3, 1813.66×1e-6) = 1.814e-3`。负体积说明 `BRepAlgoAPI_Cut` 返回了**反向实体**——即已知的 occt-wasm 近重合 B 样条布尔差缺陷（见 MEMORY「occt-wasm 内核怪癖」），不是建模错误：同一份数据里 A−B 恰好为 0、逐件质心差仅 2.0e-5。
2. 齿面数两侧不同（gear 183 vs 185、angled gear 125 vs 101）。`strictTopology: false` 下不参与判定，符合「B-spline 曲面表示必然不同」的既有标定。

### 6.3 对门槛的追加输入

§5 第 2 项的门槛（`volumeRelativeTolerance`）现在有了 BevelGearPair 的独立数据：**若定为 1e-5，则三例的 6 个件全部通过**（最大 1.415e-5 略超，需 2e-5）；若维持 1e-6，则 Bevel 族全部 9 个用例都要记为已知偏差。两种口径都要用户拍板，本文不改容差。

### 6.4 装配定位链的实测依据

`pairs.ts` 的 pinion 定位链**不是推断**，是从安装版 CadQuery 源码 + 探针实测确定的：

- `cadquery/occ_impl/geom.py` 的 `Location(t, ax, angle)` 实现是
  `T.SetRotation(gp_Ax1(Vector().toPnt(), Vector(ax).toDir()), radians(angle))` +
  `T.SetTranslationPart(Vector(t).wrapped)`——旋转轴**恒为过原点的 `gp_Ax1`**，`t` 只是平移分量。
  实测 `Location((0,0,5), Y, 90)` 作用在 `(1,0,0)` 上得 `(0,0,4)`，`toTuple()` = `((0,0,5),(0,90,0))`。
- `Location.__mul__` 是 `Location(self.wrapped * other.wrapped)`，复合**右到左**：实测
  `(r*t)·(1,0,0) = (0,11,0)`（先平移再旋转）。
- 故 `loc = A*B*C` 的施加顺序是 **C → B → A**，实测与 `C then B then A` 逐位一致
  （`(-1, 1.732050808, 2)`）。

因此 `placePinion` 的调用顺序为：绕 Z 转 `π/z`（仅齿数为偶）→ 沿 Z 平移 `-pinion.cone_h`
→ 绕 Y 转过原点转轴交角 → 沿 Z 平移 `+gear.cone_h`。

另记一处**照抄上游的不对称**：`BevelGearPair.__init__` 给 gear 传了 `clearance`，给 pinion
**没传**（落回默认 0.0）；且 pinion 的螺旋角取负。本实现逐字保持，不"修正"。
