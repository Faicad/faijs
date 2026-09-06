# faijs 接口契约（当前设计意图）

[English](api-contract.md) | 中文

> 定位：本文档记录 faijs **当前**的接口契约——分层与包结构、引擎／库职责边界、命名规则、语句模型、语法、终端判定、执行、几何引擎槽位、宿主注入与消费面。
>
> **本文档是长期有效的接口契约：不写开发计划、不记录缺陷，也不引用 `docs/plans/` 下的任何文档。**
>
> 关联文档：
> - `docs/syntax-design.md` —— `.fai.js` 语法与增量执行契约
> - `docs/ops-api-inventory.md` —— 写 `.fai.js` 代码的 API 手册（AI／用户侧，生成文件）

---

## 1. 架构分层与包结构

faijs 是 **npm workspaces monorepo**。根包 `@faicad/faijs` 是**门面薄层**（`src/index.ts` 仅 22 行），真实实现在 workspace 包内。

| 包 | 包名 | 职责 |
|---|---|---|
| `packages/core` | `@faicad/faijs-core` | **引擎 + L3 API 面**：解析／校验／调度／记账／资源，含 `cad` 命名空间全部 op（装配与布尔）于 `core/src/api/` |
| `packages/gear-lib-demo` | `@faicad/gear-lib-demo` | 第三方库样例（peer 依赖 `@faicad/faijs-core`） |
| `packages/fixtures` | `@faicad/faijs-fixtures` | 私有，纯数据 |
| `packages/tests` | `@faicad/faijs-tests` | 私有，集成测试 |
| `packages/demo` | `@faicad/faijs-demo` | 私有，vite 演示 |

依赖方向单向无环：`gear-lib-demo → core`、`tests → gear-lib-demo + fixtures`、`根 → core`。**core 无内部依赖。**

