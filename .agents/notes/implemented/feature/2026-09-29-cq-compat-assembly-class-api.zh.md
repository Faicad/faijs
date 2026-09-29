# Agent Note：cq-compat-assembly 的 CadQuery 装配类式 API

状态：已实现

[English](2026-09-29-cq-compat-assembly-class-api.md) | 中文

## 问题

`@faicad/cq-compat-assembly` 已有 `buildAssembly`/`solve`/`toCompound`/`save`/`constraint`/`constraintEx`，但 `CqAssembly` 接口只暴露 `solve()` 和 `toCompound()` 两个方法。CadQuery 2.8.0 的 `Assembly` 类有 `add`/`addSubshape`/`remove`/`traverse`/`load`/`importStep`/`export`——全部缺失。manifest 有 52 条 blockedBy 理由写「类式 API 无法在 .fai.js 受限子集表达」，该理由已过期：对象方法 + 重新赋值（`let asm2 = asm.add(...)`）在语句模型可用。

## 决策

以**不可变语义**（返回新 `CqAssembly`，非原地改后返回 self）实现缺失方法，有意偏离 CQ 的可变 `add`/`remove`，以适配 `.fai.js` 的显式赋值模型。

- **add/addSubshape/remove**（工作项 A）：`add` 接受 `Shape | {shape, name?, color?}`，生成 `part_<n>` 默认名，重名抛错。`remove` 过滤 dangling 约束（偏离 CQ：faijs `assemblyOp` 构造时验证约束引用必须存在，dangling 约束无法进入 compound）。
- **traverse**（工作项 B）：generator 产出 `[name, assembly]` 对。扁平结构产出单元素；嵌套装配待后续。
- **importStep/load**（工作项 C）：Node 侧 STEP 导入经 `loadBrep` + `fromBrep`，产出单成员装配。`load` 为别名。
- **export**（工作项 D）：复用已有 `save`。
- **manifest**（工作项 E）：52 条过期 blockedBy 理由更新为「API 已实现，待写 parity 镜像」。8 条真实缺口（`constraintEx` 缺 FixedPoint/FixedAxis/PointInPlane）保持原样——与 P0-3 交叉。

## 备选方案

- **可变语义（忠实 CQ）。** `add` 原地改后返回 `this`。否决：`.fai.js` 语句模型用显式 `let asm2 = asm.add(...)`；可变 self-return 会让 `asm` 和 `asm2` 别名同一对象，破坏重新赋值创建新绑定的预期。
- **remove 保留 dangling 约束（忠实 CQ）。** CQ 的 `remove` 不删关联约束（求解器在 `unsupported` 报引用不可达）。否决：faijs `assemblyOp` 构造时验证约束引用——带 dangling 引用的 `buildAssembly` 会抛错。过滤是避免构造时崩溃的唯一方式（除非加 `skipValidate` 逃逸口）。
- **多 solid STEP 拆为多成员。** CQ 的 `importStep` 每个 solid 一个成员。推迟：当前 `loadBrep` 返回单个 compound shape；拆解需 `kernel.getSubShapes`——P0-1 验收不需要。

## 后果

- `CqAssembly` 接口新增 `add`/`addSubshape`/`remove`/`traverse` + `constraints`/`subshapes` 字段；`buildAssembly` 注入全部方法实现。
- 新导出：`CqSubshape`、`AssemblyAddArg` 类型；`importStep`、`load` 函数（Node 侧，在 `save.ts`）。
- 15 个新测试在 `assembly-class-api.test.ts`（A: 8, B: 2, C: 3, Q4 探针: 1, e2e: 1）；全包 36 passed / 5 files。
- 52 条 manifest 条目更新（blockedBy 理由）；8 条保留（真实 `constraintEx` 缺口）。
- `mini_lathe` e2e 仍因既有 `fillet: KERNEL_ERROR` 失败（非本次引入）。