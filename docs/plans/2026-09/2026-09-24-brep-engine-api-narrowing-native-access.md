# BREP 引擎契约面收窄与原生能力直通（2026-09-24）

**状态：决策已完备（§6 全表 12 项，无遗留待拍板），可按 §4 的 Phase 1 → 8 开工。**

## 0. 用户要求（原文）

> 「我们不能采用 brepjs 的做法。必须 BrepEngineApi 默认提供的是 occt/brepkit 都有的方法。然后要可以直接访问底层的能力，但是不能伪造成 BrepEngineApi。我们的内核运行时是固定的。代码方是知道的。可以绕过 BrepEngineApi 调用，但此时一定是在写平台特定的功能。比如小程度端一定是 brepkit，它自己知道。」

拆解成四条硬约束：

1. `BrepEngineApi` **只放 occt 与 brepkit 双方都真有实现的方法**（交集面）；
2. 单方独有的能力**不得**以任何形式混进 `BrepEngineApi`（不补桩、不返回假值、不塞可选槽）；
3. 底层内核能力**可以直接访问**，但访问点必须是**显式的、平台特定的、类型真实的**；
4. 绕过 `BrepEngineApi` 的调用一律视为「正在写平台特定功能」——**内核运行时是固定的，代码方自己知道是哪个内核**，因此这类代码必须自证平台身份。

不采用 brepjs 的做法，即：**不**用「宽接口 + 方法全必需 + 实现体抛 UnsupportedKernelOperationError」的模型，也**不**用「能力接口族 + `'x' in kernel` 运行时探测」的模型。理由见 §3 D1/D5。

---

## 1. 目标态：三层能力面

| 层      | 名称                    | 内容                                                                             | 谁在用                         | 缺失时                                    |
| ------ | --------------------- | ------------------------------------------------------------------------------ | --------------------------- | -------------------------------------- |
| **L1** | 中立契约面 `BrepEngineApi` | 双方**语义可对齐**的能力（方言差异由适配器消化，判据见 §3.6），两适配器都真实现                              | 可移植代码（引擎无关 op、cad 脚本面、第三方库） | 编译期守卫报错（不是运行时）                         |
| **L2** | 平台原生面                 | occt-wasm `OcctKernel`（201 方法）/ brepkit-wasm `BrepKitKernel` 实例本身，**原样类型，零归一** | 平台特定代码                      | 不适用（平台自己保证）                            |
| **L3** | 能力声明面                 | `BrepCapabilities.methods` / `evolution` 逐名声明                                  | `backend-dispatch` 静态判定     | 执行前 `BrepUnsupportedError` / 静态降级 mesh |

判定「某段代码是不是平台特定代码」的**唯一判据**：**它是否 import 了平台模块**（`occt-kernel/*` 或 `brepkit-kernel/*`）。是 → 平台特定，直接调原生方法；否 → 只能用 L1，能力靠 L3 声明。

**引擎身份的取值**（实测常量，不是新发明）：`'occt'`（`adapters/occt.ts:23`）、`'brepkit'`（`adapters/brepkit.ts:16`）、`'brep_mock'`（`adapters/brep-mock.ts:29`），运行时读 `getBackends().config.brepEngineId`。`engines` 字段里就写这三个字符串，类型收窄为 `BrepEngineId`（由上述常量导出联合类型，禁止裸 `string`）。

### 1.1 平台特定代码的约束（硬）

- 平台模块不得被中立路径静态引用。小程序装配只注册 brepkit，`occt-kernel` 的动态 `import('occt-wasm')` 永不触发（`brep/engine/adapters/brepkit.ts:7-8`，2026-09-24 实测）；若中立模块静态 import 了 `occt-kernel/occtKernel`，occt-wasm 会被拉进小程序 bundle → 404。
- 平台特定 import 只允许出现在：① 该平台的适配器文件；② 明确标注 `@platform occt` / `@platform brepkit` 的 op 实现文件。

### 1.5 脚本面（cad 命名空间）与引擎契约面的关系

**结论：`.fai.js` 脚本调不到 `BrepEngineApi` 的任何方法。** 二者是不同层的两个名字空间，脚本只能调 op，op 内部才碰引擎。

- 脚本执行期只被注入命名空间：`DirectExecutor` 持有 `namespaces`（`cad` + 各 `registerLib` 绑定），没有任何内核/后端入口（`cad-runtime/direct-executor.ts:207/672`，2026-09-24 实测）。脚本里写不出 `kernel.makeBox(...)`。
- **cad 面约 63 个名字** = `api-namespace.ts:73-116` 的 44 个手写字面量 op（faijs 特有 dual op）+ `SCRIPT_FACE_OPS` 的 28 个生成 op（`api/generated/script-face-manifest.ts:16-45`），其中 9 个（`cut` `split` `linearPattern` `circularPattern` `gridPattern` `rectangularPattern` `mirrorJoin` `mirror` `clone`）被手写版覆盖。
- **名字与粒度都不同**：`cad.box` ↔ `makeBox`；一个 op 通常调多个内核方法——`capability-map.json` 实测 36 个 compat op 共依赖 64 个内核方法，且 op 还负责面命名、roleTable 传播、Result unwrap、句柄收养等 `BrepEngineApi` 不关心的事。
- **反向缺口更大**：`BrepEngineApi` 里大量方法在脚本面**没有任何入口**——`getSurfaceArea` / `getLength` / `getLinearCenterOfMass` / `getInertia` / `distanceBetween` 全都没有对应 op ⇒ 脚本里量不出面积、长度、线性质心。这是**脚本面的能力缺口**，不是引擎面缺口；本方案一并补（§6 Q4，Phase 7）。

**对本方案的两条推论：**

