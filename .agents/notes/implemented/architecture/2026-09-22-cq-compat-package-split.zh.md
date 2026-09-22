# Agent Note：cq-compat 按域拆包

状态：已实施

English | [中文](2026-09-22-cq-compat-package-split.md)

## 问题

`@faicad/cq-compat` 把 CadQuery 兼容面（Workplane API、2D 绘图、体素、特征、选择器、变换、齿轮内核）与装配层、STEP/装配 compare 工具（以及规划中的 2D 草图域）捆在一个包里。`fai_cq_gears`、`fai_cq_warehouse` 等消费方即使只需要其中一个域，也要背负整个兼容面；而 compare 工具（仅开发用）却随运行时包一起发布。

## 决策

把 cq-compat 拆成「兼容主包 + 域包」，主包保留完整的 CadQuery 兼容主体：

- `@faicad/cq-compat`（0.13.2）——保留兼容主体：workplane / 2D 绘图 / 体素 / 特征 / 选择器 / 变换 / 齿轮内核。移除装配与 compare 导出；re-export `asBrepShape`、`resolveFaceSelector`（装配层需要的内部符号）。
- `@faicad/cq-compat-assembly`（0.1.0）——装配兼容层：`buildAssembly` 返回 `CqAssembly` 对象；`solve()` 幂等并封装 core global 求解器；`toCompound()` 产出求解后 compound；`save()` 走 node:fs 且不进 browser 入口。消费方只允许用 CadQuery 语法（`constraint` / `buildAssembly` / `solve()` / `toCompound()`），禁止触碰 core 内部。
- `@faicad/cq-compat-compare`（0.1.0）——dev-only 几何等价性比较器（STEP 与装配 compare）。禁止出现在任何包运行时依赖链里，只允许开发脚本与测试导入。
- `@faicad/cq-compat-sketch`（0.1.0）——2D 约束草图域骨架（镜像 CadQuery sketch.py / occ_impl/sketch_solver.py 边界）；当前为 `export {}` + Phase-2 计划，按路线图填充。

`fai_cq_gears` 运行时冻结：依赖声明与 `src/` 零改动；唯一例外是 dev 侧 compare import 改指 `cq-compat-compare`。`fai_cq_warehouse` 运行时无 cq-compat 依赖；其 dev 侧 compare import 迁至新包。`3d_editor` 不在迁移范围（它直用 core `cad.assembly` 语法，无 `@faicad/cq-compat` import）。

mini_lathe（外部项目）装配脚本迁移至 `@faicad/cq-compat-assembly` 语法：`cqa.constraint` / `cqa.buildAssembly` / `asm.solve()` / `asm.toCompound()`，并使用独立本地名 `cqa` 规避 `cq` 的 autoLoadLibsFromImports 首见冲突。

## 备选方案（未采纳）

- 把主包瘦成齿轮最小面（v2 布局）：用户否决——「cq-compat的含义是cadquery兼容。你都去掉了，还谈什么兼容」——兼容主体必须完整保留，只拆装配与 2D 草图。
- compare 留在 cq-compat 内：用户否决——开发工具必须独立成包，库消费方不背负。
- 提供 `@faicad/cq-compat-all` 聚合包：用户否决——不做聚合包。
- mini_lathe 继续用 core `cad.assembly` 语法：用户否决——既然用 CadQuery 语法，就必须走封装底层求解器的 CadQuery `solve()` API，禁止直调 core。

## 影响

- 根 workspaces 扩至 11 项并强制顺序（core → compare → cq-compat → assembly → sketch → gears → warehouse → sheetmetal → fixtures → tests → demo）；`check-workspaces-order` 强制。
- cq-compat 131 测试、cq-compat-assembly 21、cq-compat-compare 2、packages/tests 1653+parity 12、mini_lathe 7 通过 2 跳过（e2e 数值段需 cadquery python 参考文件）全绿。
- faijs 借用视图生命周期与执行上下文绑定：用 `outputs` 读出的形状在 TS 侧重建装配会得到 dead 成员视图。测试因此改为「脚本端到端 + 语法面守卫（禁直调 core 求解器）」，不做 TS 侧重建；GOTCHA 已留档于 mini_lathe 测试注释。
- npm 发布计划已同步新增包与拓扑；版本维持 0.1.0（新包）/ 0.13.2（cq-compat），到发布升版本步骤统一处理。
- 既有红点原样保留并单独汇报（均非本次引入）：core typecheck（place-calibration.test.ts:90、feature-translate.test.ts:266/882）、lint（import-brep.test.ts:13、import-brep.ts:59、evolution-declaration.test.ts:86、convert.ts:26）、gears stability 8 例、warehouse params 哈希。