# 实施计划：路线 A — 取消 parser，faijs = 正常 JS（后缀 `.fai.js`）

日期：2026-09-01
状态：方案（此方案不可行）
前置分析：
- `docs/analysis/2026-09-01-two-routes-control-flow-and-lib-import.md`（两条路线对比，结论：推荐路线 A）
- `docs/analysis/2026-09-01-route-a-library-author-contract.md`（路线 A 下的第三方库作者契约）

本计划不重复两份分析文档的论证，只在 §2 记录**本次实地核实的修正与新增结论**，其余章节全部是"怎么做"。



---

## 1. 用户原话（需求基线，不准删改）

> 我想让faijs成为正常的js语言，删除之前的所有限制性规定，比如不能有控制流语句之类的，能否把parse过程取消，让js vm直接执行。有两个功能，最好能在运行时，通过库的方式实现：1. 判断哪些shape最终输出到UI上。2. 能够增量执行，（最好出错还知道行号，可选）。请判断这是否可行？

> 所谓增量执行，其实是append语义，不是update语义。就是UI上多了几个操作，对应多了几行代码，要能够在之前的结果上增量执行这几行代码。至于参数变更后的update，无法增量update也无所谓，可以全量执行。

> 其实我除了想让faijs支持控制流语法，还希望faijs可以加载别的faijs，用现有的parser能否实现这一点？似乎现在只能在faijs里import标准js/ts代码库？

> 之前你对cad的这个前缀的理解完全错误。cad要能替换成任何的名字。他只是一个随意的名字，用来引用stdlib库。第三方库可以用别的名字。

> **（本轮新增）请根据这两份分析文档写一份详细的开发计划。我要让faijs成为正常的js语言，后缀名采用.fai.js，取消parser，直接js vm执行。**

> **（本轮新增·库分类）新执行管线设计，如何处理fai.js代码里import另外一个fai.js代码？此外，你要区分给fai.js写op的库，以及用fai.js建模的库，这是两种库。第一种库后缀名是js或者ts，第二种库的后缀名用什么？我说的fai.js代码里import另外一个fai.js代码，其实就是引用另外一个建模库。我之前提到的场景，比如一个机械零件库，它应该是建模库。它需要的op，应该是op库提供。**

需求编号沿用分析文档：

| # | 需求 | 用户给定的边界 |
|---|---|---|
| R0 | 运行时判定哪些 shape 输出到 UI | 最好以库的方式提供 |
| R1 | 控制流语法，faijs 成为"正常的 JS" | 删除所有限制性规定 |
| R2 | 增量执行 | **append 语义，不是 update**；update 可全量；行号可选 |
| R3 | faijs 加载别的 faijs | 现状似乎只能 import 标准 js/ts 库 |
| R4 | `cad` 前缀可替换成任意名字 | 「他只是一个随意的名字，用来引用stdlib库」 |
| **R5** | **后缀名采用 `.fai.js`** | 已完成现有代码调整 |

---

## 2. 本次实地核实的结论（含对两份分析文档的修正）

以下全部为实测结果（文件路径 + 行号），非推断。其中 §2.1 / §2.2 推翻分析文档的两条结论，§2.5 是**两份文档都遗漏的最大工作量**。

### 2.1 修正一：`origin` 不是语句 id，路线 A 不产生拓扑迁移风险 ✅

分析文档 §7 对比表写：「拓扑引用 `origin`：`o1`（语句 id）→ 改为调用序号」。**实测证伪**：

- `packages/core/src/topology/naming/types.ts:152` `FaceNaming` 的 origin 字段类型是 **`PartName`**。
- `packages/core/src/topology/naming/build-naming.ts:65` 返回 `{ origin: PartName; role: string }`，`:125/129/132` 的 `origin: partName` 直接取 part 变量名。
- `packages/core/src/brep/face-evolution.ts:242` 注释明写：「@param outPart - the boolean statement's LHS variable name (new origin for seam faces)」。

⇒ **origin 一直是变量名（PartName），从来不是 `sN` 语句 id**。路线 A 下 PartName 的语义不变（仍是 ctx 变量名，见 §2.2），因此**分析文档列出的这条迁移风险不存在**，P0–P8 无需为它排期。

### 2.2 修正二：`outputs` 与 `PartName` 已经就是 ctx 变量名 ✅

- `packages/core/src/cad-runtime/runtime.ts:765`：`if (isShapeLike(v)) outputCache.set(name, v as Shape)` —— `name` 来自 `allShapeVarNames()`。
- `packages/core/src/cad-runtime/runtime.ts:819-828` `collectResult`：`for (const name of this.allShapeVarNames()) { outputs.set(name, ...) }`。

⇒ `ExecutionResult.outputs` 的 key **已经是 ctx 变量名**。路线 A 下 `allShapeVarNames()` 从"遍历 ScriptIR 语句 outputs"退化为"遍历 ctx 键过滤 `isShapeLike`"，**宿主可见语义零变化**。这消除了"partN 命名体系 → 变量名即 part 名"这一项的迁移工作量（分析文档 §7 把它列为成本，实测成本 ≈ 0）。

### 2.3 新增结论：`.fai.js` 顺带解决了分析文档的 D4（库 vs 脚本形态）

分析文档 §6 的 D4 悬而未决（"同一扩展名 + 文件头声明？还是区分 `.fai.js` / `.failib`？"）。**R5 给出的答案比两个选项都干净**：

| 形态 | 后缀 | 内容 | 副作用 | 导出物 |
|---|---|---|---|---|
| **脚本** | **`.fai.js`** | 顶层语句直接建模 | 有（产生 Shape、写 ctx） | 终端 Shape 列表 |
| **库** | **`.js` / `.mjs`**（普通 ESM） | 只定义函数 | 无 | 函数集合 |

理由：`.fai.js` 以 `.js` 结尾 ⇒ **不需要第二个扩展名**——"是不是 faijs 脚本"由 `.fai` 段标识，"是不是库"由没有 `.fai` 标识。库作者不需要学新扩展名，npm 生态零适配（`mech-lib` 的 `package.json` 不动）。


### 2.4 ⚠️ 本次最重要的发现：`lang/` 有 4 个宿主在用的工具函数，内部调用 parser

两份分析文档都把 `lang/` 当作"可整目录删除"。**实测不成立**。`packages/core/src/browser.ts:43-52` 与 `index.ts:48-57` 把 4 个 `lang/` 工具导出给宿主，3d_editor 正在大量使用：