1. **脚本是平台无关契约**——同一份 `.fai.js` 必须能在 occt 与 brepkit（小程序端）下都跑。因此 cad 面上的 op 原则上只应依赖 L1 交集方法。当前 28 个生成的 `scriptFaceOps` 是 brep-only compat op（vendored brepjs 投影），依赖大量 occt 独有方法 ⇒ **它们正是 Phase 5 里"平台 op"的主要候选**：要么补 brepkit 实现拉回中立面，要么声明 `engines: ['occt']` 并在 brepkit 下执行前报错。
2. **第三方库也能碰到引擎**：`sdk.ts` 已导出 `getBackends`（`sdk.ts:49`）与 `getKernel(): unknown`（`brep/handle-bridge.ts:31`）。实测 `getKernel()` 的函数体返回的是 `getBackends().kernel.brep`（`:32-36`）——即**当前引擎的 L1 归一化面**，在 brepkit 下返回的是 brepkit 适配器，而它的 JSDoc 却写着 "Get the OCCT kernel instance"，返回类型还是 `unknown`，库作者必须自行断言。**名字误导 + 类型失真**，正是"伪造成 `BrepEngineApi`"的温床。因此（决策见 D12）：
   - 新增 `getBrepApi(): BrepEngineApi` 作为唯一类型化的中立出口；`getKernel()` 标 `@deprecated`（行为不变，JSDoc 纠正）；
   - D4 的 `engines` 声明**对第三方库同样适用**：库里的 dual-op 若 import 了平台模块，就必须在 `defineOp` 里写 `engines`，拦截发生在执行期（`dispatchPath`），不依赖注册期校验。

---

## 2. 现状：要清除的错误（2026-09-24 实测）

### 2.1 occt 适配器用 `as BrepEngineApi` 硬断言，编译期守卫恒真空转

| 位置                                         | 现状                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `occt-kernel/occtKernel.ts:87-112`         | `initOcctWasm(): Promise<BrepEngineApi>`，函数体内 4 处 `kernelInstance as unknown as BrepEngineApi` |
| `brep/engine/adapters/occt.ts:183/193/327` | `primitives as BrepEngineApi`、`const occtApi = primitives as BrepEngineApi`，随后直接往该对象上挂方法       |
| `brep/engine/adapters/occt.ts:367`         | `type _AssertOcctApi = AssertSatisfiesBrepEngineApi<Awaited<ReturnType<typeof initOcctWasm>>>` |

后果：`initOcctWasm` 的返回类型已被硬断言成 `BrepEngineApi`，`_AssertOcctApi` 永远成立（代码注释自己承认「编译期守卫是空转的，只有运行时测试能证明它们真在」）。**类型撒谎的连带后果已经发生过一次**：occt-wasm 原生 `linearPattern` 返回单个 compound，而硬断言后的类型声称返回 `BrepHandle[]`（`adapters/occt.ts:174-177`）。

对照：`brepkit` 适配器是**正确的形态**——`createBrepkitPrimitives()` 返回显式对象字面量（`brepkit-kernel/brepkitKernel.ts:168-607`），`_AssertBrepkitApi`（`adapters/brepkit.ts:100`）是真守卫。要清除的错误只发生在 occt 侧。

### 2.2 接口面过宽 → 适配器用 `unsupported()` 桩填满

`BrepEngineApi` 当前声明 **119** 项（`brep/engine/primitives.ts:31`，2026-09-24 实测），而 occt/brepkit 双方交集约 **66**（归一化口径，见 §4 Phase 1）。接口声明里约 **77** 项不在交集内 ⇒ brepkit 适配器被迫写 30+ 个 `unsupported('xxx')` 桩（“缺失即暴露”在语义上成立，但**接口要求它必须存在**，这本身就是伪造形态），occt 侧则靠 `as` 蒙混过关。

### 2.3 vendored 测量面绕过能力判定

`api/occt-kernel-bridge.ts:140-144` 的 `UNMAPPED_VENDORED_MEASURE_METHODS = ['area','length','linearCenterOfMass']` 在适配器上保持 `undefined`，注释写「a silent 0 is worse than a crash」。方向正确，但**缺能力应该在执行前被静态拦截，而不是留到执行期 `TypeError`**。V3 的 `mapMeasureMethods`（`:160-177`）只映射 volume/centerOfMass/boundingBox 三个，其余不映射也不声明能力名。

### 2.4 能力名体系与运行时配置不同步

`runtime-state.ts:62-69` 的 `brepCapabilities` 宽松镜像**没有 `methods` 字段**（只有 `evolution` + 族级布尔），而 `backend-dispatch.ts:47-57` 的 `EngineCapabilitiesLike` 有。运行时对象带着 `methods` 传下去（非字面量赋值不做 excess property 检查），但类型层面两处不一致，`methods` 判定目前是「能用但没被契约钉住」。

### 2.5 盘点基线数字（脚本 `.workbuddy/tmp-surface-diff.mjs`，2026-09-24 实测）

| 项                         | 数量  |
| ------------------------- | --- |
| occt-wasm `OcctKernel` 方法 | 201 |
| brepkit-wasm 导出           | 228 |
| `BrepEngineApi` 声明        | 119 |
| 归一化交集                     | 66  |
| 归一化 occt-only             | 135 |
| 归一化 brepkit-only          | 161 |

⚠️ **归一化口径（去 `get` 前缀 + 全小写）是粗的**：`chamferDistAngle`(occt) 与 `chamferDistanceAngle`(brepkit) 明明同义却没匹配上，`surfaceArea`/`faceArea`/`length`/`wireLength` 这类一对多也没收敛。**66 / 77 只表示量级，不能当验收基线**，Phase 1 必须产出人工复核过的映射表。

---

## 3. 设计决策

### D1 接口 = 交集，声明即实现

`BrepEngineApi` 的语义从「faijs 需要的全部方法」改为「**所有已注册 BREP 引擎都真实现的方法**」。任何方法进入该接口，必须同时满足：occt 适配器有真实现、brepkit 适配器有真实现、mock 适配器有（哪怕近似的）实现。三处守卫 `_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi` 因此**同时获得校验力**——这是本方案的主要收益。

**不采用 brepjs「宽接口 + 方法体内抛错」的理由**：brepjs 的 `KernelMeasureOps`（`vendored/brepjs/kernel/interfaces/measureOps.ts`）把 `volume/area/length/linearCenterOfMass/...` 全设为必需，实现不了就在方法体抛 `UnsupportedKernelOperationError`，其注释明写动机是「先试原生、撞到不支持再回退到 JS fallback」——**运行时探测 + 运行时回退**，直接违反 AGENTS.md 红线（BREP 路径由静态规则执行前判定，禁止运行时回退）。

### D2 平台方法不进接口，也不做可选槽

