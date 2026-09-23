# Agent Note：vendored 测量面引擎收敛（胶水方法合成 + 测量方法映射 + 注入缓存重置）

状态：已实施

[English](2026-09-24-vendored-measurement-surface-engine-convergence.md) | 中文

## 问题

`injectCurrentBrepEngineAsKernel()`（装配期适配器注入，§7.10）存在三个 faijs 侧缺陷，使 vendored brepjs 测量面成为 occt-only，且重复注入有崩溃风险：

1. **胶水方法缺失**——`wrapBrepEngineApi` 裸透传引擎的 `BrepEngineApi`，不含 `createVector3d / createPoint3d / createDirection3d / createAxis1 / createAxis2 / createAxis3`，导致 `assertGlueMethodsComplete` 在装配期拒绝任何非 occt 引擎。
2. **注入缓存无重置**——模块级 `_injected` 标志使重复注入短路。occt 注入成功后切 brepkit 再调注入，会静默返回**过期的 occt 适配器**——它把 brepkit 数字句柄当 occt-wasm 指针解引用 → OOM/崩溃。已在 `measurement-parity.test.ts` 调试中以探针复现。
3. **测量方法名/形态不匹配**——vendored 测量面调用 `kernel.volume / area / length / centerOfMass / linearCenterOfMass`（自有命名，`measureFns.ts`），裸透传一个都不暴露——即使胶水检查放行，注入也会在执行期 `TypeError`。

## 决策

全部修复落在 faijs 自有桥接层（`api/occt-kernel-bridge.ts`）；vendored brepjs 只新增一个 test-only 导出，逻辑零改动。

- **胶水方法在包装层合成，不扩 `BrepEngineApi`**。这 6 个构造器在 vendored 面是纯 JS 数据字面量（零内核调用，已在 `constructionOps.ts` 实证），属于*调用约定*而非内核能力；扩引擎契约会强迫每个适配器实现无几何意义的样板。字段形态逐字复制 vendored occt 适配器（`__type` + 必备 `delete: noop`；axis1 用 `origin+direction`，axis2/3 用 `origin+zDir+xDir?` 的 6/9 参数两形态）。
- **测量映射在包装层**。`volume→getVolume`、`centerOfMass→getCenterOfMass`（vec 对象 → 元组）、`boundingBox→getBoundingBox(_, true)`（xmin..zmax → min/max 元组）；vendored `KernelShape`（裸 number 或 `.id`）先 unwrap 再调用。`shapeType`/`isNull` 同名同义透传。
- **缺口只登记，绝不补桩**。`UNMAPPED_VENDORED_MEASURE_METHODS = ['area', 'length', 'linearCenterOfMass']`——`BrepEngineApi` 无 `getSurfaceArea`/`getLength`/`getLinearCenterOfMass`，三者保持 `undefined` 并由测试钉死。伪造 `0` 是静默错值，比崩溃更难查，违反"禁止伪造能力"红线。
- **重置钩子仅限测试**。`__resetKernelInjectionForTests()` 清桥接缓存；vendored registry 的 `__resetKernelRegistryForTests()` 清空内核并解冻。registry 重置必须是 vendored 导出，因为 `_frozen` 是模块级变量——只写 `globalThis.__FAICAD_FAIJS_KERNEL_REGISTRY__.frozen = false` 不会改到它；从 faijs 侧重建 globalThis 状态则要硬编码 vendored 私有结构（含 `stateVersion` 校验），vendored 升级时静默失效。注入短路改为与 `isKernelInjected()` 同判据，registry 已可见的注入不会被对冻结 registry 重跑。
- **注册 id 不改**。`'occt-wasm'` 是 registry 槽位名（宿主侧判据 + D10 globalThis 单例兼容），不是引擎身份；vendored 面一律无参 `getKernel()` 取默认。

## 被否决的替代方案（Alternatives considered）

- **把胶水方法加进 `BrepEngineApi`**——用零几何的样板污染引擎契约，每个适配器被迫复制。
- **只从 faijs 侧重置 globalThis 状态**——需硬编码 vendored 私有结构，升级时静默失效。
- **注册 id 改成实际引擎 id**——无功能收益（vendored 面不按 id 取）；触及宿主判据与 D10 兼容。
- **`area`/`length` 补桩返回 0**——静默错值，违反禁止伪造能力红线。

## 遗留缺口（已登记，本方案不解决）

brepkit v1 适配器对 `shapeType` / `isNull` 按白名单显式抛错（`brepkitKernel.ts:577-578`），且 brepkit wasm 层**完全没有**类型/有效性查询（探针实测：`toBrepJson` 把 compound 序列化为 `type:"solid"`；`getEntityCounts`/`getCompoundSolids` 无法区分；无效句柄只能靠异常暴露）。由于 `measureVolumeProps` 无条件调 `kernel.isNull` + `kernel.shapeType`，vendored 测量面在 brepkit 上执行期仍被阻断——这是**引擎适配器能力缺口**（与缺 `getSurfaceArea` 同性质），已由 GOTCHA 测试钉死，不是桥接层 bug。

## Consequences

- 任何非 occt 引擎的 `BrepEngineApi` 现在都能通过装配期胶水检查；注入引擎中立，测试重置后再注入跟随当前引擎（防回归测试钉死）。
- 适配器真实具备的测量能力（volume / centerOfMass / boundingBox / shapeType / isNull）经 vendored 面可用；`area` / `length` / `linearCenterOfMass` 保持显式、测试钉死的缺口，直至引擎契约扩展。
- vendored 树仅新增一个 test-only 导出（`__resetKernelRegistryForTests`），逻辑零改动；occt 路径未动。

## 验证

`measurement-parity.test.ts`（10 用例，双引擎）、`engine-switch-p2/p3/test`、`registry.test.ts`、`compat-op.test.ts` 全绿。occt 路径行为零变化（occt 分支未动）。