| 导出 | 源 | 3d_editor 引用次数 | 内部是否调 `parseScript` |
|---|---|---|---|
| `codeToArgs` | `lang/code-to-args.ts:89` | **16** | ✅ `:18` import + `:95` 调用 |
| `analyzeCode` | `lang/statement-summary.ts:58` | **8** | ✅ `:14` import + `:59` 调用 |
| `formatCodeLine` | `lang/codegen.ts:246` | **6** | ❌ 但 `:247` 构造 `StatementIR` 只为复用 `fmtStatement` |
| `derivePartName` | `lang/allocate-id.ts` | 1（`features/types.ts:23` import、`:167` 调用） | ❌ 纯正则扫描（同类 `getMaxModelNum` 吃 `StatementIR[]`） |

合计 **31 处调用**会因"删除 parser"直接中断。这是本次改造**最大的隐藏工作量**，两份分析文档均未提及。

**处理原则：去 parser 化，不是删除。** 这四个函数本质是"读代码文本 → 提取语法事实"，正是新 `vm/scan.ts`（acorn 只读扫描）的能力范围，逐个改造即可：

| 函数 | 改造难度 | 改法 |
|---|---|---|
| `formatCodeLine` | **极低** | `FormatCodeLineInput`（`codegen.ts:212-231`）是 IR-free 纯数据，直接拼字符串打印即可，去掉中间那次 `StatementIR` 构造 |
| `codeToArgs` | 低 | 输入是单行文本，acorn 解析该行取末位实参对象即可（现状绕了一圈 IR） |
| `derivePartName` | **零改动** | 纯正则 `/\bpart(\d+)\b/g`（`allocate-id.ts:29`），无 parser 依赖 |
| `analyzeCode` | **中**（见 D14） | 返回的 `StatementSummary.id` 是 `StmtId`（`sN`），路线 A 下 `sN` 不存在，需重新定义 |

⇒ **P4 必须拆成 P4a（工具函数去 parser 化）与 P4b（删除 parser 与 IR）**，顺序不可颠倒。

### 2.5 现状关键事实（实施时的坐标）

| 事实 | 位置 | 实施含义 |
|---|---|---|
| parser 强制第一参数名 `=== 'cad'` | `packages/core/src/lang/parser.ts:1086` | P4 删除后 R4 自动满足 |
| parser 头注释声明"绝不 eval / new Function / import()" | `packages/core/src/lang/parser.ts:22-23` | **红线需要改写**（见 §3.4） |
| import 只登记不解析（命名空间注入） | `parser.ts:791-820` → `compile.ts:84/168` → `runtime.ts:307-315` | P5 换成真实动态 import |
| `functions` 半成品（有 parse/codegen，无 compile/执行） | `lang/types.ts:199,221`；`grep -n "functions" compile.ts module-executor.ts runtime.ts` 返回空 | P4 一并删除，不留半成品 |
| 现状已在动态执行代码 | `cad-runtime/module-executor.ts:59-72`（Node `data:` URL base64 / 浏览器 Blob URL 动态 `import()`） | 安全论证的基线（§3.4） |
| `data:`/Blob URL 模块无法解析裸说明符 | `compile.ts:6-9` 注释 | R3 的技术核心，靠 `module-resolver` 预重写 |
| `module-resolver` 零消费 | 引用点仅 `src/module-resolver/index.ts` + `scripts/api-surface-snapshot.mjs` | P5 给它第一个真实消费方 |
| `keep()` 归属依赖 `currentStmt` + `shapeToName` | `runtime-state.ts:360-371` | P2 换底为 ctx 对象身份反查 |
| `defineOp` wrapper 内已做输入收集与产物包装 | `define-op.ts:180-197`（`args.filter(isGeometryInput)`、`dispatchPath`、`wrapMeshOne`/`wrapBrepOne`） | R0 的调用记录钩子就加在这里（D7-a） |
| 终端判定静态启发式 C0/C1/C3/C5 | `cad-runtime/terminal-dag.ts:1-24` 头注释 | P2 用运行时对象图替换，C5 兜底删除 |
| `CadRuntime` 公开方法 | `runtime.ts:418 execute / 475 update / 529 append / 630 plan / 1247 check / 1373 dispose` 等 | P3 保持签名不变 |
| `ExecutionResult` 形状 | `runtime.ts:115-145` | **宿主契约，P0–P8 全程冻结** |

---

## 3. 目标形态

### 3.1 `.fai.js` 是什么

```js
// bracket.fai.js —— 一个 faijs 脚本。它就是 JS。
import * as mech from 'mech-lib'          // 普通 ESM import，第三方库

const n = 4                                // const / 模板字符串 / class 全部可用

let base = await cad.box({ size: 20 })

for (let i = 0; i < n; i++) {              // 循环：现状 parser 直接拒绝
  const hole = await cad.cylinder({ radius: 3, height: 20, center: [i * 10 - 15, 0, 0] })
  base = await cad.subtract(base, hole)
}

if (n > 3) {                               // 条件：现状 parser 直接拒绝
  const rim = await cad.cylinder({ radius: 9, height: 4, center: [0, 0, 0] })
  base = await cad.union(base, rim)
}

let gear = await mech.makeGear({ teeth: 12 })   // 第三方库，binding 名随意
```

对照现状 fixture（`packages/tests/faijs/boolean/boolean-ops.fai.js`）：

```js
let part0 = cad.box({ size:20 })
let part1 = cad.box({ size:20, center:[10,0,0] })
let part2 = cad.union(part0, part1)
```

⇒ **现有 fixture 的文本在路线 A 下原样可用**。实测 39 个 `.fai.js` 中 **38 个本来就是"松散顶层语句"**（无容器），只有 `packages/tests/faijs/parity/parity-screw.fai.js` 用了 `export default async (cad) => {...}` 容器 —— 它是唯一需要去掉容器的文件。

性质（写进 `docs/syntax-design.md`）：

1. **合法 JS 模块语法**：`for` / `if` / `while` / `try` / `class` / 闭包 / 模板字符串 / 顶层 `await` 全部可用。
2. **`cad` 不是关键字**：它是宿主注册的 binding 名，宿主想叫什么就叫什么（R4）。脚本里写 `import * as geo from '...'` 也行。
3. **执行路径是引擎 VM**，不是 `node xxx.fai.js`。`.js` 结尾带来的工具链友好性（IDE 补全、语法高亮、Prettier、ESLint 可选开启）是**附加收益，不是执行方式**。
4. **不支持**：顶层 `import` 之外的模块语法由引擎预解析后剥离执行（见 §4.2 S2/S3）；`new Function` 体内的动态 `import()` 见 D11。

### 3.2 不变量（全程不得破坏）