不设 `BrepEngineApi & Partial<OcctExtras>` 这类「可选扩展」形态。理由：可选槽与 brepjs 的 `'x' in kernel` 只是 TS 写法不同，**判定本质相同**（运行时才知道有没有），且会重蹈族级多报的覆辙（`brep/engine/types.ts:154-166` 已记录 `evolution: true` 的事故）。平台能力一律走 L2 直通。

### D3 三个访问出口（命名对称，各自类型真实）

三个出口，**都由平台模块自己导出，不挂在 `BrepEngine` 上**：

```ts
// ① 中立出口：当前引擎的 L1 契约面（可移植代码 / 第三方库唯一允许的类型化入口）
import { getBrepApi } from '@faicad/faijs/sdk'
const api: BrepEngineApi = getBrepApi()
api.getSurfaceArea(h); api.getLength(h)

// ② occt 原生面（Node / 桌面浏览器）
import { getOcctKernel } from '@faicad/faijs/occt-kernel/occtKernel'
const k: OcctKernel = getOcctKernel()
k.getLinearCenterOfMass(h); k.getInertia(h); k.section(a, b)

// ③ brepkit 原生面（小程序）
import { getBrepkitKernel } from '@faicad/faijs/brepkit-kernel/brepkitKernel'
const k2: BrepKitKernel = getBrepkitKernel()
k2.wireLength(w); k2.solidToSolidDistance(a, b)
```

| 出口 | 现状 | 本方案动作 |
|---|---|---|
| `getOcctKernel()` | `occt-kernel/occtKernel.ts:120` 已有 `getKernel(): OcctKernel`（真实类型、无断言） | **新增 `getOcctKernel` 别名**（一行 re-export），原 `getKernel` 保留不动，避免破坏存量宿主代码；新代码一律用别名，与 brepkit 侧对称 |
| `getBrepkitKernel()` | `brepkit-kernel/brepkitKernel.ts` 只有 `disposeBrepkit()` 与内部 `liveKernel`（`:154` 赋值） | **新增**，把已初始化单例以原生 `BrepKitKernel` 类型导出 |
| `getBrepApi()` | 无；只有误导性的 `handle-bridge.getKernel(): unknown` | **新增**（D12），类型化为 `BrepEngineApi`；`getKernel()` 标 `@deprecated` |

`exports` 子路径 `./occt-kernel/*` 与 `./brepkit-kernel/*` 已在 `packages/core/package.json:100-115` 存在，无需改包配置。

**禁止**新增任何 `as BrepEngineApi` / `as unknown as OcctKernel` 之类的跨层断言；新增断言一律视为回归（守卫见 §5）。

### D4 op 分两类：中立 op 与平台 op

现状：约 **30** 处 op 实现写 `const kernel = getBackends().kernel.brep as BrepEngineApi | null`（`api/geom.ts:28`、`api/chamfer.ts:194`、`api/fillet.ts:84`、`api/extrude.ts:434`、`api/boolean.ts:32`、`api/split.ts:26`、`api/pattern.ts:31` 等，2026-09-24 实测），其中大量调用 occt 独有方法（如 `chamferDistAngle`、`chamferWithHistory`、`loftAdvanced`、`getSubShapes`、`queryBatch`）。

迁移后的两类形态：

|        | 中立 op                                            | 平台 op                                                                           |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| 取内核    | `getBrepApi()`（D12，无断言）                          | `getOcctKernel()` / `getBrepkitKernel()`（D3，平台模块直连）                            |
| 调用面    | 只用 L1 交集                                         | 可调用该平台任意原生方法                                                                    |
| 能力声明   | `capabilities: [...]` 逐名（现有 `BrepMethodKind` 机制） | **只**声明 `engines: ['occt']`，**不再**声明 `capabilities`（见 D11）                       |
| 非目标平台下 | 缺能力 → `backend-dispatch` 执行前报错                   | 执行前报错：`E_BREP_UNSUPPORTED: op 'xxx' requires engine occt (current=brepkit)`      |
| 文件标注   | 无                                                | 文件头 `@platform occt`（守卫脚本据此校验已声明 `engines`，见 §5）                                 |

平台 op 的存在是**被允许的**（用户：内核运行时固定，代码方自己知道是哪个内核）；但必须**自证身份**。`defineOp` 新增 `engines?: readonly BrepEngineId[]`，缺省 = 全平台（中立 op）。完整判定规则见 D11。

### D5 能力名 = 逐核函数真名，判定单位是「名」不是「族」

沿用并扩展现有机制：`BrepMethodKind`（`brep/engine/types.ts:197-283`，83 名）+ `BrepEvolutionKind`（`:168-184`，12 名）+ `BrepCapabilities.methods`（`:309`）。`backend-dispatch.engineCapabilitySet()`（`:64-75`）把它们展开成集合，`dispatchPath`（`:130`）逐名求交。

**不采用 brepjs「能力族 + `'x' in kernel`」的理由**：`supportsConstraintSketch()` 只查 `sketchNew`/`sketchDof` 两个名字就断言整个 6 方法能力族（`vendored/brepjs/kernel/types.ts:218-264`）——这正是 faijs 已认定过的事故形态（族级多报 → 静态判定放行 → 运行时崩）。族只做类型容器，判定单位必须是单个方法名。

扩展方向（Phase 5）：**只有进 L1 的测量名**才补进 `BrepMethodKind`——`getVolume` `getSurfaceArea` `getLength` `getCenterOfMass` `getBoundingBox`。`getLinearCenterOfMass` / `getInertia` / `distanceBetween` 是平台面能力，**不进能力名空间**（进了就等于宣称它是可移植能力）；它们的存在由 `engines` 声明表达，判定走 D11。

### D6 测量族的具体归属

以 2026-09-24 实测的两个内核原始面为准：

