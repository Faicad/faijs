# BREP 内核取用与能力声明契约（库作者 / 库调用方）

> 状态：方案（定稿，四项决策已拍板）
> 方案出处：deepseek-V4.1-Flash + Workbuddy
> 日期：2026-10-14

## 0. 用户要求（原文）

### 0.1 问题

> 齿轮库契约缺口在 0.34.2 仍未修的问题，请告诉我你的修复方案

> 1. getBrepEngine('occt').primitives这个api很奇怪啊。既然要获取通用的getBrepEngine，为何还要主动传入名字，感觉是api设计错误。

> 2. 目前代码里称为BrepEngine，更合适的称呼是BrepKernel，当然这个改动很大。你判断是否要改名。

> 3. 之前每个库都犯的通用的错误。就是本项目没有为库的开发者写明如何获取brep内核，如何写出跨内核的通用方法，又如何单独调用某个内核的特殊能力。虽然op层有一个engine申请。但是库编写者在这个方面完全是随心所欲，导致各种bug层出不穷。比如库自己去实例化一个occt实例这种事情没少干过，和faijs的occt实例就冲突了。

> 4. 从库的调用方看，无法知道这个库到底需要什么内核。或者说给定一个内核，这个库的哪些方法可以调用，哪些零件是可以生成的。

### 0.2 拍板

> 要改就一次性改到位，不能半截子。

> ① 库级声明，既然有函数级别fn.engines ，库级声明绝对不是重复它。而是更高维度的声明。比如../faijs_freecad这个项目，如果它有库，一定是只能在occt上运行的库。因为freecad是依赖occt的。而../faijs_freecad是要兼容freecad的。

> ② 函数没写 fn.engines 时 ， 选 A

> ③ getBrepEngine(id?) 的签名改不改， 选 A 一次改到位

> ④ 齿轮到底算不算"只能跑 occt"的库 ，如果brepkit一个齿轮零件都无法完成建模，自然是只能occt的。

## 1. 目标

四条要求指向同一件事：**「库怎么拿内核」目前没有唯一契约**。本文把四件事收敛成一份契约：

1. 库取内核有唯一出口（§3.1）；
2. 跨内核方法与平台专属能力有明确分界（§3.1）；
3. 库对内核的要求**分两级**声明——库级定定位、函数级记例外（§3.3）；
4. 调用方能按引擎反查可用函数（§3.3 第 4 项）。

本方案只写当前设计与目标设计，事实全部落到代码路径与行号。

## 2. 现状（当前代码）

### 2.1 内核取用面的现有出口

| 出口 | 位置 | 返回 | 性质 |
|---|---|---|---|
| `getBrepApi()` | `packages/core/src/brep/handle-bridge.ts:56` | `BrepEngineApi` | 中立 L1 面；库取内核的正规出口 |
| `getKernel()` | `packages/core/src/brep/handle-bridge.ts:37` | `unknown` | 标 `@deprecated`；返回**当前引擎的原生内核**（不限 occt） |
| `getKernel()` | `packages/core/src/occt-kernel/occtKernel.ts:185` | `OcctKernel` | 与上一条**同名不同义**的公共导出 |
| `getOcctKernel` | `packages/core/src/occt-kernel/occtKernel.ts:196` | `OcctKernel` | 平台面出口（`getKernel` 的别名） |
| `getBrepkitKernel()` | `packages/core/src/brepkit-kernel/brepkitKernel.ts:1965` | `BrepKitKernel` | 平台面出口；函数名小写 `k`、类型名大写 `K`，不一致 |
| `getBackends().kernel.brep` | `packages/core/src/cad-runtime/runtime.ts:624` 接线，值来自 `packages/core/src/brep/brep-chain.ts:135`（`engine.primitives`） | 无类型 | 裸槽位，无编译期约束 |
| `getBrepEngine(id?)` | `packages/core/src/brep/engine/registry.ts:121` | `BrepEngine`（`registry.ts:19`：`{ id, primitives }`） | **可选 id**：无参取当前引擎、有参取具名引擎 |
| `getActiveBrepEngineId()` | `packages/core/src/brep/engine/registry.ts:155` | `string \| null` | 当前引擎 id |

