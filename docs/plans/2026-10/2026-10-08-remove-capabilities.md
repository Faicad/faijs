# 删除 capabilities，改由 engines 表达

> 方案出处：DeepSeek-V4.1-Flash + WorkBuddy
>
> 日期：2026-10-08

## 一、目标与约束

**目标**：删除 `capabilities` 这条声明轴——`BrepCapabilities`（`packages/core/src/brep/engine/types.ts:385-414`）、`engineCapabilitySet` / `firstMissingCapability`（`packages/core/src/cad-runtime/backend-dispatch.ts:94-121`）、`BrepCapabilityName`（`:64-71`）、`defineOp.capabilities`（`packages/core/src/define-op.ts:114`）、`arg-spec` 中各条 `capabilities`、以及三个适配器里的 `capabilities` 对象。op 是否可在某引擎上执行，一律由 `engines` 表达。

**约束**：对外行为不变。这里的「对外」= 脚本面可观察的行为：

- 各 op 在 occt / brepkit 上「可执行 / 静态拒绝 / 静态降级」的判决不变；
- 产物几何不变；
- 产物是否携带 `roleTable`（面/边能否按 role 引用）不变；
- `cad.*` 命名空间与各包导出面不变。

**非目标**：本次不改 L1 方法集、不改几何实现、不改命名机制。错误文案与测试替身（`brep_mock`）的行为不在「对外」范围内，但变化必须逐条列明（§四）。

## 二、capabilities 在运行时只有三处作用

| # | 作用 | 位置 | 处置 |
| --- | --- | --- | --- |
| 1 | 静态门禁：声明能力缺失 → brep 模式报错 / auto 模式降级 | `define-op.ts:459-460` → `backend-dispatch.ts:330-335`（报错）、`:340-348`（降级） | 可由 `engines` 完全替代（§3.1） |
| 2 | op 实现体内选实现轨（调 `*WithHistory` 还是裸方法） | 6 处：`api/boolean.ts:103`、`api/chamfer.ts:237`、`api/shell.ts:89`、`api/transform.ts:148-151`、`api/brep-operations/topologyFns.ts:239`、`:287` | 不能删，必须替换（§3.2） |
| 3 | 无消费方的字段 | `assembly` / `meshLift` / `heal` / `advSurface` / `exact` / `brepExport` / `exactMeasurement` / `tessellationModel` | 直接删（§3.3） |

## 三、替代设计

### 3.1 门禁：`capabilities: [N…]` → `engines`

**替换规则 R1**（对每条 brep-op）：

- 声明的每个能力名都被 brepkit 声明 → **删除该声明**，op 变中立；
- 否则 → **`engines: ['occt']`**。

**为什么等价**：两个真实引擎的声明面是已知常量。occt 声明了全部 `*WithHistory`（`adapters/occt.ts:33-46`）与全部方法（`:59-154`），故「能力门在 occt 穿过」恒真；brepkit 的声明是 `evolution: ['fuseWithHistory','cutWithHistory','filletWithHistory']`（`adapters/brepkit.ts:47`）加一份方法名单（`:48-125`）。于是：

- occt：原判决恒为「通过」；`engines:['occt']` 亦通过。一致。
- brepkit：原判决恰在「brepkit 缺该名」时拒绝/降级；`engines:['occt']` 恒拒绝/降级。两者判决同为「拒绝/降级」，仅理由不同。一致。

**逐条核对结果**：现有 `capabilities` 声明中，只有两个 op 的集合含 brepkit 缺失的名字——

- `roof`：`["buildTriFace","dispose","fixShape","isValid","sew","sewAndSolidify"]`，brepkit 缺 `buildTriFace` / `isValid` / `sew`；
- `locate`：`["composeTransform","dispose","hashCode","locate"]`，brepkit 缺 `composeTransform`。

其余声明（`['directEdit']` 16 处、`union` 的 `fuseWithHistory`（`api/boolean.ts:306`）、`cut`/`subtract` 的 `cutWithHistory`（`:337` / `:364`）、`linearPattern`、`torus` / `drill` / `pocket` / `boss` / `mirrorJoin` / `convexHull` / `makeBaseBox` / `ellipsoid` / `rotate` / `mirror` / `clone` / `applyMatrix` / `section` / `fixShape` / `healSolid` 等）所涉名字 brepkit 全部声明 → 直接删除。另有若干 op 已同时声明 `engines:['occt']`（`api/draft.ts`、`api/punch-hole.ts`、`api/sketch-on-face.ts`、`api/feature-repair.ts` 的 `reverseShape`），删掉 `capabilities` 即可。