| 语义            | occt-wasm                                      | brepkit-wasm                                   | 归属                    |
| ------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------- |
| 面积            | `getSurfaceArea`                               | `surfaceArea` / `faceArea`                     | **L1 核心面**（双方都有）      |
| 长度            | `getLength`                                    | `length` / `wireLength`                        | **L1 核心面**            |
| 体积 / 质心 / 包围盒 | `getVolume` `getCenterOfMass` `getBoundingBox` | `volume` `centerOfMass` `boundingBox`          | 已在 L1，保留              |
| 线性质心          | `getLinearCenterOfMass`                        | —                                              | **L2 occt 平台面**       |
| 惯性张量          | `getInertia`                                   | —                                              | **L2 occt 平台面**       |
| 距离            | `distanceBetween`                              | `pointToFaceDistance` / `solidToSolidDistance` | 语义不完全对齐 → 先留 L2 双方各自面 |
| 曲率            | `surfaceCurvature`                             | `measureCurvatureAtSurface`                    | 先留 L2                 |

核心面方法名沿用 **faijs 中立名**（现有 `getXxx` 风格），由适配器做名字映射（brepkit `surfaceArea` → `getSurfaceArea`）；这与现有 `matrix` 方言处理同构（`brepkitKernel.ts:637` 的 `toKernelMatrix` 是唯一转换点，适配器内部消化方言，调用方只说中立口径）。

### D7 vendored 测量面收口

`wrapBrepEngineApi` 的 `mapMeasureMethods` 改为：按 **L1 能力名**映射，凡在交集内的（volume/centerOfMass/boundingBox/**area**/**length**）全部真实映射；不在交集内的（`linearCenterOfMass`）→ 不再登记进 `UNMAPPED_VENDORED_MEASURE_METHODS` 静默 undefined，而是让对应的 vendored measure op **声明能力名**（`capabilities: ['linearCenterOfMass']`），由 `backend-dispatch` 在 brepkit 下执行前报错。`UNMAPPED_VENDORED_MEASURE_METHODS` 常量在收口后删除，`measurement-parity.test.ts:211` 的缺口断言改写为「能力名声明与报错路径」断言。

### D8 mock 适配器必须实现完整核心面

`brep-mock.ts` 当前对 30+ 方法 `unsupported(...)`（`:389-412`）。接口收窄后，核心面内的方法 mock 必须**全部给实现**（哪怕近似），否则 `_AssertBrepMockApi` 失效、引擎切换测试失去意义。仍在核心面外的（occt-only 的）不再出现在 mock 对象里。

### D9 补齐是双向的：核心面要「尽量大」，不是「尽量小」

用户裁决（2026-09-24）：**「brepkit 是否需要补齐 chamfer 家族？当然必须补齐。你必须真实地查看双方都支持的 api。其他缺的也要补齐。」**

因此 Phase 1 的盘点目标不是「取一个小交集求省事」，而是**最大化核心面**：凡两侧语义可对齐的能力，一律进 L1；某一侧的适配器缺实现 → **补齐实现**（brepkit 侧欠账最多：`chamferDistanceAngle` / `chamfer2d` / `chamferV2` / `filletV2` / `surfaceArea` / `length` / `wireLength` 都在它的 wasm 能力内，当前只是没接线，见 `brepkit-only` 清单）；方言差异由适配器消化（§3.6）。只有**语义确实只有单方存在**的（如 `getLinearCenterOfMass`、`getInertia`、`section(a,b)`、`split(shape,tools[])`）才下沉 L2。

### D10 核心面命名：faijs 中立名，映射表是唯一真源

1. 核心面方法名用 **faijs 中立名**（现有 `getXxx` 风格），**不采用任何一方的原生名**；适配器内部消化方言（brepkit `surfaceArea` → `getSurfaceArea`）。与现有 `matrix` 方言同构：`brepkitKernel.ts:637` 的 `toKernelMatrix` 是唯一转换点，调用方只说中立口径。
2. **例外**：双方本来就同名且语义一致时，中立名 = 该名字（`fuse` / `cut` / `makeCylinder` 等），**不强行加 `get` 前缀**。
3. **唯一真源** = Phase 1 产出的 `api/surface/engine-method-map.json`，每条 `{ core, occt, brepkit, status }`。接口里的每个方法名必须能在该表查到，且 `status ∈ { aligned, dialect }`（守卫见 §5）。
4. 移出 L1 的方法**不再有中立名**：平台面直接用原生名（`getLinearCenterOfMass` / `getInertia` / `section` / `split` / `chamferV2` …），不发明等价中立名——发明中立名等于暗示它是可移植能力。

### D11 引擎身份判定（`engines`）的完整规则

1. **字段**：`DualOpOptions` / `DualOpMeta` 新增 `engines?: readonly BrepEngineId[]`，`BrepEngineId = 'occt' | 'brepkit' | 'brep_mock'`（由三个已存在的 id 常量导出联合类型，禁止裸 `string`）。缺省 = 全平台（中立 op）。
2. **判定位置**：`dispatchPath` 的**最前面**，先于 `mode` / `capabilities` 判定——引擎不匹配时谈能力没有意义。
3. **mock 豁免**：`brepEngineId === 'brep_mock'` 时**跳过** `engines` 判定。理由：mock 是测试替身，不代表任何真实平台（它的 `capabilities` 也是"全给"），它的职责是让编排链路（naming、Result 边界、多输出）能被测到；真实引擎下的身份校验由 parity 测试与 engine-switch 测试覆盖。此处必须有注释写明是有意为之，并有测试钉住"mock 下不拦截"。
4. **brep 模式不匹配** → `BrepUnsupportedError: E_BREP_UNSUPPORTED: op 'section' requires engine occt (current=brepkit)`。
5. **auto 模式不匹配** → 静态降级 mesh；若无 mesh 实现 → `MeshUnsupportedError: E_MESH_UNSUPPORTED: op 'section' requires engine occt (current=brepkit) and has no mesh implementation`。**与现有能力路由同构，同样禁止运行时回退。**
6. **mesh 模式**：`mode='mesh'` 分支仍在最前，平台 op 与中立 op 一视同仁（有 mesh 实现就走 mesh）。宿主强制 mesh 时不因平台身份报错。
7. **与 `capabilities` 互斥**：平台 op 直连原生面，能力由平台自己保证，**只写 `engines`，不写 `capabilities`**——写能力名会虚构一个接口里已不存在的名字。`assertLibConforms` 增加校验：两者同时出现 → 报错。
8. **注册期不校验**：`registerLib` 时引擎可能尚未装配，身份校验只在执行期发生（因此错误信息必须带 `current=<engineId>`，便于宿主定位）。
9. 第三方库同样适用：库作者若 import 平台模块，其 dual-op 必须声明 `engines`；文档约束写在 `docs/library-dev-guide.md` §7。

