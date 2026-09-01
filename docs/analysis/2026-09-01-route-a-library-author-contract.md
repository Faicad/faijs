# 路线 A（JS VM 直接执行）下的第三方库作者契约

> 分析文档 · 2026-09-01
> 前置：`docs/analysis/2026-09-01-two-routes-control-flow-and-lib-import.md`（两条路线对比）
> 本文只讨论**路线 A 成立时**的库作者契约面，不重复路线选择论证。

---

## 0. 用户提问（需求基线，不准删改）

> 「如果让faijs直接js vm执行，对第三方库的作者有哪些要求，那要实现一个op，需要写哪些东西。faijs的运行时和第三方库之间有哪些契约？」

三个子问题分别对应：§3（作者要求）、§4（实现一个 op 的最小写法）、§2 与 §5（契约面全景与变更）。

---

## 1. 结论速览

**核心结论：路线 A 对库作者的要求，与现状相比几乎不变——因为现有契约本来就是模块级的、不依赖 parser。**

| 契约面 | 现状载体 | 路线 A 下 | 库作者感知 |
|---|---|---|---|
| A 环境资源 | `configureBackends` / `getBackends`（`runtime-state.ts:251,262`） | **完全不变**（模块级注册表，与 parser 无关） | 零 |
| B Shape 与句柄 | `solid()` / `fromBrep()` / `fromHandle()` 构造器 | **完全不变** | 零 |
| C 保留语义 | `keep()` / `keepHidden()`（`runtime-state.ts:347,356`） | **签名不变，归属机制换底**（§5.2） | 零 |
| D 双路径声明 | `defineOp({ mesh, brep })`（`define-op.ts:153`） | **完全不变** | 零 |
| 契约版本 | `export const contractVersion = CONTRACT_VERSION` | **不变，但校验时机改变**（§5.1） | 零 |

**为什么几乎不变**：库作者面对的是 `@faicad/faijs-core/sdk` 这个**模块导出面**（`sdk.ts` 全文 4 组导出），而 parser 处理的是 `.fai.js` **脚本文本**。二者从来没有耦合——mech-lib 全文没有任何一处与 parser 相关。

**唯一实质变化在引擎侧**：路线 A 下用户代码可以直接 `import * as mech from '...'`，绕过 `registerLib`，引擎失去唯一的库准入钩子。§5.1 给出替代方案，结论是 **`defineOp` 与 `solid()` 本身就是钩子，不需要外层 Proxy 包装**——这修正了前置文档 §4.4 的说法。

---

## 2. 现有契约的完整清单（路线 A 下依然全部有效）

以下全部实地核实自 `packages/core/src/sdk.ts`（库作者的唯一入口）。

### 2.1 SDK 导出面的四组能力

```ts
// 组 1：构造器与身份表（契约面 B）
import { solid, fromBrep, compound, isShape, isCompound, hasBrep, brepOf,
         nameOfShapes, getSlot, ensureSlot } from '@faicad/faijs-core/sdk'

// 组 2：运行时状态锚点（契约面 A + C）
import { keep, keepHidden, getBackends, configureBackends,
         assertContractVersion, CONTRACT_VERSION,
         BrepUnsupportedError, MeshUnsupportedError } from '@faicad/faijs-core/sdk'

// 组 3：BREP 桥接（造 BREP 产物）
import { getKernel, meshHandle, fromHandle } from '@faicad/faijs-core/sdk'

// 组 4：双路径实现声明（契约面 D）
import { defineOp, assertLibConforms, DUAL_OP_META } from '@faicad/faijs-core/sdk'
```

`sdk.ts` 的自述约束：**零 heavy 运行时依赖**——值导入闭包不含 three / occt-wasm / manifold / node:*，由 `dist/sdk.js` 静态 import 扫描守卫。库作者依赖 sdk 不会把重依赖拖进构建图。

### 2.2 两条禁令（引擎-库契约既有规定）

| # | 禁令 | 精确含义 |
|---|---|---|
| **F1** | 库不得访问引擎的内部可变状态 | 无 `currentStmt`、无 `script`（ScriptIR）、无 `outputCache`、无 `brepChain`。库要什么信息，引擎作为参数传给它 |
| **F2** | 库不得查询或修改 DAG | 无 `dependentsOf`、无 `touch`；禁止原地改写已发布的 Shape |

