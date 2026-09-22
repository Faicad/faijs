# Determinism scanner 集成进执行流

English | [中文](2026-09-22-determinism-scanner-integration.md)

**Date**: 2026-09-22
**Status**: implemented

## Decision

把 B 级 taint 确定性扫描器（`determinism-scanner.ts`）集成进 `.fai.js` 执行流，使每次 `execute` / `append` 在几何执行开始前自动过闸。

## Policy default

`CadRuntimeOptions.determinism` 默认 **`'error'`**——违规通过 `failedAt` 以 `E_DETERMINISM` 中止执行。这为可交换级 `.fai.js` 强制了可复现性契约（docs/reproducibility-contract.md）。`'warn'` 把违规收集进 `ExecutionResult.infos`；`'off'` 关闭。

用户明确选择 `error` 作为默认（而非零回归的 `off`），因为项目目标是确定性的交换格式——`warn` 默认会让非确定性几何静默流出。

## Insertion points

1. **主文件**——`runtime.ts` 的 `executeDirectText` / `appendDirectText`，在 `extractMetadata` 之后、`de.execute` / `de.append` 之前。闸复用 `meta.imports` 推导 `extraNamespaces` / `extraCallees` 扫描提示。
2. **项目模块**——`module-registry.ts` 的 `ModuleRegistry.load`，在 `extractMetadata` 之后。`ModuleRegistry` 接收第 4 个构造参数 `determinismPolicy`；违规抛 `ModuleRegistryError('MODULE_SECURITY')`，`loadDirectModuleImports` 已将其映射为 `failedAt`。
3. **库源码**——`runtime.ts` 的 `runDeterminismGate`，经 `ports.libLoader.loadSource(packageName)`。node-host 的 `cliPortsLibLoader` 实现 `loadSource`（解析 `package.json` → 优先 `src/index.ts`，回退 `dist/index.js`）。浏览器 host 不提供 `loadSource` → 跳过库扫描（优雅降级，不报错）。

## Bug fixed during integration

`determinism-scanner.ts` 的 `handleCall` 没有把 callee 对象上的 taint 传播到调用结果。`const d = new Date(); const r = d.getSeconds()` 的 `r` 未污染，因为 `getSeconds()` 没有受污染的**参数**。修复：当 callee 是 `MemberExpression` 且其 object 既不是几何命名空间也不是安全容器时，`evalTaint(obj)` 的 taint 传播到 `resultTainted`。

## Observation: .fai.js parser strictness

`metadata-extractor.ts` 的 `collectExprIdentifiers` 对声明 RHS（`const r = Math.random()`）**宽松**，但对 op 位置参数（`cad.sphere(Math.random())` ——把 `Math` 当作未知标识符拒绝）**严格**。因此非确定性来源必须先存进变量再流入几何——这正是扫描器要抓的 taint 传播模式。内联的 `cad.sphere(Math.random())` 在闸运行前就被 parser 拒绝；`const r = Math.random(); cad.sphere(r)` 能到达闸并被捕获。