```
┌──────────────────────────────────────────────────────────────┐
│ L0  text layer  packages/core/src/lang/                      │
│   parser (acorn + syntax gate)   codegen (debug re-print)    │
│   compile (to zero-import ESM)   allocate-id (partN)         │
│   keep (retention directives)   internal statement model     │
├──────────────────────────────────────────────────────────────┤
│ L0+ anchor  packages/core/src/runtime-state.ts (no imports)  │
│   Backends / keep sink / Shape identity tables / contract ver│
├──────────────────────────────────────────────────────────────┤
│ L1  geometry library  packages/core/src/api/ (L3 API 面)      │
│   primitives transform drill extrude engrave knurl           │
│   boolean split compound copy geom reconcile                 │
├──────────────────────────────────────────────────────────────┤
│ L1' engine core  packages/core/src/{mesh,brep,topology}/     │
│   mesh path + CSG | brep/engine (two-slot registry) | topo   │
├──────────────────────────────────────────────────────────────┤
│ L2  orchestration  packages/core/src/cad-runtime/            │
│   CadRuntime (execute/append/update/check — text in, result out)│
│   ModuleExecutor (module load + incremental + persistent ctx)│
│   backend-dispatch (dispatchPath)   terminal-dag             │
│   module-resolver (on-demand library resolution)             │
├──────────────────────────────────────────────────────────────┤
│ L3  Host  node-host (fs/CLI)   browser-host (worker/fetch)   │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 入口导出面

根包 `@faicad/faijs` 有 **11 个 subpath export**（`package.json` 的 `exports` 字段）：

| 入口 | 内容 | 说明 |
|---|---|---|
| `@faicad/faijs` | 门面：`export * from '@faicad/faijs-core'` + 包装后的 `createRuntime` | 宿主统一入口；**包名不可改** |
| `/browser` | 浏览器安全面（不含 node-host） | 宿主（3d_editor）首选 |
| `/sdk` | **第三方库开发面**，零 heavy 依赖 | 库作者唯一应依赖的入口 |
| `/stdlib` | 几何库命名空间 | 需自行注入 `cad` |
| `/csg` | CSG／Manifold 数据交换 | 浏览器安全 |
| `/sdf` | SDF 运行模板与类型 | 浏览器安全 |
| `/node` | Node 专用：`createNodePorts`／CLI／FsAssetResolver | 不得进浏览器构建 |
| `/faqts`、`/faqts/node`、`/faqts/browser` | `.ts` 源码整段执行通道（第二条执行路径） | 见 §10.5 |
| `/module-resolver` | 第三方库版本解析 | 见 §10.4 |

引擎包另有细粒度子路径（`@faicad/faijs-core/runtime-state`、`/shape`、`/identity`、`/lang/*`、`/brep/*` 等），供库作者按需导入。

**规则**：浏览器构建里静态 import node-host 会 404——Node 专用代码一律从 `/node` 导入。11 个入口的运行时导出面由 `scripts/api-surface-snapshot.mjs` 与 `scripts/api-surface-snapshot.json` 快照比对守卫。

### 1.2 职责边界（引擎／库切分）

- **引擎 = 解析 + 校验 + 调度 + 记账 + 资源；库 = 一切几何。**
- **判别一个函数归谁，问的是"它是几何算法吗"，不是"现在谁在 import 它"。** 引擎当前调用了某个几何函数，那是待清理的病灶，不是把它迁进引擎的理由。
- **引擎零函数知识**：parser／compile／runtime 不得按函数名分支、不得区分函数类别。引擎里只有"库函数"这一均匀概念，函数信息只能是数据（`StdlibNamespace`）。
- faijs 的职责只有一个：执行脚本，生成 3D 模型（`ExecutionResult`）。宿主的职责只有两个：生成正确的脚本、调用 faijs 执行。
- 🔴 **所有几何变更必须走脚本语句**；宿主只消费 `ExecutionResult`，不得重复推导终端判定、不得自行实现 DAG 叶子过滤。

---

## 2. 铁律（写进契约，任何实现都不得违反）

- **R-1 引擎不内置几何。** 几何运算全部由库实现；引擎只做调度、记账与资源供给。
- **R-2 库函数签名 = 源码里写的样子。** 禁止隐式注入：`cad.box({ size })` 编译后就是 `cad.box({ size })`，参数一个不多一个不少；禁止编译期追加末参，禁止用 `rest.pop()` 取上下文。
- **R-3 用户原文不直接执行。** 先 acorn 解析（语法闸门）→ 引擎编译为零 import 模块 → JS VM 动态 import 执行。安全边界 = 语法闸门 + 产物由引擎生成，**不 eval 用户文本**。
- **R-4 命名与终端语义由引擎统一。** `partN` 分配、DAG 叶子判定、消费合法性校验全部封装在引擎内，宿主不重复实现。
- **R-5 坐标空间**：毫米（mm）、+Z 向上、角度用度。所有 `cad.*` 输入／输出均为世界空间 `Shape`。
- **R-6 BREP 链是逐 part 的。** 一个 part 是否仍为 BREP，由 `solidCache` 中是否有它的句柄唯一决定；不存在全局标志，兄弟 part 互不污染。
- **R-7 静态分派，禁止运行时回退。** BREP 路径执行抛异常 = bug，直接报错暴露，绝不 try-catch 后改走 mesh；能力缺失按静态规则降级或明确报错，**绝不伪造 API**。
- **R-8 keep 是 faijs 与 UI 的唯一耦合点。** faijs 不定义 feature／UI 表单／图标／编辑面板——它们属于上层应用（3d_editor）。
- **R-9 op 与特征（feature）的术语约定。** 用户原话（逐字）："关于op的定义，在faijs里就是返回几何实体的操作。而在上层应用如3d_editor中，op默认指任何操作，或者说任何函数调用，而特征则对应到通用CAD术语，可以通过1个到多个op/函数调用实现。"——因此：**faijs 层**，op = 返回几何实体（`Shape`／`CompoundShape`）的操作；**宿主层（3d_editor）**，op = 任何操作／任何函数调用，特征（feature）= 通用 CAD 术语，由 1 到多个 op／函数调用实现。引擎零函数知识（§1.2）只认识"返回几何实体的库函数调用"这一均匀概念；特征的语义与 UI 表单／图标／编辑面板一样属于上层应用（见 R-8）。

---

## 3. 命名契约（StmtId 与 PartName）

每条语句带两个**正交标识**：

| 键 | 含义 | 分配规则 | 用途 |
|---|---|---|---|
| **StmtId（`sN`）** | 一条语句的身份，顺序稳定 | 解析期按语句顺序 `s1, s2, …`（参数语句占前段） | Timeline 节点键、增量调度 plan 缓存键、diff 键 |
| **PartName（`partN`）** | 变量名，一条语句可有 0~多个 | `derivePartName`（见 §3.1） | `ExecutionResult.outputs/compounds` 键、执行 ctx 变量键、终端 id |

**不变量**：

- 语句 id 永远是 StmtId（`sN`），**不是变量名**；变量名只存在于语句声明的输出里。
- 声明的输出始终显式存在：单输出 = `[name]`；split = `[front, back]`；void op = `[]`。
- `TerminalShape.id` 就是 PartName，不是 StmtId。

### 3.1 `derivePartName` 命名规则

**唯一规则：一律分配新名，按输出个数递增 `partN`。** 输入名复用规则（translate／drill 等保名重赋值）与 `_vM` 版本号语义均已取消。

| 情形 | 变量名 | 示例 |
|---|---|---|
| 无赋值语句（add_constraint／do_assemble） | 无（R0） | `assem1.add_constraint({ … })` |
| 有赋值（含单入单出） | 新名，每个输出一个 `partN` | `let part3 = cad.drill(part0, { diameter: 5 })` |
| split（1→2） | 连续两个新名 | `const { front: part1, back: part2 } = cad.split(part0, { cutMode: 'plane' })` |
| 多入多出且数量相等（Shape[] 批处理） | 禁用（R4），抛错 | — |

模型号 N 从代码文本词法扫描已用的 `partN` 取最大值 +1（不 parse，允许生成中的代码）。

**`partN` 只约束 UI 生成的代码。** AI 或手写代码可用任意**合法 JS 标识符**（`const shaft = cad.cylinder({ … })`）；引擎对两者一视同仁。

---

## 4. 语句与脚本模型

一个 `.fai.js` 脚本是一串语句，一行一个操作（扁平格式，§5）。引擎把文本解析为内部表示；**该表示是实现细节——不属于本接口契约，可随时变更**。契约面对的语句模型就是代码本身：变量名（`PartName`）、被调函数、位置实参列表（每个实参位都接受全部表达式形态——字面量、变量引用、成员访问、嵌套查询、运行时表达式）、末尾选项对象、声明的输出（§3、§5）。

`Shape`（`packages/core/src/mesh/types.ts`）是核心几何类型：`{ positions: Float32Array; indices: Uint32Array }`（三角网格，世界空间）。`CompoundShape` 是 `{ kind: 'compound', children: Shape[] }`。

### 4.1 终端

```ts
import type { PartName } from '@faicad/faijs'

export interface TerminalShape {
  id: PartName                // identified by variable name, not statement id
  kind?: 'shape' | 'compound' | 'value'
  hidden?: boolean            // kept but not rendered; undefined means visible
}
```

`ExecutionResult.terminals` 携带这些；代码里的显式 `return [...]` 覆盖 DAG 推导的终端集合。

---

## 5. 语法契约（`.fai.js` 合法 JS 子集）

`.fai.js` 必须是 **JavaScript 的合法子集**——任意 JS 解析器（acorn）都能无错解析。加载流程：acorn 解析（语法闸门）→ 引擎把解析结果编译为模块 → JS VM 动态 import 执行；**不 eval 用户文本**（R-3）。

**顶层禁止**：控制流（if／for／while／do／switch／try）、动态 `import()`、`eval`／`new Function`／`new`、`export`。越界一律报诊断码 `E_CONTROL_FLOW` / `E_SYNTAX` / `E_VALUE` / `E_REFERENCE` / `E_IMPORT` / `E_ARG`，由 `check()` 透传。

**允许**：顶层 `import`（第三方库，非控制流）、顶层函数定义、**函数体内的控制流**（if／for／while／switch／try／throw／break／continue／labeled，外加 `var`）、**本机函数调用**（callee 是脚本自身函数集的裸标识符，四种形式：赋值／重赋值／解构／副作用）、**位置实参为完整表达式**（字面量 `cad.box(10, 20, 30)`、成员访问 `cad.hem(p0.solid, …)`、多个对象实参原样保留——不覆盖不合并）、**运行时表达式**（参数值里的 `ExprIR`，由 JS 引擎求值而非折叠）、可静态折叠的表达式（二元／模板字符串／三元）、任意 callee 解构、成员方法链（`asm1.add_constraint({ … })`）。

**函数体不透明**：体内控制流合法，但 `eval`／`new`／动态 `import()`／`import`／`export`／`class`／`with` 依旧禁止，且体内不得调用另一个本机函数（v1）。本机调用按「位置 + 按名」ABI 绑定：位置实参映射前 `M` 个形参，末尾对象的键按名映射剩余形参（未知键或占用冲突 → `E_ARG`），未绑定形参为 `undefined`，`keep`／`keepHidden` 在绑定前剥离。编辑函数体经 `bodyHash` 内容键使所有调用者失效（§7.5）。

平铺格式（UI 录制，一行一个操作）：

```js
import * as mech from 'gear-lib-demo'
const size = 20
function makeGear(count, pitch) {            // body may contain loops/branches
  let parts = []
  for (let i = 0; i < count; i++) parts.push(await cad.box({ size: pitch }))
  return await cad.union(parts[0], parts[1])
}
let part0 = cad.box({ size })
let part3 = cad.drill(part0, { diameter: 5 })
const { front: part1, back: part2 } = cad.split(part0, { cutMode: 'plane' })
let part4 = cad.group({ members: [part0, part1] })
let part5 = mech.makeHeadstock({ length: 120 })
let part6 = makeGear({ count: 8, pitch: 5 })
```

**keep 指令**寄生在 args 中（不是新关键字），见 §6。代码文本是唯一事实源；从它编译出的内部表示是实现细节，从内部表示重打文本只用于调试（见 §13.3 PS）。一个操作对应一行代码是扁平格式（UI 录制）的约定。

---

## 6. 终端判定契约（keep 驱动）

**核心语义**：一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。

保留声明有两处，优先级**调用点 > 函数体**：

```js
cad.drill(a, { diameter: 8, keep: ['a'], keepHidden: true })
```

```ts ignore-check
export function group(params) {
  keep(...params.members)
  return compound(params.members)
}
```

### 6.1 `consumes()` 判定链（C0 → C3 → C5，短路）

| 规则 | 条件 | 结果 |
|---|---|---|
| **C0/C1** | 变量 ∈ `resolveKeep(stmt).kept`（调用点或函数体声明） | **不消费** |
| **C3** | 语句有赋值且所有输出都是非几何 | **不消费**任何输入 |
| **C5** | 默认 | **消费**（positional 槽内任意位置的变量引用——含 `ExprIR` 成员链——或 args 中的变量引用） |

补充规则：嵌套调用内的引用是只读查询，不消费；`receiver`（成员方法调用）不消费接收者变量；位置字面量与非末位对象实参不消费任何东西（只有变量引用和表达式标识符算消费）。

C3 是**零签名知识**的客观默认：返回非几何的函数不可能把几何吞进结果——第三方测量／查询函数的输入因此不被误吃。

`resolveKeep` 合并函数体登记（`internalKeep`）与调用点 `parseUserKeep`；**hidden 采用「最后一次保留声明胜出」**（按语句顺序，后声明压过先声明）。

### 6.2 `computeLeafTerminals()`

对每个 shape 变量名（含 compound 变量）取「最后写者 P」；P 之后无任何语句消费它 → 终端。无生产者的变量（宿主手工注入）视为终端。

- 代码里的显式 `return [...]` 优先于 DAG 判定。
- `hidden` 只有显式为 `true` 才带字段，可见归一为 `undefined`（对齐宿主 `setNodeVisible(scopedId, !terminal.hidden)`）。

### 6.3 静态校验

`validateKeepDirectives(stmt)` 是纯静态校验，对第三方库同样适用：`keep` 必须是数组、条目必须是变量引用或 `{ shape, hidden }`、引用目标必须是本语句 positional 中的变量引用之一或出现在 args 中、`keepHidden` 必须是 boolean。违反进 `CheckResult.errors`。

### 6.4 终端与执行产物

`ExecutionResult.outputs` 含**全部** Shape 变量（含中间结果），只是不进 terminals；`brepSolids` 与拓扑**按 terminals** 提取。非几何的 DAG 叶子（测量值、普通对象）进 `activeValues`，不进 `terminals`。

---

## 7. 执行契约（`CadRuntime`）

### 7.1 工厂与执行模式

```ts ignore-check
createRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, StdlibNamespace>): CadRuntime
export type ExecutionMode = 'auto' | 'brep' | 'mesh'
```

- `auto`（默认）：优先 BREP；mesh-only op、输入断链或能力缺失 → 静态走 mesh。
- `brep`：强制 BREP，不支持即报错（`BrepUnsupportedError` → `failedAt`），**不自动切换**。
- `mesh`：全部走 mesh 路径。

**门面与引擎的差别**：core 的 `createRuntime` **不装配 `cad`**（引擎零函数知识）；根门面 `src/index.ts` 包装它并注入 `registerLib('cad', createInternalStdlib())`。第三方库一律经 `runtime.registerLib(binding, ns)` 注册。

### 7.2 `CadRuntime` API

| API | 语义 |
|---|---|
| `execute(code, opts?)` | 全量执行：执行代码文本的每条语句 |
| `append(code, newIds, opts?)` | 增量追加：只执行新增语句（前缀已在持久 ctx） |
| `update(code, opts?)` | 增量更新：`plan` 算出失效集 → `reconcileCtx` → 按拓扑序从该集重算；无失效时零执行 |
| `check(code)` | 干跑校验：parse（语法闸门）→ schema（含 unknown-key）→ 引用预检 → `CheckResult` |
| `registerLib(binding, ns)` | 注册库命名空间（第三方库通道） |
| `setTopology` / `getTopology` / `deleteTopology` / `buildBrepTopology` | 拓扑注入与构建 |
| `dispose()` | 释放全部 BREP 句柄与缓存 |

三个执行入口**都是公开接口，输入是代码文本**（`execute` / `append` / `update`）；引擎在内部解析文本。增量语义按内容寻址（§13.2）。

`CheckResult = { ok, errors: CheckError[], warnings, script? }`，其中 `script` 提供 `{ statements, callees }` 供 AI 自我修正。

### 7.3 `ExecutionResult`（宿主主要消费面）

```ts ignore-check
export interface ExecutionResult {
  outputs: Map<PartName, Shape | CompoundShape>   // all shape variables, intermediates included
  brepChain: BrepChainState                       // BREP chain state (per-part handles)
  terminals: TerminalShape[]                      // DAG leaf terminals
  infos: string[]
  failedAt?: { index: number; callee: string; message: string }
  brepSolids?: Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>
  topology?: Map<PartName, PartTopology>
  compounds?: Map<PartName, PartName[]>           // compound variable -> member names
  changed?: PartName[]                            // variables whose value changed this run
  activeValues?: Map<PartName, unknown>           // live but non-geometric leaf values
}
```

### 7.4 `ExecuteOptions`

```ts ignore-check
export interface ExecuteOptions {
  params?: Record<string, unknown>
  inputGeometryMap?: Map<PartName, Shape>
  sceneCode?: string                               // whole-scene code text for cross-part refs
  partTransform?: { position: Vec3; scale?: Vec3 }
  startIndex?: number
  topology?: 'auto' | 'brep' | 'off'
  executionTimeoutMs?: number                      // whole-run guard (optional, default off) → E_EXEC_LIMIT
}
```

公开执行入口**恰好三个**——`execute(code)` / `append(code, newIds)` / `update(code)`，全部接收代码文本；**不存在第四个入口，也没有 `ExecuteCodeOptions`**。`sceneCode` 携带跨 part 引用的整场景代码文本。

**执行护栏**（`executionTimeoutMs`，可选、默认关）：覆盖 execute/append/update 全程（含每个本机函数重放）的整轮超时；超时抛 `ExecutionLimitError`（`E_EXEC_LIMIT`），保护 worker/UI 免于死循环。函数体内的同步 `while(true)` 是 JS 引擎单线程限制，本护栏无法打断——真正的防护在宿主层（worker terminate / AbortController）。

### 7.5 增量执行语义

- **按内容寻址**：语句身份键 = 带命名空间的被调函数 + 整个 positional 槽的 JSON（去掉 keep）+ 各依赖的内容指纹；参数语句为 `param|JSON(value)`；**本机函数调用为 `local.<callee>#<bodyHash>`**——编辑函数体使所有调用它的语句 key 变化、下游重算，未改动的函数体零重算。`keep`／`keepHidden` 两键被排除——**切换保留／隐藏状态零几何重算**。
- **持久 ctx**：脚本变量存于跨执行存活的容器，支持原地重赋值。
- **重放范围**：`plan` 算出失效集，从首个变更点重放；无失效则零执行。**本机函数调用是单一执行单元**——整个函数体作为一个整体重放（函数体内无语句级 diff）；函数体中间变量永不进入顶层 ctx 或终端判定。
- **函数 BREP 域**：本机函数运行期间新产生的 OCCT 句柄被登记；返回时除返回值可达句柄外的全部瞬态句柄被释放（`finally`，异常路径同样）。函数体内的 `cad.*` 调用产生几何但永不进入顶层 `solidCache`；只有返回值的句柄进入。

### 7.6 库契约三面

旧的 `ExecContext` 把内核、身份槽与 DAG 查询塞进一个注入的 `exec` 对象，已废止。现行契约是三个**显式 import** 的面，全部从 `@faicad/faijs/sdk` 导出。

**面 A —— Backends（宿主注入一次，库 import 访问）**

```ts ignore-check
configureBackends(backends: Backends): void   // called once at host startup
getBackends(): Backends                       // throws when unconfigured; no silent default
export interface Backends {
  readonly contractVersion: number
  readonly config: { mode; brepEngineId?; brepCapabilities?; partTransform? }
  readonly kernel: { readonly brep: unknown | null; readonly csg?; readonly sdf? }
  readonly fonts; texture; assets; events
  readonly cad?: StdlibNamespace
}
export const CONTRACT_VERSION = 1
```

**面 B —— Shape 构造器（库零记账）**

```ts ignore-check
solid(mesh): SolidShape                       // every mesh product must be created here
fromBrep(mesh, holder): SolidShape            // BREP product: registers handle + face evolution
compound(children): CompoundShape             // structure (hierarchy), not new geometry
isShape(v) / isCompound(v) / isCompoundLike(v)
hasBrep(shape): boolean / brepOf(shape): unknown | undefined
```

**面 C —— keep 声明（库函数体内调用）**

```ts ignore-check
keep(...shapes): void        // keep and render
keepHidden(...shapes): void  // keep but do not render on canvas
```

**两条禁令**：库**不得**访问引擎内部可变状态（无 `currentStmt`／`script`／`outputCache`／`brepChain`）；库**不得**查询或修改 DAG（无 `dependentsOf`／`touch`，禁止原地改写已发布的 Shape）。这些能力由引擎侧承担：`changed` 由引擎比对推导，装配变换的下游失效由引擎 `computeDownstream` 完成。

### 7.7 错误体系（Result 原生）

faijs 全面对齐 vendored BREP 树的 `Result`／`BrepError` 体系，作为三个 API 面的**主**错误机制。

| 面 | Result 处置 | 消费者写法 |
|---|---|---|
| ① TS 兼容面 | `Result<T>` 原样返回 | `const r = fuse(a, b); if (isErr(r)) …` |
| ② cad 脚本面 | 语句边界 unwrap：`err` → `ExecutionResult.failedAt`（带语句上下文） | `let p = cad.union(a, b)` — err → 语句失败 |
| ③ 库边界面 | 库内原样；边界 unwrap | 库内用 `ok`／`err`／`andThen`；`compatOp` 包装器在语句边界 unwrap |

**关键原语**（全部从 `vendored/brepjs/core/result.ts` 和 `core/errors.ts` 投影，经 `@faicad/faijs` 和 `@faicad/faijs-core/api/compat` 导出）：

```ts ignore-check
ok<T>(value: T): Ok<T>
err<T>(error: BrepError): Err<T>
isOk<T>(r: Result<T>): r is Ok<T>
isErr<T>(r: Result<T>): r is Err<T>
map<T, U>(r: Result<T>, f: (v: T) => U): Result<U>
andThen<T, U>(r: Result<T>, f: (v: T) => Result<U>): Result<U>
unwrap<T>(r: Result<T>): T   // throws if Err
```

**`BrepError`** 携带 `kind`／`code`／`message`／`suggestion`／`metadata`；`BrepErrorCode` 常量表枚举全部错误类别。完整表见 `vendored/brepjs/core/errors.ts`。

**语句边界 unwrap**：`compatOp` 包装器（和 `defineOp` 的 Result 感知边界）调用共享的 `unwrapResult(r, opName)` 叶子。当结果为 `err` 时，unwrap 抛出携带 op 名和 `BrepError` code 的执行错误——引擎已有的语句级 catch 将其转为 `ExecutionResult.failedAt`。这意味着**存量 `.fai.js` 脚本零修改**：错误面与之前的 throw 行为完全一致。

### 7.8 `compatOp` — `defineOp` 之上的兼容壳

`compatOp`（`packages/core/src/api/internal/compat-op.ts`）把任意 brepjs 形态函数提升为 faijs 语句级 op。它是 **`defineOp` 之上的单一入口兼容壳**——不存在第二条平行的实现路径。唯一定制部分是 **adapter**（`buildAdapter`），其余全部归属 `defineOp`：

1. **adapter——三步桥接**：① **借入（borrow）**：深遍历 faijs `Shape` 参数 → `createBorrowedHandle` 零拷贝视图（vendored 句柄原样透传——库私有，不改）；② **调用（call）**：`callBrepjs(fn, args)` 并在边界 unwrap Result——`err` 转为携带 op `name` 与 `BrepError` code 的执行错误；③ **收养（adopt）**：`adoptOut` 各收养产物（注销 finalizer + `fromHandle`）——单个顶层句柄，或 `outputs` 声明的字段逐一收养（数组字段逐元素收养）。
2. **spec 透传**：`name`、`capabilities`、`outputs`、`schema`、`slotMap` 原样交给 `defineOp`；`keep`／`keepHidden` 天然保留。
3. **其余全部归属 `defineOp`**：静态分派（`dispatchPath` + 能力门）、语句边界 Result、产品包装（`wrapBrepOne`／`wrapByKeys`）、`DUAL_OP_META` 挂载。兼容 op 于是就是一个普通 defineOp 产物：brep-only（mesh 模式抛 `E_MESH_UNSUPPORTED`），链下输入或缺失能力抛 `E_BREP_UNSUPPORTED`，位置/对象形态经 spec 的 `slotMap` 归一。

多产物契约名只有 **`outputs`** 一个——与 `defineOp` spec 相同的列表，经 adapter 第 ③ 步收养。

`admitCompatLib`（`packages/core/src/cad-runtime/admit-compat-lib.ts`）是 `compatOp` 的批量应用：`registerLib(binding, ns, { compat: true })` 在包装**之前**运行 `assertLibConforms`（R8：硬顺序约束——DUAL_OP_META 是 `enumerable:false`，先包装会让裸函数静默跳过严格校验）。对裸（非 dual-op）库函数只认一个标注——`fn.outputs`——并用它构建 `outputs` spec。

---

## 8. 几何契约（BREP／Mesh 双链路）

### 8.1 `dispatchPath`（静态判定，禁止运行时回退）

位于 `packages/core/src/cad-runtime/backend-dispatch.ts`（**不在 SDK 公开面**——库作者经 `defineOp` 声明实现集，见 §10.3）：

```ts ignore-check
dispatchPath(inputs: Shape[], impls: { mesh?: UnknownFn; brep?: UnknownFn }, requiredCapability?: BrepCapabilityName): 'brep' | 'mesh'
```

判定顺序：

1. `mode='mesh'` → 无 `impls.mesh` → **抛 `MeshUnsupportedError`**（`E_MESH_UNSUPPORTED`）；否则 mesh。
2. `mode='brep'` → 无 `impls.brep`、输入不全在链（`hasBrep`）、或当前引擎缺 `requiredCapability` → **抛 `BrepUnsupportedError`**。
3. `mode='auto'` → 缺 `requiredCapability` → mesh（静态降级）；否则有 `impls.brep` 且全部输入在链 → brep，否则 mesh。

空输入的创建类 op 满足 `[].every(hasBrep) === true`，因此走 brep。两种不支持错误（`BrepUnsupportedError`／`MeshUnsupportedError`）都被引擎捕获为 `ExecutionResult.failedAt`，不冒泡、不静默。

### 8.2 双引擎槽位注册表

mesh 引擎与 BREP 引擎是**两个正交槽位**，不是互相替代：mesh 是每条链的必经之路（`Shape` 是必有载荷 + 显示三角化），BREP 是可选的精度增强层，可随时断链。切换其中一个不影响另一个。

```ts ignore-check
registerBrepEngine(id: string, provider: BrepEngineProvider): void  // first registrant becomes default
registerMeshEngine(id: string, engine: MeshEngine): void
getBrepEngine(id?): Promise<BrepEngine>     // async provider, result cached
getMeshEngine(id?): MeshEngine
freezeEngineRegistries(): void              // freeze after assembly; further registration throws
export interface BrepEngine { readonly id: string; readonly primitives: BrepEngineApi; readonly capabilities?: BrepCapabilities }
export type BrepEngineProvider = () => Promise<BrepEngine>
```

**注册只发生在宿主启动装配期，注册表运行期只读**；不提供 unregister／setDefault／运行时切换。OCCT 作为默认 BREP 引擎由适配器 `ensureOcctDefaultEngine()` 幂等装配。

**能力声明**（`BrepCapabilities`，全可选）：`evolution`（`*WithHistory` 面演化）、`heal`、`directEdit`、`advSurface`、`assembly`（XCAF）、`meshLift`（mesh→BREP 提升）。缺失的能力按静态规则降级或明确报错，**绝不伪造**。

### 8.3 `BrepChainState`

```ts ignore-check
export interface BrepChainState {
  solidCache: Map<PartName, BrepHandle>       // present = still BREP; absent = downgraded
  kernel: BrepEngineApi | null                // null in mesh mode
  capabilities?: BrepCapabilities             // current engine capabilities (capability routing)
  partTransform?: { position: Vec3; scale?: Vec3 }
  faceEvolutionCache?: Map<PartName, Map<number, number[]>>
  meshShapeCache?: Map<PartName, WasmMesh>    // tessellation cache (topology mesh = display mesh)
}
```

**生命周期**：solid 所有权在**持久 `solidCache`**（重算顶替释放 / `dispose` 释放）。

### 8.4 Shape 与身份槽

`Shape` 是**必有载荷**（mesh），BREP 是身份槽上的**可选叠加层**。身份表（`created` WeakSet / `slots` WeakMap / `shapeToName`）挂在 `globalThis` 上的全局锚点 `runtime-state`——这让"两份 faijs 代码"（宿主 bundle 一份、第三方库打进一份）共享同一份状态，避免 Shape 身份孤岛。

`isShape` 只认构造器产物（WeakSet 登记），是终端判定的唯一依据。`isCompoundLike` 是结构判定（`kind === 'compound' && Array.isArray(children)`），引擎内部的终端／消费判定用它，对第三方返回的未注册 compound 同样生效。

### 8.5 断链物化

**断链（chain break）** = 产物用 `solid()` 而非 `fromBrep()` → 无 BREP 句柄 → 该 part 从此只剩 mesh 层，**永久不可自动恢复**。断链时刻 = `dispatchPath` 返回 `'mesh'` 的那一刻。

三种触发：T1 mesh-only op（如 knurl／sdf）；T2 混合输入（`inputs.every(hasBrep)` 不成立）；T3 显式 `mode='mesh'`。

**物化入口** `reconcileBrepInputs(inputs)`（`packages/core/src/api/reconcile.ts`）：对 BREP 侧输入做三角化归约（焊接顶点 → 去退化面 → 统一朝向 → 断言 2-manifold），mesh 侧透传。

`part-brep-lost` 事件由**引擎统一发送**（库不 emit）：判据是语句有几何输入、全部输入在链上、但输出不在链上。

---

## 9. 宿主契约

### 9.1 `HostPorts`

```ts ignore-check
export interface HostPorts {
  csg?: CsgBackend
  sdf?: SdfBackend
  fonts?: FontProvider
  texture?: TextureSampler
  assets?: AssetResolver
  events: EventSink   // required: emit('part-brep-lost', { partName, callee, reason })
}
```

除 `events` 外全部可选——Node 测试环境可只提供 BREP 引擎，BREP 路径的 op 不依赖 Ports。

### 9.2 宿主消费契约（3d_editor）

- 统一从 `@faicad/faijs/browser` 导入。
- 执行统一走 `CadRuntime.execute` / `append` / `update` / `check`（代码文本进，`ExecutionResult` 出）。
- **宿主不得重复实现 DAG 叶子过滤**（终端语义是引擎产物）；几何变更必须走脚本语句。
- 场景树层级从 `ExecutionResult.compounds` 构建；终端几何提交按 `result.terminals`；`brepSolids`／`topology` 直接消费（STEP 导出、拓扑重建）。
- **STEP 导出**：mesh 零件也可导出，区别只是三角化（faceted）STEP 而非精确 BREP 实体。按零件类型分别处理（精确 vs 三角化），不要整段失败。

---

## 10. stdlib 与第三方库

### 10.1 函数目录（`cad` 命名空间，30 个）

| 类别 | 函数 |
|---|---|
| 创建类 | `box` `sphere` `cylinder` `cone` `wedge` `text` `screw` `svgExtrude` `sdf` `load` |
| 变换类 | `translate` `rotate` `scale` |
| 特征类 | `drill` `extrude` `engrave` `knurl` |
| 布尔 | `union` `subtract` `intersect` |
| 分割 | `split`（双输出，解构 `const { front, back } = …`） |
| 结构型 | `group` `assembly`（compound 输出） |
| 克隆 | `copy` |
| 查询 | `faceCenter` `faceNormal` `bboxCenter` `bboxMin` `bboxMax` |
| 资产 | `asset` |

> 注：表中"特征类"是 faijs 函数目录的内部类别名（对既有几何做修改的操作），与宿主层"特征（feature）"术语无关——后者是通用 CAD 术语，由 1 到多个 op／函数调用实现（见 §2 R-9）。

**完整参数契约（默认值／必填）以 `docs/ops-api-inventory.md` 为准**（由 stdlib JSDoc 生成的产物，禁止手改）。

### 10.2 消费语义（声明驱动）

消费不再由 op 类别硬编码决定，而是**声明驱动**：默认消费（C5），保留由库函数体的 `keep()` / `keepHidden()` 声明，调用点的 `keep` 指令覆盖之。

| 库函数 | 声明 | 效果 |
|---|---|---|
| `group` / `assembly` | `keep(...members)` | 成员不被消费，成员与 compound 双双显示 |
| `copy` | `keep(input)` | 源不被消费，源与副本都显示 |
| 布尔系 | `keepHidden(...inputs)` | 源保留但 canvas 不渲染 |

### 10.3 库函数统一形态（defineOp）

库函数统一用 `defineOp`（`@faicad/faijs/sdk`）声明实现集——**不手写 `dispatchPath`**（该函数不在 SDK 公开面，见 §8.1）：

```ts
import { defineOp } from '@faicad/faijs/sdk'
import type { Shape } from '@faicad/faijs/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

interface MyParams { size: number }
declare function myOpMesh(input: Shape, params: MyParams): { positions: Float32Array; indices: Uint32Array }
declare function myOpBrep(input: Shape, params: MyParams): BrepHandle

export const myOp = defineOp({
  mesh: (input: Shape, params: MyParams) => myOpMesh(input, params),
  brep: (input: Shape, params: MyParams) => myOpBrep(input, params),
})
```

`defineOp` 的约束：

- 至少声明一个实现；**mesh 为默认路径**（mesh-only／brep-only 均合法）。
- 几何输入自动收集（`args.filter(isShape)`）；多产物函数用 `outputs: string[]` 声明（如 `split` 的 `{ front, back }`）。
- 包装器按 mode 自动分派（内部走 `dispatchPath`，见 §8.1）；失败抛 `BrepUnsupportedError`／`MeshUnsupportedError`，由引擎转 `ExecutionResult.failedAt`。能力声明（如布尔系 `['evolution']`）缺失时 auto 降级 mesh、brep 模式报错。

### 10.4 第三方库通道

- **注册**：`runtime.registerLib(binding, ns)`；脚本中 `import * as mech from 'gear-lib-demo'` 后以 `mech.fn(...)` 调用。引擎记录调用的来源命名空间，增量键带包名前缀。
- **校验**：导出 defineOp 声明的库必须带匹配的 `contractVersion`（=`CONTRACT_VERSION`）；`registerLib` 经 `assertLibConforms` 严格校验——不匹配即抛错，不静默降级（D-4）。未用 defineOp 声明的普通函数合法，但不享受 mode 路由／自动包装／装配校验。
- **解析**：`@faicad/faijs/module-resolver` 提供 `resolveImports` 与 semver 判定（`satisfies`），支持按需加载大库分片。

### 10.5 `.ts` 整段执行通道（faqts）

`@faicad/faijs/faqts` 是与录制管道**平行的第二条执行路径**：`.ts` 源码整段 transform 后一次执行，不逐语句调度、不接入 timeline；输出由作者显式 `export` 声明（无 DAG 自动推导）。它与 faijs 侧共享同一套 `cad` API 与 Shape 契约，因此两者产物互通。

---

## 11. 拓扑契约

- `ExecuteOptions.topology`：`'auto'`（默认）为**在 BREP 链上的终端**自动构建 BREP 真拓扑；`'brep'` 为所有在链上的输出构建（含非终端）；`'off'` 不自动构建。
- **BREP 真拓扑**由引擎在收尾时构建，复用身份槽的三角化缓存，保证拓扑 mesh = 显示 mesh，随 `ExecutionResult.topology` 携带。
- **假拓扑**（primitive 参数拼凑 / STL·3MF 特征检测）：宿主在加载／创建时刻构建，经 `runtime.setTopology` 注入，引擎透传；**假拓扑不重新生成**。
- 宿主重建 SelectorRuntime 用 `buildSelectorRuntimeMaps`（从 `topology` 的 `SelectorRuntimeData` 构建）。

### 11.1 TopoRef 命名层（跨历史身份）

- **两层职责**：快照内地址层（`FaceId`/`EdgeId` 序号、`SelectorManifest`/`SelectorRuntime`）服务拾取/渲染，保持不变；跨历史层（`TopoRef` + `RoleTable`）在重放后命名「同一个面/边/点」。
- **`TopoRef` 是纯数据、JSON 安全**：写进 `.fai.js` op 参数（face / edge / vertex / derived-face 四类）。解析方向单向——`TopoRef` → 解析器 → 当前序号或活 BREP 句柄；绝不反向把序号当稳定身份存进脚本。
- **`ExecutionResult.naming: Map<PartName, {source, faceNaming, edgeNaming}>`** 与 `topology` 并列携带命名行（序号 1 起 ↔ 下标）；宿主把拾取到的 Reference 序号反查到命名行，经 `captureTopoRef(row)` 造 `TopoRef`。
- **`RoleTable` 只是执行内状态**（Shape 身份槽 + runtime 持久 `roleTableCache`，与 `faceEvolutionCache` 同生命周期）；绝不序列化。hash 是会话内活句柄；跨会话整体重建，`TopoRef` 的稳定性来自 role/hint 数据。
- **解析显式三态**：成功 `exact` / `geometric-fallback`；失败抛 `TopoRefError`（`E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND`）——绝不静默拿序号硬取。
- **来源能力分级**：BREP part 带沿演化传播的语义+位置 role；primitive 假拓扑用与 BREP 同一套命名器按固定面序给语义 role；mesh（STL/3MF）part 只给 hint（`role=''`），恒走几何解析。
- **链切换降级**：part 在链中途从 BREP 降级 mesh 时，已累积的 `{origin, role}` 与 hint 作为纯数据保留，解析回落到面 hint 快照（几何兜底）——引用层面的降级，不是引擎路径运行时回退。

---

## 12. 装配 / 分组契约

- `group` / `assembly` 的产物是 **compound Shape**（属于 shape、进 terminals、在 UI 显示）；自身无独立 mesh，几何由成员承载。
- `ExecutionResult.compounds: Map<PartName, PartName[]>` 由引擎收尾时从 compound 的 children 反查 ctx 变量名生成；宿主据此建场景树层级，不对成员做二次活跃性判定。
- **求解 ≠ 传播**（职责分离）：约束求解在**库**（`solveTransforms` → `setPendingAssemblyTransforms` 登记结果）；变换的**应用与下游失效在引擎**（`takePendingAssemblyTransforms` → 成员 mesh 与 BREP solid 同步变换 → `computeDownstream` 重算下游 → 变量名进 `ExecutionResult.changed`）。
- **成员方法链**：`assem1.add_constraint({ … })` / `assem1.do_assemble()` 是 void op（`outputs: []`），不消费 receiver 变量。
- **group 语义**：原子组、零约束；成员不准单独被修改（修改 group 即整体修改其全部成员）。

---

## 13. 不变式与版本化

### 13.1 身份契约（增量执行前提）

- 既有语句的 id（StmtId）**不得重命名、不得重排**；只能就地改 `args` 值（参数变更）或改 `callee`（结构变更）。
- AI 提交 = **全量覆盖式文本**，引擎按 id 对齐做 diff（UNCHANGED / PARAM / STRUCT / ADD / DELETE），从首个变更点起重放。
- 参数声明本身是语句，"改参数 → 参数语句 key 变化 → 级联下游 stale"。

### 13.2 增量保真

`computeContentKey`（positions/indices → 内容指纹）是几何等价的度量手段；语句身份键（callee + positional 槽 + 去掉 keep 的 args + 各依赖的内容指纹）决定增量重算范围，`plan` 据此判定。见 §7.5。

### 13.3 「结果一致」的边界（防回潮）

契约只保证：**代码 → 模型是一个函数**，且保存/加载往返稳定：3d_editor 导出代码保存为 `.fai.js` 文件、再导入该文件，得到的模型必须一致——这是文本级往返（文本是唯一事实源）。**不保证也不要求**：代码路径与鼠标路径的内部实现／属性分配算法一致、实例 id 值相同、undo 栈结构相同。

PS：从 IR 重打文本只用于调试，不属于任何契约。

### 13.4 生成文件红线

- `docs/ops-api-inventory.md` 由 `scripts/gen-ops-api-inventory.ts` 从 stdlib JSDoc 生成，**禁止手改**（CI `--check` 守卫）。
- `packages/core/src/mesh/api.d.ts` 由 `packages/core/scripts/gen-api-dts.ts` 从 stdlib 函数目录生成，**禁止手改**（守卫测试 `packages/core/src/api-dts-sync.test.ts`）。

### 13.5 兼容性

- 顶层禁止控制流（语言约束），保证终端判定等静态规则不被 AI 代码破坏；**控制流允许出现在函数体内**（v1，§5）。
- 本机函数调用（裸标识符 callee）与运行时表达式（参数里的 `ExprIR`）是新的顶层能力；不含函数的既有脚本解析不变（零回归），参数/字面量表达式依旧按原样折叠。
- 本机函数调用与其它语句一样是 DAG 节点：`positional` / `args` / `outputs` 参与 `consumes()` 与终端判定，只有函数体不透明。
- 函数体是嵌入编译产物的用户源码——对「用户文本不进 VM」（R-3）的已记录例外，边界是 acorn 闸门 + 白名单（见 `docs/syntax-design.md`），与 faqts 通道同构（§10.5）。
- 旧版带版本后缀的命名不再产生、也不再解析（版本号语义与 `grp_` 前缀均已取消；旧名兼容解析已删除，决策 2，见 `lang/allocate-id.ts`）。
- `export default async (cad) => {}` 容器与扁平格式均可解析；扁平代码自动封装为合法容器。

---

## 14. HostArg 契约（宿主侧位置实参的 IR 屏蔽）

### 14.1 HostArg 类型

宿主（3d_editor 等）通过 `HostArg` 与位置实参交互，不接触 IR 类型（`ParamRefIR`/`VarRefIR`/`CallRefIR`/`ExprIR`）。

```ts ignore-check
// packages/core/src/lang/host-arg.ts
interface HostVarRef   { kind: 'var-ref';   name: string }
interface HostParamRef { kind: 'param-ref'; name: string }
interface HostCallRef  { kind: 'call-ref';  callee: string; args: HostArg[]; namespace?: string }
interface HostExprRef  { kind: 'expr-ref';  text: string; refs: string[]; params: string[] }
type HostRef = HostVarRef | HostParamRef | HostCallRef | HostExprRef
type HostArg = JsonValue | HostRef
```

`HostRef` 在结构上是 `JsonValue` 的子类型——判别依赖**运行时守卫**（`isHostRef` 等），而非类型系统。这是有意为之。

### 14.2 保留字规则

字面量参数对象不得使用 `HOST_REF_KINDS` 中的 `kind` 值（`'var-ref'`、`'param-ref'`、`'call-ref'`、`'expr-ref'`）。一个普通对象的 `kind` 字段若匹配这些值之一且结构匹配对应变体，则在 Host→IR 方向上被确定性地判定为引用形态。

IR→Host 方向只识别 `$` 前缀的标记键（`$ref`、`$param`、`$call`、`$expr`），不识别 `kind`——因此从 `.fai.js` 源码解析产出的字面量对象不会被误分类。

### 14.3 API 变更（0.9.0，破坏性）

- `codeToArgs` 返回 `{ positional: HostArg[]; args: Record<string, HostArg> }`（经 `argIRToHost` 剥离 IR）
- `formatCodeLine` 输入的 `positional` 和 `args` 使用 `HostArg`（入口处经 `hostArgToIR` 转换）
- `StatementSummary`：`positional` 现为 `HostArg[]`；**新增** `args: Record<string, HostArg>`；**移除** `inputs`（用 `isHostVarRef` 过滤 `positional` 代替）和 `positionalKinds`（用运行时守卫代替）
- 导出辅助函数：`isHostVarRef`、`isHostParamRef`、`isHostCallRef`、`isHostExprRef`、`isHostRef`、`hostArgToDisplay`、`hostArgToLiteral`、`HOST_REF_KINDS`
- **不导出**：`argIRToHost`、`hostArgToIR`（IR 红线）