| # | 不变量 | 为什么 |
|---|---|---|
| **I-1** | `ExecutionResult` 形状冻结（`outputs` / `terminals` / `brepChain` / `infos` / `topology` / `brepSolids`） | 3d_editor 279 处引用依赖它 |
| **I-2** | PartName = ctx 变量名 | 已成立（§2.2），不能漂移 |
| **I-3** | BREP/mesh 路径**执行前静态判定，禁止运行时回退** | AGENTS.md 红线；`dispatchPath` 不受本次改动影响 |
| **I-4** | K1 签名 = 源码里写的样子；K2 几何运算在库；K5 引擎零函数知识 | 库契约，`defineOp` 路径不变 |
| **I-5** | 不静默降级：任何"跳过校验 / 猜一个默认值"必须显式报错 | 用户红线 |
| **I-6** | 测试 stderr 零容忍 | CI 强制 |
| **I-7** | OCCT handle 必须显式释放 | 现状 `reconcileCtx` + `releaseSolid`，见风险 R-4 |

### 3.3 红线改写（必须显式记录，不能悄悄跨过）

`parser.ts:22-23` 现行红线是「**绝不 eval / new Function / import() 真执行**」。

本方案要跨过它。处理原则（写进 AGENTS.md，不静默）：

- 原红线的**真实意图**是「用户原文不进 VM」。该意图在路线 A 下被用户明确要求放弃（R1/R5）。
- 现状**已经在执行动态代码**（`module-executor.ts:59-72`），只是执行的不是用户原文。所以跨过这条红线**不引入新的执行机制**，只改变被执行代码的来源。
- 改写后的红线表述：**「引擎执行用户脚本必须经由单点封装（`vm/vm-exec.ts`），禁止在其它任何位置 `eval` / `new Function` / 动态 `import()`」**。约束从"禁止"变成"单点收口"，可测试（一条 grep 守卫即可）。

---

## 4. 新执行管线设计

### 4.1 总览（S1 → S7）

```
用户 .fai.js 文本
   │
   ├─ S1 只读扫描（acorn，不拒绝任何语法）
   │     ├─ 顶层 import 声明（specifier / binding / span）
   │     ├─ 顶层词法声明名（let / const / class / function）
   │     └─ 自由变量（append 前缀校验用）
   │
   ├─ S2 import 解析（module-resolver 首个真实消费方）
   │     ├─ resolveImports() 裸说明符 → 绝对 URL
   │     └─ await import(url) → namespace 对象（+ contractVersion 校验，D6-a）
   │
   ├─ S3 源码改写（只做两件事，行号零漂移）
   │     ├─ import 声明整段 → 等量换行
   │     └─ 末尾追加持久化行（仅顶层词法声明名）
   │
   ├─ S4 构造并执行（new Function + with(Proxy)）
   │     └─ 行号换算：stack 行号 − 固定偏移
   │
   ├─ S5 ctx 收敛（reconcile + OCCT handle 释放）
   │
   ├─ S6 终端判定（运行时对象图，替换 terminal-dag 静态判定）
   │
   └─ S7 ExecutionResult 组装（形状同 I-1）
```

### 4.2 各阶段契约

#### S1 `vm/scan.ts` — 只读扫描，不拒绝任何节点

```ts
export interface ScriptScan {
  imports: ImportScan[]      // specifier / kind / localName / span{start,end,lineCount}
  topLevelNames: string[]    // 顶层 let/const/class/function 名（持久化用）
  freeVars: string[]         // 引用了但本文件未声明的名字（append 前缀校验用）
}
export function scanScript(code: string): ScriptScan   // acorn 语法错误 → 抛 SyntaxError（带 loc）
```

硬约束：**只收集，不拒绝**。任何 AST 节点类型都不触发"不支持"错误。acorn 解析失败 → 抛标准 `SyntaxError`（`err.loc.line/column`），比现状的 `E_*` 码更标准。

`topLevelNames` 只收**顶层块**的 `let`/`const`/`class`/`function`。嵌套块内声明不收 —— 这同时保证了 S3 追加的持久化行**不会 ReferenceError**（顶层顺序执行完毕 ⇒ 一定已初始化；中途抛错则根本执行不到追加行）。

#### S2 import 解析

```ts
const resolved = resolveImports(code, { imports, scopes, slices, reservedPrefixes })
// resolved.code：裸说明符已重写为绝对 URL
for (const imp of scan.imports) {
  const ns = await import(imp.resolvedSpecifier)   // 绝对 URL，浏览器/Node 都能解析
  if (imp.kind === 'namespace') mods[imp.localName] = ns
  else mods[imp.localName] = ns.default ?? ns        // default / named 形态见 D10
}
```

- **同一 URL 只 import 一次**（模块级 `Map<string, Promise<Namespace>>` 缓存），ESM 本身也保证单例，但缓存能省掉一次 `assertContractVersion` 往返。
- `contractVersion` 校验在加载后立即执行（D6-a），不匹配 → 显式抛错，不静默（I-5）。

#### S3 `vm/transform.ts` — 改写，行号零漂移

两件事，**仅此两件**：

1. **import 剥离**：把每条 import 声明的 span 区间替换为**等数量的 `\n`**。多行 import 按实际换行数补齐。⇒ 后续所有行的行号与原文**逐行一致**。
2. **追加持久化行**（仅当 `topLevelNames` 非空）：

```
;__faijs__persist({ part0, part1, gear })
```

- 该行追加在用户源码**之后**，所以用户行号不受影响。
- `__faijs__persist` 由 S4 的 scope Proxy 提供（见 §4.3 保留前缀），不占用用户命名空间。
- 持久化目标：写回 `let`/`const` 声明的变量。无声明赋值（`x = ...`）在 S4 的 `set` 陷阱里已经直接写回 ctx，**不重复处理**。

#### S4 `vm/scope.ts` + `vm/vm-exec.ts` — 执行

scope 是四层回退的 Proxy，顺序**精确定义**（决策 D9）：

```ts
function createScriptScope(ctx, libs, mods, persist) {
  return new Proxy(ctx, {
    has: (_t, k) => !(typeof k === 'string' && k.startsWith('__faijs__')),  // 保留前缀不进 with
    get: (t, k) => {
      if (k === '__faijs__persist') return persist            // ① 引擎内部槽，最高优先级
      if (Reflect.has(t, k)) return t[k]                       // ② ctx（持久用户变量）
      if (Reflect.has(mods, k)) return mods[k]                 // ③ 本文件 import 的模块
      if (Reflect.has(libs, k)) return libs[k]                 // ④ 宿主注册的库（cad 等）
      if (Reflect.has(globalThis, k)) return globalThis[k]     // ⑤ 全局（沙箱对象，D1）
      return undefined
    },
    set: (t, k, v) => { t[k] = v; return true },               // 无声明赋值写回 ctx
  })
}
```

四个**必须**点（全部为上一轮 node 探针实测，不是推断）：

