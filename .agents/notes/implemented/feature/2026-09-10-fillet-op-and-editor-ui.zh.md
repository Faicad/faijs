# Agent Note: BREP-only fillet op（等半径）+ 3d_editor UI

Status: implemented

[English](2026-09-10-fillet-op-and-editor-ui.md) | 中文

## 问题

`cad.*` op 集没有圆角（fillet）。需要圆角的零件无法用 `.fai.js` 表达，3d_editor 宿主也没有圆角工具。与倒角类似，圆角是 BREP-only 操作，但不同于倒角的是，圆角使用 OCCT 的 `*WithHistory` API 获取面演化数据用于 roleTable 传播——确保圆角修改拓扑后，后续特征操作仍能按 role 选面/选边。倒角的 `equal` 路径也同步升级使用 `chamferWithHistory`，获得同样的 roleTable 传播能力。

## 决策

### faijs 引擎（`packages/core`）

- `cad.fillet(part, { edges, radius })` 通过 `defineOp({ capabilities: ['directEdit'], brep })` 在 `api/fillet.ts` 中声明为 BREP-only op，登记到 `cad` 命名空间（`api-namespace.ts`），从 `api/index.ts` 导出，并在 `api/surface/arg-spec.ts` 中列出（`scriptFace: false`，手写 dual-op 遮蔽 vendored 投影）。
- op 调用 `filletWithRoleTable`（`brep/face-evolution.ts`），封装 `kernel.filletWithHistory(solid, edges, radius, inputHashes, bound)` 并将返回的 `BrepEvolutionData` 解码为：
  - 序号键 `FaceEvolution`（供 UI 选择/可视化），
  - hash 键 `HashEvolution`（供 role 传播），
  - 传播后的 `roleTable`（经 `propagateAllOriginsLocal`，结构等价于 `naming/roles.propagateRoles`，但放在本地以避免 `brep/` 与 `topology/naming/` 之间的循环依赖）。
- `face-evolution.ts` 中的 `directEditWithRoleTable` 是 fillet 和 chamfer 共用的单输入 WithHistory 封装；`filletWithRoleTable` 和 `chamferWithRoleTable` 是其便捷别名。
- `chamfer.ts` 的 `equal` 路径从 `kernel.chamfer`（无历史）升级为 `chamferWithRoleTable`，使倒角后的实体也传播 roleTable。
- BREP 引擎接口（`brep/engine/primitives.ts`）新增 `fillet`、`filletVariable`、`filletWithHistory`、`chamferWithHistory` 声明；4 个 topology/naming 测试文件中的 mock 已更新以包含这些方法。
- 错误处理：`assertFilletParams` 校验 `edges`（非空数组，每条目为格式正确的 `EdgeTopoRef`，含 `kind:"edge"` 和两元素 `faces`）和 `radius`（正有限数）；OCCT 失败回译为 `E_FILLET_RADIUS_TOO_LARGE`——绝不静默返回未圆角的原形状。

### 3d_editor 宿主

- `stores/tools/fillet-store.ts`：Zustand store 管理工具激活、半径、边引用、面板位置、撤销（Tier A 字段注册，半径输入用 debounced snapshot）。
- `engine/features/fillet.ts`：Feature 描述符，含 `buildFilletCode`（代码生成）、`filletBackfill`（时间线编辑回填）、`filletCollectArgs`（当前状态转参数）。
- `engine/components/fillet/FilletToolbar.tsx`：工具栏按钮，带 BREP-only 门控（场景中无 BREP 目标时静默）。
- `engine/components/fillet/FilletPanel.tsx`：可拖动面板，含半径输入、边选择状态、错误显示和确定按钮。
- `engine/components/fillet/FilletPreview.tsx`：通过 `ScriptEngine.filletPreview` 实时 BREP 预览，半径/边变化时 debounce 重建。
- `engine/script-engine/ScriptEngine.ts`：`filletPreview` 方法——执行圆角但不提交几何，返回 mesh 供预览绑定。
- `engine/version-store/Command.ts`：`fillet` 加入 `COMMAND_TYPES`。
- `locales/{zh,en}.json`：19 个 fillet UI 的 i18n 键。
- `engine/script-engine/feature-icon-map.tsx`：fillet 图标和颜色映射。

## 备选方案

- **同时声明 mesh fillet。** 否决：圆角几何上是 BREP-only 操作；mesh 回退是假近似。dispatcher 对 mesh-only 输入正确报 `E_MESH_UNSUPPORTED`。
- **用 `kernel.fillet` 不走 WithHistory。** 否决：没有面演化数据，roleTable 传播不可能——圆角后后续特征操作无法按 role 选面/选边。`WithHistory` API 在圆角本身之外零额外内核调用即返回 `BrepEvolutionData`。
- **将 `directEditWithRoleTable` 放在 `topology/naming/`。** 否决：会在 `brep/`（需要调用它）和 `topology/naming/`（拥有 `propagateRoles`）之间创建循环依赖。函数放在 `brep/face-evolution.ts`，用本地实现的 `propagateOriginRoles`，结构等价。
- **M1 支持变半径。** 否决：M1 范围仅等半径；变半径（`filletVariable`）计划在 M2 以单边 + 无 roleTable 降级实现。

## 后果

- `fillet` 现在是正式 op 面：`cad` 命名空间携带 31 个函数（原 30）；`ops-api-inventory.md` 和 `api-contract.md` 已更新。
- `chamfer` 的 `equal` 路径现在也传播 roleTable，修复了倒角后特征操作可能丢失 role 选择的潜在问题。
- 4 个 topology/naming 测试 mock 已更新以包含新的 `BrepEngineApi` 方法（`fillet`、`filletVariable`、`filletWithHistory`、`chamferWithHistory`）。
- 3d_editor lint 修复：3 个文件（`Command.ts`、`features/types.ts`、`stores/core/tool-store.ts`）在文件头部累积了多个 UTF-8 BOM 标记，导致 `no-irregular-whitespace` 错误。

## 验证

- `fillet.test.ts`（10 个测试）：参数校验——合法参数通过；空/缺失 edges 抛 `E_FILLET_NO_EDGES`；错误的边引用抛 `E_FILLET_BAD_EDGE_REF`；错误的半径抛 `E_FILLET_BAD_RADIUS`。
- `chamfer-math.test.ts`（6 个测试）：未改，全部通过。
- `face-evolution.test.ts`（12 个测试）：未改，全部通过。
- 4 个 topology/naming 测试文件：mock 更新后全部通过。
- Typecheck：`tsc --noEmit` 干净通过。
- Lint：所有 fillet 相关文件 `eslint` 干净通过。
- 3d_editor lint：所有 fillet 相关文件通过；BOM 修复后的文件通过。
