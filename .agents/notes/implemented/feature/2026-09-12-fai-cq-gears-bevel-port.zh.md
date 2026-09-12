# Agent Note: fai_cq_gears 移植 BevelGear（球面渐开线齿面 + 平面裁切端面）

Status: implemented

[English](2026-09-12-fai-cq-gears-bevel-port.md) | 中文

## Problem

`fai_cq_gears` 此前已移植 cq_gears 九个单体齿类中的八个（SpurGear、HerringboneGear、RingGear、HerringboneRingGear、CrossedHelicalGear、RackGear、HerringboneRackGear、Worm）。只剩 BevelGear，而它是唯一一个齿面不在圆柱面上的类：齿廓是**球面渐开线**，端面来自用两个 `z = const` 平面裁切一块双曲率 B-spline 面片，背锥与顶锥再由**回转体**布尔差成形。上游 31 条回归用例中有 6 条（`case08`–`case13`，16–138 齿，螺旋角 0/±30–42°）覆盖它，是参考集中最大的一块未移植内容。

## Decision

把 BevelGear 移植进 `fai_cq_gears` 既有的 v1 裸内核路径，逐条对照 `bevel_gear.py::BevelGear`：

- **数学** —— `src/profile.ts` 的 `bevelGearGeometry()` 计算锥角（`gamma_p/b/f/r`）、大球半径 `gs_r = rp/sin(gamma_p)`、扭转角，以及**画在单位球面上**的四段齿廓点集。配套助手（`sphereToCartesian`、`sInv`、`sArc`、`angleBetween`）移入 `src/math.ts`，作为 `utils.py` 的逐字移植。与 Python 参考数组实测：6 例最大坐标偏差 3.1e-15。
- **实体** —— `src/bevel_gear.ts` 构造四块齿面（单位球面齿廓 × 每站位行的锥距 → `buildSplineFace`），用 `kernel.split` 在 `z = tc_h`（保留 `zmax` 最大的片段）与 `z = pc_h`（保留 `zmax` 最小的片段）各裁一次，绕 Z 复制 `z` 份，两端加盖面，再 `sew` → `makeSolid` → `fixFaceOrientations`，减去两个回转体裁切体（`_trim_bottom`/`_trim_top`），把齿轮重定向到背锥面上，最后打轴孔。
- **齿面策略** —— 采用 `row-approx-loft`（本包默认）。备选的 `grid-approx`——即 CadQuery `Face.makeSplineApprox` 所调的 `GeomAPI_PointsToBSplineSurface` 同族——在 `case11-BevelGear` 上实测体积相对差 **2.47e-1**，而 `row-approx-loft` 是 `1.93e-4`，故按实测否决，与 SpurGear 尖峰报告的结论一致。
- **两处有意的实现替换**，均与 Python 原版几何等价：端盖边界边改用**解析平面判据**（边上的采样点全部落在 `z = tc_h` / `z = pc_h` 的 ±1e-6 内）选取，而不是 CadQuery 的 `edges('<Z')` / `edges('>Z')` 质心极值选择器及其 1e-4 聚类容差；轴孔改用沿轴向、跨越该实体自身 z 区间的贯穿圆柱，而不是 `faces('<Z').workplane().circle(bore_d/2).cutThruAll()`（缺省 `ProjectedOrigin` 圆心选项把圆心放在齿轮轴上，两者是同一个孔）。
- **参考数据** —— `case08`–`case13` 已连同 STEP 文件并入 `fixtures/reference/manifest.json`（现 35 条），使 T1（`volume`/`bbox`）与 T2（`compareAssemblyFiles`）都覆盖到该类。

## Alternatives considered

- **齿面用 `grid-approx`（一次全局 B-spline 拟合，`Face.makeSplineApprox` 最接近的对应物）。** 否决：`case11` 实测体积相对差 2.47e-1，比 `row-approx-loft` 差三个数量级。occt-wasm 的 `bsplineSurface` 不暴露 DegMin/DegMax/Tol3D，只能按内核默认值运行，对双曲率锥齿面拟合很差。
- **照搬 CadQuery 的 `edges('<Z')` 选择器**（按质心聚类，容差 1e-4）。否决：两条裁切边由 `face.split` 产生、精确落在各自平面上，解析平面判据既更简单又精确；质心启发式只会多引入一个并不需要的容差旋钮。
- **再用平面裁切一次端盖面来代替布尔差。** 否决：`_trim_bottom`/`_trim_top` 是用**回转曲面**穿过齿面裁切的（它们成形的是背锥），不是平面，`split` 表达不了。
- **直接复用 `features.ts::applyBore`。** 否决：该助手把 `[0, width]` 这个区间写死给直齿族实体；锥齿实体在打孔前已被重定向，所以轴孔改为从实体自身的 bbox 推导。

## Consequences

- `case08`–`case13` 全部构造出有效 solid。与 CadQuery 参考实测：**体积相对差 ≤ 1.93e-4**（case08 5.1e-5、case09 1.0e-13、case10 3.1e-12、case11 1.9e-4、case12 1.6e-4、case13 4.6e-5），**bbox 绝对差 ≤ 6.6e-3 mm**（case12 的 `zlen`，相对 8.3e-4；其余五例在 1e-13…5.4e-4）。包内测试套件覆盖 `case08`（螺旋角 0）与 `case11`（螺旋角 30）这两条 `surface_splines` 分支，约 50 s；大件由 T2 导出/比对链路覆盖。
- 残余偏差是**跨内核的曲面逼近差**，不是移植错误，证据是结构性的：`surface_splines = 2` 时 CadQuery 的全局拟合与我们的两行放样都退化为直纹面，结果吻合到 1e-13；`surface_splines = 12` 时两种逼近发散出 ~1e-4 的包围体积差——仍远在双方都被允许的 1e-2 曲面容差包络之内。逐例表格与包络算术见 `docs/analysis/2026-09-12-fai-cq-gears-bevel-precision.md`。
- T2 已对 `case08` 跑通端到端：`export-ours.ts` 后 `compare-all.ts` 报 `DIFFERENT | bbox 1.000e-12 | vol 5.916e-3% | com 4.484e-5`。同一 harness 上的对照组 `case00-SpurGear` 报 `EQUIVALENT | bbox 2.000e-7 | vol 2.639e-7% | com 7.605e-10 | bool A-B 0`，说明 harness 与容差本身工作正常——超出预算的只有体积一项。
- 因此有两项门槛**保持原样上报而非放宽**：T1 的 bbox 绝对 `1e-3` 门禁被 `case12` 超出（一个 58 mm 的件，其 1e-4 相对差必然大于 1e-3 绝对值），T2 的 `volumeRelativeTolerance = 1e-6`——按直齿 2.6e-9 标定的——被**每一个** Bevel 用例超出：直齿的 `case08` 超 59 倍，斜齿最多超 190 倍。（超预算的只有体积项；`bbox` 两侧都吻合到 1e-12。）两者都需要定夺：是加逐类容差（移植计划的降级阶梯允许，依据已记录在分析文档中），还是改以几何差为主判据。
- 成本与体量：单件构造 25 s（16 齿）到 290 s（138 齿）；6 个入库参考 STEP 给仓库增加 17 MB（移植计划允许把某类裁到两例 smoke 集，如果倾向如此）。
- 在包内验证过：`npx tsc --noEmit` 与 `npx eslint src` 均干净。顺带修掉 `src/features.ts` 与 `src/worm_gear.ts` 里 4 个**既存**的 lint 错误（两个 `prefer-const`、两个未用导入）——因为 pre-commit 钩子只 lint staged 文件，把它们放过去了。