> F1 是「库不能读引擎的**内部状态**」，不是「库不能知道引擎存在」。库当然要 `import` faijs、按 faijs 协议写声明。区别在于**公开接口 vs 内部状态**。

**路线 A 让 F1/F2 更容易遵守**：`ScriptIR`、`StatementIR`、DAG 这些概念在路线 A 下根本不存在，库作者连"想违反"的对象都没有。

### 2.3 K1/K2/K5 三条硬约束对库作者的直接含义

| 约束 | 对库作者的含义 |
|---|---|
| **K1** 签名 = 源码里写的样子 | 你的函数签名就是调用方看到的签名。引擎**不会**在参数列表末尾偷偷加上下文对象。反过来：你也不能靠 `rest.pop()` 取上下文 |
| **K2** 几何运算在库 | 引擎不内置任何几何算法。你要造几何，自己调 `getBackends().kernel` 或自带算法 |
| **K5** 引擎零函数知识 | 引擎不按函数名分支。**faijs 自带标准库与第三方库没有类别之别**——你的库和 stdlib 走完全相同的路径 |

K5 的实测印证：`assertLibConforms`（`define-op.ts:212-244`）对 `contractVersion` 与 dual-op 元数据的校验，对 stdlib 和 mech-lib 一字不差地适用。

---

## 3. 库作者的要求清单（路线 A）

### 3.1 必做四项

| # | 要求 | 具体形态 | 不做的后果 |
|---|---|---|---|
| **1** | 导出 `contractVersion` | `export const contractVersion = CONTRACT_VERSION` | 库含 dual-op 时**抛错**（`define-op.ts:215-219`） |
| **2** | 几何函数用 `defineOp` 声明实现集 | `export const foo = defineOp({ mesh, brep? })` | 不参与 BREP/mesh 静态分派；产物不被自动包装 |
| **3** | 产物经构造器创建 | `solid(mesh)` / `fromBrep(mesh, holder)` / `fromHandle(h)` | 对象**不在身份表**（`created` 集合，`shape.ts:45`）⇒ `isShape` 返回 false ⇒ 不被识别为几何输入，终端判定与 keep 全部失效 |
| **4** | 遵守 F1/F2 两条禁令 | 不碰引擎内部状态、不改 DAG | 破坏增量执行与 undo 的正确性 |

要求 2 有例外：**纯计算函数不需要 `defineOp`**。`assertLibConforms` 明确「Functions without dual-op metadata are left untouched」——一个返回数字的 `measureVolume(shape)` 直接 `export function` 即可。判据是**是否产出 Shape**，不是"是否在库里"。

### 3.2 `defineOp` 的构造期校验（写错立刻抛错，非静默）

`define-op.ts:157-166` 在 `defineOp` **调用那一刻**（即模块加载时）就校验：

```
mesh 存在但非函数        → '[faijs/defineOp] mesh must be a function'
brep 存在但非函数        → '[faijs/defineOp] brep must be a function'
mesh 与 brep 都不是函数  → 'at least one implementation (mesh or brep) is required'
```

这是**模块加载期**失败，不是调用期。库作者写错了在 `import` 阶段就炸——路线 A 下这个性质尤其有价值，因为它不依赖任何 parse。

### 3.3 可选三项

| # | 可选项 | 用途 | 声明形态 |
|---|---|---|---|
| **5** | `capabilities` | 声明本 op 的 BREP 实现依赖哪些内核能力（D5 能力路由） | `defineOp({ brep, capabilities: ['fillet'] })` |
| **6** | `outputs` | 多产物 op（如 split 的 front/back） | `defineOp({ mesh, outputs: ['front', 'back'] })` |
| **7** | `keep()` / `keepHidden()` | 函数体内声明保留哪些入参（契约面 C） | `keep(...params.members)` |

`capabilities` 的运行时语义（`define-op.ts:186-188`）：取第一个缺失能力喂给 `dispatchPath`，auto 模式降级 mesh、brep 模式报错。**这是静态判定，不是 try-catch 回退**。

---

## 4. 实现一个 op 需要写哪些东西

### 4.1 最小完整库（三行核心）

```ts
import { defineOp, CONTRACT_VERSION } from '@faicad/faijs-core/sdk'

export const contractVersion = CONTRACT_VERSION

export const makeBall = defineOp({
  mesh: (params: { radius: number }) => sphereMesh(params.radius),   // 返回 {positions, indices}
})
```