| # | 点 | 不做的后果 |
|---|---|---|
| ① | `has` 对 `__faijs__` 前缀返回 `false` | `with` 的 `has:()=>true` 会把引擎注入的 `__faijs__persist` 遮蔽成 `undefined`（实测 `new Error is not a constructor` 同款坑） |
| ② | `get` 必须回退到全局 | 不回退则 `Math` / `JSON` / `Error` 全部被遮蔽 |
| ③ | 保留前缀优先级最高 | 见 ① |
| ④ | `set` 一律写回 ctx | 无声明赋值不持久 ⇒ append 读不到上一轮结果 |

执行与行号：

```ts
const fn = new Function('__scope__', `with(__scope__){ return (async()=>{\n${transformed}\n})() }`)
await fn(scope)
```

- 用户源码包在 `async` 箭头里 ⇒ **顶层 `await` 原生可用**。
- 行号：`new Function` 引入固定偏移，**必须由测试标定并断言**（上一轮实测为 3，本计划不写死推导值）。`vm/error-loc.ts` 提供 `toUserLine(stackLine)`，并在 `vm-exec.test.ts` 中用一条"第 N 行故意抛错"的用例锁定偏移。

#### S5 ctx 收敛

现状 `module-executor.ts` 的 `reconcileCtx(activeIds, writeSets, referenced)` 依赖 ScriptIR 判定活跃变量。**路线 A 下活跃集 = ctx 自身**：

- `append`：只增不删 ⇒ 无需回收。
- `execute` / `update`：全量重跑前，`dispose()` 已释放全部 handle。
- ⚠️ 唯一需要新逻辑的是 **脚本内变量被删除后重新执行** 的场景 —— 见风险 R-4，必须在 P3 显式处理，否则 OCCT handle 泄漏。

#### S6 终端判定（R0）

记录源：**`define-op.ts` wrapper 内部**（D7-a，分析文档 §5.1 的推荐方案）。在 `define-op.ts:180-197` 的 `wrapped` 内、`inputs` 过滤之后、产物包装之后，追加一次记录：

```
record({ fn: wrapped, inputs, output, path })
```

判定规则：

- `consumed: WeakSet<Shape>` —— 任何被作为几何输入消费的 Shape 加入集合。
- `terminals = ctx 中 isShapeLike 的值 ∉ consumed` ∪ `keep()/keepHidden() 显式声明的 Shape`。
- `keep()` 是**覆盖**语义（沿用 C0/C1）：被 keep 的 Shape 即使被消费也进终端。
- `hidden` 由 `keepHidden()` 标记（沿用 D1/D2「最后一次保留声明胜出」）。
- 输出非 Shape 的调用（测量类）**不消费输入** —— 这条由"记录的是实际产出，产出不是 Shape 就不写 consumed"自然成立，**不需要 C3 那种语法启发式**。

⇒ `terminal-dag.ts` 的 C5「默认消费」启发式**整段删除**。这是 R0 相对现状的实质改进：判定依据从"语法推断"变成"运行时实际发生"。

#### S7 结果组装

沿用 `collectResult` 的形状（`runtime.ts:819+`），只把 `allShapeVarNames()` 换成 ctx 扫描。

### 4.3 保留前缀约定（新增契约）

**`__faijs__` 是引擎保留前缀**，用户脚本禁止使用以它开头的标识符。违反 → 引擎在 S1 扫描时显式报错（不静默，I-5）。这条同时写进 `docs/syntax-design.md` 与 `docs/api-contract.md`。

---

## 5. 分阶段实施计划

> 每层进入下一层的前置条件：本层所有测试 + lint + typecheck 通过。
> 各阶段的测试命令遵循 AGENTS.md「开发完成后的测试步骤」：`npm run lint` → `npx tsc --noEmit` → 单包 `npm run test -w <pkg>` → 相关 `--workspaces`。**严禁通过跑 CI 找 bug。**

### P0 — 决策冻结 + 探针验证（不接主管线）

**目标**：把 §6 的决策点全部定下来，并用可执行的探针证明关键机制，避免"方案看起来对、实现时撞墙"。

**产出**：
- 本计划 §6 决策点全部填写结论（写入本文件 + Agent Note）。
- 新增 `packages/core/src/vm/__probe__/`（独立目录，不被主流程引用，P4 前删除）：
  - `probe.test.ts` —— 逐条断言 §4.2 S4 的四个必须点、顶层 await、控制流、行号偏移实测值、import 剥离后行号不漂移、`globalThis` 零污染。

**验收**：探针测试全绿；决策表无"待定"项。

---

### P1 — 新 VM 内核（并行存在，不接主路径）

**新增** `packages/core/src/vm/`：

| 文件 | 职责 |
|---|---|
| `scan.ts` | acorn 只读扫描 → `ScriptScan`（S1） |
| `transform.ts` | import 剥离（保行号）+ 持久化行追加（S3） |
| `scope.ts` | 四层回退 scope Proxy（S4） |
| `vm-exec.ts` | `runScript()` 单点封装（S4） |
| `error-loc.ts` | 行号换算（偏移量由测试锁定） |
| `terminals.ts` | consumed WeakSet + 终端计算（S6，P2 接线） |

**不动** `CadRuntime`、`parser`、`compile`。

**测试**（`vm/*.test.ts`，与源码同目录）：
- 控制流：for / if / while / try / class / 闭包 / 模板字符串 / 顶层 await
- 持久化：`let` / `const` / 无声明赋值 三种写法跨次执行可见
- 行号：故意在第 N 行抛错，断言换算后 === N
- 保留前缀：`__faijs__` 开头标识符被拦截

---

### P2 — 调用记录 + 终端判定换底 + keep 换底

**改动**：
1. `define-op.ts:180-197` wrapper 内加 `record(...)`（D7-a）。
2. 新增 `vm/terminals.ts`，实现 §4.2 S6 规则。
3. `runtime-state.ts:360-371` `registerKeep` 换底：从 `currentStmt` + `nameOf(s)` 改为 **ctx 对象身份反查**：
   ```ts
   const name = Object.entries(ctx).find(([, v]) => v === s)?.[0]
   ```
   `keep(...shapes)` 的**签名一字不改**（库作者零感知，契约文档 §5.2）。
4. 预留 `setCtxLookup(fn)` 注入点，由 `CadRuntime` 在 P3 接线。

**测试**：`cad-runtime/keep.test.ts`（18KB，现状覆盖充分）必须**全量通过且不改断言** —— 这是换底等价性的核心证据。

---

### P3 — CadRuntime 切换主执行路径

**改动**（`cad-runtime/runtime.ts`）：