### D12 收敛 `getKernel(): unknown` 这个失真出口

- 新增 `getBrepApi(): BrepEngineApi`（实现在 `brep/handle-bridge.ts`，与 `getKernel` 同文件便于对照；从 `sdk.ts` 导出给第三方库），作为**唯一类型化的中立出口**；
- `handle-bridge.getKernel()` 标 `@deprecated`，**运行时行为不变**（仍是 `getBackends().kernel.brep`），只纠正 JSDoc：它返回的是当前引擎的 L1 契约面，不保证是 OCCT；需要原生面请用 `getOcctKernel()` / `getBrepkitKernel()`；
- 存量调用点（`vendored/` 与各 op）逐步迁移到 `getBrepApi()`，`getKernel` 在下一个 major 移除。

### 3.6 语义差异的三类处置（`extrude` / `section` / `split` 实测）

L1 的判据**不是「方法同名」而是「语义可对齐」**。下列签名全部取自 `node_modules` 的类型声明（2026-09-24 实测）。

| 中立语义        | occt-wasm `dist/index.d.ts`                                              | brepkit-wasm `brepkit_wasm.d.ts`                                    | 判定                     |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| 挤出          | `extrude(shape, dx, dy, dz)`——**向量分量**（`:124`，JSDoc “extrusion vector X component”） | `extrude(face, dir_x, dir_y, dir_z, distance)`——**方向 + 距离**，**只吃 face**（`:570`） | **方言差异 → 可归一，进 L1**   |
| 两形状求交线      | `section(a, b)` → 交线/顶点 compound（`:102`，`BRepAlgoAPI_Section`）              | 无（brepkit 的 `section` 是另一个操作）                                       | **occt-only → L2**     |
| 平面剖切（截面轮廓）  | 无同名（可用平面 face 作工具经 `section` 达成，**待 Phase 1 探针实测**）                        | `section(solid, px,py,pz, nx,ny,nz): Uint32Array`（`:1797`）            | 待实测；成立则进 L1 并取中立名       |
| 工具形状分割      | `split(shape, tools[])` → fragment compound（`:112`，`BOPAlgo_Splitter`）      | 无                                                                  | **occt-only → L2**     |
| 平面二分        | 无同名（可用平面 face 作 tool，**待 Phase 1 探针实测**）                                  | `split(solid, px,py,pz,nx,ny,nz): Uint32Array` → `[正半, 负半]`（`:1908`） | 待实测；成立则进 L1 并取中立名       |

> **关键事实**：brepkit 的 `section` / `split` 不是「签名不同的同一个操作」，而是**「用平面切实体」这另一个操作**；occt 的同名方法是「用形状作工具」。二者工具形态根本不同（平面参数 vs 形状句柄），**无法互相实现**——这正是 `brepkitKernel.ts:194/202/602` 三处注释「语义不同 → 保持 unsupported」的由来。

**三类处置原则：**

1. **方言差异**（参数形态 / 单位 / 方向是否归一化 / 输入类型窄化）→ 归一进 L1，适配器内部消化。`extrude` 属此类：中立签名保留 `extrude(shape, dx, dy, dz)`（向量），brepkit 适配器内 `len = |v|`、`dir = v/len` 后调原生 `extrude(face, dir, len)`；`len === 0` 抛错；输入不是 face → 抛 `E_BREP_UNSUPPORTED: brepkit extrude requires a face input`（**显式报错，不静默降级**）。
2. **工具形态不同**（形状 vs 平面）→ 不是同一操作，**拆成两个中立名**，各自按「双方是否都有该语义」判定归位。建议名 `sectionByPlane(shape, point, normal)` / `splitByPlane(shape, point, normal)`。
3. **单方有语义** → L2 平台面，对应 op 声明 `engines`。`section(a,b)`、`split(shape, tools[])` 在 brepkit 补出同语义实现之前暂时归位 L2（若将来用「平面 face + 多次二分」组合出同语义，再拉回 L1）。

#### 3.6.1 「op 声明 `engines`」具体指什么

一句话：**一个 op 的实现只要 import 了平台模块，就必须在 `defineOp` 里写出自己属于哪个平台；分派器拿这个声明和当前引擎 id 比对，不匹配就在实现跑起来之前报错。**

以 `section` 为例，目标态三段：

| 环节 | 形态 |
|---|---|
| 接口 | `BrepEngineApi`（L1）里**没有** `section` / `split`——它们只在 occt 原生面（L2）里 |
| op 实现 | `api/section.ts` 文件头标注 `@platform occt`，取内核用 `getKernel()`（`occt-kernel/occtKernel.ts:120`）而不是 `kernel.brep as BrepEngineApi` |
| op 声明 | `defineOp({ brep, engines: ['occt'], ... })` |
| 判定 | `dispatchPath` 新增分支：`config.brepEngineId ∉ engines` → brep 模式抛 `E_BREP_UNSUPPORTED: op 'section' requires engine occt (current=brepkit)`；auto 模式静态降级 mesh，无 mesh 实现则 `MeshUnsupportedError`。**不回退、不补桩、不伪造** |

为什么要「引擎身份」而不是继续用能力名：接口收窄后 `section` 已不是 `BrepEngineApi` 的方法，`capabilities: ['section']` 里的名字会变成一个**接口里不存在的虚构名**；而 op 文件既然 import 了 `occt-kernel/*`，它已经在物理上绑定 occt，`engines` 只是把这个事实显式化，且可以在**装配期**用守卫校验（import 平台模块却没声明 `engines` → 报错）。

#### 3.6.2 与现状的差别（2026-09-24 实测）

现状**没有** `engines`：`DualOpOptions`（`define-op.ts:101-122`）只有 `name / capabilities / outputs / schema / slotMap / naming`；`dispatchPath`（`backend-dispatch.ts:130-183`）没有引擎身份分支，`config.brepEngineId` 只出现在报错**文案**里（`:157`）。

现状靠的是**逐方法能力名**，它碰巧覆盖了同样的场景，但有三处不准：

