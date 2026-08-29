# faijs 平台 API 设计：取消 exec 末参，走向正常语言

- 日期：2026-08-29
- 状态：待评审（仅写方案，未改代码）
- 上位文档：`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`（§3.4 全局锚点、§4.1 SDK、§10 V1/V2/V3）
- 相关文档：`docs/syntax-design.md` §6.2（统一 ABI）、`docs/plans/2026-08-28-keep-syntax-design.md` §2.2（exec.keep 归属）

---

## 0. 需求原话（用户，逐字）

> 这个也明显不是正常的语言该有的东西：`exec` = ExecContext，是引擎注入给每个库函数（op）的"平台 API 上下文"？ 必需明确申明。

> 所以还是我的要求faijs必需是正常的语言，应该怎么设计？

> faijs/faits必需是一个正常的语言。faits可以理解为就是ts代码，它里面可以import其它的库。而faijs对应UI录制的代码，只有这个特殊一些，但是也要能引用第三方库呀，只是没有控制流语句。

> faijs必需是正常的js的子集，除了没有控制流语句。

---

## 1. 明确申明：exec 末参不是正常语言的东西

**申明**：`exec`（ExecContext）是引擎**隐式注入**给每个库函数的隐藏末参——编译期机械发射 `, exec`（`compile.ts`），`.faijs` 文本与 `api.d.ts` 里都看不到它，但库函数签名里有。**这不是正常语言的机制**，必须取消。

正常语言里，函数获取"平台/宿主能力"只有三种模式，exec 三种都不是：

| 模式 | 例子 | exec 符合？ |
|---|---|---|
| **模块导入（import）** | `import { fs } from 'node:fs'`、`import { THREE } from 'three'` | ❌ exec 不可 import，引擎凭空注入 |
| **全局对象（globalThis 成员）** | `console`、`window`、`process` | ❌ exec 是逐调用注入的参数，不是全局 |
| **显式参数（ctx 模式）** | `f(opts, ctx)` | 形态像，但调用方**必须写**；exec 是调用方没写、引擎偷偷补的第三参 |

**根本错误（用户指出）：引擎凭什么知道哪些是库函数 op？**

`exec` 是"引擎注入给**库函数 op** 的上下文"——这个语义隐含引擎必须**识别哪些函数是库函数 op、哪些不是**，否则无法决定注入与否。但**引擎零函数知识**是红线（`docs/syntax-design.md` §0.2 硬约束 4：parser/compile/codegen/runtime 不允许任何按函数名分支的代码）。

当前实现对一切调用机械发射 `, exec`，看起来"零函数知识"，实质是**把"所有被调函数签名必须是 `(…args, exec)`"强加为语言级 ABI**（roadmap §4.1 的 ExecContext 契约）——第三方库、用户自定义函数全部被绑架成引擎签名。一旦放开函数定义（V1.3）与任意表达式调用（§2.3 规范），编译期**无法判断** `helper(r)`（用户函数，不该注入）与 `mech.makeHeadstock(...)`（第三方，按旧设计要注入）——注入机制必然崩。

**exec 机制的错是双重的：① 隐式注入，不是正常语言；② 隐含"引擎识别库函数"的能力，违反零函数知识红线。它必须被"显式 import"取代。**

exec 带来的三个问题：
1. **签名造假**：`cad.union(a, b)` 源码两个参数，被调用时实际三个 `union(a, b, exec)`——违反函数调用的直观语义。
2. **库作者被绑架**：第三方库函数签名被迫携带引擎类型 `ExecContext`，与"第三方库是普通 npm 包"（roadmap §3.2：`npm i @faicad/faijs` → tsc → publish，与写普通包无区别）矛盾。
3. **引擎知识泄漏进函数签名**：`currentStmt`（当前是哪条语句）本应是引擎执行层的内部状态，却成了库函数的一个参数。

---

## 2. 目标

