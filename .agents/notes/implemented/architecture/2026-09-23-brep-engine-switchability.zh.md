# Agent Note: BREP 引擎可切换性——能力名分层与装配期内核注入

Status: implemented

[English](2026-09-23-brep-engine-switchability.md) | 中文

## Problem

faijs 只有一条固定的 BREP 路径：`bindOcctKernel()` 把 vendored 内核注册表硬绑定到
occt-wasm 适配器，第二个 BREP 引擎（brepkit、memory mock）无法支撑 compat op 面。
不触碰 vendored 代码就无法切换引擎做 parity 测试或宿主定制。

## Decision

- **装配期适配器注入取代固定绑定。** `injectCurrentBrepEngineAsKernel()`
  （Phase 2，commit `bc13f0f`）从 BREP 引擎注册表取当前引擎，包装为
  `KernelAdapter` 注册进 vendored 内核注册表：occt 走 `OcctWasmAdapter.fromKernel`
  （同一 occt-wasm 单例上的完整 211 方法适配器），其它引擎走透传的
  `wrapBrepEngineApi()`。`bindOcctKernel()` 已废弃（调用即抛）；
  `isKernelInjected()` 取代 `isOcctKernelBound()`。
- **能力名三层结构**（Phase 1，commit `92aa0cd`）：族级布尔
  （`heal`/`directEdit`/…）、`BrepEvolutionKind`（具体 `*WithHistory` 真名）、
  `BrepMethodKind`（具体非演化方法真名）。别名如 `'mirror'` 无法同时表达
  "提供 `mirrorWithHistory`"与"提供 `mirror`"，两族必须分名。
- **静态判定，无运行时回退。** op 在当前引擎上能否执行，在执行前由能力表
  （capability-map.json，36 compat op / 64 唯一内核方法，Phase 0）静态决定。
  缺能力静态降级（auto 模式有 mesh）或执行前报错（`BrepUnsupportedError` /
  `MeshUnsupportedError`）；能力**绝不伪造**——brepkit 只声明其内核适配器
  实际接线的 wasm 导出。
- **能力映射表收敛（Phase 3，commits `d022e68` / `5857132`）。** 64 个内核
  方法全部登记进 `BrepEngineApi`；occt 接线 33 个新登记（18 原生 + 15 vendored
  组合代理），brepkit 接线 7 个真实现（boundingBox、surfaceCenterOfMass、
  makeEllipsoid、makeTorus、makeVertex、mirror、shell），其余保持
  `unsupported` 且不声明。`engine-switch-p3.test.ts` 钉住契约：接口覆盖
  （编译期守卫）、实例完整、声明 ⊆ 实现。

## Alternatives considered

- **运行时回退（try-catch 探测）。** 否决：BREP 链是否可用静态可知；运行时探测
  会让已声明能力在通过静态分派后死于内核——正是设计禁止的"静默死亡"红线。
- **能力名别名制（一族一个字符串）。** 否决：`'mirror'` 无法区分"提供
  `mirrorWithHistory`"与"提供 `mirror`"；演化族与方法族必须分名（P3）。
- **在 faijs 侧重写 vendored 函数逻辑**（replica 角色回投、Result 语义、
  keep 处理）。否决：双份维护且丢失命名资产；注入让 vendored 函数零改动。
- **乐观声明 brepkit 全部 wasm 导出。** 否决：wasm 有导出 ≠ 适配器已接线；
  声明桩会让静态分派放行后死在运行时。brepkit 只声明已接线实现，并把语义
  不匹配（wasm 的 extrude/section/split 是平面式）记录为 unsupported。

## Consequences

- 换引擎成为装配期、静态、宿主可见的操作；装配后注册表只读（无运行时切换、
  无注销）。
- `capability-map.json` 是 compat op → 内核方法的唯一事实来源；
  `ops-api-inventory.md` 的能力声明列由其生成，`api-contract.md`
  §7.9/§7.10/§8.2 记录三层命名、静态判定与适配器注入。
- occt 与 brepkit 的 parity 测试成为一等工作流（`engine-switch-p2/p3.test.ts`）；
  chamfer 等 brepkit 缺失能力执行前报错（含引擎 id 与能力名）。
- 已知缺口保留在方案 §5.3：族级布尔残留（heal/directEdit/advSurface/
  assembly/meshLift）与 `disposalModel` 尚未并入 capabilities。
