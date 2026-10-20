# 第三方库开发手册

[English](library-dev-guide.md) | 中文

> 本手册按 faijs 生态的三层分工组织——**库作者**写什么、**Host**（引擎装配方）处理什么、**`.fai.js` 脚本**调用什么。每层一节：职责、接口与边界。

> 相关文档：`docs/api-contract.md`（引擎契约——§7 三个 API 面与 Result 错误体系）、`docs/ops-api-inventory.md`（脚本面 `cad.*` API 手册）。

---

## 1. 三层一览

```mermaid
flowchart LR
  A[Library author writes] -->|exported functions + annotations + contractVersion| B[Host assembles & admits]
  B -->|registerLib: dual-ops pass through, bare fns lifted| C[.fai.js calls]
  C -->|ns.fn / cad.* + Result unwrap at statement boundary| D[Engine dispatches & bridges]
  D -->|Shape / handle / data record| C
```

| 层 | 角色 | 写 / 做什么 | 产出 | 关键接口 |
|---|---|---|---|---|
| ① 库作者 | TS/JS 库开发者 | 导出函数、`Result` 返回、`defineOp` / `fn.outputs` / `solidOf` 标注、`contractVersion` | 一个普通模块命名空间 | `@faicad/faijs/sdk` |
| ② Host | 引擎装配方（应用 / worker） | 创建运行时、注册库、提供内核与 backends | 可调用命名空间（`ns.*`、`cad.*`） | `runtime.registerLib(binding, ns, { autoLift: true })` |
| ③ `.fai.js` 脚本 | 用户 / UI / AI 生成代码 | 导入库并调用其函数 | 几何产物与值存储中的数据 | `ns.fn(...)` / `cad.*` |

数据流在编写期与运行期方向不同：库作者写命名空间，Host 注册并接纳，脚本调用已接纳的函数——引擎在两者之间处理分派、桥接与语句边界 Result。

---

## 2. 第一层——库作者写什么

### 2.1 库模块

faijs 库就是一个普通 TS/JS 模块命名空间，导出若干函数。库作者只写模块，**不负责注册**——那是 Host 的事（§3）。

```ts
import { keep, fromBrep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'

export const contractVersion = CONTRACT_VERSION

export function external(params: { teeth: number; moduleSize: number; thickness: number }) {
  // ... build the gear, return a faijs Shape or a geometry handle ...
}
```

### 2.2 导出函数返回 `Result`

库函数返回 `Result<T>`（`ok` / `err`）。引擎在语句边界 unwrap：`err` 变成语句失败（`ExecutionResult.failedAt`）——**不是崩溃**；失败前已完成的语句保留其 outputs。意外异常（bug）仍会抛穿 `execute()`。

### 2.3 返回值——三分类

引擎用**单一判别**区分几何与纯数据——`__occtWasm` 标记（判别实现收敛在 `brep/handle-bridge.ts` 的 `isOcctHandle` 叶子）。返回值必须是以下三种形态之一：

| 返回值 | 分类 | 引擎行为 |
|---|---|---|
| faijs `Shape`（来自 `solid` / `fromBrep`） | 已包装 | 原样透传 |
| OCCT 句柄：带 `__occtWasm: true` 标记的对象，或 branded number id | 几何句柄 | 三角化 + 登记 BREP 槽（`fromHandle`） |
| 不带标记的 plain object | 纯数据记录（如 sheetmetal `part`） | 原样存储——**绝不**被当句柄三角化 |

把数据记录当句柄传入会在 SDK 边界以 `E_BAD_HANDLE` 显式拒绝，而不是在 kernel 深处崩溃。不要发明其他句柄形态。

还有两种返回值落在三分类之外，值得专门点名——被提升的裸函数会在作者毫无意图的情况下撞上它们：

| 返回值 | 落到哪里 | 后果 |
|---|---|---|
| `undefined`（`void` 函数） | 未通过对象判定，落进 `fromHandle(undefined)` | 硬失败：`E_BAD_HANDLE: expected an OCCT handle (numeric id or __occtWasm-tagged object); got undefined` |
| 未 await 的 `Promise` | 落进 plain object 分支——`typeof` 是 `'object'`，无标记 | **不报错**：被当成数据记录放行，既不 await 也不 reject——值静默丢失 |