`getBrepEngine(id?)` 把两个意图（取当前引擎 / 按 id 查注册表）压进一个可选参数，而库作者要的是第三种东西——中立方法面，它另有出口 `getBrepApi()`。`docs/library-dev-guide.md` §3.1.1 的宿主 bootstrap 样例用的是 `await getBrepEngine(OCCT_BREP_ENGINE_ID)`（宿主装配期，正确用法），但该样例会被当作「取内核的标准写法」搬到库代码里。

**实际调用形态（实测）**：全仓共 86 处调用，其中**无参 78 处**（`getBrepEngine()`，全部是"取当前引擎"）、传参 8 处（`'occt'` ×3、`'counting'` ×2、`'remus'` ×1、`'nope'` ×1，另一处是签名声明）。78 处无参调用的分布：`packages/core/src` 仅 **3** 处（`brep-chain.ts:132`、`primitives-brep.ts:66`、`runtime.ts:662`），其余 **75** 处在 `packages/core/test` 与 `packages/sheetmetal/test`。下游两仓：`animation` **0** 处；`3d_editor` **1** 处（`packages/platform/src/weapp/faijs.worker.ts:160`，且已是传参形态 `getBrepEngine(BREPKIT_BREP_ENGINE_ID)`）。

### 2.2 绕过正规出口的实际写法

裸槽位加断言在本仓核心代码里就有 7 处：`packages/core/src/extra/ops/copy.ts:29`、`fai_drill.ts:81`、`fai_drill.ts:151`、`fai_extrude.ts:31`、`fai_split.ts:34`、`svg-extrude.ts:36`、`text.ts:42`，全部形如 `getBackends().kernel.brep as BrepEngineApi | null`。

第三方库里两处：

- `packages/faijs-fasteners/src/kernel.ts:23`：`getBackends().kernel.brep as BrepEngineApi | null`
- `packages/faijs-gears/src/kernel/gears.ts:91`：`getBackends().kernel?.brep`，`:92` 断言成 `GearKernel`（`BrepEngineApi` 与其 15 个 occt 平台扩展的并集），`:97` 未配置 backend 时兜底 `initOcctWasm()` 自建内核

`gears.ts:91-92` 是用户第 3 条所指现象的标本：一个**契约上中立**的槽位被断言成平台面，缺的方法只在齿轮构建深处以 `kernel.X is not a function` 爆出，且失败被 op 层压成通用 `E_OP_FAILED`（`packages/core/src/api/internal/result-unwrap.ts:83`）。

### 2.3 库作者契约的现有归属与覆盖

`docs/library-dev-guide.md` 已覆盖：`engines` 声明（§2.4）、平台 op 与 `engines` 规则（§4.4）、宿主 bootstrap（§3.1.1）、移植 brepjs 库时删除 `registerKernel`（§6）。

三处缺口：

1. §4.4 把平台身份规则的权威出处写作「narrowing plan」——一份 `docs/plans/` 文档，且按归档规则已进入 `docs/plans/yyyy-mm/`。`docs/AGENTS.md` 规定非 `docs/plans/` 文档严禁引用 `docs/plans/` 文档、必须自包含；`AGENTS.md` 规定每条规则只有一处权威归属。库作者因此无据可依。
2. 手册**没有**「库如何取得内核」的独立章节：`getBrepApi()` 只在 §2.4 的平台 op 说明里作为反例出现一次，`getOcctKernel()` / `getBrepkitKernel()` 全篇未提，`initOcctWasm()` 的禁止也没写进 §2.8 硬约束。
3. 守护规则存在但覆盖面与挂载都不成立：
   - `scripts/check-platform-imports.mjs`（已挂 `scripts/ci.ps1:179`）管的是平台模块 import 隔离与 `@platform` 文件的 `engines` 自证，不管取内核。
   - `scripts/check-lib-layering.mjs` 恰好就是第 3 条要的那套规则（禁 `occt-wasm` / 禁 `initOcctWasm` / 禁 `getGearKernel` / 禁 `as any` / 禁 `OcctKernel` 类型），但 `pkgRoot` 硬编码为 `packages/faijs-fasteners`（`:20`），**且 `package.json`、`scripts/ci.ps1`、`scripts/ci.sh` 全都没有引用它**——它只会被人手工敲命令时才跑。实际出事的 `faijs-gears` 从未被这份门禁覆盖。