就这些。`sphereMesh` 是纯函数，返回 `MeshData = { positions: Float32Array; indices: Uint32Array }`。**产物不用自己调 `solid()`**——wrapper 会做（`define-op.ts:102-105` `wrapMeshOne`：已是 Shape 则透传，否则 `solid(v)`）。

实证来源：`mech-lib/src/mock-mech-brep.ts:117-119` 的 `makeBall` 就是这个形态，全文只比这多了一个 `sphereMesh` 的实现体。

### 4.2 双路径 op（mesh + BREP）

```ts
import { defineOp, CONTRACT_VERSION, getBackends } from '@faicad/faijs-core/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

export const contractVersion = CONTRACT_VERSION

function boxSolidHandle(size: number): BrepHandle {
  const kernel = getBackends().kernel.brep as { makeBox(x: number, y: number, z: number): unknown } | null
  if (!kernel?.makeBox) throw new Error('[mylib] OCCT kernel not available (run in auto/brep mode)')
  return kernel.makeBox(size, size, size) as BrepHandle
}

export const makeHeadstock = defineOp({
  mesh: (params: { size: number }) => cubeMesh(params.size),     // MeshData
  brep: (params: { size: number }) => boxSolidHandle(params.size), // BrepHandle
})
```

要点：

1. **BREP 实现返回裸 `BrepHandle`**，wrapper 调 `fromHandle(v)` 登记（`define-op.ts:113`）。若需附带面演化，返回 `{ solid, faceEvolution }`，wrapper 走 `fromBrep(meshHandle(res.solid), res)`（`:109-111`）。
2. **两个实现签名必须一致**——同一组 `args` 会喂给任一实现（`define-op.ts:191/195` 都是 `(...args)`）。
3. **内核不可用时抛错，不静默降级**（对应 BREP/mesh 红线：执行前静态判定）。

### 4.3 引擎自动做的事（库作者不用写）

| 引擎自动做 | 位置 | 库作者不写 |
|---|---|---|
| 收集几何输入 | `define-op.ts:181` `args.filter(isGeometryInput)` | 不用声明 `inputs` 字段——由 args 自身在运行时决定，不由作者声明 |
| 选择 brep/mesh 路径 | `define-op.ts:189` `dispatchPath(inputs, meta, missing)` | 不用判断"当前该走哪条路" |
| 包装产物 | `:192/196` `wrapMeshOne` / `wrapBrepOne` | 不用自己调 `solid()`（调了也行，`isShape` 透传） |
| 登记身份与 BREP 槽 | `shape.ts:45` `created.add(s)`、`fromBrep` 写 slot | 不用手动记账 |
| async 包装 | `:180` wrapper 是 `async` | 实现可以是同步函数——wrapper 统一 `await` |

第 5 条值得单独说：**实现可同步**（`MeshImpl` 类型是 `MeshProduct | Promise<MeshProduct>`）。`boolean.ts` 的 mesh impl 就是同步的，async 是 wrapper 强加的。这在路线 A 下有直接影响——见 §5.3。

### 4.4 一个 op 的完整交付物清单

| 交付物 | 是否必须 | 说明 |
|---|---|---|
| 几何算法函数（纯函数） | ✅ | 返回 `MeshData` 或 `BrepHandle` |
| `defineOp({...})` 包装并 export | ✅ | 除非是非几何的纯计算函数 |
| 库根导出 `contractVersion` | ✅ | 整个库一次，不是每个 op |
| 参数类型声明（TS） | 建议 | 供调用方与 IDE；引擎不校验参数 schema |
| `capabilities` 声明 | 仅 BREP 依赖特定内核能力时 | |
| `outputs` 声明 | 仅多产物 op | |
| `keep()` 调用 | 仅装配类 op（需保留入参可见） | |
| JSDoc | 项目内库必须 | 门禁检查 |

**引擎不校验参数 schema**——这是与现状 parser 的一个真实差异，见 §5.4。

---

## 5. 路线 A 下的四处实质变更（全在引擎侧）

### 5.1 库准入钩子：`registerLib` 消失，但 `defineOp` 与构造器就是钩子