**最终以生成式校验为准**（§六），不依赖本表的人工核对。

### 3.2 实现轨选择：唯一的「确实需要」，用引擎身份替代

作用 2 删不掉，因为它要回答的是「当前引擎是否原生提供某个 `*WithHistory`」。这条事实真实存在且逐方法不同：brepkit 提供 `fuse` / `cut` / `fillet` 三员原生面演化，不提供 `chamfer` / `shell` / `translate` / `rotate` / `scale` / `mirror` / `intersect`（`adapters/brepkit.ts:42-47`、`adapters/occt.ts:26-46`）。

**替代**：新增一个引擎键判据模块（如 `packages/core/src/brep/engine/native-history.ts`），只暴露一个函数：

```ts
/** 当前引擎是否原生实现该 *WithHistory（静态；读引擎身份，不读声明表）。 */
export function hasNativeHistory(kind: BrepEvolutionKind): boolean
```

实现即「按 `getBackends().config.brepEngineId` 派生」：`occt` → 真；`brepkit` → 命中 `{fuseWithHistory, cutWithHistory, filletWithHistory}` 才真；其它（含 `brep_mock`）→ 假。6 处调用点把 `caps.has('XWithHistory')` 换成 `hasNativeHistory('XWithHistory')`。

这条事实从「op 声明轴 + 全局查询」搬回「引擎层」，op 不再声明、不再查表，语义与你说的「一切由引擎的实现说了算」一致。

**为什么不改用「实现存在性」判据**（`typeof kernel.XWithHistory === 'function'`）：`BrepEngineApi` 把四个 `*WithHistory` 定为必需成员（`brep/engine/primitives.ts:110,288,294,300`），brepkit 的 `primitives` 对象**四个都给**（`brepkit-kernel/brepkitKernel.ts:1437-1449`，含 `intersectWithHistory`）。改用存在性判据会让 brepkit 的 `intersect` 从「裸调用、无 roleTable」变成「走历史路径、有 roleTable」——这是行为改变，与「对外不变」冲突。该不一致本身需要单独处理（§4.3）。

### 3.3 死字段

`assembly` / `meshLift` / `heal` / `advSurface` 四个布尔与 `exact` / `brepExport` / `exactMeasurement` / `tessellationModel` 四个字段：无任何 op 声明、无任何读取点（`engineCapabilitySet` 只收前五个布尔，且其中只有 `directEdit` 被 op 声明过）。整批删除，含 `BrepCapabilityName` 中的族名与 `engineCapabilitySet` 的对应行。

## 四、影响分析

### 4.1 对外不变（逐条论证）

1. **op 判决**：occt 上所有 op 原本就通过能力门，删表后无门或 `engines:['occt']`，仍通过。brepkit 上原先被拦的（`roof` / `locate`）改用 `engines:['occt']` 后仍被拦；原先不被拦的删掉声明后仍不被拦。判决一致。
2. **几何与命名**：作用 2 的判据按引擎键镜像今天的声明（同一引擎 → 同一路径），故 `roleTable` 有无、面演化数据不变；作用 1 原本不产任何几何。`fillet` 等不查表的 op 不受影响（`api/fillet.ts:130-144` 本就不分支）。
3. **脚本面**：`cad.*` 命名空间（`api/api-namespace.ts:128-213`）不含任何 capabilities 相关项，不变。

### 4.2 受影响项（均非生产对外面）

1. **错误文案**：原先能力门的文案是 `E_BREP_UNSUPPORTED: current engine lacks capability 'X' (brepEngineId=…)`（`backend-dispatch.ts:331-334`）；改后同类情形走引擎门，文案为 `E_BREP_UNSUPPORTED: op 'Y' requires engine occt (current=brepkit)`（`:303`）。判决相同、文案不同。脚本或宿主若匹配文案会受影响；`packages/core/test/brep/engine/engine-switch-declaration.test.ts` 的 GOTCHA-1 正是钉文案的用例，必须同步改写。
2. **`brep_mock` 不再因能力拦截**：mock 的声明是空对象（`adapters/brep-mock.ts:462-464`），今天所有带 `capabilities` 的 op 在 mock 上都被能力门拦下；删表后 mock 不再拦截任何 op。仅影响测试面，且与 `backend-dispatch.ts:294-297` 注释所称「mock 的能力全给」一致化。需改：`registry.test.ts`、`brepkit-*-fix.test.ts`、`evolution-declaration.test.ts` 中依赖该拦截的断言。
3. **构建期链路**：`arg-spec.ts` 的 `capabilities` 字段、`packages/core/scripts/gen-*.ts` 模板、以及由它们生成的 `api/generated/*.ts` 必须同批更新并重新生成，否则生成物与来源漂移；`arg-spec-capabilities.test.ts` 的「三方一致」口径改为只认 `engines`。