- occt 声明了 `methods: [..., 'section', 'split', ...]`（`adapters/occt.ts:64/96`），brepkit 没声明（`adapters/brepkit.ts:42-79`，`:60-61` 注释明确「语义不匹配 → 保持 unsupported 不声明」）⇒ 生成的 `section` / `split` op（`api/generated/topology.ts:328/338`，`capabilities: ["dispose","isNull","section"]`）在 brepkit 下确实会被拦；
- 但 `firstMissingCapability` 只返回**第一个**缺口、`dispatchPath` 只收到**一个**名字（`define-op.ts:347-348`），而 brepkit 也没声明 `dispose` ⇒ 实际报的是 `lacks capability 'dispose'`，**归因与真实阻塞点无关**，且所有生成 op 都栽在同一个名字上，无法证伪；
- 同时 `BrepEngineApi` 仍把 `section` / `split` 声明为必需成员，brepkit 适配器只能交 `unsupported()` 抛错桩（`brepkitKernel.ts:202`、抛错体 `:79-81`）⇒ 类型说有、体里抛，这正是要清除的伪装。

对比：手写 op 声明得**精确**时机制是对的——`chamfer.ts:273 capabilities: ['chamfer','chamferDistAngle']`，occt 声明了这两个（`occt.ts:123-124`）brepkit 没有 ⇒ `engine-switch-p2.test.ts:167-169` 断言报错里同时出现 `chamfer` / `lacks capability` / `brepkit`。生成 op 的问题在于把 `dispose` 这类与实际语义无关的名字也列进了清单。

#### 3.7 两个新中立名的返回口径（决策）

| 中立名 | 签名 | 返回 | 理由 |
|---|---|---|---|
| `splitByPlane` | `(shape, point, normal)` | `outputs: ['positive','negative']`（具名双输出，与现有 `split` op 的 `naming: {kind:'subdivide'}` 形态一致） | brepkit 原生就给 `[正半, 负半]`；具名避免 `[0]/[1]` 的方向歧义（法向正侧 = `positive`） |
| `sectionByPlane` | `(shape, point, normal)` | `BrepHandle[]` | brepkit 返回 `Uint32Array`（一组边/轮廓句柄），occt 侧 `section` 返回 compound 需 downcast 展开；数组是两边都能落到的事实形态 |

**降级规则（决策）**：两者都依赖 Phase 1 探针证明 occt 侧可达（用平面 face 作 tool）。**探针失败 → 该能力降级为 brepkit-only**，即进 brepkit 平台面，op 声明 `engines: ['brepkit']`，**不进 L1**。宁可少一个中立能力，也不要一个只能在一半引擎上兑现的中立名。

#### 3.8 cad 脚本面的平台 op 规则（决策）

1. 脚本是**平台无关契约**——同一份 `.fai.js` 必须能在 occt 与 brepkit（小程序）下都跑，因此 cad 面 op **默认必须中立**；
2. 允许例外，但必须**同一份声明**：平台 op 在 `script-face-manifest` 里带 `engines` 字段，同步进 `api/generated/script-face.ts` 与 `op-set-consistency.test.ts`，不存在第二套判定；
3. 后果对宿主显式：不支持的引擎下运行含平台 op 的 `.fai.js` → 该语句 `failedAt`，信息含 `requires engine occt (current=brepkit)`；
4. UI 参数面板是否隐藏平台 op 由宿主决定，本方案只保证执行期给出可定位的失败信息。

---

## 4. 实施阶段

### Phase 1 — 双向能力盘点 + 语义对齐判定（无行为改动）

1. 把一次性脚本 `.workbuddy/tmp-surface-diff.mjs` 提升为常驻脚本 `packages/core/scripts/gen-engine-method-map.ts`，输入两侧 wasm 的真实声明（`occt-wasm/dist/index.d.ts`、`brepkit-wasm/brepkit_wasm.d.ts`），输出 `packages/core/src/api/surface/engine-method-map.json`：
   `{ coreNeutralName: { occt: 'getSurfaceArea', brepkit: 'surfaceArea', status: 'aligned' | 'dialect' | 'occt-only' | 'brepkit-only' | 'need-probe' } }`。
   **同义异名必须人工填写，禁止靠字符串归一化自动匹配**（`chamferDistAngle` ↔ `chamferDistanceAngle` 就是归一化漏网的例子）。
2. 逐条做 §3.6 的三类判定，产出三份清单：① **核心面**（含方言适配说明与中立名）；② **brepkit 补齐清单**（wasm 有、适配器没接线：`chamferDistanceAngle` / `surfaceArea` / `length` / `wireLength` / `extrude` / …）；③ **平台面清单**（单方语义，每条标注归属 `engines: ['occt']` 还是 `['brepkit']`）。
3. 对标注 `need-probe` 的（`sectionByPlane` / `splitByPlane` 的 occt 侧可达性）写探针测试（放 `brep/engine/phase1-semantic-probes.test.ts`，沿用 `phase0-kernel-probes.test.ts` 的形态），用实测结果钉死归位；**探针失败即按 §3.7 降级为 brepkit-only**，不进 L1。
4. 验收：`engine-method-map.json` 有测试断言它与两个内核的真实声明面一致；内核换版本 → 测试红。

### Phase 2 — 拆分契约面

1. `brep/engine/primitives.ts`：按 Phase 1 清单把 119 项拆成 `BrepEngineApi`（核心面，保留文件名与导出名，消费点零改名）与「移出项」；同时按 §3.6 新增中立名（`sectionByPlane` / `splitByPlane` 等）与补齐项。
2. 验收：`npm run typecheck` 一次性暴露全部受影响调用点（预期 30+ 处），作为 Phase 5 的工作清单。

### Phase 3 — 清除 occt 侧的类型撒谎

1. `occtKernel.initOcctWasm()` 返回类型改回 `Promise<OcctKernel>`（删 4 处 `as unknown as BrepEngineApi`），`getKernel()` 保持返回 `OcctKernel`；
2. 新增 `createOcctPrimitives(): Promise<BrepEngineApi>`——形态照抄 `createBrepkitPrimitives()`：**显式对象字面量、逐方法接线**，含现有 pattern 三方法组合实现与已接线的 33 个登记方法；
3. `_AssertOcctApi` 改为断言 `ReturnType<typeof createOcctPrimitives>`；
4. `adapters/occt.ts` 的 `as BrepEngineApi` 与 `occtApi.xxx = ...` 猴子补丁全部移除；
5. 验收：`occt-kernel/` 与 `brep/engine/` 下 grep `as BrepEngineApi` 零命中（做成守卫测试）；`brep/engine/*.test.ts`、`evolution-bindings.test.ts` 全绿。