**问题**：现状唯一准入点是 `registerLib`（`runtime.ts:307`），它调 `assertContractVersion` + `assertLibConforms`。路线 A 下用户代码直接 `import * as mech from 'https://...'`，引擎**拿不到那个 namespace 对象**。

**实测 ESM namespace 的性质**（node 探针）：

```
① namespace 是否 frozen  : false
   赋值 ns.makeGear = 1   : 抛错 → TypeError        ← 不可写，无法原地改
② Object.keys(ns)         : contractVersion, makeBox, makeGear
   检出 dual-op 数        : 2                        ← enumerable:false 的元数据仍可读
③ Proxy(ns) 读取          : 生效                     ← 可以代理
④ 复制成普通对象再包装    : 元数据透传 OK / 身份稳定 / 原始模块未被污染
```

所以技术上**能**包，但**没有时机**——引擎不参与用户代码的 `import`。

**结论：不需要包。** 两个天然钩子都是**库必须调用的模块级函数**：

| 钩子 | 触发时机 | 能拿到什么 |
|---|---|---|
| `defineOp(decl)` | **库模块加载时**（模块顶层执行） | op 的完整元数据 + 构造期校验 |
| `defineOp` 的 wrapper 内部 | **每次调用时** | `(函数身份, 输入 Shape 集, 输出 Shape)` —— 终端判定所需的全部信息 |
| `solid()` / `fromBrep()` | 每次产出几何时 | Shape 创建事件 |

wrapper 内部（`define-op.ts:180-197`）已经在做输入收集与产物包装，**加一行调用记录即可**，位置比外层 Proxy 更准（拿得到 `inputs` 已过滤结果、拿得到最终 Shape）。

**这修正了前置文档 §4.4 的方案**：那里写「引擎在库准入处包一层 Proxy」，前提是 `registerLib` 仍是唯一入口。路线 A 下该前提不成立，而 `defineOp` 是更好的钩子——库作者零感知、无身份稳定性问题、无元数据透传问题、无"先校验后包装"的时机陷阱。前置文档 §4.4 讨论的四个 Proxy 实现要点（wrapCache / 非函数透传 / async 时序 / 元数据透传）在这个方案下**全部不需要**。

**代价**：不用 `defineOp` 的库就完全不受管——但这与现状一致（`assertLibConforms` 本来就放过无元数据的函数），且 K5 禁止按名字分类，没有别的合法判据。

**遗留缺口**：`contractVersion` 校验失去执行点。三个选择：

- (a) `defineOp` 内部读不到所属模块的 `contractVersion`（模块级变量，op 无法反查）⇒ 不可行
- (b) 宿主在 resolve 库 URL 时做一次 `import` + 校验（`module-resolver` 的自然归属，它现在零消费）
- (c) 接受不校验，靠 `defineOp` 的构造期校验兜底结构合法性

推荐 (b)——这给 `module-resolver` 找到了第一个真实消费方。

### 5.2 `keep()` 的归属机制换底

**现状**（`runtime-state.ts:360-371`）依赖两个 parser 产物：

```ts
const stmt = getRuntimeState().currentStmt   // StatementIR —— 路线 A 下不存在
const n = nameOf(s)                          // shapeToName 表，由引擎按语句登记
keepSink(String(stmt.id), names, hidden)     // 归属到语句 id
```

**路线 A 下改为从 ctx 反查对象身份**（探针实测）：

```
① kept 变量名    : a, b        ← 库函数体内 keep(...members) 生效
② ctx 内全部 Shape: a, b, g, tmp
③ 未被 keep 的   : g, tmp
④ 重命名无影响   : 对象身份比对，与变量名字面无关
```

反查一行即可：`Object.entries(ctx).find(([, v]) => v === shape)?.[0]`。

三个收益：不需要 `currentStmt`（消除 F1 意义上最后一处内部状态依赖）、不需要 `shapeToName` 表（ctx 本身就是表）、变量重命名不影响结果（现状用名字比对，重命名即失效）。

**库作者签名完全不变**——`keep(...shapes)` 一字不改。

### 5.3 op 可以做成同步（可选优化，非必须）

wrapper 现在无条件 `async`（`define-op.ts:180`），原因是「The compiled .fai.js product always awaits the call」——**这是 codegen 的约定，不是几何的需要**。

路线 A 下用户手写代码，`await` 由用户自己写。若保持 wrapper `async`，用户必须每行都写 `await`：