| 方法 | 改法 |
|---|---|
| `execute(code)` `:418` | 走 S1→S7；`ExecutionResult` 形状不变（I-1） |
| `append(code)` `:529` | 只对新增文本跑 S1→S7；ctx 持久；**执行前**用 `freeVars` 与 ctx 键比对，缺引用抛 `AppendPrefixError`（宿主降级为全量 `execute`） |
| `update(old, new)` `:475` | 退化为全量重跑（`dispose()` + `execute(new)`）—— 用户明确说可接受 |
| `plan(script)` `:630` | 删除 —— **已实测**：仅 `runtime.test.ts:324/342/937/948` 4 处消费，无生产调用方 |
| `check(code)` `:1247` | 退化为：acorn 语法检查 + import 可解析性检查 + 库 `contractVersion` 校验（D12） |
| `executeIR/appendIR/updateIR` | 删除（IR 入口） |

**风险 R-4 必须在此阶段显式处理**：新建/切换 ctx 时的 OCCT handle 释放路径。

**验收**：`packages/tests` 全量集成测试通过（39 个 fixture 等价性）。

---

### P4a — 宿主工具函数去 parser 化（**先做，否则 P4b 会打断 3d_editor**）

**目标**：让 §2.5 的 4 个导出在**没有 parser** 的前提下行为不变。

| # | 任务 | 验收 |
|---|---|---|
| 4a-1 | `formatCodeLine` 去掉 `StatementIR` 中转，直接按 `FormatCodeLineInput` 打印 | 现有 codegen 测试中的 `formatCodeLine` 用例**断言不改**且通过 |
| 4a-2 | `codeToArgs` 改为 acorn 直解单行 | 16 处宿主演绎用例（用现有 fixture 行文本构造）结果逐字段一致 |
| 4a-3 | `analyzeCode` 改为 acorn 扫描，`id` 按 D14 结论换底 | `StatementSummary` 除 `id` 外字段语义不变 |
| 4a-4 | `derivePartName` 保留；`getMaxModelNum` 按 D13 处理 | 类型编译通过 |

**纪律**：这 4 个函数是宿主契约面（`packages/core/src/browser.ts:43-52`、`index.ts:48-57`），改完必须跑 `scripts/api-surface-snapshot.mjs` 确认导出面未变。

---

### P4b — 删除 parser 与 IR（P4a 全绿之后）

**删除清单**：

| 路径 | 行数 | 说明 |
|---|---|---|
| `packages/core/src/lang/parser.ts` | **1469** | 核心删除项 |
| `packages/core/src/lang/codegen.ts` | 330 | `formatCodeLine` / `fmtNum` 已迁出，其余删除 |
| `packages/core/src/lang/compile.ts` | 266 | IR → 模块文本 |
| `packages/core/src/lang/statement-summary.ts` | 80 | `analyzeCode` 已迁出去 parser 版 |
| `packages/core/src/lang/keep.ts` | 237 | IR 层 keep（运行时侧 `runtime-state.ts` 保留） |
| `packages/core/src/lang/symbol-table.ts` + `.generated.ts` | 37 + 39 | 符号表（`check` 用，D12 已降级） |
| `packages/core/src/cad-runtime/terminal-dag.ts` | 182 | 静态终端判定（P2 已换底） |
| `packages/core/src/lang/types.ts` 的 IR 部分 | 263（部分） | `ScriptIR` / `StatementIR` / `FunctionDefIR` / `ImportIR` 等；`ArgIR`/`JsonValue` 等宿主面类型保留 |
| `lang/*.test.ts`（8 个） | ~70 KB | parser/codegen/compile/f1/f2 相关 |
| `module-executor.ts` 的 `importModule` | `:59-72` | 动态 import 编译产物 |
| `cad-runtime/runtime.ts` 的 `plan()` | `:630` | 已在 P3 删除，此处为清单完整性保留 |

**保留**（去 parser 化后继续导出）：
- `lang/code-to-args.ts`（已改造）
- `lang/allocate-id.ts`（按 D13）
- `formatCodeLine` / `fmtNum` / `analyzeCode` —— 迁到 `lang/` 下不依赖 parser 的新文件（或就地在去 parser 后的文件里）
- `lang/identity.ts`（`PartName` / `asPartName`）—— I-2 依赖
- `module-executor.ts` 的 **ctx 管理 + OCCT handle 释放**（`releaseSolid` / `getSolid` / `setSolid` / `setFaceEvolution` / `setRoleTable`），重写为不依赖 `CompiledStatement`
- `module-resolver/`（P5 接线）

**同步**：`scripts/api-surface-snapshot.mjs` 基线更新（导出面变化需显式确认，不是顺手改）。

> 净减估算：上表删除项约 **2,500+ 行**（含 8 个测试文件），扣除 P1 新增 `vm/`（预计 500–700 行）与 P4a 迁出代码（约 200 行），**净减仍 ≥ 1,600 行**。AC-8 按"净减 ≥ 1,600 行"判定，而非分析文档原文的 2,500（原文未计入 P1 新增与 P4a 迁出）。

---

### P5 — module-resolver 接线（R3 + D6-a）

1. S2 接入 `resolveImports`（`module-resolver` 的第一个真实消费方）。
2. 库加载后 `assertContractVersion(ns)`（D6-a）。
3. URL → namespace 的 Promise 缓存。
4. 未登记的裸说明符 → `UnresolvedImportError` **直接抛，不回退**（I-5）。

**测试**：用 `packages/mech-lib`（现状 `@faicad/mech-lib` 已有 vitest alias）做端到端用例 —— 一个 `.fai.js` 里 `import * as mech from 'mech-lib'` 并调用其 op。

---

### P6 — `.fai.js` 后缀与脚本形态落地
已完成

---

### P7 — 文档与门禁

| 文档 | 动作 |
|---|---|
| `docs/syntax-design.md`（+ `.zh.md` + `.i18n.yaml`） | **重写**：从"合法 JS 子集 + 禁止清单"改为"就是 JS + 保留前缀 + 执行模型" |
| `docs/api-contract.md`（+ 双语） | 更新执行模型、`check()` 语义变化、`__faijs__` 保留前缀 |
| `docs/ops-api-inventory.md` | 脚本示例全部改为 `.fai.js` 形态 |
| `AGENTS.md` | 架构分层（L0 从"文本层 parser"改为"扫描层"）、红线改写（§3.3）、命令行表 |
| `.agents/notes/` | 新增 Agent Note：路线 A 决策 + 红线改写理由 |
| `npm run doc-sync` | 12 项门禁全过 |

---

### P8 — 3d_editor 迁移（跨仓库，独立 PR）

**不在本仓库范围内**，但需要提前登记：

