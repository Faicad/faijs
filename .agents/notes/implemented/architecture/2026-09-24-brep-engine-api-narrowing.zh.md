# Agent Note: BrepEngineApi 收窄与平台原生访问

Status: implemented

[English](2026-09-24-brep-engine-api-narrowing.md) | 中文

## Problem

`BrepEngineApi` 是个过宽的接口：它承载 119 个"faijs 需要"的方法，而不是每个已注册 BREP 引擎都真实现的方法。brepkit-wasm 只实现其中一部分，于是 occt 与 brepkit 两个适配器在诚实度上分叉——occt 全量填满，brepkit 用 `unsupported()` 桩补缺口，能力声明与运行时配置持续漂移。vendored 测量面（`measureSurfaceProps` / `measureLinearProps`）完全绕过能力路由，经借入层绑定 occt-wasm。脚本面则根本没有测量入口：脚本量不出面积和长度，这是一个真实的能力缺口。

接口必须只表达一件事——双方适配器都真实现的方法集合——而其下的平台层必须有一个类型真实、诚实的出口可达。

## Decision

**`BrepEngineApi` 收窄为 L1 中立契约面。** 语义从"faijs 需要的全部方法"改为"所有已注册 BREP 引擎都真实现的方法"，收窄到 99 个 L1 方法（`aligned` + `dialect`）；方法要进入接口，必须 occt、brepkit、mock 三处都有真实现（mock 可近似）。三处编译期断言——`_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi`——因此同时获得校验力。平台方法（135 个归一化 occt-only，如 `section`、`split`、`mirrorWithHistory`）移出接口，经平台原生出口触达。映射表 `engine-method-map.json` 是唯一真源（D10）：接口里每个方法在表中都是 `aligned`/`dialect`，且表中每个此类条目都出现在接口里（无孤儿）。

**三个访问出口，各自类型真实。** ① `getBrepApi(): BrepEngineApi`——可移植代码与第三方库的中立、类型化出口（唯一允许的 L1 入口）。② `getOcctKernel()` / `getBrepkitKernel()`——平台原生出口，返回裸内核实例，原样类型、零归一；只有适配器文件与 `@platform` 标注的 op 实现文件可以 import 平台模块。`getKernel(): unknown` 保留但标 `@deprecated` 并纠正 JSDoc（D12）。

**`engines` 声明平台身份（D11）。** 实现**静态 import 了** `occt-kernel/*` 或 `brepkit-kernel/*` 的 op 是平台 op，必须在 `defineOp` 声明 `engines: ['occt']` / `['brepkit']`。判定在 `dispatchPath` 中最先执行（D11-2，先于 mode 与能力）：brep 模式在触碰内核之前抛 `BrepUnsupportedError`；auto 模式静态降级 mesh；`mode='mesh'` 与 `brep_mock` 豁免（D11-6 / D11-3）。`engines` 与 `capabilities` 互斥（D11-7）。脚本面可以用同一份声明暴露平台 op——不支持的引擎在语句边界失败（`failedAt`，Q11）。

**vendored 测量面收口为 occt-only。** 12 个测量 query op 全部声明 `engines: ['occt']`；生成器在函数体第一行渲染 engine guard；能力诚实测试（声明了名字 → 适配器上必须是 function）覆盖整个 `methods` 清单。

**脚本面新增中立测量 op（Phase 7）。** `cad.area(shape)` / `cad.length(shape)` 是 `api/measurement/index.ts` 里的手写 op，经 `getBrepApi()` 直调 L1 `getSurfaceArea` / `getLength`——无借入层、无引擎绑定，天然平台中立；经 arg-spec `scriptFace: true` / kind `faijs` 通道登记，符号表与 manifest 保持三源一致。引擎直连的测量 parity 测试在两侧适配器上断言相同数值。