- faijs 里**没有任何隐式注入**：库函数签名就是普通函数签名 `(…sourceArgs)`。
- 平台能力获取 = 正常语言的 **import 模式**：库作者显式 `import { ... } from '@faicad/faijs/sdk'`；SDK 内部读**全局运行时锚点**（roadmap §3.4 已铺路），拿到引擎侧的内核、记账、keep、事件等。
- 引擎的"当前语句"等执行态 = 锚点上的**引擎内部状态**，不是函数参数。
- UI 录制的 `.faijs` 文本**不变**：`cad.box({ size })` 照旧（`cad` 是作用域符号，来自容器参数/import 段）。
- **引擎零函数知识红线自然成立**：SDK import 模式不需要引擎知道任何函数——函数 import 什么用什么，能力显式、签名自定，引擎不做任何"是否是库函数"的判定。

---

## 3. 设计：平台 API = Runtime Anchor + SDK import

### 3.1 Runtime Anchor（全局锚点，roadmap §3.4 扩展）

`globalThis.__FAICAD_FAIJS_RUNTIME__`（现有：`created` WeakSet、`slots` WeakMap、`kernel` 单例）新增字段：

```ts
interface FaijsRuntimeState {
  readonly stateVersion: number
  readonly created: WeakSet<object>          // isShape 依据（已有）
  readonly slots: WeakMap<object, ShapeSlot> // 身份槽：solid/faceEvolution/...（已有）
  readonly kernel: { instance; initPromise } // OCCT 单例（已有）
  // ── 新增：平台能力（引擎初始化时注入）──
  kernels?: { occt: OcctKernel | null; csg: CsgBackend; sdf: SdfBackend }
  mode?: ExecutionMode
  // ── 新增：引擎执行态（执行前设置，引擎内部状态，不是函数参数）──
  currentStmt?: StatementIR
  onKeep?: (stmtId, names, hidden) => void   // keep 登记回调
  // ── 新增：宿主平台（HostPorts 透传）──
  events?: EventSink; assets?: AssetResolver; fonts?: FontProvider; texture?: TextureSampler
  // ── 新增：内置命名空间引用（SDK 的 cad 指向它）──
  cad?: StdlibNamespace
}
```

### 3.2 SDK 导出（库作者视角，全部普通函数/普通值）

```ts
import { solid, compound, isShape, isCompound } from '@faicad/faijs/sdk'     // 构造器/身份（已有）
import { cad } from '@faicad/faijs/sdk'                                      // 内置 op 命名空间
import { kernels, mode, getSolid, setSolid,
         getFaceEvolution, setFaceEvolution } from '@faicad/faijs/sdk'       // 双链路平台 API
import { keep, keepHidden } from '@faicad/faijs/sdk'                         // 函数体 keep 声明
import { events, assets, fonts, texture } from '@faicad/faijs/sdk'           // 宿主平台
import { resolvePath, BrepUnsupportedError } from '@faicad/faijs/sdk'        // 双链路静态判定
```

- SDK **内部全部读锚点**（`getRuntimeState()`），保持"零运行时 import、单文件 ESM"（roadmap §4.2）——它只读 `globalThis`，不 import three/occt 实现。
- `kernels` / `mode` / `cad` / `events` 等 = 锚点字段的 getter 导出。

### 3.3 库函数签名 = 普通函数

```ts
// mech-lib（第三方，普通 npm 包）
import { cad, keep, getSolid, resolvePath } from '@faicad/faijs/sdk'

export function makeHeadstock(opts: HeadstockOpts): SolidShape {
  const body = cad.box({ size: [400, 300, 350] })   // 调内置 op（普通调用，无 exec）
  keep(body)                                        // 声明保留 body（读锚点 currentStmt 归属）
  const merged = cad.union(body, gear, { keepHidden: true })
  return solid(merged)
}
```

内置 stdlib 同形态改造：

```ts
// src/stdlib/copy.ts（目标）
import { getSolid, setSolid, keep, resolvePath } from '@faicad/faijs/sdk'
export function copy(input: Shape): Shape {
  keep(input)
  const path = resolvePath([input], brepImpl)      // mode 从锚点读
  if (path === 'brep') {
    const solid = getSolid(input)                  // 从锚点 slots 读
    ...
    setSolid(shape, copiedSolid)
  }
}
```

### 3.4 编译与执行层