`Promise` 那一行才是危险的：整条链路没有任何环节会报告它。调用为何会变成未 await，见 §4.5。

`unwrapResult` 只用一条结构判定识别 `Result`——`typeof v.ok === 'boolean'`（`api/internal/result-unwrap.ts`）。因此带布尔字段 `ok` 的数据记录会被当成 Result 解包：`ok: true` 取 `v.value`，`ok: false` 抛 `OpError`。返回的数据记录里绝不要用 `ok` 作字段名。

### 2.4 双路径 op：`defineOp`

用 `defineOp`（来自 `@faicad/faijs/sdk`）声明两条实现路径和 L3 元数据：

```ts ignore-check
import { defineOp, keepHidden } from '@faicad/faijs/sdk'

export const intersect = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'intersect')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'intersect')
  },
  outputs: [...],             // named multi-product fields (§2.6)
  schema: { ... },            // param types for the UI panel (L3)
  slotMap: { ... },           // positional → object boxing, for brepjs-style calls
})
```

- **`mesh` / `brep`**：两条引擎路径。`mesh` 是默认；`brep` 可选。brep-only op 在 mesh 路径抛 `E_MESH_UNSUPPORTED`。
- **`engines`**（上例没有它——`intersect` 是中立 op）：只有**平台 op**才需要，即实现里静态 import 了 `occt-kernel/*` 或 `brepkit-kernel/*` 的 op。它点名这个 op 为哪些引擎而写（`engines: ['occt']`）。其余 op 一律不写它，且只能停留在 L1（`getBrepApi()`）。op 元数据里没有第二条声明轴：内核能做什么从引擎本身读（见下方陷阱 2），绝不写在 op 元数据里。**库级**是另一条轴，记的是定位而非实现（§2.11）。
- **`outputs`**：命名多产物字段（唯一被识别的多产物契约名；数组字段逐元素收养）。
- **`schema` / `slotMap`**：L3 元数据——UI 面板的参数类型，以及 brepjs 风格调用所需的位置 → 对象装箱表。

### 2.5 `keep` / `keepHidden`——UI 层可见性

控制哪些输入 shape 留在 UI 层显示。函数体声明（库作者写，执行期求值）**被调用点声明覆盖**（用户 / UI / AI 在脚本录制期写）：

| 声明点 | 谁写 | 优先级 |
|---|---|---|
| 调用点（`.fai.js` 语句选项） | 用户 / UI / AI | 最高 |
| 函数体（实现内部的 `keep` / `keepHidden`） | 库作者 | 被覆盖 |

### 2.6 裸函数与 `fn.outputs`

普通导出函数（未用 `defineOp`）在命名空间以 `{ autoLift: true }` 注册时被提升为 brep-only op。用唯一被识别的标注声明多输出字段：

```ts ignore-check
interface PlanetaryOutput {
  sun: ValidSolid
  planets: ValidSolid[]
  ring: ValidSolid
}
export function planetary(params: PlanetaryParams): Result<PlanetaryOutput> {
  // ... build sun, planets, ring ...
  return ok({ sun, planets, ring })
}
;(planetary as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']
```

### 2.7 `solidOf`——显式几何终端

对于数据中心库（sheetmetal：`part` 是一个内嵌 `solid` 的纯数据对象），提供 `solidOf(part)` 作为显式几何终端：

```ts ignore-check
export function solidOf(part: SheetMetalPart): Result<ValidSolid> {
  return ok(part.solid!)
}
```

### 2.8 硬约束

