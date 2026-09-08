# Agent Note: 装配变换应用按变量名同步 solidCache，而非 memberNames

状态：已实施

[English](2026-09-08-assembly-transform-cache-key.md) | 中文

## 问题

对 `memberNames` 与语句变量名不同的装配（cq-compat 路径：CadQuery 短名 `axk` vs 脚本变量 `shape_axk`）执行 `do_assemble()`/`solve()` 后，CLI 导出在 `buildSolidTopologyRuntime`（brep-topology.ts:99）抛 occt-wasm `INVALID_SHAPE_ID`。根因：

- `applyPendingAssemblyTransforms`（direct-executor.ts:450）先 `kernel.release(solid)` 释放旧句柄，再把新 solid 以 **memberName** 为键写入 `solidCache`（`setSolidHook(asPartName(name))`），而 `solidCache` 的键是**语句变量名**（runtime.ts:404 的 `setSolid` 钩子 + 导出按 `shape_axk` 查 `buildBrepTopology`）。
- 更新写进了不存在的键；变量名键仍指向已释放的悬空句柄，导出期拓扑构建对其 `meshShape` → `INVALID_SHAPE_ID`。`changedSet` 同样键错位（`changed.add(memberName)`，而宿主按变量名刷新）。
- `memberNames` 必须保留短名（CadQuery 约束 DSL 按成员名引用；求解器经 memberNames 把约束 `part` 映射到成员下标）。bug 只在于**缓存键**误用了它。
- 最小复现验证：A（不传 `memberNames` → 引擎回退反查变量名）导出正常；B（显式 `memberNames: ['x','y']`，变量名 `a`/`b`）报 `INVALID_SHAPE_ID`。3d_editor 路径从不触发，因为其不传 `memberNames`（成员名即变量名）。

## 决策

在 `applyPendingAssemblyTransforms`（packages/core/src/cad-runtime/direct-executor.ts）中，用 `nameOf(member)`（shapeToName 表，执行器在每条语句后用 `setName` 填充）解析每个成员的**变量名**：

- `solidCache` 以 `varName ?? memberName` 同步（变量名优先——它才是缓存键）；
- `changedSet` 以变量名登记；两者不同时额外保留 memberName（按成员名消费位姿的宿主——P3 kinematics——继续工作；kinematics 映射本身不变，仍以成员名为键）。

mesh 原地烘焙、BREP 刚体变换、`ensureSlot(member).solid = transformed`、P3 运动副位姿传播（成员名键）均未改动。`ModuleExecutor` 已删（P6），direct-executor 是唯一应用点；其余 `setSolidHook` 调用（逐单元同步 :357/:373）本就使用变量名键，本次与其对齐。

## 备选方案

- **在 cq-compat 侧把变量名当作 `memberNames` 传入。** 否决：CadQuery 约束 DSL 与 `buildAssembly` 语义要求短名；改兼容层会破坏约束→成员解析并偏离 CadQuery。
- **把 `solidCache` 改成 memberName 键。** 否决：solidCache 被拓扑/命名/导出路径按语句变量名消费（也含 3d_editor 的 statement-cache）；改键会波及整个 runtime。
- **仅在 `nameOf` 缺失时回退 memberName。** 采纳：`varName ?? name` 只是对未登记变量名的纯回退（装配成员必为语句产出，`nameOf` 应命中；万一 miss 则保持旧行为）。

## 影响

- 最小复现 B（显式短名 `memberNames` + `do_assemble`）现可成功导出；mini_lathe `assembly.fai.js` + `asm.solve()` 复现（11383 STEP 实体）成功导出——两者修复前均报 `INVALID_SHAPE_ID`。
- `cli.test.ts` 新增回归测试：显式短名 `memberNames` + `do_assemble` → `ok=true`、STEP 导出成功、成员 leaf 名仍为 `['left','right']`（成员名保真不受影响）。
- 回归：core 全量 1075 passed / 10 skipped（83 文件，+1 新测试）；cq-compat 8/8；`packages/mini_lathe/scripts/verify-all.ts` 五项全绿（6-leaf 装配、成员名、slide_top 基线、新旧必须 DIFFERENT）；typecheck（根 + 全部 workspaces）与 lint 干净。
- 此前诊断的「CLI 导出中约束不生效」现已**解决**：调用 `asm.solve()` 可应用求解位姿并正确导出。上一份 Agent Note 中的遗留诊断说明被本修复取代。

## 验证

- `npx vitest run src/node-host/cli.test.ts` 14/14（含新短名装配回归）。
- `packages/core`（1075 passed / 10 skipped）与 `packages/cq-compat`（8/8）全量。
- `npx tsx packages/core/scripts/faijs-cli.ts run <_asm-short.fai.js> --out x.step --mode brep` 与 `_solve-repro.fai.js`（mini_lathe + solve）均成功。
- `npx tsx scripts/verify-all.ts`（packages/mini_lathe）全绿；`npm run typecheck`（根 + workspaces）与 `npm run lint` 干净。