| 层 | 现状（exec 末参） | 目标 |
|---|---|---|
| 语句 fn 签名 | `(ctx, cad, exec) => Promise<void>` | `(ctx, cad) => Promise<void>`（`module-executor.ts`） |
| 编译发射 | `ctx.x = await cad.box(ctx.size, exec)` | `ctx.x = await cad.box(ctx.size)`（`compile.ts` 4 种形态 + 嵌套调用） |
| 执行态 | `exec.currentStmt = source`（exec 对象上） | 锚点 `runtimeState.currentStmt = source`（module-executor 调用 fn 前设置） |
| keep 登记 | `exec.keep(...)` → `exec.onKeep` | `keep(...)`（SDK）→ 锚点 `onKeep`（归属读锚点 `currentStmt`） |
| `ExecContext` 接口 | `exec-context.ts` 定义 | **删除**；能力拆散到锚点 + SDK |

### 3.5 keep-syntax 迁移（`2026-08-28-keep-syntax-design.md` §2.2）

- 函数体声明：`exec.keep(...)` / `exec.keepHidden(...)` → **SDK 的 `keep(...)` / `keepHidden(...)`**。
- 归属规则不变：登记到"当前执行语句"——`currentStmt` 从"exec 的属性"改为"锚点的引擎内部状态"，执行前由 module-executor 设置。
- 原"为什么挂在 exec 上而不是全局 keep()"的论证（§2.2）**失效**：全局锚点正是全局 `keep()` 所需的单例作用域，且 `currentStmt` 也放锚点——**挂全局/ SDK 反而更顺**（与 roadmap §3.4 一致，零新增机制仍然成立）。
- 消费判定 C0/C1/C3/C5、调用点 `keep:[...]`、`resolveKeep`、`terminal-dag` 逻辑**全部不变**，只换声明入口。

### 3.6 事件与双链路判定

- `part-brep-lost` 等事件：库函数不再主动 `exec.events.emit(...)`（knurl.ts/sdf.ts 现状）。方案：**mesh-only op 执行后由引擎自动判定并发事件**（输出不在 BREP 链即发，partName 从锚点 currentStmt.outputs 取）——事件语义归引擎，库函数零负担。
- `resolvePath`：`resolvePath(inputs, brepImpl)`，`mode` 从锚点读；`BrepUnsupportedError` 仍由库函数抛（brep 强制模式，红线不变）。

---

## 4. 对比表（现状 vs 目标）

| 面 | 现状（exec 末参） | 目标（正常语言） |
|---|---|---|
| 库函数签名 | `(opts, exec)` | `(opts)` |
| 内核访问 | `exec.kernels.occt` | `kernels.occt`（SDK import） |
| BREP 记账 | `exec.getSolid/setSolid` | `getSolid/setSolid`（SDK） |
| keep 声明 | `exec.keep(...)` | `keep(...)`（SDK） |
| 事件 | `exec.events.emit` | 引擎自动发 / `events.emit`（SDK） |
| 当前语句 | `exec.currentStmt`（函数参数） | 锚点内部状态（库函数不可见，也不需要） |
| faijs 文本 | `cad.box({ size })` | `cad.box({ size })`（不变，cad 是作用域符号） |
| 编译产物 | `await cad.box(ctx.size, exec)` | `await cad.box(ctx.size)` |
| 第三方库 | 签名带 `ExecContext` | 普通 npm 包形态（roadmap §3.2） |

---

## 5. 影响面（已核实）

| 位置 | 现状 | 改动 |
|---|---|---|
| `src/cad-runtime/exec-context.ts` | `ExecContext` 接口 + `ExecContextImpl` + `StdlibFn` | 接口拆散/删除；实现逻辑迁锚点 + SDK |
| `src/cad-runtime/internal-stdlib.ts` | 统一 ABI `(…args, exec)` | 仅装配（无 exec 概念） |
| `src/cad-runtime/module-executor.ts` | fn `(ctx, cad, exec)`；执行态挂 exec | fn `(ctx, cad)`；`currentStmt` 写锚点 |
| `src/lang/compile.ts` | 4 种形态 + 嵌套调用发射 `, exec`（:178/187/192/196/250） | 去掉 `, exec` |
| `src/lang/types.ts` | `CallRefIR` 注释"编译为 cad.<callee>(…, exec)" | 注释同步 |
| `src/stdlib/**`（14 文件） | 全部收 exec | 去 exec，内部读 SDK（锚点） |
| `src/runtime-state.ts` | （roadmap §3.4 规划，未建） | **新增**：全局锚点 + 字段扩展 |
| `src/sdk.ts` | （roadmap §2.2 规划，未建） | **新增**：SDK 导出面 |
| keep-syntax 设计 | `exec.keep` | `keep`（SDK） |
| roadmap §4.1 | `ExecContext` 带 `cad`/`libs` | SDK 直接导出 `cad`；`libs` 经锚点注册 |
| 测试 | `op-set-consistency.test.ts` 等引用 `ExecContext` | 同步 |