1. **`contractVersion`**：与运行时匹配（`assertContractVersion`）；双路径 op 缺它会被拒绝。
2. **不碰引擎内部**：不得访问引擎内部可变状态（`currentStmt` / `script` / `outputCache` / `brepChain`），不得查询或修改 DAG，不得原地修改已发布的 `Shape`。
3. **句柄所有权**：返回的句柄一旦被引擎收养，之后不得再 `delete()`（返回即转移）。句柄是从 `0` 起分配的数字，`0` 是合法句柄——见 `docs/api-contract.md` §8.6 的引擎边界契约。
4. **不启动内核**：不得调用 `initOcctWasm()` / `setOcctWasmInitFn()` / `initBrepkitWasm()`，不得 `import 'occt-wasm'`——启动内核是 Host 的职责（§3.1.1）。唯一例外是宿主角色包自己的 `test-setup.ts`。
5. **不读裸槽位**：不得读 `getBackends().kernel.*`；按 §2.11 的三分表取中立法（`getBrepApi()`）或平台法（`getOcctKernel()` / `getBrepKitKernel()`）。

### 2.9 每个导出都是脚本面 API

接纳步骤遍历 `Object.entries(ns)`——不存在"内部导出"或"仅宿主可用导出"的概念（§3.3）。常量、`contractVersion`、从别处 re-export 的辅助函数、宿主侧的生命周期函数，全部都能从 `.fai.js` 触达；凡是函数的导出都要走提升，并承担 §2.3 的返回值契约。把宿主专用辅助（reset / flush / collect 回调、缓存）放在库**另外 import 的**模块里，库本身只导出脚本应该调用的东西。

### 2.10 库作者产出什么

一个普通模块命名空间：导出函数、可选标注（裸函数上的 `fn.outputs`）、可选 `defineOp` 声明、`contractVersion`。Host 原样接收这个命名空间——它从不改写库作者的代码。

### 2.11 内核取用与两级引擎声明

库代码永远不按 id 去要内核，也永远不读裸内核槽位。出口只有三个，而你的代码用哪一个，**就是**它的引擎声明：

| 你的代码是 | 取内核 | 必须声明 | 禁止 |
|---|---|---|---|
| 中立 op / 中立库 | `getBrepApi()` | 不写引擎约束 | 任何平台符号 |
| 平台 op / 平台库 | `getBrepApi()`（L1 部分）加 `getOcctKernel()` / `getBrepKitKernel()`（平台部分） | `engines`（op 级）/ 库级平台约束 | 读裸内核槽位 |
| 数据 / 声明库 | 什么都不取 | 不写引擎约束 | 出现任何内核符号 |

`getBrepApi()` 是引擎中立的 L1 契约面（`BrepEngineApi`）：同一个调用在 OCCT、brepkit 和网格替身下都成立。`getOcctKernel()` 与 `getBrepKitKernel()` 是平台面——import 其中之一，就等于把这段代码绑到某个平台；这件事既要声明（本节），也要被门禁守（`check-lib-layering.mjs`）。中立法由**库作者入口** `@faicad/faijs/sdk` 导出（§1）；主入口给的是裸槽位 `getBackends()`，没有这个出口——所以从库作者入口导入，才是站在中立法上的写法。

#### 两级——定位属性与实现事实

两级回答的是不同的问题，所以它们**不是**同一件事的粗细两层：

- **库级——定位属性。** 写在库自身 `package.json` 的 `faijs.lib` 里，装配期从那里读——无论是 Host 按脚本 `import` 自动装载该库，还是用 `packageName` 显式注册它的命名空间。它回答「这个库能不能在某个内核上成立」，判据是库的语义基准（`conformsTo`），而不是逐个枚举它的函数调了什么：`faijs-freecad` 的几何必须与 FreeCAD 一致，而 FreeCAD 的几何由 OCCT 定义，所以它只能跑在 OCCT 上——这条约束任何 `fn.engines` 都写不出来。
- **函数级——实现事实**（`fn.engines`）。它回答「**这个函数的实现**碰了哪个内核」。它是挂在函数对象上的标注，形制与 `fn.outputs` 相同（§2.6）。

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

`platform` 的判定只问一件事：**L1 覆盖不到的能力，落在构建主路径上，还是落在支路上？**

| 库 | L1 之外能力的位置 | `platform` |
|---|---|---|
| gears | 封盖、切齿、投影求点——每个齿轮都要走 | `['occt']` |
| fasteners | 螺纹直纹面、taper 沉孔——只有两条支路 | `[]`（中立），那两条支路的函数单独标 `fn.engines = ['occt']` |
| sheetmetal | 没有 | `[]` |

