# Agent Note: 分层 API 移植 — P3 vendored surface（L2 第一批，用 brepjs 自己的测试）

Status: implemented

[English](2026-09-01-layered-api-p3-vendored-surface.md) | 中文

## Problem

P2 已落地 occt-wasm 内核树与 D10 冻结注册表，但 L2 层（`topology/` + `query/` + `measurement/`）仍是未经测试的移植。P3 验收门是"用 brepjs 自己的测试跑通移植栈，内核经 D10 绑定触达"——意味着要在移植树之上复刻 brepjs 测试 harness 的语义（内核装配、divergence 注册表），且不改动任何移植代码。

两个卡点是结构性的，不是几何 bug：

- 移植测试直接调用 `getKernel()`（在 brepjs 里从 `@/kernel/index.js` 引入）构造 null shape 输入与原始 arc。我们的 facade 没有 re-export `getKernel`，导致 null-shape 预检测套件以 `getKernel is not a function` 崩溃。
- 两个行为在 occt-wasm 适配器上确实不同：`fuse` 忽略 `simplify` 选项（无 OCCT `SimplifyResult`）；partial-arc 的 `curveAxis` 需要 `castShape` 层面的 arc 处理。brepjs 自带的 divergence 注册表对 occt-wasm 把 `booleanFns.pairwiseSimplifyFaceMerge` 标记为 skip——这是上游已认可、预期中的差异，不是移植 bug。

## 决策

1. **packages/tests 下的 harness** — `faijs/p3-vendored-surface/`：
   - `brep-surface.ts`：薄 facade，重导出测试用到的约 125 个 vendored 符号，外加最小 sketch-shape 兼容面（`P3SketchSurface` + `sketchRectangle`/`sketchCircle`），让 `shape()` 认得构造对象。sketch 层本身属于 P5，这里只 stub wrapper 管道。
   - `kernel-setup.ts`：`initKernel()` = `initOcctWasm()` + `bindOcctKernel()`（D10），并 re-export `getKernel`/`bindOcctKernel`/`getBrepjsKernel`/`isOcctKernelBound` 与 divergence 助手。
   - `kernel-divergences.ts`：brepjs `tests/helpers/kernelDivergences.ts` 注册表的忠实移植，固定到 `occt-wasm` 分支（我们的宿主内核）。正是它把两处真实差异变成 skip 而非失败。
   - 11 个测试文件从 brepjs `tests/` 原样拷入（topology/query/measurement + shapeFns/faceFns/curveFns/booleanFns/finderFns/wrapperFns/primitiveFns/measureFns），只改写 import 行（`@/…` → 相对路径）。

2. **vendored 测试的类型检查姿态** — 移植的测试拷贝放在 `p3-vendored-surface/tests/`，并从 `packages/tests` 严格 `tsc`（tsconfig `exclude`）中排除，镜像 brepjs 自身 tsconfig 排除 `tests/` 的做法。它们按 vitest（esbuild）下可运行来书写，不保证过 `noUncheckedIndexedAccess` 的严格度；harness 胶水（`brep-surface.ts`、`kernel-setup.ts`、`kernel-divergences.ts`）仍在类型检查门内。

3. **`getKernel` 通过 facade 提供给测试**，使 measureFns/booleanFns 中的 null-shape 构造与在 brepjs 自己的 `@/index` 下行为一致。

## 备选方案

- **改移植代码强制行为**（例如让 adapter 的 `fuse` 事后 simplify）。否决：D2/D3 要求移植树保持字节级忠实；`booleanFns.pairwiseSimplifyFaceMerge` 的 divergence 上游已为 occt-wasm 记录，遵守注册表才是正确的"通过"路径，而非 hack。
- **在测试拷贝里改写 `Shape` 类型调用**以满足严格 TS。否决：那会让 fixtures 与 brepjs 分叉，违背"原样跑上游测试"的目标；exclude 才是对上游忠实的答案。
- **把 harness 接进现有 D10 occt-kernel smoke 而非新建套件。** 否决：D10 保持为窄的单实例保证；P3 需要独立目录下的独立套件，便于未来内核（brepkit/manifold）用另一分支重跑同样的 394 个测试。

## 后果

- 在 `packages/tests` 下运行 `npx vitest run faijs/p3-vendored-surface` = 392 passed / 2 skipped。两个 skip 即 occt-wasm 的 divergence（fuse simplify，及一个既有 wrapper skip）；该路径也被全量 workspace 运行覆盖（整体 634 passed / 2 skipped）。
- 全量 `faijs/**` 类型检查包含 harness 胶水，不包含移植拷贝；vendored `tsc` 与 `check-layer-boundaries` 保持全绿。
- corner / blueprint / 2d 等套件本次刻意不移植——它们依赖 2d + blueprints 层（P5）。