---

## 6. 分期实施

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **P0** | 全局锚点落地 + 扩展（roadmap V2.1）：`src/runtime-state.ts`（stateVersion/created/slots/kernel + kernels/mode/currentStmt/onKeep/events/cad）；SDK 入口 `src/sdk.ts`（roadmap V2.2）：导出构造器 + 平台 API getter | roadmap V2 |
| **P1** | stdlib 去 exec：14 个文件签名 `(…args)`，内部读 SDK；`internal-stdlib.ts` 只装配 | P0 |
| **P2** | compile 发射去 `, exec`；`module-executor.ts` fn `(ctx, cad)`、`currentStmt` 写锚点；删除 `ExecContext` | P1 |
| **P3** | keep-syntax 迁移：`exec.keep` → SDK `keep`；terminal-dag/keep.ts 逻辑不变；事件改引擎自动发 | P2 |
| **P4** | 文档同步：`syntax-design.md` §6.2 统一 ABI、`api-contract.md`、keep-syntax 设计（§2.2 论证更新）；第三方库示例（makeHeadstock 无 exec）端到端 | P3 |

---

## 7. 验收标准

- 编译产物逐字断言：`cad.union(ctx.a, ctx.b)`（**无 `, exec`**），含 4 种语句形态与嵌套调用。
- `src/` 下 `ExecContext` 零残留；stdlib 全部签名无 exec。
- `mech.makeHeadstock(opts)`（普通 npm 包形态，签名无 exec）端到端：内部 `cad.box` / `keep` / `cad.union` 生效；产物进 `ExecutionResult.outputs`；`keep` 归属正确（锚点 currentStmt 登记）。
- keep-syntax 回归锚点全过：`union(a,b)` → a、b 终端且 hidden；`group({members:[a,b]})` → 成员终端可见；调用点 keep 覆盖函数体声明。
- `part-brep-lost` 事件：mesh-only op 输出时引擎自动发（不再依赖库函数主动 emit）。

---

## 8. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| O1 | 第三方库内部 `cad` 的来源：`import { cad } from '@faicad/faijs/sdk'`（推荐，显式 import = 正常语言）还是全局 `globalThis.faicad.cad`？ | **SDK import**；UI 录制代码的 `cad` 保持容器参数/import 段，两者指向同一对象（锚点注册） |
| O2 | `currentStmt` 对库函数不可见后，需要"当前语句信息"的场景（事件 partName）怎么办？ | 引擎自动发事件（事件语义归引擎）；库函数不再需要知道自己在哪条语句 |
| O3 | `mode`（auto/brep/mesh）放锚点后，`resolvePath` 签名 `resolvePath(inputs, brepImpl)`——是否需要显式传 mode（便于纯函数测试）？ | 默认读锚点，可选手动传参（保持可测） |
| O4 | `ExecContext` 类型是否保留为 SDK 的 type-only 导出（供少数需要显式 ctx 的库）？ | 不保留——库函数签名不再有 exec，类型随机制删除 |
| O5 | 增量执行（statementKey / outputContentKey）依赖"当前语句"吗？ | 不依赖 exec——键由执行层算，锚点 currentStmt 只服务 keep 归属与事件 |

---

## 9. 参考

- roadmap §3.4（全局锚点）、§4.1/4.2（SDK 导出面、零依赖约束）、§10 V2（锚点+SDK）、V3（模块运行时）。
- keep-syntax §2.2（exec.keep 归属；本文档取消该机制，论证见 §3.5）。
- syntax-design §6.2（统一 ABI 现状；实施后改为"普通函数签名"）。