### Phase 4 — brepkit 补齐 + mock 对齐（本轮重点）

1. 按 Phase 1 的「brepkit 补齐清单」**逐项接线真实现**，优先项：
   - chamfer 家族（按 §6 Q4 的粒度：只对齐**等距 + 距角**两种）：brepkit `chamfer` → `chamfer`，`chamferDistanceAngle` → `chamferDistAngle`（参数口径逐项核对：距离/角度的单位与正负定义）；`chamfer2d` / `chamferV2` **不进 L1**，留在 brepkit 平台面（原生名直连）；
   - 测量族：`surfaceArea` → `getSurfaceArea`，`length` / `wireLength` → `getLength`（wire 与 edge 的入参差异必须在适配器内判别，不可静默接受实体）；
   - `extrude`：按 §3.6 做方向/距离归一 + face 输入断言；
   - 其余清单项按同一模式推进。
2. 删除接口不再要求的 `unsupported()` 桩；
3. 新增 `getBrepkitKernel()` 导出（D3）；
4. `brep-mock.ts`：核心面全实现，移除核心面外方法；
5. 验收：每个补齐项都有 parity 测试（同一输入在 occt 与 brepkit 下语义等价，允许数值容差）；`engine-switch*.test.ts`、`capability-routing.test.ts`、`registry.test.ts` 全绿。

### Phase 5 — op 分层与平台声明

1. `defineOp` / `DualOpOptions` / `DualOpMeta` 新增 `engines?: readonly BrepEngineId[]`；`BrepEngineId` 由 `'occt' | 'brepkit' | 'brep_mock'` 常量导出（D11-1）；
2. `dispatchPath` 按 D11 加「平台身份」分支：**置于最前**，含 `brep_mock` 显式豁免（D11-3，注释 + 测试钉住）；错误文案按 D11-4/5；
3. `assertLibConforms` 增加互斥校验：`engines` 与 `capabilities` 同时出现 → 报错（D11-7）；
4. 30+ 处 `kernel.brep as BrepEngineApi` 调用点逐个分类：
   - 只用核心面 → 保持中立，取内核改用 `getBrepApi()`（D12，去掉 `as BrepEngineApi`）；
   - 用到平台面 → 改成平台 op（文件头 `@platform occt`，取内核改 `getOcctKernel()`，声明 `engines: ['occt']`）；
   - 可经 brepkit 补齐拉回中立的（chamfer 家族、`extrude`）→ 已在 Phase 4 补齐，op 保持中立；
5. 28 个生成的 `scriptFaceOps`（§1.5）按同一规则分类，平台身份按 §3.8 写进 `script-face-manifest` 并同步生成物；
6. `runtime-state.ts` 的 `brepCapabilities` 宽松镜像补 `methods?: readonly string[]`（消除 §2.4 的类型不一致）；
7. 验收：每个平台 op 一个测试（非目标引擎下执行前报错，不伪造结果）+ 一个测试（mock 下不拦截）；`capability-map.json` 重跑更新。

### Phase 6 — vendored 测量面收口

1. `mapMeasureMethods` 按 D7 扩展（补齐后的 area/length 也纳入映射）；删除 `UNMAPPED_VENDORED_MEASURE_METHODS`；
2. vendored measure op 声明能力名；
3. `measurement-parity.test.ts` 改写：不再断言「缺口存在」，改为断言「核心面测量在两引擎下都有真值 / 平台专属测量在非目标引擎下执行前报错」；
4. 验收：`npm run test -w @faicad/faijs` 与 `-w @faicad/faijs-tests` 全绿。

### Phase 7 — 脚本面测量 op 补齐（用户裁决 Q5）

1. 核心面测量稳定后，在 cad 面新增对应 op（`cad.area` / `cad.length` 等，命名待定），把 §1.5 的反向缺口补上；
2. 走三源一致通道：`arg-spec` 标 `scriptFace: true` → 重跑 `gen-l3-surface.ts` / `gen-symbol-table.ts`，`op-set-consistency.test.ts` 自动覆盖；
3. 验收：`.fai.js` 里可调用并拿到与引擎一致的值；`check()` 符号表同步。

### Phase 8 — 守卫、文档与发布

1. 新增守卫脚本 `scripts/check-platform-imports.mjs`（与 `check-ghost-deps.mjs` 同构，并入 `scripts/ci.ps1`）：
   - 中立模块集合（不含 `@platform` 标注的文件）不得 import `occt-kernel/*` / `brepkit-kernel/*`；
   - 标注 `@platform occt` / `@platform brepkit` 的文件，其 `defineOp` 必须声明对应 `engines`；
2. `docs/library-dev-guide.md` §7 调用矩阵补「平台 op 与 `engines` 声明」一节（第三方库作者视角）；
3. `docs/api-contract.md` 补 L1/L2/L3 三层与 `engines` 判定（契约层同步）；
4. 新增 Agent Note：`.agents/notes/implemented/architecture/2026-09-24-brep-engine-api-narrowing.md`；
5. 版本号：本方案是**契约面破坏性变更**（`BrepEngineApi` 方法移出、`getKernel` 语义纠正），随下一个 **major** 发布；过渡期**不留兼容别名**（一次性切换，避免延长债务）。


## 5. 守卫清单（防回归）