### 2.4 op 级能力声明的现状与唯一缺口

op 级声明链**已经完整**：

| 环节 | 位置 |
|---|---|
| 声明位 | `packages/core/src/define-op.ts:124`（`DualOpOptions.engines`） |
| 元数据 | `packages/core/src/define-op.ts:182`（`DualOpMeta.engines`） |
| 合法性校验 | `packages/core/src/define-op.ts:567-577`（`assertLibConforms` 比对 `BREP_ENGINE_IDS`） |
| 引擎 id 集合 | `packages/core/src/brep/engine/types.ts:21`（`['occt','brepkit','brep_mock']`） |
| 透传 | `packages/core/src/api/internal/compat-op.ts:168,176`（`compatOp` 已解构并转发 `engines`） |
| 执行前拦截 | `packages/core/src/cad-runtime/backend-dispatch.ts`（`dispatchPath` 按 `config.brepEngineId` 静态判定，拒绝文案 `E_BREP_UNSUPPORTED: op<label> requires engine <ids> (current=<id>)`，`:226`） |

**缺口在覆盖范围，不在机制**：一个用裸函数导出全部 API 的库（`faijs-gears` / `faijs-fasteners` / `@faicad/sheetmetal` 都是这种形态）**没有声明入口**。`packages/core/src/cad-runtime/admit-compat-lib.ts` 的头注释确立了「裸函数的唯一契约名是 `fn.outputs`」，即裸函数目前只有输出注解、没有引擎注解；提升出的 op 的 `engines` 恒为 `undefined`，被当作中立 op，在 brepkit 会话下放行到内核深处才失败。

库级聚合声明不存在。内置面有一份生成的清单 `packages/core/src/api/generated/script-face-manifest.ts`（`SCRIPT_FACE_OPS`，41 条，含 `engines`），第三方库没有对应物。

### 2.5 库的内核绑定已经存在，只是没被读

各库 `package.json` 的 `peerDependencies` 实测，以及各库「L1 之外能力」的实际分布：

| 包 | 版本 | `occt-wasm` peer | L1 之外能力的分布 | 等价引擎约束 |
|---|---|---|---|---|
| `@faicad/faijs-gears` | 0.34.2 | `^5.6.0` | 落在**构建主路径**：端盖 `healWire`（`spur_gear.ts:81` 的 `planarCapAtZ`）、切齿（工具分割 `split`）、投影求点 | 全库 occt |
| `@faicad/faijs-fasteners` | 0.34.2 | `^5.6.0` | 只在**两条支路**：螺纹直纹面 `loft(ruled)`、taper 沉孔 `draftPrism` | **库级中立 + 函数级例外** |
| `@faicad/sheetmetal` | 0.34.2 | **无** | 无（`src` 内零 `getBackends` / `getOcctKernel`） | 中立 |
| `@faicad/faijs-freecad` | 0.33.2 | `^5.6.0` | 兼容 FreeCAD（其几何由 occt 定义） | occt |
| `@faicad/faijs-cadquery` | 0.33.1 | `^5.6.0` | 兼容 CadQuery（依赖 occt） | occt |
| `@faicad/faijs-openscad` | 0.29.5 | **无** | 兼容 OpenSCAD（CGAL 内核） | 中立 |
| `@faicad/faijs-viewer` | 0.34.2 | `5.6.0` | 宿主 / 查看器角色，非零件库 | 不适用 |

这张表就是「库级维度」的实物：**库能不能在某个内核上成立，是库的定位属性，与任何具体函数无关**。`faijs-freecad` 只能跑 occt，不需要看它的任何函数——它兼容 FreeCAD，而 FreeCAD 依赖 occt；`faijs-openscad` 是反例，兼容目标不依赖 occt，所以它没有这条约束。

`faijs-fasteners` 给出反向的一课：它同样声明了 `occt-wasm` peer，却**不是** occt-only 库。它的 `WarehouseKernel`（`src/kernel.ts:60`）已经是 `BrepEngineApi` 的**真子集**，L1 之外只剩三个方法名（`draftPrism`、`loft(wires, isSolid=false, ruled)`、`getNurbsCurveData`），且只落在两条支路上——螺纹直纹面（`thread.ts:198` → `primitives.ts:284`）与 taper 沉孔（`recess.ts:306` → `primitives.ts:605`）。**`occt-wasm` peer 的存在只说明"这个库可能用到 occt"，不说明"每个函数都需要 occt"。** 库级声明因此不能由 peer 机械反推，要看 L1 之外的能力落在主路径还是支路（判据见 §3.3 第 1 项）。

