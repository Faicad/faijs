# Agent Note: 删除 capabilities 声明轴，引擎身份成为唯一收窄轴

Status: implemented

[English](2026-10-08-remove-capabilities-declaration-axis.md) | 中文

## Problem

此前有两条静态声明轴在收窄一个 op 能否执行：`engines`（引擎白名单）与 `capabilities`（引擎侧一个 `BrepCapabilities` 对象，op 侧 `defineOp.capabilities`，由 `cad-runtime/backend-dispatch.ts` 的 `engineCapabilitySet` / `firstMissingCapability` 在执行前求交）。能力轴当初没有经过设计就直接引入，且从未证明自己的必要：

- 同一个名字下混了三类互不相干的东西：族级布尔（`heal` / `directEdit` / `advSurface` / `assembly` / `meshLift`）、`*WithHistory` 核函数名（`BrepEvolutionKind`）、以及普通内核方法名（`BrepMethodKind`）。族级布尔会多报——内核可能只实现该族的一部分——而 2026-09-26 之后只有 `directEdit` 曾被 op 声明过。
- 对每个引擎集合本就决定了判决的 op，它只是把 `engines` 重说了一遍，多出一道结论相同的门。
- 它助长了一个错误的心智模型：「能力」不是切换轴，它是引擎源码的固有性质，写代码的时刻就已确定。
- 四个字段（`exact` / `brepExport` / `exactMeasurement` / `tessellationModel`）与其中四个布尔既无读取方也无声明方。

## Decision

整条轴删除：`BrepCapabilities`、`BrepTessellationModel`、`BrepMethodKind`、`BrepCapabilityName`、`EngineCapabilitiesLike`、`engineCapabilitySet`、`firstMissingCapability`、`defineOp.capabilities`、arg-spec 的 `capabilities` 字段及其生成物、三个适配器的 `capabilities` 对象、`BrepEngine.capabilities`、`Backends.config.brepCapabilities`、`BrepChainState.capabilities`。`engines` 成为唯一收窄轴，且在 `decidePath` 中最先判定。

轴能回答而 `engines` 不能回答的，只有一个问题：「这个引擎原生实现这个 `*WithHistory` 核函数吗？」。6 处 op 实现体问它，以静态选定实现轨（权威面演化轨，或 L1 裸调用）。这条事实下沉到引擎层，位于 `brep/engine/native-history.ts`：

`hasNativeHistory(kind: BrepEvolutionKind): boolean` 从 `getBackends().config.brepEngineId` 对一张常量表取答案——`occt`：全部十二个；`brepkit`：`fuseWithHistory` / `cutWithHistory` / `filletWithHistory`；`brep_mock` 与未知 id：一个都没有。它刻意不写成 `typeof kernel.X === 'function'`：所有适配器在整个面上都摆了桩，函数存在什么都证明不了。表的内容镜像删除前两个真实适配器的声明，故每条轨都不变。

## Alternatives considered

1. **以「现有代码有依赖」为由保留 `capabilities`。** 否决：依赖数量是删除它的论据，不是保留它的论据。每个消费方要么在重述 `engines` 已承载的事实（那道门），要么就是在问上面那一个引擎事实。
2. **把「原生有 `*WithHistory`」写成 `typeof kernel.XWithHistory === 'function'`。** 否决：`BrepEngineApi` 把共有的 `*WithHistory` 成员定为必需，而 brepkit 适配器把它们全给了，含 `intersectWithHistory`。存在性判据会把 brepkit 的 `intersect` 从裸轨（无 `roleTable`）挪到历史轨——这是可观察的行为改变。
3. **保留能力表，但只留 `*WithHistory` 名字。** 否决：那是「每个引擎一个答案」的问题，表会退化成只有那 6 个调用点读的中间层；把答案留在 op 元数据里正是要纠正的错误。
4. **把这个问题并进 `engines`，给每个 op 一个能复现今天能力判决的引擎集合。** 以过度设计否决：它会把「核函数事实」编码成「引擎白名单」，于是某引擎将来拿到某个 `*WithHistory` 时，会悄悄改变该 op 声称支持的引擎集合。

## Consequences

脚本面行为不变：occt 与 brepkit 上逐 op 的判决、产物几何、以及产物是否携带 `roleTable` 全部一致。判决等价不再是口头论证，而是被钉住的事实——`packages/core/test/brep/engine/engine-verdict-equivalence.test.ts` 把删除前的判决数据冻结成字面量，逐 op 断言集合相等，任何漂移都会以 diff 形式暴露。

两处有意为之的差异，均不在脚本面上：

- **错误文案。** 原先能力门的拒绝文案是 `E_BREP_UNSUPPORTED: current engine lacks capability 'X' (brepEngineId=…)`；同一情形现在走引擎门，文案为 `E_BREP_UNSUPPORTED: op 'Y' requires engine occt (current=brepkit)`。若宿主匹配了旧文案会受影响。
- **`brep_mock`。** 能力门对测试替身同样生效——它的声明是空对象——故凡声明过能力的 op 在 `brep_mock` 上一律被静态拒绝；现在一个都不拦。`packages/core/test/brep/engine/engine-switch.test.ts` 钉住了 occt 段与 mock 段恢复对称后的行为。

`packages/core/src/api/surface/capability-map.json` 与其生成器刻意不动：它们是「每个 op 调了哪些内核方法」的构建期审计产物，从不参与分派。