**CI 守卫封死平台隔离。** `scripts/check-platform-imports.mjs`（与 `check-ghost-deps.mjs` 同构，并入 `scripts/ci.ps1`）强制：中立模块（无 `@platform` 标注、无适配器/入口/测试豁免）不得静态 import `occt-kernel/*` 或 `brepkit-kernel/*`；`@platform` 标注且含 `defineOp` 的文件必须声明匹配的 `engines`。此前未标注的平台绑定文件（`occt-kernel-bridge.ts`、`brep-topology.ts`、`brep-primitives.ts`）已补 `@platform occt` 标注，使其平台性质显式化。

## Alternatives considered

**保留宽接口、用 `UnsupportedKernelOperationError` 桩填缺口。** 否决：运行时探测 + 运行时回退违反仓库红线（BREP 路径由静态规则在执行前判定，禁止 try-catch 探测），且桩填满的接口给所有消费者一种虚假的可移植感。

**平台方法作为接口可选槽。** 否决：可选槽仍在接口上，仍从可移植代码里看起来可调用，仍要求每个适配器定义它——收窄只是表面功夫。

**经 `getKernel(): unknown` 加断言触达平台方法。** 否决：迫使每个调用方手写类型断言；类型化出口 `getOcctKernel()` / `getBrepkitKernel()` 让平台边界显式且可 grep。

**用能力名前缀声明平台身份。** 否决（用户裁决）：收窄后 `capabilities: ['section']` 会命名一个接口里已不存在的方法；`engines` 陈述物理事实（op import 了平台模块），且可在装配期校验。

**留着测量缺口、让 vendored op 覆盖。** 否决：vendored 面绑定 occt 且绕过能力路由；L1 直连的手写 op 是唯一的平台中立测量入口，并在两侧适配器上验证与引擎值一致。

## Consequences

- `BrepEngineApi` 从 119 收窄到 99 个 L1 方法；`brep-mock.ts` 对齐 L1 核心面（移除 33+ 平台方法、补齐 13 个缺失 L1 方法）；`liftCurve2dToPlane` 降为 occt-only、checkpoint 标记为 kernel-only。
- 平台调用点（face-evolution、step 导出、螺纹 loft、镜像复制、section）改走 `getOcctKernel()`；29 个平台 op 与生成类 vendored op（fuse、extrude、revolve、…）全部声明 `engines: ['occt']`。
- `cad.area` / `cad.length` 是新的脚本面 op——20×10×5 盒在 occt 下给出 700 mm² / 280 mm（边-面计数）；brepkit 对 solid 输入的长度语义（`getEdgeCurveType`→`edgeLength` 取首边）记录为适配器级语义缺口，本次不做归一。
- 150 个 core 测试文件通过（2094 tests, 10 skipped）；新守卫与 parity 测试新增 30+ 用例。
- 破坏性变更（Q12）：随下一个 **major** 发布，不留兼容别名——一次性切换。
- 外部包（`cq-compat` / `fai_cq_gears` / `fai_cq_warehouse`）对收窄后的面出现 typecheck 错误，在同一变更集内修复。`cq-compat-compare` 是 occt 平台工具，直接消费 `OcctKernel` / `ShapeHandle`（收窄后不再冒充 `BrepEngineApi` 消费方）。`GearKernel` / `WarehouseKernel` 从 `extends BrepEngineApi` 改为 type 交叉 `Omit<BrepEngineApi, 'interpolatePoints' | 'getNurbsCurveData'> & { …平台成员 }`——继承全部 L1 方法，同时用 occt 原生 periodic 语义覆盖 `interpolatePoints`（L1 的 `interpolatePoints(points, degree)` 是 brepkit 方言，交叉先 Omit 再覆盖；`getNurbsCurveData` 同理覆盖加宽返回结构）。warehouse 测试里 `exportStepFromSolids` 调用点带显式跨面断言传入平台内核——运行时是 raw occt-wasm，且入口 solid 恒不触碰仅 L1 的 mesh 重建路径。