同时，`package.json` 的 `faijs` 字段**已有先例且已有消费通道**：`faijs-cadquery`、`faijs-openscad` 均已声明 `faijs.autoLift: false`；`packages/core/src/cad-runtime/browser-lib-loader.ts:66,153` 与 `packages/core/src/node-host/cli.ts:72` 会抓取库自身 `package.json` 的 `faijs.autoLift` 并填入 meta 缓存（构建期产物 `lib-meta.json`）。**库级声明无需新建基础设施。**

## 3. 方案

### 3.1 取用面：三个出口，各归其位

目标是每一类代码只有一条取内核的路：

| 你的代码是 | 取内核 | 必须声明 | 禁止 |
|---|---|---|---|
| 中立 op / 中立库 | `getBrepApi()` | 不写引擎约束 | 任何平台符号 |
| 平台 op / 平台库 | `getBrepApi()`（L1 部分）+ `getOcctKernel()` / `getBrepKitKernel()`（平台部分） | `engines`（op 级）/ 库级平台约束（库级） | 读裸槽位 |
| 数据 / 声明库 | 什么都不取 | 不写引擎约束 | 出现任何内核符号 |

具体改动（**一次到位，不留旧签名**）：

1. `getBrepEngine(id: string)`：`id` 改为**必填**，语义唯一化为「按 id 查已注册引擎」，定位为装配期与诊断用 API。取当前引擎改用新增的 `getActiveBrepEngine()`（与既有 `getActiveBrepEngineId()` 对称）。随本批改造 78 处无参调用（§2.1 已给出精确分布：src 3 处、test 75 处、下游 0 处受影响）。
2. `Backends.kernel.brep` 标 `@internal`，并把 `packages/core/src/extra/ops/` 下 6 个文件的越界读（共 7 处）收回到 `getBrepApi()`。
3. 消除同名导出：`packages/core/src/brep/handle-bridge.ts:37` 的 `getKernel()` 删除（它返回的是**当前引擎的原生内核**，与 `OcctKernel` 无关，且已标 `@deprecated`）；`packages/core/src/occt-kernel/occtKernel.ts:185` 的 `getKernel()` 保留，平台面统一用 `getOcctKernel()` 别名。
4. `getBrepkitKernel` 改名 `getBrepKitKernel`，与类型名 `BrepKitKernel` 一致。
5. `brep/handle-bridge.ts:63` 的 `return kernel as BrepEngineApi` 保留，但把「本文件是 L1 契约的注册点、此处断言诚实」这条依据写进 JSDoc 并加一条测试钉住：注入槽位的值必须来自 `BrepEngine.primitives`（`brep-chain.ts:135`），不得是别的来源。

### 3.2 命名：判定不改 `BrepEngine`（用户第 2 条）

**结论：不改。** 依据：

1. "kernel" 在本仓已被 `OcctKernel` / `BrepKitKernel` / `getOcctKernel()` / `getBrepKitKernel()` 占为**具体内核实现实例**；`BrepEngine` 指**注册表条目** `{ id, primitives }`（`registry.ts:19-22`），是装配期概念。两者本就该不同名，合并成一个词会制造新的歧义——第 1 条的困惑正来自「引擎 / 内核」两词混用。
2. 成本：`BrepEngineApi` 320 处 / 92 文件；`getBrepEngine` src 10 处 + test 140 处；公共导出被下游两仓消费。收益只是命名观感。
3. 改名的触发条件（未来再议）：`getBrepEngine` 在库代码中归零、只出现在装配期与诊断代码之后，槽位词义收窄，成本收益才反转。

只做 §3.1 第 4 项（`getBrepkitKernel` 大小写）这类零成本改名。

### 3.3 两级声明：库级定定位，函数级记例外（用户第 1、4 条）

**库级声明不是函数级声明的汇总，而是函数级声明无法表达的约束。**