- 包名 `@faicad/faijs` **绝不能改**（tarball 消费，引用 279 处）。
- 改 faijs 源码后必须 `npm run pack` 重打 tarball，3d_editor 再 `npm install`。

**迁移面（已按 §2.5 实测收敛，不是"过一遍 279 处"）**：

| # | 项 | 是否要改 | 依据 |
|---|---|---|---|
| 1 | `ExecutionResult` 消费方 | **不改** | I-1 冻结 |
| 2 | `codeToArgs` / `analyzeCode` / `formatCodeLine` / `derivePartName`（31 处调用） | **不改** | P4a 去 parser 化后签名与行为不变（AC-12/13） |
| 3 | `StatementSummary.id` 语义（`statementIndex` / Timeline） | **要改** | D14，id 从 `sN` 变为行号 |
| 4 | `check()` 的 `E_*` 诊断码 | **要评估** | D12，AI 自我修正闭环（R-2） |
| 5 | 代码生成（拼文本） | **可简化，非必须** | 不再需要遵守"顶层只能是 `cad.xxx()` 语句"的约束 |


---

## 6. 决策点（P0 必须全部定稿）

沿用分析文档编号（D1/D2/D6/D7），新增 D9–D14（`.fai.js` 与宿主契约相关）。带「**待用户确认**」标记的必须用户拍板。

### D1 沙箱边界

| 选项 | 说明 |
|---|---|
| D1-a | Worker 内执行（浏览器已有 `browser-host/worker-csg-backend.ts`，Node 用 `worker_threads`） |
| **D1-b（推荐）** | 构造受限 global 对象（白名单 `Math` / `JSON` / `Array` / `Object` / `Error` / `String` / `Number` 等），`get` 第 ⑤ 层回退它而非 `globalThis` |
| D1-c | 不隔离，信任脚本来源 |

**推荐理由**：D1-b 不需要跨线程改造（Worker 会让 `Shape` 与 OCCT handle 的传递变成大问题 —— handle 是 wasm 内存里的指针，无法结构化克隆），却堵住了最直接的攻击面。D1-c 在"AI 生成 + 本地运行"场景下可接受，但 3d_editor 是 Web 应用，不能默认信任。

> **待用户确认**：默认 D1-b 还是 D1-c。

### D2 `let` / `const` 持久化

| 选项 | 说明 |
|---|---|
| D2-a | 约定用户用无声明赋值（`part3 = ...`） |
| **D2-b（推荐）** | acorn 只读扫描顶层声明名 + 末尾追加 `__faijs__persist({...})` |
| D2-c | 要求全部用 `let`，配合 D2-b |

**推荐 D2-b**。实测 43 个 `.fai.js` 里三种写法并存：

| 写法 | 出现次数 | 涉及文件数 |
|---|---|---|
| `let partN = ...` | 105 | 多数 |
| 无声明赋值 `partN = ...` | 23 | **15** |
| `const x = ...` | 4 | 少数 |

⇒ **只有 D2-b 能让全部 43 个文件零改动迁移**：D2-a 要改那 105 处 `let`，D2-c 排斥 `const` 且同样要动无声明赋值。acorn 从"限制器"降级为"作用域分析器"，与"取消限制"不冲突，也不影响行号。

### D6 `contractVersion` 校验执行点

| 选项 | 说明 |
|---|---|
| **D6-a（推荐）** | 宿主 resolve 库 URL 后 `import` + `assertContractVersion`（给 `module-resolver` 第一个真实消费方） |
| D6-b | 不校验，靠 `defineOp` 构造期校验兜底 |

**推荐 D6-a**：`defineOp` 内部读不到所属模块的 `contractVersion`（模块级变量，op 无法反查），D6-b 会让版本不匹配的库以更晚、更难诊断的方式失败 —— 违反 I-5。

### D7 调用记录位置

| 选项 | 说明 |
|---|---|
| **D7-a（推荐）** | 放在 `defineOp` wrapper 内 |
| D7-b | 外层 Proxy 包装命名空间 |

**推荐 D7-a**（分析文档 §5.1 已论证）：路线 A 下用户直接 `import`，引擎拿不到 namespace 对象，**D7-b 在路线 A 下根本无施加时机**。D7-a 还顺带解决了身份稳定性、元数据透传、"先校验后包装"时序三个坑 —— 分析文档 §4.4 讨论的四个 Proxy 实现要点**全部不需要**。

**代价（必须接受并记录）**：不用 `defineOp` 的库函数不被记录 ⇒ 不参与终端判定。这与现状一致（`assertLibConforms` 本来就放过无元数据的函数），且 K5 禁止按名字分类，没有别的合法判据。

### D9 scope 查找顺序（新增，`.fai.js` 特有）

| 选项 | 说明 |
|---|---|
| **D9-a（推荐）** | `ctx` > `mods`（本文件 import）> `libs`（宿主注册）> `global` |
| D9-b | `ctx` > `libs` > `mods` > `global` |

**推荐 D9-a**：用户在文件里**显式写的** import，应当压过宿主**默认注入**的同名 binding。"显式优先于默认"是通用直觉，且让"用户想换掉宿主默认库"成为可能（R4 的自然延伸）。

⚠️ 副作用需记录：若宿主注册了 `cad`，而脚本又 `import * as cad from './my-cad.js'`，则脚本内 `cad` 指向 import 的那个。这是**期望行为**，但要写进文档。

### D10 import 形态支持范围（新增）

现状 parser 只支持 `import * as ns` 与 `import ns`（`parser.ts:813-816` 禁止 named import）。路线 A 下：

| 选项 | 说明 |
|---|---|
| D10-a | 只支持 `import * as ns`（最小面） |
| **D10-b（推荐）** | 支持 `import * as ns` / `import ns`（default）/ `import { a, b }` |

**推荐 D10-b**：路线 A 下这是"顺手支持"（S1 已扫到 specifier 列表，S2 按 kind 取值即可），不支持反而是新的限制，与 R1 精神冲突。

### D11 动态 `import()`（新增）

`new Function` 体内动态 `import()` 合法，但裸说明符无法解析。

| 选项 | 说明 |
|---|---|
| D11-a | 不支持，用户只能用静态 import |
| **D11-b（推荐）** | S1 一并扫描 `ImportExpression`，用 `module-resolver` 重写为绝对 URL |

**推荐 D11-b**，但排到 P5 之后作为增量项（不阻塞 P0–P5）。

### D12 `check()` 的降级形态（新增）

`check()` 现状提供三阶段：parse → 符号检查（callee ∈ 符号表）→ 引用预检（`runtime.ts:1240-1290`）。路线 A 下符号表与 IR 都不存在。