装配期跑两条校验：

- `platform` 含 `occt` ⟹ 该包必须声明 `occt-wasm` 的 `peerDependency`（**单向**）。反向不成立：`faijs-fasteners` 有该 peer，库级 platform 却是中立的，所以 peer 永远不能用来反推 `platform`。
- `platform` 必须与 L1 之外能力的实际分布相符，`conformsTo` 给出这条约束的语义理由。

#### 函数级——注解只记例外

裸函数声明引擎的方式与声明产物一样：挂在函数对象上的属性。其余什么都不用改——判定链在装配期（`registerLib`）一次解析完，分派侧只读 op 元数据。

```ts ignore-check
import type { BrepEngineId } from '@faicad/faijs/sdk'

export function buildThread(params: ThreadParams): Result<Solid> { … }
;(buildThread as { engines?: readonly BrepEngineId[] }).engines = ['occt']
```

**有效引擎 = `fn.engines ?? lib.platform ?? 中立`。** 库级写 `platform: ['occt']` 时，全部函数自动为 OCCT，**无需**逐个写 `fn.engines`——齿轮库就是这么写的。库级写 `platform: []` 时，只有少数需要平台能力的函数带 `fn.engines`——`faijs-fasteners` 就是这么写的。两级都不写 = **中立**，也就是今日行为，存量库一个都不用改。

声明前有两点要知道：

- 有效引擎是在**接纳**时解析的，而接纳只存在于**提升**通路上，且库级 `platform` 只注入给裸函数。所以无法兑现的声明一律在装配期被拒，绝不静默丢掉：库以 `autoLift: false` 被接纳，而函数带 `engines` 或库级 `platform` 非空；或者库级 `platform` 非空、库里又导出了未带自身 `engines` 的 dual-op。请在库的 `package.json` 里写 `"faijs": { "autoLift": true }`（或以 `autoLift: true` 注册），让声明有落脚处。
- 一条声明覆盖整个函数。平台依赖按参数分叉时，要么取保守值（整个函数算平台函数），要么把它拆成两个函数——没有按调用点声明的余地。

#### Host 侧的查询面

调用方的两个问题都由**同一份声明**回答，所以两个视图既不会互相矛盾，也不会与实际分派矛盾：

| 查询 | 回答 |
|---|---|
| `runtime.describeLib(binding)` | 该库的 `{ role, conformsTo, platform }` 加逐函数的 `{ engines, outputs }`；未写 `fn.engines` 的函数回报继承来的库级平台 |
| `runtime.libsUnder(engineId)` | 给定引擎，哪些函数可调用、哪些被静态拒绝，每条拒绝都带原因 |

内置 `cad` 面也是一个已注册的绑定，因此这两个查询同样覆盖它——`runtime.libsUnder('brepkit')` 回答 brepkit 宿主能调用哪些内置 op（`docs/api-contract.md` §7.12）。

#### 库代码里禁止做的事

1. `import 'occt-wasm'` / `import 'brepkit-wasm'`，以及调用 `initOcctWasm()` / `setOcctWasmInitFn()` / `initBrepkitWasm()`。启动内核是 Host 的职责（§3.1.1）；库自己启动会造出第二个内核实例，与 Host 的实例冲突。唯一例外是宿主角色包自己的 `test-setup.ts`。
2. 读 `getBackends().kernel.*`。那个槽位是 `@internal`，里面是当前引擎放进去的东西——要取就取中立法（`getBrepApi()`）或平台法（`getOcctKernel()` / `getBrepKitKernel()`）。
3. 自己用 `getBrepEngine(id)` / `getActiveBrepEngine()` 解析引擎。那些是装配期与诊断用的 API；库应该用声明说明自己需要哪个引擎，由 Host 去解析。

---

## 3. 第二层——Host 处理什么

### 3.1 Host 职责

Host（Node 宿主或浏览器 worker）装配引擎并让库可被调用：