理由：函数级 `fn.engines` 回答的是「**这个函数的实现**调了哪个内核的东西」——它是**实现细节**。而"一个库能不能在某个内核上成立"是**定位属性**：`faijs-freecad` 的库即使全部用 L1 中立法实现，它的**几何结果仍必须与 FreeCAD 一致**，而 FreeCAD 的几何由 occt 定义，所以它只能跑 occt。这条约束**任何 `fn.engines` 都写不出来**，因为它不由"调了哪些方法"决定。两者是不同维度，不是粗细两层。

#### 第 1 项 · 库级声明：定位与平台约束

载体：库自身 `package.json` 的 `faijs.lib`（与既有 `faijs.autoLift` 同处，复用既有读取通道，见 §2.5）。

```json
{
  "faijs": {
    "autoLift": false,
    "lib": {
      "role": "library",
      "conformsTo": "cadquery",
      "platform": ["occt"]
    }
  }
}
```

| 字段 | 含义 | 取值 |
|---|---|---|
| `role` | 库在系统中的角色 | `library`（默认）/ `host` / `declaration` / `adapter` |
| `conformsTo` | **语义基准**：本库的几何语义以谁为准 | `faijs`（原生）/ `cadquery` / `freecad` / `openscad` / … |
| `platform` | 由基准推导出的引擎约束（显式写出，供门禁静态读） | `['occt']` / `['brepkit']` / `[]`（中立） |

**库级 `platform` 的判定方法**：不看函数实现逐个枚举，只看一件事——**L1 覆盖不到的能力，落在构建主路径上还是支路上**。

| 库 | L1 之外能力的位置 | 库级 `platform` |
|---|---|---|
| gears | 端盖 / 切齿 / 投影，每个齿轮都要走 | `['occt']` |
| fasteners | 螺纹直纹面 / taper 沉孔，只有两条支路 | `[]`（中立）；两条支路的函数单独标 `fn.engines = ['occt']` |
| sheetmetal | 无 | `[]` |

装配期校验两条：

- `platform` 含 `occt` ⟹ 库自身必须有 `occt-wasm` 的 `peerDependencies`（**单向**）。反向不成立：`faijs-fasteners` 有 `occt-wasm` peer，库级 `platform` 却是中立的（§2.5）。
- `platform` 必须与 L1 之外能力的实际分布相符；`conformsTo` 给出语义理由（为什么这个库会依赖 occt），二者冲突时拒绝该库。

#### 第 2 项 · 函数级注解：只记例外

`admit-compat-lib.ts` 透传 `fn.engines`（沿用 `fn.outputs` 的既有形制，该文件头注释已确立「库作者经函数对象属性声明」）：

```ts
out[name] = compatOp(v as (...a: unknown[]) => unknown, {
  name,
  outputs: (v as OutputsCarrier).outputs,
  engines: (v as EngineCarrier).engines,   // 新增透传
  naming: BARE_LIFT_DEFAULT_NAMING,
})
```

**有效引擎的判定链**：`fn.engines ?? libPlatform ?? 中立`。

- 库级 `platform: ['occt']` 时，全部函数自动为 occt，**无需逐个写 `fn.engines`**——齿轮库属这类。
- 库级 `platform: []` 时，只有少数函数需要平台能力，逐个标 `fn.engines`——**fasteners 属这类**：`thread.ts` 的构形函数（`buildThread` / `isoThread` / `acmeThread` / `metricTrapezoidalThread` / `plasticBottleThread`）与走 taper 路径的 `recessCutter` 标 `['occt']`，其余零件保持中立、在 brepkit 下照常可建。声明依据是既有清单 `packages/faijs-fasteners/test/kernel-conformance.test.ts:38` 的 `PROBED_OCCT_PLATFORM`。
- 声明只能覆盖整函数：`recessCutter` 的平台依赖按参数分叉（`recess.ts:306`：`taperDeg === 0` 走 L1 `extrude`，否则走 `draftPrism`），静态声明取保守值 `['occt']`。若要让无 taper 的情形在 brepkit 下可用，需把两条分支拆成两个函数——不在本方案范围。

**缺省语义（用户第 2 条已决）**：未声明 = 中立 = 今日行为，存量库零改动。安全网由 §3.4 的门禁提供——「代码里出现平台符号却没声明」判红。