| 选项 | 说明 |
|---|---|
| **D12-a（推荐）** | `check()` = acorn 语法检查 + import 可解析性检查 + 库 `contractVersion` 校验；返回值保留 `{ ok, errors, warnings }` 形状 |
| D12-b | 删除 `check()`，由宿主用 esbuild/acorn 自己查 |

**推荐 D12-a**：3d_editor 与 CLI 都在调用它，删掉会扩大迁移面。形状保留、能力降级，并在文档中明确"不再校验函数名是否存在"。

⚠️ 这会削弱 AI 生成代码的护栏 —— 见风险 R-2，需要用户决策。

### D13 `allocate-id.ts` 怎么处理（新增，**已按实测修正**）

`derivePartName` 给 UI 自动生成的变量分配 `partN`。

| 选项 | 说明 |
|---|---|
| ~~D13-a 删除~~ | ~~命名责任完全交给宿主~~ |
| **D13-b（推荐，实测修正）** | **保留 `derivePartName` 与其导出**；只删 `getMaxModelNum` |

**修正理由（原推荐 D13-a 已被实测推翻）**：3d_editor **正在用**它 —— `3d_editor/src/engine/features/types.ts:23` `import { derivePartName, formatCodeLine } from '@faicad/faijs/browser'`，`:167` 实际调用；且 `3d_editor/src/engine/__tests__/contract-entry.test.ts:65` 把 `'derivePartName'` 写进了**导出面契约断言**。删除会直接打破宿主契约测试。

具体处理：
- **`derivePartName` 保留**：它只依赖 `{ inputCount, outputCount, code }`，内部是纯正则 `PART_TOKEN_RE = /\bpart(\d+)\b/g`（`allocate-id.ts:29`），**零 parser 依赖，一行不用改**。
- **`getMaxModelNum(statements: StatementIR[])` 删除**：签名吃 `StatementIR[]`，路线 A 下无意义；实测无宿主消费方。

### D14 `StatementSummary.id` 换底（新增，P4a 阻塞项）

`analyzeCode` 返回的 `StatementSummary.id` 是 `StmtId`（`sN`，`statement-summary.ts:22-23`）。3d_editor 用它派生 `statementIndex` 并驱动 Timeline（`TimelinePanel.test.tsx:111` 注释明写「analyzeCode 分配语句 id（sN）」）。路线 A 下 `sN` 不存在。

| 选项 | 说明 |
|---|---|
| **D14-a（推荐）** | `id` = **源码行号**（1-based，字符串化） |
| D14-b | `id` = 顶层语句的**顺序索引**（0-based） |
| D14-c | `id` = 产出变量名（PartName）；无赋值的语句退回行号 |

**推荐 D14-a**：行号是路线 A 下唯一"天然稳定且可定位"的标识 —— 本方案已经为错误定位建了行号换算能力（§4.2 S4），Timeline 的「查看代码」也本就展示行文本。D14-b 在插入一行后会整体漂移；D14-c 对无赋值语句无解。

⚠️ **这是宿主可见的契约变更**，3d_editor 侧 `statementIndex` 的 key 语义会变，必须列入 P8 迁移清单。**需用户确认**。

### 6.1 需用户拍板的决策汇总（P0 阻塞项）

| 决策 | 推荐 | 未拍板的后果 |
|---|---|---|
| **D1 沙箱边界** | D1-b（受限 global 白名单） | 无法定 P1 `vm/scope.ts` 的第 ⑤ 层回退目标 |
| **D12 `check()` 降级** | D12-a（保留形状、降级能力） | 影响 R-2：AI 生成代码的自我修正闭环是否可接受削弱 |
| **D14 `StatementSummary.id`** | D14-a（改为行号） | 阻塞 P4a-3；3d_editor Timeline 的改造量取决于此 |

其余（D2 / D6 / D7 / D9 / D10 / D11 / D13）分析文档已论证或实测已定，采推荐值即可，不阻塞开工。

---

## 7. 测试计划（提纲式）

### 7.1 分层

| 层 | 位置 | 覆盖内容 |
|---|---|---|
| 单元 | `packages/core/src/vm/*.test.ts` | 扫描 / 改写 / scope / 行号 / 保留前缀 |
| 单元 | `packages/core/src/define-op.test.ts`（新增） | 调用记录的时序与内容 |
| 集成 | `packages/tests/faijs/**` | 43 个 fixture 改名后等价性（**P3/P6 的核心回归网**） |
| 集成 | 新增 `faijs/control-flow/*.test.ts` | for / if / while / try / 循环内建模 |
| 集成 | 新增 `faijs/import-lib/*.test.ts` | `import * as mech from 'mech-lib'` 端到端 |
| 集成 | 新增 `faijs/incremental/*.test.ts` | append 增量 + 引用缺失降级 |
| 契约 | `cad-runtime/keep.test.ts` | **不改断言，全量通过** = keep 换底等价性证据 |
| 契约 | P4a 四工具的等价性测试 | `formatCodeLine` / `codeToArgs` / `analyzeCode` / `derivePartName` 改造前后逐字段一致（AC-12） |
| 守卫 | `scripts/api-surface-snapshot.mjs` | 导出面变更显式确认（AC-13） |
| 守卫 | 新增 grep 守卫 | `eval` / `new Function` / 动态 `import()` 只允许出现在 `vm/vm-exec.ts` |
| 守卫 | `3d_editor/src/engine/__tests__/contract-entry.test.ts` | 跨仓库导出面契约守卫（P8 回归网，本地不跑） |

### 7.2 关键测点

1. **行号**：脚本第 N 行抛错 → `failedAt` / 错误对象的行号 === N（偏移由测试锁定，不靠推导）。
2. **增量**：`append` 后 ctx 保留上一轮全部 Shape；第二轮引用第一轮变量成功；引用不存在的变量 → `AppendPrefixError`（且是**执行前**抛出，不是执行中 ReferenceError）。
3. **控制流**：循环内生成 10 个 box → `outputs` 有 10 个（或合并结果）；`if` 分支未走到的变量不在 ctx。
4. **终端**：循环内被后续 subtract 消费的中间体不进 `terminals`；`keep()` 声明的即使被消费也进。
5. **零污染**：执行后 `globalThis` 上不出现脚本里的变量名。
6. **BREP 链**：`brepChain` / `brepSolids` / `topology` 与现状一致（parity 测试 `beforeAll` 里 `initOcctWasm()`）。
7. **stderr 零容忍**：CI 强制，任何 `stderr |` 行即失败（I-6）。

### 7.3 执行顺序

`npm run lint` → `npx tsc --noEmit` → `npm run test -w @faicad/faijs-core` → `npm run test -w @faicad/faijs-tests` → 相关的 `--workspaces`。**不跑全量 CI**（AGENTS.md 明令：严禁通过跑 CI 找 bug）。

