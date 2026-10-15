# Agent Note: 编辑器 load 路径的 STEP 基座角色表

Status: implemented

[English](2026-10-15-step-base-role-table-editor-path.md) | 中文

## 问题

STEP 参数化编辑基座层（方案 2026-09-18）只在平台 op `cad.import_step` /
`cad.import_brep` 上建了导入件角色表（`imported:<i>`）。编辑器消费的是
`cad.load`，它：

1. 在 `fromBrep` 调用处没有传 `roleTable`；
2. 且是裸 async 函数（不经 `defineOp` 包装），即便传了表也不会被提升到
   part 键表（`outputTablesByPart`）——而 `tableOfPart` / 执行器的
   `setRoleTableHook` / `buildNamingInput` 读的正是 part 键表。

后果链（评审 2026-10-15）：`cad.load` 的 STEP 零件所有边命名行
`faces === null` → `hasUsableEdgeNaming === false` → STEP 导入件的倒角/圆角
被禁用。另外，多 solid 文件导入为 compound，成员共享同一 StmtId，裸
`imported:<i>` 角色会在成员间撞名（几何相同的成员会产生相同的面 hash）。

## 决策

- **`extra/ops/load.ts` 在 BREP 路径建角色表**（与 `import-step.ts:74-80`
  同构）：
  - 单零件：`imported:<i>`（与 `import_step` 完全一致）；
  - 多零件 compound：逐成员 `imported:<memberIdx>:<i>`——合并表（单一
    StmtId origin）保证每个成员的 role 键唯一。
- **手动登记 part 键表。** 因为 `load` 是裸 async 函数，形状建成（单零件）
  或 compound 组装完（多零件）后，显式调用
  `runtimeLineage.recordOutput(stmtId, table, solid, part)` 落 part 键——
  即 `define-op.ts` 对 defineOp op 所做的提升（import-step.ts GOTCHA 注释）。
- **`runtime.ts buildNamingInput` 学会处理 compound 终端。** compound 没有单一
  `solidCache` 键，`ordinalToHash` 此前从未被计算——即便有表合并命名也全是
  null。compound 分支现在按 children 声明序逐成员拼接 `subShapeHashes`，
  与 `buildCompoundTopologyRuntime` 的合并面序对齐。

## 备选方案

- 让编辑器走 `import_step`：否决——编辑器路径按设计就是 `cad.load`，平台
  op 不被 3d_editor 消费。
- 给成员分配合成 StmtId：否决——origin 必须是真实语句 id 才能做血缘解析；
  伪造 id 会破坏语句↔锚点一致性。
- 所有成员都用 `imported:<i>`：否决——同型成员会在 `roleOfOrdinal`
  （首匹配）里撞名，正是 P0-2 红线。

## 工程笔记

- part 键登记是承重半段：只去掉 `fromBrep` 槽位表（保留
  `recordOutput(..., part)`）时编辑器路径断言仍然通过；把登记本身禁用后才
  复现修复前的失败（`expected -1 to be greater than or equal to 0`——没有
  任何带 `faces` 的边行）。
- `loadCache`（内容哈希）只缓存解析产物；`fromBrep` + 建表在每次 execute
  都发生，因此缓存命中与未命中都会产出命名。

## 后果

- STEP 导入件重新可编辑：编辑器路径上 `edgeNaming[i].faces !== null`，
  对基座边做倒角成功且改参重放不裂，多零件成员 role 逐成员唯一。
- 宿主侧仍需在 load 路径落命名派生数据（`_commitLoadSideEffects`），否则
  导入后 `hasUsableNamingForFile` 看不到命名（由同一 PR 的 3d_editor 改动
  承担）。

## 测试

- 新增 `packages/core/test/api/load-step-parametric-edit.test.ts`：真实 STEP
  fixture（`box_boss.step`、`test-model.step`）上的编辑器路径断言——P1
  （可用边命名）、P2（loadCache 命中 + 未命中）、P3（基座边倒角 + 重放）、
  P4（合并命名逐成员 role 唯一）。
- `packages/core` 全量：349 文件、3927 通过 / 13 跳过。monorepo 全量：
  440 文件、4837 通过 / 18 跳过。typecheck + lint 全绿。