1. 提供引擎：内核（`brep` / `csg` / `sdf`）、backends、字体/资源——经 `createRuntime(ports, mode)`。
2. 用 `runtime.registerLib(binding, ns, { autoLift: true })` 注册库。
3. 提供 `cad` 命名空间（内置 op）与值存储。

### 3.1.1 装配引擎——内核、BREP 引擎与 backends

`createRuntime(ports, mode)` 创建的是**运行时实例**，它**本身并不提供几何内核**。一个可用的 Host 还必须在之外：初始化 OCCT wasm 内核、注册 BREP 引擎、并把后端配置推入全局运行时状态。缺了这些，裸调 ① TS 兼容面（`box`、`union` …）与脚本面的布尔运算都会失败。

一个完整、可复制的引导函数：

```ts
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine, getActiveBrepEngineId } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'

// One-time Host bootstrap. Call once at startup, before any geometry op.
// Order matters: kernel -> engine registration -> backend config.
export async function assembleHost(): Promise<void> {
  // 1. Boot the OCCT wasm kernel.
  await initOcctWasm()

  // 2. Register the OCCT BREP engine into the engine registry.
  await registerOcctBrepEngine()

  // 3. Read the registered engine back and push the full backend config.
  const eng = await getBrepEngine(OCCT_BREP_ENGINE_ID)
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: {
      mode: 'brep',
      brepEngineId: getActiveBrepEngineId() ?? OCCT_BREP_ENGINE_ID,
    },
    kernel: { brep: eng.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  })
}
```

`assembleHost()` 之后，要么为脚本执行创建运行时（② 脚本面），要么直接裸调 ① TS 兼容面的扁平函数——① 面一旦内核/引擎/后端配好就不需要运行时：

```ts ignore-check
import * as F from '@faicad/faijs'
import { createRuntime, createNodePorts } from '@faicad/faijs/node'
import * as gear from 'my-gear-lib'

// ② script face: run .fai.js
const runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear, { autoLift: true })
await runtime.execute('let g = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })')

// ① TS-compat face: bare function calls (no runtime needed after assembleHost())
const a = await F.box(10, 10, 10)
const b = await F.union(a, await F.translate(a, [5, 0, 0]))
```

#### 三个必踩的坑（均为实测）

1. **只 `createRuntime` 不 `registerOcctBrepEngine` → `[faijs/bridge] BREP engine API not available: BREP operations require an initialized engine`**。——脚本面走 `runtime.execute` 时 brepChain 会自带内核，但裸调 ① 面不会。务必先跑 `assembleHost()`。
2. **`configureBackends` 漏 `config.brepEngineId` → `E_BREP_UNSUPPORTED: op 'sweep' requires engine occt (current=<none>)`**。——`runtime.ts` 里 `config` 是个 **getter**；照抄只设 `config: { mode: 'brep' }` 的片段会漏掉它，第一个平台 op 在执行前就被拒。中立 op 不会被拒，但同样丢掉引擎事实：未知引擎下 `hasNativeHistory` 一律答「没有」，于是布尔 op 静默走 L1 裸轨，丢失面演化与 role table 传播。务必把 `brepEngineId` 与 `mode` 一并传入——运行时自己从注册表推导，只有手搓 config（测试）才会漏。
3. **`defineOp` 包装的函数返回 `Promise<Shape>`，不是 `Result`。**——① 面的 op（`box`、`union`、`volume` …）都是 `defineOp` 包装；调用它们得到的是 `Shape`（或它的 Promise），**不是** `Result`。用 `isErr(x)` 判定这种值会得到假阳性——`isErr` 的判据是 `ok === false`，而 `Shape` 上没有 `ok` 字段。只有**你自己**从库函数返回的值才带 `Result`。

### 3.2 注册库

```ts ignore-check
import { createRuntime, createNodePorts } from '@faicad/faijs'
import * as gear from 'my-gear-lib'

const runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear, { autoLift: true })
```

`binding`（`'gear'`）是脚本导入并调用的名字：`.fai.js` 里的 `gear.external({ ... })`。