---

## 8. 验收标准（AC）

| # | 标准 | 判定方式 |
|---|---|---|
| AC-1 | 43 个 `.fai.js` 文件（39 测试 fixture + 4 demo example）改名 `.fai.js` 后**全部通过**，且 `ExecutionResult` 与改造前逐字段一致 | `npm run test -w @faicad/faijs-tests` + 改造前后快照 diff |
| AC-2 | for / if / while / try / class / 顶层 await 在 `.fai.js` 中正常执行 | 新增集成测试 |
| AC-3 | `append` 增量语义不变：只跑新增行，ctx 持久，缺引用 → `AppendPrefixError` | 新增集成测试 |
| AC-4 | 错误行号准确（用户行号，非 VM 行号） | 偏移锁定测试 |
| AC-5 | `.fai.js` 能 `import` 第三方 ESM 库并调用其 op | mech-lib 端到端测试 |
| AC-6 | `ExecutionResult` 形状零变化（I-1） | api-surface 快照 + 类型等价 |
| AC-7 | `keep.test.ts` 断言**一行不改**且全通过 | 直接跑 |
| AC-8 | 代码**净减 ≥ 1,600 行**（删除 parser 1469 + codegen/compile/terminal-dag/相关测试，扣除 P1 新增 `vm/` 与 P4a 迁出） | `git diff --stat`，见 P4b 估算 |
| AC-12 | **4 个宿主工具函数去 parser 化后行为不变**：`formatCodeLine` / `codeToArgs` / `analyzeCode` / `derivePartName` 现有断言不改且通过 | `npm run test -w @faicad/faijs-core` + api-surface 快照 |
| AC-13 | 导出面契约（`browser.ts:43-52` / `index.ts:48-57` 的 4 个工具）在 P4a 前后**完全一致** | `scripts/api-surface-snapshot.mjs` 基线 diff |
| AC-9 | `eval` / `new Function` / 动态 `import()` 全仓仅出现在 `vm/vm-exec.ts` | grep 守卫 |
| AC-10 | 无 stderr 输出（I-6） | CI 检查 |
| AC-11 | `npm run doc-sync` 12 项门禁全过 | 直接跑 |

---

## 9. 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| **R-1** | 3d_editor 迁移（跨仓库） | **高** | 影响面已实测收敛到三处：① **31 处 `lang/` 工具调用**（P4a 去 parser 化后**零改动**，见 §2.5）；② `StatementSummary.id` 语义变更（D14，Timeline 侧要改）；③ `.fai.js` 资产改名 + `check()` 诊断码消失（R-2）。`ExecutionResult` 冻结（I-1）使执行结果消费方不受影响。改造前先 `npm run pack` 打基线 tarball；`3d_editor/src/engine/__tests__/contract-entry.test.ts` 是导出面契约守卫，可作为回归网 |
| **R-2** | `check()` 的 `E_*` 诊断码消失，AI 生成代码的自我修正闭环受损 | 高 | **需用户决策**（D12）。缓解：路线 A 换来的是**准确行号**（现状 IR→codegen 往返后行号是推算的），可以把"行号 + 运行时错误类型"喂回 AI 形成新闭环 |
| **R-3** | 沙箱：用户代码可触达宿主全局 | 中 | D1-b 受限 global 白名单；Web 侧后续可升级 D1-a（Worker），但 handle 跨线程传递需另行设计 |
| **R-4** | **OCCT handle 泄漏** | 高 | 现状 `reconcileCtx` 依赖 ScriptIR 活跃集；路线 A 活跃集 = ctx。切换/重建 ctx 时必须显式遍历旧 ctx 调 `releaseSolid`。**P3 专项处理 + 专门测试**（执行 N 次 execute/dispose 后断言 handle 计数归零） |
| **R-5** | 不安全感：跨过 `parser.ts:22-23` 红线 | 中 | §3.3 显式改写红线为"单点收口"+ grep 守卫（AC-9），不静默 |
| **R-6** | 不用 `defineOp` 的库函数不参与终端判定 | 低 | 与现状一致，写进文档；K5 禁止按名分类，无更优判据 |
| **R-7** | 参数 schema 校验消失（分析文档 §5.4） | 低 | 责任下移到库；stdlib 已有先例（`split.ts:269-272` 手写断言）。可选 D8（sdk 提供 `assertVec3` 等）作为独立增量 |

---

## 10. 与两份分析文档的关系（差异登记）

| 分析文档结论 | 本计划的处理 | 理由 |
|---|---|---|
| §7 「拓扑引用 `origin`：`o1` → 改为调用序号」 | **删除该风险项** | 实测证伪，`origin` 一直是 `PartName`（§2.1） |
| §7 「`partN` 命名体系 → 变量名即 part 名」 | **删除该成本项** | 实测 `outputs` 的 key 已经是 ctx 变量名（§2.2） |
| §4.4 「引擎在库准入处包 Proxy」 | **改为 D7-a（wrapper 内记录）** | 分析文档 §5.1 已自我修正：路线 A 下引擎拿不到 namespace 对象，无施加时机 |
| D4 「库 vs 脚本形态」 | **由 R5 直接解决** | `.fai.js` = 脚本，普通 `.js` = 库，不需要第二个扩展名（§2.3） |
| D3 「路线 B 函数体变量解析」 | **不适用** | 已选路线 A |
| D5 「默认命名空间怎么表达」 | **不适用** | 路线 A 无 `namespace` 字段，"缺省命名空间"概念不存在，R4 自动满足 |
| 两份文档共同隐含前提：「`lang/` 可整目录删除」 | **推翻，新增 P4a 阶段** | 实测 4 个 `lang/` 工具是宿主公开契约，3d_editor 有 31 处调用，其中 2 个内部调 `parseScript`（§2.5）。必须**先去 parser 化再删 parser** |
| 分析文档 §7 「3d_editor 279 处引用需过一遍」 | **收敛为 3 处** | `ExecutionResult` 冻结（I-1）+ 工具函数去 parser 化后零改动，实际只剩 D14 的 id 语义、`.fai.js` 改名、`check()` 诊断码三项（§9 R-1） |

---

## 11. 落地时的附加要求

- 每个阶段的 PR 必须同步更新至少一份 Agent Note（`.agents/notes/`，AGENTS.md 规定）。
- 红线改写（§3.3）必须在 **P1 的同一个 PR** 里完成，不能等到 P4 删 parser 时才改 —— 否则中间态是"红线还在但已被违反"。
- `git mv` 迁移 fixture，**禁止删除后重建**（保历史）。
- 版本号更新在 pack 之前（AGENTS.md 规定）。
