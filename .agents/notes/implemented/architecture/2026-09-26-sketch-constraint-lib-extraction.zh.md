# 草图约束库拆分 —— `cad.sketch` 改名与库边界

**日期**：2026-09-26
**状态**：已实施
**方案**：`docs/plans/2026-09-26-sketch-constraint-lib-plan.md`

## 决策：`cad.sketch` 改名为 `cad.profile`，`sketch` 让给约束库

原 `cad.sketch` op（从原始段组装闭合轮廓构面）改名为 `cad.profile`。`sketch` 名字释放给新包 `@faicad/faijs-sketch` 约束库，其 op 为 `cad.sketch`（求解约束 → 构面）。

**原因**：`sketch` 是约束驱动 2D 设计的用户面词汇。旧 op 名不副实——它不做求解，只是轮廓到面的转换。`profile` 是截面/轮廓的正确跨域术语，用于挤出/旋转/扫掠。

**放弃了什么**：旧 `cad.sketch` 名字。无别名过渡（D6）——所有调用点（3d_editor、.fai.js fixture、测试）在同一变更中同步改。对仍在用 `cad.sketch` 的外部消费者是破坏性改名。

**被否的替代方案**：
- `cad.contour`——与 fcstd 内部 `Contour`/`ContourSeg` 类型同名易混。
- `cad.face2d`——太窄；该 op 还产出 wire。
- 别名过渡（`cad.sketch` → `cad.profile` 带废弃别名）——否决，因为约束库需要立即用 `sketch` 名；过渡期需要两个名字共存。

## 边界：库无 core 深路径特权

`@faicad/faijs-sketch` 只通过 core 的公开导出（`@faicad/faijs/api/profile`、`@faicad/faijs/api/result`、`@faicad/faijs/mesh/types`）消费 core，不深入 `packages/core/src/` 深路径。这与 `@faicad/faijs-extra` 遵循的契约相同。

**原因**：深路径 import 在发布态解析会断——安装的包有 `dist/`，没有 `src/`。npm 安装冒烟测试（`src/install-smoke.test.ts`）是绊线：它打包、装进隔离目录、跑全链路求解。任何深路径 import 会在安装态以 `ERR_MODULE_NOT_FOUND` 失败。

**如何应用**：给草图库加新能力时，只从 `@faicad/faijs/api/*` 或 `@faicad/faijs/mesh/types` 导入。需要的函数若未导出，先从 core 导出——不要深入 `src/`。

## 诊断状态：通过 `gcs.dof()` 检测欠约束

求解状态（`solved` / `underconstrained` / `redundant` / `conflicting` / `failed`）由 planegcs 的 `has_gcs_redundant_constraints()` / `has_gcs_conflicting_constraints()` 与 DoF 探针（`wrapper.gcs.dof()`）组合判定。

**原因**：planegcs 不原生区分"零 DoF 求解"与"有剩余 DoF 求解"——两者都返回 `SolveStatus.Success`。DoF 探针是暴露欠约束状态的唯一手段。没有它，欠约束草图会静默报 `solved`，违反"允许 ≠ 静默"契约（D3）。

**GOTCHA**：canonical 模型中的 `fixed` 约束被投影为空操作（FCStd 无显式固定约束；隐式固定框架覆盖原点/轴）。这意味着用户指定点上的 `fixed` 约束不会在求解器中真正固定该点。依赖 `fixed` 做绝对定位的草图会有剩余 DoF。这是首版已知限制。