### 4.3 一处必须记录的既有不一致

brepkit 的实现面**提供** `intersectWithHistory`（`brepkit-kernel/brepkitKernel.ts:1446`，与 `cutWithHistory` / `fuseWithHistory` 并列），但声明面**未列出**它（`adapters/brepkit.ts:47`）。后果是 `api/boolean.ts:99-103` 在 brepkit 上让 `intersect` 走裸路径、不产 `roleTable`。

本方案按「保持现状」处理（判据镜像声明），因此**不修复**它。该不一致应作为独立事项决定：要么补声明让 brepkit 的 intersect 也走历史路径（行为增强，需几何验证），要么从实现面移除该未声明方法。二者都改动对外行为，不属本次范围。

## 五、实施步骤

1. 新增 `packages/core/src/brep/engine/native-history.ts`；改 6 处 op 体分支（§3.2 清单）改用 `hasNativeHistory`。
2. 门禁层删除：`backend-dispatch.ts` 的 `BrepCapabilityName` / `EngineCapabilitiesLike` / `engineCapabilitySet` / `firstMissingCapability` 与 `decidePath` 的能力分支（`:320`、`:330-335`、`:340-348`）；`dispatchPath` 去掉 `requiredCapability` 形参；`define-op.ts` 去掉 `capabilities` 字段（`:114`、`:179`、`:388`、`:566-567`）与 `firstMissingCapability` 调用（`:459`）。
3. 类型与配置删除：`brep/engine/types.ts` 的 `BrepCapabilities`；`registry.ts:20-24` 的 `BrepEngine.capabilities`；`runtime.ts:586-588` 的 `brepCapabilities` getter；`runtime-state.ts:63` 的配置字段；`brep/brep-chain.ts` 中透传 `engine.capabilities` 的三处；`occt.ts:169-183` / `brepkit.ts:40-134` / `brep-mock.ts:462-464` 的 `capabilities` 对象。
4. op 声明：删除全仓 `capabilities: [...]`（含 `packages/sketch/src/op.ts`、`api/replicate.ts`、`api/generated/*`）；`roof` 与 `locate` 改为 `engines: ['occt']`。
5. 构建期：`arg-spec.ts` 移除 `capabilities` 字段，更新 `packages/core/scripts/` 下的生成器，重新生成 `api/generated/*.ts`。
6. 测试改写与新增（§六）。
7. 注释清理：`api/boolean.ts`、`api/chamfer.ts`、`api/shell.ts`、`api/transform.ts`、`api/draft.ts`、`api/fillet.ts` 等处的「能力路由 / 能力表」措辞改为「引擎判据」。

## 六、验证（固化为测试）

全部探针保存为长期测试，禁止一次性探针文件。

1. **判决等价性测试**（新）：对 occt / brepkit 两个真实引擎，逐 op 断言「旧能力门判决 == 新 `engines` 判决」。这是 R1 的直接证据，取代人工核对。
2. **判据测试**（新）：断言 `hasNativeHistory` 在 `{occt, brepkit}` × `BrepEvolutionKind` 全 12 员上的取值等于删除前 `evolution` 声明的取值。**同时钉住两值**：当前值（镜像声明）与「应有正确值」——即 brepkit 实现面已有 `intersectWithHistory`（`brepkitKernel.ts:1446`）这一事实，写成一条带说明的待翻转断言。
3. **不得删除既有守卫**：`engine-switch-p3.test.ts` 的「声明 ⊆ 实例」、`engine-switch-p2`、`capability-routing.test.ts` 按新口径保留等价语义。
4. **回归**：几何与命名回归用既有 brepkit 修复用例（`brepkit-intersect-fix.test.ts`、`brepkit-batchA/B/C-fix.test.ts`、`brepkit-clone-fix.test.ts`）证明 `roleTable` 有无与产物不变。
5. **门禁**：`npm run doc-sync` 及 `tsc` 全绿（先记录既有失败项，不得把新失败混入既有失败）。

## 七、不含在本次范围

- `packages/core/src/api/surface/capability-map.json` 与 `packages/core/scripts/gen-capability-map.ts`：构建期审计产物，不参与运行时分派，其存废单独判定。
- brepkit `intersectWithHistory` 声明不一致的修复（§4.3）。
