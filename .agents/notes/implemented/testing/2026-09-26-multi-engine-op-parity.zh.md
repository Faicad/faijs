# Agent Note: 多引擎 op 兼容性测试框架

Status: implemented

English | [中文](2026-09-26-multi-engine-op-parity.md)

## 问题

faijs 支持两个 BREP 引擎后端（OCCT 和 brepkit），通过静态分发层按 `engines` 声明和 `capabilities` 路由 op。此前没有测试系统性地在所有支持的引擎和 brepkit-wasm 版本上执行每一个上层 op：

- 中立 op（无 `engines` 声明）在 brepkit 上产出的几何是否与 OCCT 一致，逐 op 未知。
- brepkit-wasm 2.x（MIT/Apache，项目可发布的版本线）与 3.x/4.x（AGPL，当前依赖和 latest）行为是否有差异，未验证。
- 既有 parity 测试仅在 BrepEngineApi 层覆盖基本体和 pattern，未通过 CadRuntime 覆盖完整 L3 op 面。

## 决策

在 `packages/core/src/` 下构建两层测试框架：

1. **`brepkit-kernel/multi-version-test.ts`** —— `loadBrepkitVersion('2.129.15' | '3.4.18' | '4.0.32')` 通过 `setBrepkitWasmInitFn`（绝对路径 ESM import npm pack 的 tarball）+ `disposeBrepkit()` + `__resetEngineRegistriesForTests()` + `registerBrepkitBrepEngine()` 在同一进程内切换 brepkit 内核。未修改 brepkitWasm.ts / brepkitKernel.ts / registry.ts 源码。

2. **`brep/engine/multi-engine-op-parity.test.ts`** —— 特征化测试，覆盖 33 个 op × 4 个引擎（OCCT + 3 个 brepkit 版本）。对每个有 brep 实现的中立 op，通过 `createEditorRuntime` 在 brep 模式下执行自包含的 `.fai.js` 脚本；从 `result.outputs` 提取输出 bbox，跨引擎按 1% 容差比较。已知 brepkit 适配器缺口记录在 `KNOWN_BREPKIT_GAPS` 白名单中（不硬失败），任何*新出现的*回归会立即让测试变红。预期错误用例（能力缺口、occt-only op、mesh-only op）断言精确的错误类和消息内容。

3. **`brep/engine/multi-engine-results.json`** —— 测试运行时写入的逐 op×引擎 bbox + 状态原始数据，供下游报告使用。

## 关键发现

- **14 个 op 在全部四个引擎上通过** 1% bbox 容差：box, sphere, cylinder, cone, wedge, rotate_euler, scale3d, linearPattern, shell, splitByPlane, engrave, place, unifySameDomain, defeature。
- **18 个中立 op 在全部三个 brepkit 版本上失败**，原因是适配器层缺口（缺 `dispose`/`copyShape` 能力、布尔内核 `Invalid array length` 崩溃、edgeRef 依赖 OCCT roleTable、非实体句柄被拒绝）。这些是 faijs 适配器缺陷，不是 brepkit-wasm 版本差异。
- **brepkit 2.129.15 / 3.4.18 / 4.0.32 行为完全一致**：通过/失败模式相同、bbox 数值相同、错误信息相同。唯一差异是内部句柄分配序号。
- **许可证**：2.129.15 = MIT OR Apache-2.0；3.4.18 和 4.0.32 = AGPL-3.0-only。项目当前 devDependency 锁定的是 3.4.18（AGPL）。

## 考虑过的替代方案

- **每个 brepkit 版本单独 vitest pass**（类似既有 parity 套件的分 pass 做法）：拒绝，因为通过 `setBrepkitWasmInitFn` 的同进程切换已验证可靠，避免了三次 worker 初始化开销。`disposeBrepkit()` + 注册表重置序列可干净隔离版本。
- **直接调用 BrepEngineApi 而非 CadRuntime 脚本**：拒绝，因为用户需求是"所有上层 op"——通过 defineOp + dispatchPath 测试能捕获内核级测试遗漏的路由和参数归一化 bug。
- **对每个 brepkit 缺口硬失败**：拒绝，因为 18 个缺口是已知存量；白名单化让测试能捕获*回归*（缺口被修复、或新出现的破坏）而不会永久飘红。

## 后果

- `npm run test -w @faicad/faijs` 现包含多引擎兼容性套件（约 131 秒，单 worker）。
- `_test-kernels/` 目录存放 npm pack 的 brepkit-wasm 2.129.15 和 4.0.32，已 gitignore（仅追踪 `.gitignore`）。
- 当某个 brepkit 适配器缺口被修复时，从 `KNOWN_BREPKIT_GAPS` 中删除对应条目即可将该 op 提升为硬 parity 断言。
- 未修改任何生产源码；未更改 package.json 依赖。
