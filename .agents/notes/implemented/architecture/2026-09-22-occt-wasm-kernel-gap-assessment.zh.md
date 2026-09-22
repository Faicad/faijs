# Agent Note：occt-wasm 内核缺口评估（CadQuery parity 视角）

Status: implemented

English | [中文](2026-09-22-occt-wasm-kernel-gap-assessment.md)

## 问题

CadQuery parity manifest（`packages/cq-compat/tests/manifest.json`）记录了 328
个 blocked 用例，其中相当比例阻塞在 occt-wasm 内核能力而非 parser 或 API 面缺口。
Phase 4 计划列出四项可疑内核缺口（shell 外扩、负 taper、sweep 多截面、高椭圆），
另有运行态形状编辑（remove/replace）与 fuzzy 布尔。向上游提内核需求前，每项都需
活体探针核实，确保需求清单基于事实而非假设。

## 评估（2026-09-22 探针实证）

- **shell 外扩 + 移除面** — 真缺口。`kernel.shell` 实现 `MakeThickSolid`（移除面 +
  内/外偏移）。向内墙（`shell(h, faces, -t)`）可用，cq-compat 直连；封闭外扩
  （无移除面）用「偏移减原体」近似且已验证。**外扩 + 移除面**组合需要
  `MakeThickSolidByJoin` 的 intersection-join 模式，内核未暴露；cq-compat 的
  `shell()` 对其显式抛错（testSimpleShell__s1/s3 在 tests/mark-blocked.ts 中
  blocked）。
- **负 taper** — API 存在但语义未标定。`kernel.draftPrism(shape, dx, dy, dz,
  angleDeg)` 接受 wire 或 face；对 solid 直接报错（"Solids are not Processed"）。
  探针：`draftPrism(wire, 0,0,10,-10)` 返回负体积；`draftPrism(face)` 对
  10×10×10 棱柱返回 1394（含 taper 期望 ≈1000），dx/dy/dz↔angle 约定与
  CadQuery 的 `LocOpe_DPrism` 角部锥面语义不对应，需标定工作。中优先级。
  **2026-09-23 已解锁（无需内核变更）**：cq-compat `extrude(taper<0)` 改为缝合
  精确 10-face arc-join 体（底 + 偏移 arc-join 顶 + 4 平面侧壁 + 4 圆锥角面，
  `sew`+`makeSolid`+`fixFaceOrientations`），`testTaperedExtrudeHeight__s2`
  `equivalent=true`；draftPrism 仍用于尖角截锥与圆截面（无角部）。
- **sweep 多截面** — 真缺口。`sweepPipeShell(profile, spine, freenet, smooth)`
  与 `sweepOriented(... auxSpine ...)` 存在且单 profile + 可选 guide 可用；
  两者均不接收多个截面 wire，`BRepOffsetAPI_MakePipeShell` 的多截面能力未暴露。
  中优先级。
- **高椭圆（major < minor）** — 真缺口，已硬确认。探针：`makeEllipseEdge(center,
  Z, 2, 4)` 抛 `gp_Elips() - invalid construction parameters`；主轴固定为全局 X
  方向。cq-compat `ellipse()` 已用「宽椭圆绕平面法线旋转 90°」绕过主轴规则
  （对上游 testEdgeTypesFilter 验证通过）。低优先级。
- **附带发现（并非缺口）** — `kernel.offsetWire2D(wire, d, joinType)` 可用
  （rect 1×1 偏移 −0.1 → 0.64，匹配上游 test_modes s5）；平面 2D 面上的
  `fuse/cut/common` 可用（L 形 fuse = 3 面、cut/common = 1 面），支撑 Phase 2
  Sketch 模式；`removeHolesFromFace` 存在可移除孔，但 `remove`/`replace`
  （BRepBuilderAPI_MakeShape 的 shell/面手术）与 fuzzy 布尔（`SetFuzzyValue`）
  仍未暴露 — 真缺口。

## 决策

- 向上游 occt-wasm 提交需求：`MakeThickSolidByJoin` 外扩+join 模式、
  `BRepOffsetAPI_MakePipeShell` 多截面、形状 `remove`/`replace`
  （BRepBuilderAPI_MakeShape）、fuzzy 布尔容差。高椭圆绕过与负 taper 标定探针
  作为后续项，不阻塞。
- 此期间 manifest 为每个 blocked 用例记录内核原因（blockedBy =
  occt-wasm-kernel），缺口清单一次 grep 可见。
- 不引入任何运行时近似；维持既有「显式抛错、禁止静默烘焙」纪律。

## 备选方案

- 用「切偏移板」模拟外扩+join（cq-compat 旧启发式）：拒绝 — 几何与任何上游
  reference 都不匹配（见 shell() 注释），且静默近似违反 parity 纪律。
- TS 侧 2D 布尔多边形裁剪替代 Sketch 模式：拒绝 — 内核面级布尔是精确的且已
  验证。
- 把 `BRepBuilderAPI_MakeShape` 手术用内核原语在 cq-compat 内重实现：暂缓 —
  风险高，覆盖收益仅两个测试函数（test_remove / test_replace）。

## 影响

- 计划四项缺口现在有实测状态：1 真+部分（shell）、1 标定（taper）、1 真
  （multisection）、1 真+绕过（高椭圆）。
- Phase 2 Sketch 复用：offsetWire2D 与面级布尔在此验证，Phase 2 提交中的
  `sketch.ts` 已消费。
- Manifest blocked 原因已内核化；上游需求清单 = 328 个 blocked 原因中剔除
  parser/Sketch/LGPL 类后的差集。