下游无需改动：`compatOp`（`compat-op.ts:168,176`）已转发、`assertLibConforms`（`define-op.ts:567-577`）已校验 id 合法性、`dispatchPath` 已按静态规则拦截。这条改动让用户第 4 条直接成立——库声明引擎约束后，在非声明引擎下该函数在**执行前**被拒，错误码 `E_BREP_UNSUPPORTED`，不再是 `E_OP_FAILED: operation failed`。

#### 第 3 项 · 调用方查询面

| 查询 | 语义 |
|---|---|
| `runtime.describeLib(binding)` | 该库的 `{ role, conformsTo, platform }` + 逐函数的 `{ engines, outputs }`（未写 `fn.engines` 的函数回报继承来的库级平台） |
| `runtime.libsUnder(engineId)` | 给定引擎，列出**可调用**的函数（其余为静态拒绝项，附拒绝原因） |

内置面已有同构清单（`SCRIPT_FACE_OPS`，41 条，构建期生成）；第三方库的对应物在装配期生成。两者合起来回答用户第 4 条的两个问题：「这个库需要什么内核」与「给定内核，哪些方法可调用」。「哪些零件可以生成」由既有 `outputs` 给出。

### 3.4 库作者契约：唯一归属 + 全仓守卫

1. **唯一权威归属**：在 `docs/library-dev-guide.md` 新增一节「内核取用」，内容即 §3.1 的三分表、§3.3 的两级声明与禁止清单；同时删掉 §4.4 那条指向 `docs/plans/` 的引用，把规则正文写进手册（`docs/AGENTS.md`：非 plans 文档必须自包含）。
2. **`docs/library-dev-guide.md` §2.8 硬约束补两条**：库代码不得调用 `initOcctWasm()` / `setOcctWasmInitFn()`，不得 `import 'occt-wasm'`（宿主角色在 `test-setup.ts` 除外）；库代码不得读 `getBackends().kernel.*`，只能经 `getBrepApi()` / `getOcctKernel()` / `getBrepKitKernel()`。
3. **`scripts/check-lib-layering.mjs` 从单包硬编码改为按包声明**：
   - 扫描范围由 `packages/<pkg>/src` 与 `scripts/` 扩展为全部声明了 `faijs.lib` 策略的包；
   - 每包在 `package.json` 的 `faijs.lib` 里声明角色（§3.3 第 1 项）；`library` 与 `declaration` 角色下 `getBackends()` 出现即判红（不留文件白名单——fasteners 的 `src/kernel.ts:23` 改造后归零），`host` 角色按声明放行；
   - 默认策略取最严（= `library` 角色，禁平台符号），未声明者按默认处理；
   - `faijs-gears` 首次纳入，声明 `platform: ['occt']`；
   - 规则集在现有 5 条基础上加一条：禁止 `as unknown as` 跨越内核面（`gears.ts:92` 属此类）；再加一条：`faijs.lib.platform` 与 `peerDependencies.occt-wasm` 必须一致。
4. **挂载进 CI**：`scripts/check-lib-layering.mjs` 加进 `package.json` 的 lint 链与 `scripts/ci.ps1`（与 `check-platform-imports.mjs` 同列，`ci.ps1:179` 附近）。

### 3.5 以 `faijs-gears` 为第一个落地对象

齿轮库的语义基准是 **CadQuery**，代码里逐字复刻：`bevel_gear.ts:118`（「复刻 cq `Face.split(plane)` + 按 zmax 取片」）、`:120`、`:179`（「cq 的裁切平面比齿面大 1000 倍，照抄」）、`:384`（「cq 顺序：先 bottom 后 top」）、`crossed_pair.ts:95`（「与 cq 逐字一致」）。故库级声明为 `conformsTo: 'cadquery'` → `platform: ['occt']`，与其既有 `peerDependencies.occt-wasm` 一致。

具体动作：