faijs 原生库（消费 core `Shape`、内部调 core op，如 `sheetmetal`）与 brepjs 形态库（消费 brepjs 形态的 `Shape`）注册方式完全相同：`registerLib(binding, ns, { autoLift: true })`，无需任何额外标记。所有 Shape 实参都原样送达库函数——引擎在入向不做任何改写——需要内核句柄的库自行经 `brepOf`（`@faicad/faijs/sdk`）从 Shape 上取。

### 3.3 接纳——每个导出发生什么

以 `{ autoLift: true }` 注册时，Host 的接纳步骤处理命名空间的每个导出：

| 导出类型 | 发生什么 |
|---|---|
| `defineOp` 声明的函数（携带 `DUAL_OP_META`） | 按其 spec 原样透传——不重写 |
| 裸函数 | 提升为 brep-only op；`fn.outputs`（如有）成为其 `outputs` spec |
| `contractVersion` | 与运行时校验（`assertLibConforms`）——不匹配则拒绝整个库 |
| 其他值（常量、数据） | 原样登记供脚本访问 |

提升是**整个命名空间一次性**判定，不是逐导出判定：`autoLift ?? !hasDualOp(ns)`。只要命名空间里有至少一个 `defineOp` 函数，推断结果就是 `false`——所以**混合型**库（一个双路径 op + 若干裸辅助函数）里的辅助函数**不会**被提升，而全是裸函数的库则会被提升。命名空间混用两种形态时，显式传 `autoLift`，不要依赖推断。

### 3.4 引擎边界行为（Host 无感知）

脚本调用已接纳的函数时，边界机制由**引擎自己**处理——Host 不写任何这部分：

1. **分派**：mesh / brep 路径静态判定（链状态 + 引擎身份），无运行时回退。
2. **直传**：faijs `Shape` 实参原样送达库函数（入向不做改写）。
3. **调用 + unwrap**：函数运行；`Result` 的 `err` 被 unwrap 成语句失败。
4. **收养**：几何产物跨回成为 faijs `Shape`（三角化 + BREP 槽）；纯数据原样透传（§2.3）。

### 3.5 Host 产出什么

可调用的命名空间：`gear.*`（第三方）与 `cad.*`（内置），都能从 `.fai.js` 以同样的语句级语义调用。

### 3.6 关掉提升——数据型与声明型库

返回值是数据、或只是登记声明（运动学、标注、元数据、颜色）的库，必须关掉提升。被提升的函数会被包成 brep-only op，产物要穿过 `wrapBrepOne`，`void` 或基本类型返回值在那里会变成 `E_BAD_HANDLE`（§2.3）。三种关掉提升的方式：

| 机制 | 谁写 | 键 | 适用 |
|---|---|---|---|
| `registerLib(binding, ns, { autoLift: false })` | Host | binding 名 | 宿主手动注册的库 |
| `libLoader.options.autoLiftFor = (name) => (name === 'my-lib' ? false : undefined)` | Host | 脚本里写的 import specifier（`packageName ?? specifier`） | 由 `import` 语句自动装载的库 |
| 库 `package.json` 里的 `"faijs": { "autoLift": false }` | 库作者 | 包名 | 浏览器宿主——`createBrowserLibLoader` 从构建期 `lib-meta.json` 或经 `prefetchMeta()` 取得 |

对不想影响的库，`autoLiftFor` 必须返回 `undefined` 而不是 `false`：`undefined` 才会回落到 `options.autoLift`，再回落到推断式。

关掉提升后命名空间原样注入：函数保持同步，可以返回 `void` 或任意值，对脚本而言就是普通 JS。代价是失去提升提供的边界服务——`Result` 不再被 unwrap（脚本拿到的是 `Result` 记录本身）、`fn.outputs` 不再做多产物收养、也没有平台门控（§4.4）。

---

## 4. 第三层——`.fai.js` 调用什么

### 4.1 调用形态

parser 顶层调用实参是完整表达式（`lang/parser.ts`）——**`.fai.js` 在调用点上是真正的 JS 子集**：