| 守卫        | 形态                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 接口完整性     | `_AssertOcctApi` / `_AssertBrepkitApi` / `_AssertBrepMockApi` 三处编译期断言（Phase 3 后全部真生效）                 |
| 禁止跨层断言    | 测试/grep 守卫：`occt-kernel/`、`brep/engine/adapters/` 下不得出现 `as BrepEngineApi`、`as unknown as OcctKernel` |
| 核心面 == 语义对齐面 | 测试断言 `BrepEngineApi` 的每个方法名在 `engine-method-map.json` 里状态为 `aligned` / `dialect`，且**没有** `*-only` 混入 |
| 命名真源        | 反向同样断言：`engine-method-map.json` 里 `status ∈ {aligned, dialect}` 的条目必须在接口里出现（D10-3，防"该进核心面的漏在外面"）            |
| 无桩断言            | 测试断言两适配器上每个核心面方法都是 function，且调用不返回 `unsupported` 桩（brepkit 补齐项逐条覆盖）                                 |
| 平台隔离      | 脚本守卫 `scripts/check-platform-imports.mjs`（Phase 8）：中立模块不静态 import 平台模块（保护小程序 bundle）                 |
| 平台身份自证    | 同一脚本断言：标注 `@platform occt` / `@platform brepkit` 的文件，其 `defineOp` 必须声明对应 `engines`                 |
| 能力声明诚实    | 已有 `evolution-declaration.test.ts` 模式扩展到 `methods`：声明了名字 → 适配器上必须是 function                           |
| 平台 op 拦截  | 每个平台 op 两个测试：非目标引擎下执行前抛错；`brep_mock` 下不拦截（D11-3）                                                   |
| 声明互斥      | `assertLibConforms`：`engines` 与 `capabilities` 不得同时出现（D11-7）                                            |

---

## 6. 决策记录（全部已决，2026-09-24）

「来源」列：`用户` = 用户当面裁决；`代选` = 用户授权「帮我选一个最合适方案」后由我选定，可推翻。

| # | 议题 | 裁决 | 理由 | 来源 |
|---|---|---|---|---|
| Q1 | 平台身份用什么声明 | **`engines: ['occt']` 字段（引擎身份）**，不是能力名前缀 | 接口收窄后 `capabilities: ['section']` 会变成接口里不存在的虚构名；而 op 既然 import 了平台模块就已物理绑定该平台，`engines` 只是把事实显式化，且能在装配期用脚本守卫校验（§3.6.1） | 用户 |
| Q2 | `extrude` / `section` / `split` | 按 §3.6 三类：`extrude` 方言差异 → 归一进 L1；`section(a,b)` / `split(shape,tools[])` 工具形态不同 → 降为 occt 平台面，另立 `sectionByPlane` / `splitByPlane` | 有真实签名依据（`node_modules` 类型声明），brepkit 同名方法是「平面切实体」另一操作 | 用户 |
| Q3 | brepkit 是否补齐 | **必须补齐**，且不限于 chamfer——凡双方 wasm 都支持、只是没接线的全部补齐（D9） | 核心面要「尽量大」而非「尽量小」 | 用户 |
| Q4 | 脚本面测量 op | **补**（Phase 7），走三源一致生成通道 | 脚本量不出面积/长度是真实缺口 | 用户 |
| Q5 | 核心面方法名以谁为准 | **faijs 中立名**（`getXxx`），适配器消化方言，`engine-method-map.json` 为唯一真源（D10） | 与现有 `toKernelMatrix`（`brepkitKernel.ts:637`）同构——方言消化点收在适配器内，调用方只说中立口径；双方同名时直接用原名，不强行加 `get` | 代选 |
| Q6 | `splitByPlane` / `sectionByPlane` 返回口径 | `splitByPlane` → `outputs: ['positive','negative']`；`sectionByPlane` → `BrepHandle[]`；**探针失败即降级 brepkit-only，不进 L1**（§3.7） | 具名双输出避免法向正负歧义；宁可少一个中立能力，也不要只有一半引擎能兑现的中立名 | 代选 |
| Q7 | chamfer 家族对齐粒度 | **只对齐等距 + 距角**（`chamfer` / `chamferDistAngle`）；`chamfer2d` / `chamferV2` 留 brepkit 平台面 | `chamfer2d` 是草图级能力，occt 侧由 sketcher 承担；`chamferV2` 语义未核实。拉进 L1 会逼 occt 补桩 | 代选 |
| Q8 | mock 引擎是否参与 `engines` 拦截 | **豁免**：`brep_mock` 跳过判定，注释写明有意为之 + 测试钉住（D11-3） | mock 是测试替身不代表真实平台（其 capabilities 也是全给），价值在于让编排链路可被测试；真实引擎的身份校验由 parity / engine-switch 测试覆盖 | 代选 |
| Q9 | `getKernel(): unknown` 这个失真出口 | 新增 `getBrepApi(): BrepEngineApi`；`getKernel()` 标 `@deprecated`、行为不变、JSDoc 纠正（D12） | 保留存量宿主代码可用，同时给库作者一条类型真实的中立出口，堵住「自己断言成 BrepEngineApi」的口子 | 代选 |
| Q10 | 平台原生入口命名 | occt 侧新增 `getOcctKernel()` 别名（原 `getKernel` 保留不动），brepkit 侧新增 `getBrepkitKernel()`（D3） | 两侧对称；不动存量导出名以免破坏宿主，新代码统一用别名 | 代选 |
| Q11 | cad 面能否出现平台 op | 允许，但**用同一份 `engines` 声明**写进 `script-face-manifest` 与生成物，不支持的引擎下执行前 `failedAt`（§3.8） | 不存在第二套判定；UI 是否隐藏由宿主决定，引擎侧只保证失败可定位 | 代选 |
| Q12 | 兼容与发布 | **major 一次性切换，不留兼容别名** | 契约面破坏性变更；faijs 处于高频重构期，留别名只会延长债务 | 代选 |

---

## 7. 不做的事（明确非目标）

- 不为缺失能力补桩、不返回假 0 / 假空数组（沿用 `occt-kernel-bridge.ts:136-138` 已确立的原则）；
- 不做运行时能力探测与运行时回退（AGENTS.md 红线）；
- 不引入 brepjs 的 `UnsupportedKernelOperationError` / 能力族 / `'x' in kernel` 模型；
- 不改 mesh 引擎槽、不改双槽正交结构；
- 不为「第三引擎」预留抽象：引擎集合固定为 `'occt'` / `'brepkit'` / `'brep_mock'`，`BrepEngineId` 是这三个的联合类型，不做可注册任意 id 的开放设计；
- 不重命名既有 cad 面 op（Phase 7 只**新增**测量 op，不动 `cad.box` 等 63 个名字）；
- 不给 mock 补真实几何（mock 只保证核心面方法可调用、返回值形态正确，数值不参与 parity 断言）。