```js
part1 = await cad.box({size: 10})
part2 = await cad.fillet(part1, {r: 2})
```

若让 wrapper 在实现同步时返回同步值，可写成 `part1 = cad.box({size: 10})`。代价是 wrapper 内部要判断实现返回值是否 thenable，且**同一个 op 在不同路径下同步性可能不同**（mesh 同步、brep 异步）——这会让用户代码的 `await` 需求随执行模式变化，是真隐患。

**建议保持全 async**：`await` 是显式的、可预测的，且 JS 里 `await` 一个非 Promise 值是合法的。这条列在这里只为说明"同步化是可选项，不是路线 A 的必要条件"。

### 5.4 参数 schema 校验消失

现状 parser 有 `args-schema`，能在 parse 期校验参数形状。路线 A 下这一层不存在——**参数校验责任转移给库作者自己**。

对库作者的实际含义：想报友好错误，得自己写。stdlib 已有先例（`split.ts:269-272` 手写 `assertNonZeroVec3`、`if (!input) throw`），说明**这一层本来就在库里做**，parser 的 schema 是额外的一道，不是唯一的一道。

可选补偿：在 sdk 里提供一组断言辅助（`assertVec3` / `assertPositive` 等），让库作者少写样板。这是纯增量的库侧能力，与路线选择无关。

---

## 6. 契约变更总表

| 契约项 | 现状 | 路线 A | 库作者需改动 |
|---|---|---|---|
| `contractVersion` 导出 | 必须 | 必须 | 无 |
| `defineOp` 声明 | 必须（几何函数） | 必须 | 无 |
| 构造器产出 Shape | 必须 | 必须 | 无 |
| `getBackends()` 拿内核 | 模块级 import | 模块级 import | 无 |
| `keep()` 签名 | `keep(...shapes)` | `keep(...shapes)` | 无 |
| `keep()` 归属实现 | `currentStmt` + `shapeToName` | ctx 对象身份反查 | **无**（引擎侧改） |
| F1/F2 禁令 | 有效 | 有效且更易遵守 | 无 |
| 参数 schema | parser 校验 + 库自查 | **仅库自查** | 建议补断言 |
| 库准入校验 | `registerLib` 单点 | `defineOp` 构造期 + 宿主 resolve 期 | 无 |
| 库的分发形态 | TS 库 + 宿主注入命名空间 | **ESM 模块 + 用户直接 import** | 需发布为可 import 的 ESM |

最后一行是库作者**唯一**需要适配的：从"被宿主 `registerLib` 注入"变成"被用户代码 `import`"。对 npm 包而言这是更标准的形态——`mech-lib` 现在就是标准 ESM 包，它的 `package.json` 不需要改。

---

## 7. 待定决策点

### D6 `contractVersion` 校验的执行点

- (a) 宿主 resolve 库 URL 时 `import` + 校验（**推荐**，给 `module-resolver` 找到第一个消费方）
- (b) 不校验，靠 `defineOp` 构造期校验兜底
- 影响：(a) 需要宿主在加载前多一次 import；(b) 版本不匹配的库会以更晚、更难诊断的方式失败

### D7 调用记录放在 `defineOp` wrapper 内 vs 外层包装

- (a) wrapper 内（**推荐**）：拿得到过滤后的 `inputs` 与最终 Shape，库作者零感知
- (b) 外层 Proxy：需处理 wrapCache / 元数据透传 / 校验时机（见前置文档 §4.4）
- 影响：(a) 只管 `defineOp` 的 op，不用 `defineOp` 的函数不被记录；(b) 在路线 A 下无施加时机

### D8 是否提供参数断言辅助库

- (a) 在 sdk 增加 `assertVec3` / `assertPositive` / `assertRange` 等
- (b) 不提供，库作者自己写
- 影响：与路线选择无关，可独立决定

---

## 8. 一句话总结

**路线 A 对库作者几乎没有新要求**——现有四面契约（环境资源 / Shape 构造 / keep / defineOp）全部是模块级的，与 parser 零耦合，`mech-lib` 一行都不用改。真正要动的是引擎侧的三处：库准入钩子从 `registerLib` 迁到 `defineOp`、`keep` 归属从语句 id 换成 ctx 对象身份、参数 schema 校验责任下移到库。