- **位置实参任意形态、任意混排**：字面量（`addHole(p, 'root', 15, 15, 4)`）、数组、已声明变量、成员访问（`hem(p0.solid, spec)`）、嵌套命名空间查询、运行时表达式。
- **多个对象实参原样保留**：`tabAndSlot(p, tabSpec, slotSpec)` 可用——不覆盖、不合并。*末位*纯对象是选项槽（承载 `keep` / `keepHidden`），更早的对象是位置数据。

```js
import * as gear from 'my-gear-lib'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let b0 = cad.box(30, 30, 5)
let u1 = cad.union(g1, b0)
```

### 4.2 语句边界行为

每个调用库 op 的语句都是一个边界：`Result` 被 unwrap（`err` → `ExecutionResult.failedAt`，之前已完成的语句保留其 outputs）；调用点的 `keep` / `keepHidden` 覆盖函数体声明（§2.5）。

### 4.3 调用矩阵

1. **对象形态入口是推荐风格，不再是硬性要求。** spec 对象参数仍是惯用方式，但首参是字符串 id、标量或数组的函数也能调用。
2. **脚本里可以读记录字段**（`hem(u1.solid, …)`——成员访问是运行时求值的表达式）；整份记录传递照常可用。
3. **库的 `err` 结果是语句失败，不是崩溃**——`OpError` → `ExecutionResult.failedAt`；失败前已完成的语句保留其 outputs。

对 `@faicad/sheetmetal` 的实测结论（整包注册，`{ autoLift: true }`）——现在全部签名形态都可调用：

| 可调用 | 示例 |
|---|---|
| spec 对象函数 | `author(spec)`、`hem(p, spec)` |
| 字符串 id / 标量 / 数组函数 | `addHole(p, 'root', 15, 15, 4)`、`allowance(p, 0.44)` |
| 变量上的成员访问 | `hem(p0.solid, { kFactor: 0.44 })` |
| 多个对象实参 | `tabAndSlot(p, tabSpec, slotSpec)` |
| 几何终端 | `unfoldSolid(s1)`——直接消费输入 `Shape`（无视图适配层） |

`solidOf` 作为显式终端保留，供 TS 兼容面与库侧使用；脚本面上它不再是*必需*的——成员访问（`p.solid`）可以直接取到该字段。
### 4.4 平台 op 与 `engines` 声明

库里的 op 只要**静态 import 了平台模块**（`occt-kernel/*` 或 `brepkit-kernel/*`），就是**平台 op**——import 是唯一判据。平台 op 必须在 `defineOp` 里声明平台身份：

```ts ignore-check
import { defineOp } from '@faicad/faijs/sdk'
import { occt } from './my-occt-only-helper' // imports occt-kernel/* → platform op

export const myOp = defineOp({
  name: 'myOp',
  engines: ['occt'], // REQUIRED for platform ops
  brep: async (ctx, ...args) => { /* ... */ },
})
```

规则（D11，由 `assertLibConforms` + CI 守卫 `check-platform-imports.mjs` 检查）：

1. **`engines` 只写真实引擎 id**——`'occt'` / `'brepkit'` / `'brep_mock'`（禁止裸 `string`）。
2. **`engines` 就是全部 op 级声明**——在 op 这一级它是唯一的收窄轴，没有别的东西与它并列可声明。op 要么点名自己的引擎，要么是中立 op。两者皆空只允许 mesh-only op。库级是**另一条**轴，记的是定位而非实现（§2.11）。
3. **拦截发生在执行期**——非目标引擎下 op 在触碰内核之前失败（`BrepUnsupportedError` → `ExecutionResult.failedAt`）。静态守卫只强制声明本身，不能替代声明。
4. **`brep_mock` 豁免拦截**（测试替身，D11-3）——但声明的 `engines` 仍参与 parity / engine-switch 测试。
5. **库的 dual-op 若 import 了平台模块，同样受此约束**——在 `defineOp` 写 `engines`，拦截发生在执行期 `dispatchPath`。`package.json` 的库级 `platform` 则在注册期校验；引擎**匹配**依旧不是注册期的事。

中立 op（实现只经 `getBrepApi()` L1 方法）*不得*写 `engines`——L1 契约面天然与引擎无关。