1. `packages/faijs-gears/src/kernel/gears.ts:89-100` 的 `getGearKernel()` 删除。改为两个显式、类型真实的句柄：L1 部分取 `getBrepApi()`，平台部分取 `getOcctKernel()`，`GearKernel` 类型相应拆成 `{ l1, occt }`；调用点由 `kernel.x()` 改为 `k.l1.x()` / `k.occt.x()`，用错面在编译期报错。
2. 按当前实际调用对账（源码中调用的内核方法名共 40 个）：**37 个**可由 `getBrepApi()` 覆盖——其中 `getShapeType`(11 处) 改用 L1 中立名 `shapeType`（`packages/core/src/occt-kernel/occt-primitives.ts:411` 即 `k.getShapeType` 直通，零语义变化），`revolve`(2 处) 改用 L1 方言名 `revolveVec`（入参形态与角度单位随之换算），`isFace`(5 处) 与 `isShell`(1 处) 由 `shapeType` 派生；另有两个 L1 同名但口径不符的调用点须按 L1 口径改写（`loft` 的第三参与 `interpolatePoints` 的第二参）。剩下的 **3 个**是平台专属，走 `getOcctKernel()`：
   - `healWire`：`spur_gear.ts:81`（正齿轮封盖）、`bevel_gear.ts:243`、`worm_gear.ts:250`；
   - 工具分割语义的 `split`：`bevel_gear.ts:129`、`rack_gear.ts:142,157`、`worm_gear.ts:199,209`；
   - `projectPointOnFace`：`kernel/gears.ts:391`。

   这三项落在**构建主路径**（封盖 / 切齿 / 投影求点）上，因此齿轮库整体是 occt-only，而非个别函数例外。
3. `GearKernel` 里 `isWire` / `isEdge` / `outerWire` / `healFace` / `makeFaceOnSurface` / `buildSolidFromFaces` 六个声明在实际源码中零调用，删除。
4. `package.json` 加 `faijs.lib`（`conformsTo: 'cadquery'`、`platform: ['occt']`）；导出 `libManifest` 用于函数级清单与自校。
5. **测试口径翻转**：`packages/tests/faijs/engine-compat/gears.test.ts` 第二个 describe（`gears: brepkit cannot build (genuine engine gap)`）的目标值改为「brepkit 会话下齿轮函数在**执行前**被拒，错误码 `E_BREP_UNSUPPORTED`、消息含引擎名」，不再是「缺口向下游漂移」（现文案 `E_LOFT_BAD_ENDPOINT`）。该文件原有的 occt 回归组（6 个齿轮 fixture）保留。
6. `docs/library-dev-guide.md` 不再需要为齿轮写例外说明——它是平台库，按平台库的规则声明即可。

## 4. 落地：单一批次

**不得把任何一步作为独立发布**；批次内按下列顺序实施，但交付态必须是完整的，不允许留下「新老两套写法并存」的中间态。

| 序 | 内容 | 依据 |
|---|---|---|
| 1 | 取用面收敛：`getBrepEngine` id 必填 + 新增 `getActiveBrepEngine()` + 78 处调用点改造；裸槽位标 `@internal` + 7 处越界读收回；同名 `getKernel` 去重；`getBrepKitKernel` 大小写 | §3.1 |
| 2 | 两级声明通道：`admit-compat-lib.ts` 透传 `fn.engines`；`faijs.lib` 的读取与装配期校验（含与 `occt-wasm` peer 的一致性）；`describeLib` / `libsUnder` | §3.3 |
| 3 | 手册「内核取用」节 + §2.8 硬约束两条；删归档引用 | §3.4 第 1、2 项 |
| 4 | `check-lib-layering.mjs` 全仓化（按包声明）并挂进 `package.json` lint 链与 `ci.ps1` | §3.4 第 3、4 项 |
| 5 | 三个库补声明：`faijs-gears` 库级 `platform: ['occt']`（`conformsTo: 'cadquery'`）；`faijs-fasteners` **库级中立 + 两条支路的函数标 `fn.engines = ['occt']`**，并将其 `src/kernel.ts:23` 的裸槽位读改为 `getBrepApi()`；`@faicad/sheetmetal` 中立 | §3.3、§2.5 |
| 6 | `faijs-gears` 改双句柄、删死声明、测试口径翻转 | §3.5 |
| 7 | 下游两仓跟随：`3d_editor` 的 `getBrepEngine(BREPKIT_BREP_ENGINE_ID)` 无需改（已是传参形态），仅需核过；`animation` 无调用点 | §3.1 |

第 5 步的声明内容与第 4 步的门禁必须同批：门禁默认取最严策略，未声明 `faijs.lib` 的包按 `library` 角色处理，因此声明缺位会直接判红。

## 5. 验证

