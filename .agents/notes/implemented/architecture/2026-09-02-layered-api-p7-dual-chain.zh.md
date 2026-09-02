# Agent Note: 分层 API 移植 — P7 双链整合（KernelCapabilities 并入 + 首条 L3→L2 接线）

Status: implemented

[English](2026-09-02-layered-api-p7-dual-chain.md) | 中文

## Problem

P6 退役了 stdlib、把 L3 API 面落在 `packages/core/src/api/`，但方案的 P7（双链整合）仍有三个缺口：(1) 移植的 `KernelCapabilities`（`exact`/`brepExport`/`exactMeasurement`/`tessellationModel`）只存在于 vendored 树内——faijs 的 `BrepCapabilities` 数据模型没有这些"引擎本质"字段，适配器无从如实声明（D4 剩余项）；(2) 没有任何 L3 op 消费移植 L2——vendored L2 只经 p3/p5 测试 harness 跑自己的套件，D11 的"brep 缺失能力 → 调移植 L2"路径是空的；(3) op-graph/replay 的砍除只是隐含的（`kernel/manifold` 目录不存在），没有锁定断言。

## 决策

1. **`KernelCapabilities` 并入 `BrepCapabilities`（D4）。** 四个数据字段加入既有六个路由标志：`exact`、`brepExport`、`exactMeasurement`、`tessellationModel`（新增中立镜像类型 `BrepTessellationModel` = `'build-time' | 'extract-time' | 'none'`，按 D8 保持零 vendored import）。OCCT 适配器（`brep/engine/adapters/occt.ts`）如实声明：前三项 true、`tessellationModel: 'extract-time'`。`BrepCapabilityName`/`dispatchPath` **不改**——新字段描述引擎本质，不是逐 op 路由键。`disposalModel` **刻意不并入**（D5：faijs 的句柄释放由 `cad-runtime` 顶替释放统一编排；vendored port 已裁掉它，方案也不强制）。
2. **首条 L3→L2 桥接 op：`cad.fillet`。** BREP-only（`capabilities: ['directEdit']`），实现调 vendored `topology/modifierFns.fillet`（edges `undefined` = 全棱边，`trackEvolution: false`）。句柄整合按 D10：faijs `BrepHandle`（运行时是 occt-wasm u32 arena id）经 `helpers.handle` + 内核 `getShapeType` 包装成 `OcctWasmHandle` 对象，再用 `createBorrowedHandle` 借入移植树（non-owning——L2 只读输入、绝不释放）；产物句柄经 `unregisterFromCleanup` 脱离移植树 GC 兜底，u32 id 经 `fromBrep` 登记进 faijs 身份槽——此后释放归 `cad-runtime`。`Result → throw` 翻转（D3）是 L3 边界的固定样板。
3. **同一装配点绑定移植内核。** `registerOcctBrepEngine()` 现顺带调用 `bindOcctKernel()`（幂等）——消费移植 L2 的 L3 op 在生产宿主装配下可用，而不只是在 p3/p5 测试 harness 里。
4. **P7 验收套件。** `packages/tests/faijs/p7-dual-chain/` 用静态 grep 断言锁定砍除：无 `kernel/manifold` 目录、无 `opGraph.ts`/`replay.ts`、无运行期切换 `withKernel`、无三级 `init()` 回落、`freezeKernels`/`getKernel` 保留、`api/` 之外禁止 import vendored。`packages/tests/faijs/fillet/` 端到端断言接线：brep 链存活、身份槽登记、体积减少/面数增加、mesh 输入 `E_MESH_UNSUPPORTED`、brep-mock 引擎下能力路由 `BrepUnsupportedError`。

## Alternatives considered

- **L3 直接调内核适配器（brepjs-mirror 样式）而非移植 L2。** 否决：D11 的价值正是消费移植 L2 及其校验/边解析机制；kernel 直调等于重写一遍移植代码。
- **用 `copyShape` 转出产物而非 `unregisterFromCleanup`。** 否决：D10 说的是所有权*转移*（cast）不是复制——复制破坏句柄身份且增加内核开销。vendored 树确实暴露了逃生门（`unregisterFromCleanup`），O15 的保守回退仅作记录、未启用。
- **连 `disposalModel` 一起并入。** 否决：vendored port 已裁掉，D5 说不强制统一 brepjs arena 语义，faijs 本就有自己的释放编排。
- **把新字段加进 `BrepCapabilityName` 路由。** 否决：D4 明确分派逻辑本身不改；并入的字段是给宿主/工具的描述性数据。

## Consequences

- `cad.fillet` 现在可用于 `.fai.js`（BREP-only）——移植 L2 可从 L3 消费的首个实证，接线样板可推广到其余缺失能力（shell/offset/sweep/loft/…）。
- 门禁全绿：新套件（fillet 4 passed、p7-dual-chain 6 passed）；受影响套件（core engine/api 90 passed；d10/p3/p4/p5/refactor-acceptance/chamfer 1047 passed/2 skipped；core runtime 219 passed；mixed/parity/v53-lib-brep-dispatch/topology-naming/primitives/transforms 66 passed）；vendored 严格 `tsc` + core/tests `tsc --noEmit`；`lint` 0 errors；`check-layer-boundaries`（237 个 vendored 文件）；`check-ghost-deps`（489 文件）；`api-surface-snapshot.mjs`（10 子路径）。
- 版本号按 patch 递增：root/core `0.7.4 → 0.7.5`，mech-lib `0.5.11 → 0.5.12`。
- 依用户指令，`doc-sync` 与文档术语清理（`docs/api-contract.md` 过期的 `stdlib` 引用、`ops-api-inventory` 改从 L3 声明生成）推迟到开发完成后的统一文档处理。
