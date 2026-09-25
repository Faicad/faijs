# Agent Note：core 解耦 Phase 1–2 —— 基础件内联与 vendored 桥删除

状态：已实施

[English](2026-09-25-core-decouple-phase1-2-basics-and-bridge-removal.md) | 中文

## 问题

`@faicad/faijs-brepjs` 子包仍持有 faijs BREP 面的一部分：反向投影桥
（`api/occt-kernel-bridge.ts`）在引擎注册时注入 vendored kernel registry；
若干基础件（Result 族、brepjs-compat 工具、视图投影辅助、凸包）从 brepjs
复制而来。方案的终态是删除 brepjs 子包；Phase 1–2 落地前置条件：基础件内联
core 并删除桥。

## 决策

1. **基础件内联 core。** `result/`（`result.ts`、`errors.ts`、`bug.ts`、
   `kernelErrorTranslation.ts`、`vec3.ts`）与 `api/brepjs-compat/`（types、
   planeTypes、constants、vecOps、planeOps）同源复制 brepjs，import 改第一方
   相对路径；`api/view/projectionPlanes.ts` + `cameraFns.ts` 复制自 brepjs
   `projection/`（裁剪 projectEdges）；`api/result.ts` 重导出第一方模块（保住
   `@faicad/faijs/api/result` 深路径）。
2. **hull 走 occt-wasm 原生。** `occt-kernel/hullGeometry.ts`（QuickHull，
   原样复制）+ `hullOps.ts` 让 `hullFromPoints` 直调 occt-wasm 内核
   （`buildTriFace` → `sewAndSolidify` → `fixFaceOrientations`），删除
   `occt-primitives.ts` 里 `OcctWasmAdapter.fromKernel` 依赖。
3. **删除桥。** 移除 `api/occt-kernel-bridge.ts`；`registerOcctBrepEngine`
   不再向 vendored registry 注入。
4. **剩余两个 core 消费方直读 vendored registry**（`@faicad/faijs-brepjs/kernel/index`）：
   `compat-projection.ts` 用 `getActiveKernelId() === null` 判断；
   `l3-bridge.ts` 用 `getKernel()`。
5. **vendored 装配职责移至宿主/测试。** `injectCurrentBrepEngineAsKernel`
   语义变为 tests/sheetmetal 的自装配 helper：
   `OcctWasmAdapter.fromKernel(getHostKernel())` → `registerKernel('occt-wasm')`
   → `freezeKernels()`（幂等；D10 单实例由共享 host 内核天然保证）。
6. **core 测试加全局 vitest setup**（`src/test/vendored-setup.ts`，顶层
   await），跑 compat op / view 投影的测试无需逐文件装配。
7. **测量对拍迁移。** `measurement-parity.test.ts` 保留 BrepEngineApi parity
   describe；vendored 测量面与注入重置两组用例迁至
   `packages/tests/faijs/vendored-measurement-selfhost`（自装配）；
   `engine-switch-p2.test.ts` 删除装配期完整性 describe（胶水方法检查随桥
   一并消亡）。

## 被否决的替代方案（Alternatives considered）

- **保留桥**（P7 单实例语义）——与删除 brepjs 包的终态冲突；否决。
- **core 测试逐文件装配**——11 个文件重复同一段装配；选全局 vitest setup
  （幂等，对纯单元文件无功能副作用）。
- **桥做惰性按需注入**——中间态复杂度，且不导向终态；否决。

## Consequences

- 中间态下：跑 compat op 的宿主/测试必须自行装配 vendored registry；core
  产品代码不再注入。
- core 的 brepjs 足迹下降（桥删除；剩余消费方为 compat-projection /
  l3-bridge 与 vitest setup）。
- 验证全绿：core 146 文件 / 2061 通过 / 10 跳过；tests 44 文件 / 1040 通过 /
  2 跳过（d10、p3、p5、p7、vendored-measurement-selfhost、compat-face）；
  sheetmetal 22 文件 / 233 通过；导出面快照与 Phase 0 基线一致（18 子路径，
  零 diff）。