| 层 | 命令 / 判据 |
|---|---|
| 类型 | `npm run typecheck` 全绿；`getBrepEngine` 的无参调用在编译期全部报错，改造后归零 |
| 声明通道 | 新增测试：带 `fn.engines = ['occt']` 的裸函数在 brepkit 会话下被**执行前**拒绝，断言错误码 `E_BREP_UNSUPPORTED` 且消息含引擎名；同函数不带 `fn.engines` 时保持今日行为（回归）。测试须同时钉住「当前值」与「应有正确值」 |
| 库级声明 | `platform` 含 `occt` 而库无 `occt-wasm` peer 时装配期拒绝（单向）；三库声明就位后 `describeLib` 输出与声明一致 |
| fasteners 可用面 | brepkit 会话下：中立零件照常构建成功；`buildThread` / `isoThread` / `acmeThread` / `metricTrapezoidalThread` / `plasticBottleThread` 与 taper 路径的 `recessCutter` 在**执行前**被拒（`E_BREP_UNSUPPORTED`）。判据与 `packages/faijs-fasteners/test/kernel-conformance.test.ts:38` 的 `PROBED_OCCT_PLATFORM` 清单一致 |
| 门禁 | `node scripts/check-lib-layering.mjs` 全仓产出违例清单（先钉住现状、再归零）；`npm run doc-sync` 通过 |
| 齿轮 | `packages/tests/faijs/engine-compat/gears.test.ts`：occt 回归组 6 例全绿；brepkit 组断言执行前拒绝 |
| 查询面 | `describeLib` / `libsUnder` 的返回与 `assertLibConforms` 的拒绝条件一致（同一份声明的两个视图，禁止两处各自维护） |
| 下游 | `animation` 的齿轮闸门测试 `test/gears-brep.test.ts` 从「钉住缺失」翻转为「钉住可用」；`3d_editor` 的 `packages/app/src/engine/script-engine/c4-brepjs-gear.test.ts` 同步翻转 |

## 6. 已决事项

| # | 事项 | 结论 | 依据 |
|---|---|---|---|
| ① | 库级声明的定位 | **更高维度的定位声明**，不是函数级声明的汇总。字段 `role` / `conformsTo` / `platform`，载体为库 `package.json` 的 `faijs.lib` | 库的内核绑定已以 `peerDependencies.occt-wasm` 形式存在（§2.5）；`faijs-freecad` 只能跑 occt 是定位推论，非函数事实。**反例是 fasteners**：有 `occt-wasm` peer 但库级中立，故 peer 不能机械反推 `platform` — 判据是「L1 之外能力落在主路径还是支路」 |
| ② | `fn.engines` 缺省语义 | **缺省 = 中立**（等于今日行为，存量库零改动）；安全网由 §3.4 门禁提供 | 用户拍板 |
| ③ | `getBrepEngine(id?)` 签名 | **一次改到位**：`id` 必填 + 新增 `getActiveBrepEngine()`，78 处无参调用同批改造 | 用户拍板；破坏面实测收敛在 faijs 自己仓内（src 3 处、test 75 处），下游 animation 0 处 |
| ④ | 齿轮库的定位 | **occt-only**。brepkit 无法完成任何齿轮零件的建模，故声明 `platform: ['occt']`；`engine-compat/gears.test.ts` 的 brepkit 组口径翻转为「执行前拒绝」 | 三类平台专属调用（`healWire` / 工具分割 `split` / `projectPointOnFace`）落在封盖、切齿等构建主路径（§3.5 第 2 项） |

## 7. 明确不做

1. 不改 L1 契约面的成员集合（`BrepEngineApi`）：平台方法不进 L1。
2. 不给 `Backends.kernel.brep` 注入「L1 合并平台扩展」的合成面：该槽位的语义是当前引擎的原生内核，合成面会让 `getBrepApi()` 的类型断言失去依据。上游 harness 的 `gearOcctKernel`（`packages/tests/faijs/engine-compat/harness.ts`）是测试专用构造，不提升为生产 API。
3. 不做运行时能力探测与运行时回退：所有引擎判定保持执行前静态判定。
4. 不做 `BrepEngine` → `BrepKernel` 的全量改名（§3.2）。
5. 不保留过渡期的双写法（如「先只新增不改签名」「先声明后收紧」）。