### 4.5 不在语句位置上的库调用

有三处库调用的行为与 §4.1 不同。本机函数 ABI 本身（注入的命名空间绑定、外层引用注入、逐字嵌入的函数体）由 `docs/language-design.md` §6.2 规定。

1. **用户函数体读顶层脚本变量：支持读、不支持写。** 函数体在**调用时**解析顶层 `const` / `let` 变量与顶层函数（支持前向引用：函数定义在声明之前、调用在其之后）；两次调用之间顶层 `let` 变更，后续调用取新值。函数体内对顶层名的赋值落在本地绑定，顶层值不变，同一函数的其它调用不受影响；同名本地声明（含块级、嵌套函数内）按 JS 作用域规则遮蔽顶层。参数默认值表达式引用顶层变量不受支持（默认值先于注入求值）。
2. **函数体内直接作用域的 op / 本机函数调用会被 await。** 两个执行后端都会对函数体直接作用域内的 `ns.fn(…)` 与顶层本机函数调用注入 `await`（数组、实参、模板等值位置同样覆盖），与语句边界的 await 语义一致。两个例外不要依赖：嵌套在函数体内部的**同步嵌套函数**里的调用不注入（VM 后端产出未决 Promise，解释器后端会 await——两后端在此不一致）；参数默认值表达式里的顶层变量引用先于注入求值（见第 1 条）。
3. **命名空间绑定不是顶层标识符。** 它只在语句变换把调用改写成 `await __ns.<binding>.<fn>(…)` 的位置上被绑定。在任何其他顶层值位置——`let ms = [anim.driver('a', 1)]`——该名字保持未绑定，报 `anim is not defined`。把这种数组字面量直接写在调用实参位置。

脚本无法用手工 await 补救第 2 条：实参位置的 `await` 在解析期就被拒绝（`E_VALUE: unsupported value expression: AwaitExpression`）。


---

## 5. 端到端走查

一个函数跨越全部三层，逐步看：

1. **库作者写**（第一层）：`planetary` 返回 `Result<{ sun, planets, ring }>` 并携带 `fn.outputs = ['sun', 'planets', 'ring']`（§2.6）。
2. **Host 注册**（第二层）：`registerLib('gear', gear, { autoLift: true })`——`planetary` 被提升为 brep-only op，`outputs: ['sun', 'planets', 'ring']`；`contractVersion` 通过校验（§3.3）。
3. **脚本调用**（第三层）：`let p0 = gear.planetary({ ratio: 4 })`——语句记录调用点的 `keep`，引擎分派、原样直传 shape 输入、调用 `planetary`、unwrap `Result`。
4. **产物返回**：`p0.sun` / `p0.planets` / `p0.ring` 被收养为 faijs `Shape`（或数据记录），存入值存储——后续语句可继续使用（`cad.union(p0.sun, b0)`）。

每一步恰好属于一层：库作者写，Host 接纳，脚本调用，引擎桥接。

---

## 6. 移植已有的 brepjs 库

已经写过 brepjs 库？移植基本是机械性的——faijs 沿用 brepjs 惯例（位置参数、`Result` 返回、DSL）：

1. **改导入**：`from 'brepjs'` → `from '@faicad/faijs'`（`package.json` 同步）。
2. **删除 `registerKernel` 调用**——faijs 管理内核（单实例）；由宿主提供。
3. **删除 `pinned` 数组 / finalizer 变通方案**——收养生命周期（调用 → unwrap → 收养）由引擎处理，库不再管理释放。
4. **注册命名空间**：`runtime.registerLib('mylib', myNamespace, { autoLift: true })`。
5. **按需补 `fn.outputs` / `solidOf`**（§2.6 / §2.7）。

返回的句柄在被引擎收养前保持 borrowed-view 语义（不拥有、不释放），因此「返回即转移所有权」就是全部契约——borrowed-view 概念由 brepjs 自身的惯例自足。移植中遇到引擎边界问题时，第一层（§2.3 返回分类、§2.6 `outputs`、§2.7 `solidOf`、§2.8 硬约束）是权威契约。
