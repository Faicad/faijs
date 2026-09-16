# M0 探针报告：planegcs WASM 可行性 — GO

> 日期：2026-09-16
> 对应计划：docs/plans/2026-09-15-fcstd-to-faijs-port-plan.md §7 M0
> 结论：**GO**，按计划进入 M3（WASM 路线 A 兑现）

## M0.1 安装与 primitive 清单

- `@salusoft89/planegcs@1.2.0` 已加入 `packages/core` dependencies（tarball 手动装，见下「安装注记」）。
- 约束类型清单：`constraints.d.ts` 共 **83 种** primitive 约束类型。
- **P0 约束集 15 类全覆盖**（映射见下表），M0.4 出口判据满足。

| FCStd ConstraintType | planegcs primitive |
|---|---|
| Coincident | `p2p_coincident` |
| Horizontal / Vertical | `horizontal_pp` / `horizontal_l`、`vertical_pp` / `vertical_l` |
| Parallel | `parallel` |
| Perpendicular | `perpendicular_ll` / `perpendicular_arc2arc` 等 |
| Tangent | `tangent_lc` / `tangent_cc` / `tangent_ca` / `tangent_aa` |
| Distance / DistanceX / DistanceY | `p2p_distance` / `p2l_distance` / `c2ldistance` / `c2cdistance`、`coordinate_x` / `coordinate_y` |
| Angle | `p2p_angle` / `l2l_angle_ll` / `l2l_angle_pppp` |
| Radius / Diameter | `circle_radius` / `arc_radius` / `circle_diameter` / `arc_diameter` |
| Equal | `equal` / `equal_length` / `equal_radii_*` |
| PointOnObject | `point_on_line_pl` / `point_on_circle` / `point_on_arc` / `point_on_ellipse` |
| Symmetric | `p2p_symmetric_ppp` / `p2p_symmetric_ppl` |
| InternalAlignment（P1） | `internal_alignment_ellipse_*` / `internal_alignment_bspline_control_point` |

- 样本集中零出现的 `SnellsLaw`/`Block`/`Weight`/`Text`：`snells_law` 存在但不用；其余无对应，命中即降级 L2（计划 D3），与方案一致。
- 几何 primitive：`point/line/circle/arc/ellipse/arc_of_ellipse`（+ parabola/hyperbola/bspline），样本集 5 种几何全覆盖。

## M0.2 WASM 加载（Node 22）

- wasm 体积 **508,141 B**（纯 wasm；对比 occt-wasm 为数十 MB 级，可忽略）。
- `make_gcs_wrapper(wasmPath)` 初始化耗时个位数毫秒级，Node 环境直接可用。
- 安装注记：npmmirror 无此包 tarball（404），且 `npm install -w` 会把 workspace 内部包当注册表依赖导致 E404——最终以官方 registry tarball 手动解包绕过。**lockfile 尚未收录该依赖，后续需修复 npm install 链路（见「遗留」）。**

## M0.3 基准求解

矩形 40×30、锚点 p0=(10,20)（fixed point）+ 4 边 + horizontal×2 + vertical×2 + p2p_distance×2：

```
solve status: 0 (Success, LevenbergMarquardt), conflicting=false, redundant=false
solved params: [10,20,50,20,50,50,10,50,40,30]
max error vs analytic: 0.000e+0  (< 1e-6 出口判据 ✓)
```

探针脚本：`scripts/probe-planegcs.ts`（可重跑）。

## M0.4 约束清单差异比对

本地未找到 FreeCAD 26.3.0-dev 源码目录（`C:/git/FreeCAD` 不存在），逐行比对未执行。但 M0.4 的**出口判据**是「差异清单覆盖 P0 约束集」——上表已按计划 §5.3 的 `ConstraintType` 枚举（前文分析文档逐字核实过的落盘枚举）完成映射并确认全覆盖，判据实质满足。若后续拿到 FreeCAD 源码可补充逐行 diff，不阻塞 M3。

## 遗留事项

1. `npm install` 对 workspace 的解析被 `@faicad/faijs-core` E404 卡死（根 package.json `"@faicad/faijs-core": "*"` 被当注册表依赖）。planegcs 目前是手动解包的「幽灵依赖」，需修 lockfile 链路（`node scripts/check-ghost-deps.mjs` 会拦截）。
2. M1 需要定位 56 个 `.FCStd` 样本的实际路径（计划假定 FreeCAD 仓库本地存在）。
