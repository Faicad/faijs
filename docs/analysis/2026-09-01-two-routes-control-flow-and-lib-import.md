# 分析：faijs 两条技术路线对比 —— 取消 parser（纯 JS VM）vs 保留 parser（扩展 IR）

日期：2026-09-01
范围：`packages/core/src/lang/`（L0 文本层）、`packages/core/src/cad-runtime/`（L2 编排层）、`packages/core/src/module-resolver/`
前置阅读：`docs/analysis/2026-09-01-parse-step-removal-analysis.md`（parse 步骤逐项可移性评估，本文档不重复其结论）

---

## 1. 用户原话

> 我想让faijs成为正常的js语言，删除之前的所有限制性规定，比如不能有控制流语句之类的，能否把parse过程取消，让js vm直接执行。有两个功能，最好能在运行时，通过库的方式实现：1. 判断哪些shape最终输出到UI上。2. 能够增量执行，（最好出错还知道行号，可选）。请判断这是否可行？

> 所谓增量执行，其实是append语义，不是update语义。就是UI上多了几个操作，对应多了几行代码，要能够在之前的结果上增量执行这几行代码。至于参数变更后的update，无法增量update也无所谓，可以全量执行。

> 其实我除了想让faijs支持控制流语法，还希望faijs可以加载别的faijs，用现有的parser能否实现这一点？似乎现在只能在faijs里import标准js/ts代码库？所以你其实要评估两套方案。一套是取消parser，支持我上面提到的两点+这个第三点，就是引用别的库，如果faijs就是js，那么应该很简单。如果不取消parser，则如何支持控制流语句，如果加载第三方库？请写一份分析文档，比较这两种技术路线的优劣

需求拆解（三项）：

| # | 需求 | 用户给定的边界 |
|---|---|---|
| R1 | 控制流语法（for / if / while / try 等），faijs 成为"正常的 JS" | 删除所有限制性规定 |
| R2 | 增量执行 | **append 语义，不是 update**；参数变更的 update 可以全量执行；行号可选 |
| R3 | faijs 加载别的 faijs（`import` 一个 `.faijs`） | 当前似乎只能 import 标准 js/ts 库 |
| R4 | `cad` 前缀可替换成任意名字 | 「cad要能替换成任何的名字。他只是一个随意的名字，用来引用stdlib库。第三方库可以用别的名字。」 |
| R0 | （上一轮）运行时判定哪些 shape 输出到 UI；最好以库的方式提供 | — |

R4 的来源（用户纠正，2026-09-01）：

> 你对cad的这个前缀的理解完全错误。cad要能替换成任何的名字。他只是一个随意的名字，用来引用stdlib库。第三方库可以用别的名字。

这条纠正推翻了本文初版把 `cad` 当作固定前缀/引擎内置符号的表述。核实后的正确事实模型与影响见 §3.2b。

路线定义：

- **路线 A**：取消 parser，用户原文直接进 JS VM（上一轮已用 node 探针实证可行）。
- **路线 B**：保留 parser + ScriptIR + compileToModule，在其上扩展以支持 R1/R3。

---

## 2. 结论摘要

**推荐路线 A，但有三个前置决策点（§8）必须先定。**

三条需求在两条路线下的可行性差异极大，且**差异的根源不是工作量，而是架构冲突**：

| 需求 | 路线 A（取消 parser） | 路线 B（保留 parser） |
|---|---|---|
| R1 控制流 | 天然支持，零成本（JS 原生） | **顶层结构性不可行**；只能在函数体内隔离放开 |
| R2 增量（append） | 天然支持（ctx 持久，只跑新增行） | 已支持，但每次 append 都要**重 parse 全量文本** |
| R3 import .faijs | 天然支持（就是 ESM 动态 import） | 需要新增加载器 + 放开 `export` + 让 `functions` 可执行 |
| R4 `cad` 可任意命名 | **自动满足**（无 IR，"缺省命名空间"概念不存在） | **新增必做项**，跨三层同步改，否则引入误判 bug（§3.2b） |
| R0 终端判定 | 改为运行时对象图，更准 | 现状即可用（静态 C0/C1/C3/C5） |

一句话概括：**路线 A 的四个需求都是"本来就是这样"，路线 B 的四个需求都是"要开一个洞"，而洞与洞之间会互相冲突**（§5.3）。

> **R4 是用户当面纠正后新增的维度**（原话见 §3.2b）。核实结论是：`cad` 在**运行时层早已只是普通 binding 名**（`registerLib(binding: string, ns)`，根门面约定注入 `cad`），把它钉死的只有 L0 文本层 `parser.ts:1086` 一处硬编码；但更麻烦的是 `namespace: undefined ≡ 'cad'` 这个"缺省命名空间"约定散落在类型层、parser 四处、runtime 三处。路线 A 下该问题连同其隐患一并消失，路线 B 则必须把它做完。

关键反直觉结论：**路线 A 并不比现状更危险**。现状 `importModule`（`cad-runtime/module-executor.ts:59-72`）已经在用 `data:` URL / Blob URL 动态 `import()` 执行生成代码。安全红线 `parser.ts:22-23`（"绝不 eval / new Function / import() 真执行"）约束的是**用户原文不进 VM**，而非"系统不执行动态代码"——后者早已发生。

---

## 3. 现状实地核实

以下全部为本次实地核查结果（文件路径 + 行号），非推断。

### 3.1 parser 的限制清单

`parser.ts` 共 1469 行。头部注释（`parser.ts:9-23`）声明的合法子集与禁止项：

```
支持的语法：
- `// apiVersion: N`
- `export default async (cad) => { ... }`   ← 唯一合法容器（**参数名被硬编码为 `cad`**，见 §3.2b）
- `const <name> = <literal>` → ParamDef（右侧仅字面量）
- `const part<N>_v<M> = [await] cad.<op>(<inputVar>?, { ...args })`
- `return { shape, name, color, ... }` → ScriptIR.meta

禁止：
- 循环 / 条件 / IIFE / try-catch / 模板字符串
- 多 default export、函数定义（除顶层箭头外）
- eval / new Function / 动态 import()
```

执行限制的代码位置：

| 限制 | 位置 |
|---|---|
| **容器参数名必须叫 `cad`** | `parser.ts:1086`（`arrowFn.params[0].name !== 'cad'` → ParseError）；连带 `parser.ts:1124/1126` 命名空间集合硬编码 `'cad'`（详见 §3.2b） |
| 控制流黑名单（顶层） | `parser.ts:52`（`E_CONTROL_FLOW` 码定义） |
| 函数体内黑名单（控制流 / import / export / class / eval / new） | `parser.ts:896-932`，`validateFunctionBody()` 递归遍历全节点 |
| `export` 语句禁止 | `parser.ts:838`（顶层）、`parser.ts:914`（函数体内） |
| side-effect import 禁止 | `parser.ts:800`（`import 'pkg'` 不支持） |
| named import 禁止 | `parser.ts:813-816`（只支持 `import * as ns` 与 `import ns`） |
| import 必须在文件头连续段 | `parser.ts:834-836` |
| 动态 `import()` 禁止 | `parser.ts:52` 归入 `E_CONTROL_FLOW` |

### 3.2 import 的真相：命名空间注入，不是模块加载

这是 R3 的核心现状，**用户的猜测（"似乎现在只能在 faijs 里 import 标准 js/ts 代码库"）是准确的**。

链路如下：

1. `parser.ts:791-820` `importDeclToIR()` 把 `import * as mech from 'mech-lib'` 转成 `ImportIR`（记录 binding 名与 specifier），**不解析模块**。
2. `compile.ts:84` / `compile.ts:168` 把调用发射为 `ns.<namespace>.<callee>(...)`。
3. 运行时的 `ns` 由宿主**注入**：`runtime.ts:307-315` `registerLib(binding, ns)`，根门面用同一接口注入 `cad`。

`packages/mech-lib/src/index.ts:15` 的注释直接确认了这一点：

> （`.faijs` 脚本里的 `import * as mech from 'mech-lib'` 是库机制运行时注入，与此无关。）

补充证据：

- **全部 `.faijs` fixture 中没有任何一条 import 语句**（实测 `grep -rn "^import" packages/tests/faijs packages/fixtures --include=*.faijs` 返回空）。F2 的 import 能力目前只被单元测试覆盖（`lang/f2-imports-namespace.test.ts`），未被真实脚本使用。
- 第三方库是 **TS 库而非 `.faijs` 库**：`packages/mech-lib/src/mock-mech-brep.ts:21-24` 直接 `import { defineOp, CONTRACT_VERSION, getBackends } from '@faicad/faijs-core/sdk'`。即第三方库**直接依赖宿主包**拿几何能力（与 brepjs 的"模块级注册器 + 库 import 宿主包"同款）。

### 3.2b `cad` 只是随意的 binding 名（用户纠正，必读）

> **用户原话**：「你对cad的这个前缀的理解完全错误。cad要能替换成任何的名字。他只是一个随意的名字，用来引用stdlib库。第三方库可以用别的名字。」

这条纠正推翻了本文初版的一处表述（初版把 `cad` 当作固定前缀与引擎内置符号）。实地核实后的**正确事实模型是分层的**：

| 层 | `cad` 的身份 | 证据 |
|---|---|---|
| **L2 运行时** | **已经只是普通 binding 名**，与第三方库完全同路 | `runtime.ts:307` `registerLib(binding: string, ns)` 接受任意名；注释明写「`cad` is registered the same way」 |
| **根门面** | **约定**注入名为 `cad` 的 binding（不是关键字） | `src/index.ts:26`、`src/browser.ts:24` `rt.registerLib('cad', createInternalStdlib())` |
| **第三方库** | **任意 binding 名**（F2 namespace import 的本地名） | `import * as mech from 'mech-lib'` → `mech`，`parser.ts:1124` `importBindings` |
| **L0 文本层** | **硬编码关键字** ⚠️ | `parser.ts:1086` 强制第一参数名 `=== 'cad'`，否则 `ParseError: expected 'export default async (cad) => { ... }'` |

即：**运行时层早已是用户想要的样子，把 `cad` 钉死的只有 L0 文本层一处。**

#### 一个比命名更深的隐患：「缺省命名空间 ≡ 字面量 `cad`」

`cad` 不只是被硬编码，它还被特殊对待成一个**省略态**。`StatementIR.namespace?: string` 的 `undefined` 被赋予语义「= cad」，此约定散落三处：

| 位置 | 代码 | 语义 |
|---|---|---|
| `lang/types.ts:96` | 注释「缺省 = 'cad'」 | 类型层约定 |
| `parser.ts:365/488/600/1337` | `...(nsName !== 'cad' ? { namespace: nsName } : {})` | 名为 cad 时**省略字段** |
| `runtime.ts:722/736` | `${source.namespace ?? 'cad'}.${source.callee}` | `??` 兜底成 cad |
| `runtime.ts:1279` | `if (ns && ns !== 'cad')` | 非 cad 才查注册库表，cad 走**内部符号表** |

由此推出一个**尚未爆发但必然爆发的 bug**：一旦开放任意命名，若某个第三方库的 binding 恰好也叫 `cad`（或用户把 stdlib 参数命名为别的名字），第 1279 行的 `ns !== 'cad'` 会把它**误判进内部符号表分支**，绕过 `registerLib` 的注册校验——反之亦然。`??` 兜底同理：它把「未指定命名空间」与「名字叫 cad」混为一谈。

**结论**：`cad` 随意化不是改一处字面量，而是要让「默认命名空间」从**隐含字面量**变成**宿主显式声明**（例如 `registerLib` 时指定 `defaultNamespaces`，或干脆取消"缺省"概念、所有调用一律带 `namespace` 字段）。这一条对两条路线的影响是反向的：

- **路线 A**：此问题**自动消失**。没有 IR、没有 `namespace` 字段，所有库都是 ctx 里的普通变量，一律平等，不存在"缺省命名空间"这个概念。这是路线 A 一项此前未被计入的收益。
- **路线 B**：这是**新增的必做改造项**（原 R1–R3 之外的 R4），涉及类型层 + parser 四处 + runtime 三处，且必须一次改完否则留下上述误判 bug。

### 3.3 module-resolver：能力齐备但零消费

`packages/core/src/module-resolver/resolver.ts`（290 行）是一个纯函数 `resolveImports(code, options)`：

- acorn 定位所有 import 的 span（复用 `faqts/imports`）
- 裸说明符 → 查解析表（`imports` / `scopes` / `slices`）→ 重写为绝对 URL
- 支持版本范围校验（`mech@^1.2`）、多版本 scopes、V5.4 大库切片（只 fetch 被引用的 `pkg/sub`）
- 未登记的裸说明符 → `UnresolvedImportError`（不回退、不静默）

**但它在 faijs 内部没有任何调用方**——实测引用点仅两处：`src/module-resolver/index.ts`（facade re-export）与 `scripts/api-surface-snapshot.mjs`（API 面快照）。它目前是**暴露给宿主（3d_editor）的裸 API**。

这个模块对两条路线都关键：**它是"裸说明符 → URL"的现成解决方案**，而这是动态 import 的硬约束（见 §3.5）。

### 3.4 `functions` 是半成品：有 parse、有 codegen，无执行

`lang/types.ts:199` 定义 `FunctionDefIR`（`{ name, params, body }`，`body` 是**花括号内原文切片**），`types.ts:221` 的 `ScriptIR.functions?` 承载它。

| 环节 | 是否支持 | 位置 |
|---|---|---|
| parse（收集函数定义） | ✅ | `parser.ts` 的函数定义收集 + `validateFunctionBody` 校验 |
| codegen（打印回源码） | ✅ | `codegen.ts:278-280` `fmtFunction()`，body 保留原文 |
| **compile（编译进执行产物）** | ❌ | `compile.ts` 全文无 `functions` |
| **执行** | ❌ | `module-executor.ts` / `runtime.ts` 全文无 `functions` |

实测：`grep -n "functions" compile.ts module-executor.ts runtime.ts` 返回空。

**含义**：parser 已经能解析顶层函数定义、也能把它打印回去，但函数定义**根本不会被编译也不会被执行**。路线 B 若要支持控制流，这里是现成的一半基础设施（§5.1）。

### 3.5 现状已在动态执行代码（重要前提）

`module-executor.ts:59-72`：

```ts
async function importModule(code: string) {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node
  if (isNode) {
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    return import(/* @vite-ignore */ url)
  }
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try { return await import(/* @vite-ignore */ url) }
  finally { URL.revokeObjectURL(url) }
}
```

即：**编译产物已经以动态 `import()` 方式进入 JS VM**。

`compile.ts:6-9` 解释了产物为何必须"零 import"：

> 产物零 import 是关键决策——Node 的 `data:` URL 与浏览器的 Blob URL 动态 import 都无法解析裸说明符，零 import 使模块在两个平台都能直接 `import()`，无需 import map / 打包器 / 文件系统。

**这条约束对两条路线都成立**，且是 R3 的技术核心：`data:` / Blob URL 的模块没有 base URL，内部的裸说明符（`import 'mech-lib'`）无法解析。要 import 第三方库，必须**先把 specifier 重写为绝对 URL**——这正是 `module-resolver` 的用途（§3.3），两条路线都得走这一步。

### 3.6 append 的现状语义

`runtime.ts:529-540`：

```ts
async append(code: string, opts?: ExecuteOptions) {
  const fullCode = this.accumulatedCode === null ? code : `${this.accumulatedCode}\n${code}`
  this.accumulatedCode = fullCode
  const { script } = parseScript(fullCode, { looseVars: true })
  const newIds = []
  for (const s of script.statements) if (!this.accumulatedIds.has(s.id)) newIds.push(s.id)
  this.accumulatedIds = new Set(script.statements.map((s) => s.id))
  return this.appendIR(script, newIds, opts)
}
```

语义与用户描述的 append **完全一致**：累加全文 → 重新 parse → diff 出新语句 id → 只执行新 id。引用完整性由 `assertAppendPrefix`（`runtime.ts:590+`）校验，缺引用抛 `AppendPrefixError`，宿主可降级为全量 `execute`。

**注意代价**：每次 append 都对**全量累积文本**重新 parse。这是路线 B 下 O(n) 的重复解析开销，路线 A 下不存在（新增文本直接进 VM）。

### 3.7 终端 shape 判定（R0 现状）

`cad-runtime/terminal-dag.ts`（182 行），静态短路判定 C0 → C1 → C3 → C5：

- **C0/C1**：变量被 `keep` 声明（调用点 keep 指令 / 函数体 `exec.keep`）→ 不被本语句消费
- **C3**：本语句有赋值且所有输出都是非几何（measure/bbox 之类）→ 不消费任何输入
- **C5**：**默认消费**（drill / transform / 未声明保留的第三方几何函数）
- 嵌套调用（`CallRefIR`）中的引用 = 只读查询，不消费

C5 是启发式兜底，也是路线 A 要替换掉的部分（§4.4）。

---

## 4. 路线 A：取消 parser，faijs = JS

### 4.1 执行机制（上一轮 node 探针已实证）

用户原文逐字进入 VM，用 `with(Proxy)` 接管跨执行的变量读写：

```js
const scope = new Proxy(ctx, {
  has: () => true,                                          // 保证赋值能写回
  get: (t,k) => Reflect.has(t,k) ? t[k] : globalThis[k],    // 非 ctx 名回退全局
  set: (t,k,v) => { t[k] = v; return true },
})
new Function('__s__', `with(__s__){ return (async()=>{\n${用户原文}\n})() }`)(scope)
```

实测结论（四条全过）：读上一轮变量 ✅、新变量写回 ctx ✅、第二轮 append 读到第一轮结果 ✅、**不污染 `globalThis`** ✅；`for` / `class` / 箭头闭包 / `if` 全部正常执行。

两个必须记录的坑：

1. `has: () => true` 而 `get` 不做全局回退时，会把 `Error` / `Math` / `JSON` **全部遮蔽**（首版探针撞上 `new Error is not a constructor`）。
2. `let x = ...` 是词法声明，`with` 拦截不到，**不会持久化**；只有无声明赋值 `x = ...` 会写回 ctx。见 §8 决策点 D2。

### 4.2 R1 控制流：原生支持

零成本，无额外设计。所有 JS 语法（for / if / while / try / class / 闭包 / 模板字符串）直接可用。

### 4.3 R2 增量 append：ctx 持久 + 只跑新增行

宿主传新增的那几行文本，引擎包一层执行，ctx 持久。新增代码引用旧变量由 `with` 解析；引用不到抛 `AppendPrefixError`，宿主降级全量执行（沿用现状的错误类型与降级策略）。

**update 场景**（用户说可以全量执行）：路线 A 退化为全量重跑。若仍需 op 级缓存，可由命名空间对象做 **memo 化**：

```
key = 函数对象身份 + 参数深比较 + 输入 Shape 的对象身份
```

注意 key 的第一项是**函数对象身份**（`fn` 引用）而非字符串名——因为 `cad` 这类 binding 名由宿主随意注册（§3.2b），同名不同库、同库不同版本都是不同函数对象。按名比对会串。

这比现状的 `statementKey`（`runtime.ts:722`，`${ns}.${callee}|${JSON.stringify(args)}`）**更鲁棒**：现状既依赖变量名（`?? 'cad'` 兜底）又依赖字符串名，变量重命名或库换名即失效；对象身份不受命名影响。

### 4.4 R0 终端判定：改为运行时对象图

#### 谁来包：引擎，在库准入（admit）处包 —— 不是库作者，也不是根门面

命名空间对象现状是**纯对象字面量**（`internal-stdlib.ts:41-55` 返回 `{contractVersion, box, sphere, ...}`），零拦截能力。要记录调用，必须有人给它包一层。三个候选点：

| 候选 | 判断 | 理由 |
|---|---|---|
| 库作者自己包（stdlib / mech-lib 内部） | ❌ | 第三方库不会配合；每个库重复实现；把引擎职责泄漏给库作者，违反 K5 |
| 根门面包（`src/index.ts:26` 处） | ❌ | 只覆盖 `cad`；宿主调 `registerLib` 注册的第三方库**完全绕过** |
| **引擎在库准入处包** | ✅ | 库作者零感知，mech-lib 不用改一行，覆盖面 100% |

**但"库准入处"不止 `registerLib` 一个。** 实测发现一条绕过路径：`constructor`（`runtime.ts:320-321`）直接 `this.libs = libs` / `this.namespaces = {...libs}`，**既不调 `assertContractVersion` 也不调 `assertLibConforms`**——现状就已存在的一致性缺口。若只在 `registerLib` 里包，constructor 注入的库将漏记录。

⇒ 正确做法是把「校验 + 包装」抽成一个准入函数，两条注入路径共用：

```ts
// 引擎侧：所有库进入 runtime 的唯一收口（registerLib 与 constructor 共用）
private admitLib(binding: string, raw: StdlibNamespace): StdlibNamespace {
  assertContractVersion(raw)          // ① 先校验，且必须对【原始对象】
  assertLibConforms(raw)              //    （理由见下方 ⚠️）
  return instrument(raw, binding)     // ② 校验通过后才包装
}
registerLib(binding: string, raw: StdlibNamespace): void {
  this.libs[binding] = raw                 // 内部保留原始对象（按名读元数据用）
  this.namespaces[binding] = this.admitLib(binding, raw)
  this.executor.setNamespaces({ ...this.namespaces })
}
```

**两个存储必须分开**：`this.libs[binding]` 存**原始对象**（供引擎内部按名读 `DUAL_OP_META`，例如 UI 判定某 op 是否 brep-only 以禁用图标）；`this.namespaces` 存**包装后对象**（只注入给用户代码）。

#### 怎么包：一个 `get` 陷阱 + 四个必须点（node 探针已逐条实证）

Proxy 只能拦属性读取，**拦不到调用**。要记录 `(函数, 输入, 输出)`，必须在 `get` 陷阱里返回包装函数：

```ts
function instrument(ns: StdlibNamespace, nsName: string): StdlibNamespace {
  const wrapCache = new Map<StdlibFn, StdlibFn>()   // 点①：身份稳定的关键
  return new Proxy(ns, {
    get(target, prop, recv) {
      const val = Reflect.get(target, prop, recv)
      if (typeof val !== 'function') return val     // 点②：非函数字段透传
      let wrapped = wrapCache.get(val)
      if (!wrapped) {
        wrapped = (...args: unknown[]) => {
          const out = val.apply(target, args)
          if (out && typeof (out as Promise<unknown>).then === 'function') {
            // 点③：异步在 then 里记，必须在返回给用户【之前】注册
            return (out as Promise<unknown>).then(v => { record(nsName, val, args, v); return v })
          }
          record(nsName, val, args, out)            // 同步：直接记
          return out
        }
        // 点④：元数据透传（防御）
        if (DUAL_OP_META in val) {
          Object.defineProperty(wrapped, DUAL_OP_META,
            { value: (val as MetaCarrier)[DUAL_OP_META], enumerable: false })
        }
        wrapCache.set(val, wrapped)
      }
      return wrapped
    },
  })
}
```

四点逐条说明（均为实测结论，非推断）：

| # | 点 | 不做的后果 |
|---|---|---|
| ① | **`wrapCache` 保证 `cad.box === cad.box`** | 每次 `get` 返回新函数 → 函数对象身份不稳定 → §4.3 的 memo key 首项（函数对象身份）直接失效 |
| ② | **非函数字段透传** | `contractVersion` 是**数据字段**（数字，非函数），被误包装会让 `assertLibConforms` 与版本校验读出 `undefined` |
| ③ | **异步在 `.then` 里记，且注册早于用户 `await` 续体** | 实测：包装函数的 `.then` 先注册，故 `await cad.union(...)` 返回时记录**已可见**；若改成用户在 await 后再注册，判定就漏 |
| ④ | **透传 `DUAL_OP_META`** | 见下方 ⚠️ |

探针实测输出（`node v22`）：`cad.box === cad.box → true`、`contractVersion → 3`、同步记录即时可见、`await` 后记录即时可见、调用序列按真实顺序、`cad`/`mech` 两命名空间互不串。

#### ⚠️ 包装时机的硬约束：必须先 `assertLibConforms`，后包装

`DUAL_OP_META = '__faijs__dualOp'` 是**挂在函数对象上**的元数据（`define-op.ts:197`，`enumerable: false`），`defineOp` 的注释明写「Metadata hung on the wrapped function object (K5)」。它的唯一读取方是 `assertLibConforms`（`define-op.ts:214/223`），而该函数用 `Object.values(lib)` 遍历取值再判 `v[DUAL_OP_META]`。

**包装函数默认不带这个属性。** 实测后果：

```
对原始对象校验 : 检出 dual-op，执行严格校验
对 Proxy  校验 : 未检出 dual-op → 跳过校验（静默放过）
透传元数据后   : 检出 dual-op，执行严格校验
```

即：**若先包装后校验，一个 `mesh` 实现非法的坏库会被静默放过**（`hasDualOp` 判 false → 整段严格校验跳过，不报错）。这与项目「不静默降级」的红线直接冲突。故：

- **顺序不可换**：`assertContractVersion` / `assertLibConforms` 必须作用于**原始对象**。
- **仍要透传元数据（点④）**：虽然当前唯一读取方在包装前执行，但引擎内部保留的 `this.libs` 是原始对象，而**宿主/UI 侧若从注入的命名空间读元数据**（例如按 `brep`/`mesh` 有无来禁用图标），不透传就会读到 `undefined`。透传成本一行，收益是消除这类时序耦合。

#### 两条好消息（原以为的风险，实测不存在）

1. **包装不会破坏 BREP/mesh 分派**。`dispatchPath(inputs, meta, missing)` 的 `impls` 是 `defineOp` 的**闭包变量**（`define-op.ts:169` 构造 `meta`、`:183` 在 wrapper 内直接引用），不是从函数对象上读的。包装只在外层记一笔，分派逻辑完全不受影响。
2. **`StdlibNamespace` 是扁平函数字典**（`runtime-state.ts:72-74` `{[name]: StdlibFn}`，无嵌套）。所以只需一个 `get` 陷阱即可全覆盖，不需要递归包装。

#### 判定规则

记录的是 `(命名空间名, 函数对象, 参数集, 输出)`，据此：

- **终端 Shape** = 从未作为"几何消费型调用"输入的 Shape（消费判据沿用 `terminal-dag.ts` C3 精神：输出非 Shape 的调用不消费输入，如 `bbox`/`faceCenter` 这类测量调用）。
- 因为记录的是**对象身份**而非字符串名，库用 `cad`、`geo` 还是 `mech` 命名都不影响判定——这同时消掉了 §3.2b 里"缺省命名空间"那一整类歧义。

相比现状的静态判定有实质改进：

- 用**对象身份**而非变量名 → 重命名不再影响结果
- 用**运行时实际调用**而非语法推断 → 现有的 C5 "默认消费"启发式可以整个删掉

### 4.5 R3 import 别的 .faijs：天然支持，但有一处硬约束

faijs 就是 JS，`.faijs` 文件就是一个 ESM 模块，`import` 它就是动态 import 一个模块。**但需要区分两种形态**（§6 是两条路线的共同问题）。

硬约束：`data:` / Blob URL 模块无法解析裸说明符（§3.5）。解法是**在构造模块文本前先用 `module-resolver` 把 specifier 重写为绝对 URL**——能力现成，只是当前零消费（§3.3）。

### 4.6 行号：天然准确

用户原文逐字进 VM，`new Function` 有固定偏移 **3**（上一轮实测），减掉即用户行号。**不需要 sourcemap、不需要插桩**——比现状的 IR → codegen 往返干净。

---

## 5. 路线 B：保留 parser，扩展 IR

### 5.1 R1 控制流：顶层结构性不可行，只能函数内隔离

**这是架构冲突，不是工作量问题。**

现状 IR 是扁平语句列表，每条语句有静态分配的稳定 `id`（`s1..sN`），`compile.ts:215-266` 按 id 建 `{ id, deps, fn }`，增量执行靠 diff "新 ids"（`runtime.ts:534`）。控制流一旦出现在顶层：

- `for (let i=0;i<n;i++) { part_i = cad.box(...) }` → **语句数量运行时才确定**，id 无法静态分配
- `if (cond) { a = ... } else { b = ... }` → **哪些语句执行运行时才确定**，deps 图无法确定

⇒ **顶层放开控制流 = 摧毁 id 稳定性 = 摧毁增量执行**。无解，只能绕。

**唯一出路：函数边界隔离。** 函数体内部放开任意控制流，函数体**整体**作为一个 DAG 节点：

- 粒度退化：函数体内 100 行循环 = 1 个节点，改其中一行 = 整个函数重跑
- 对 CAD 而言这个退化是合理的（循环生成的阵列本来就该整体重算）

现成基础：`functions` 已有 parse + codegen（§3.4），缺 compile 发射与执行。**这是中等工作量，不是重写 parser**——必须说清楚，否则会高估路线 B 的成本。

**但有一个精确的技术障碍**：ESM 是严格模式，`with` 被禁。函数体原文引用顶层变量（如 `r`）时，两条路：

| 做法 | 说明 | 代价 |
|---|---|---|
| B-1 发射时改写 `r` → `ctx.r` | 需对函数体**再做一次 AST walk + 改写** | 面对的是任意 JS，复杂度与路线 A 的 `with(Proxy)` 相当，只是范围缩到函数体 |
| B-2 用 `new Function` 构造函数（非严格模式，可用 `with`） | 简洁 | **跨过 `parser.ts:22-23` 的红线**（首次让用户原文进 VM） |

顺带澄清一个直觉误区：B-2 的 `new Function` **并不比现状更危险**——现状已在用 `data:` URL 动态 `import()` 执行生成代码（§3.5）。两者都是"执行动态代码"，区别只在用户原文是否直接进 VM。

### 5.2 R2 增量 append：已支持，但每次全量重 parse

现状即 append 语义（§3.6），无需改动。代价是**每次 append 对全量累积文本重新 parse**，规模增长后是 O(n) 重复开销。

行号：现状由 parser 记录 `statementLines`（`parser.ts` `ParseResult.statementLines`），可用。

### 5.3 R3 import 别的 .faijs：三步新做，且与控制流方案冲突

需要同时完成：

1. **放开 `export`** —— 现状 `parser.ts:838`、`914` 明确禁止。库必须能导出符号。
2. **让 `functions` 可执行** —— 现状不编译不执行（§3.4）。库导出的是函数，函数不可执行则库无意义。
3. **新增 `.faijs` → ESM 库加载器** —— 把 `.faijs` 编译为可 import 的 ESM，再由宿主 `import()`。

第 3 步有现成基础：`compileToModule` 的产物**就是标准 ESM**（`export const statements = [...]`）。但它的产出形态是"语句数组"，不是"可调用的函数库"——**要作为库被引用，产出的形态得变**。

**洞与洞的冲突**：步骤 1、2 都依赖 §5.1 的函数体方案，而函数体方案本身要决定 B-1（再 walk 一次）还是 B-2（跨红线）。三个需求在路线 B 下**不是三个独立任务，而是一条依赖链上的三环**，任何一环的设计变更都会波及另外两环。这是路线 B 最实质的隐性成本。

### 5.4 R4 `cad` 随意化（路线 B 额外新增，原 R1–R3 之外）

这是 §3.2b 的直接后果。按用户的要求，`cad` 必须能换成任何名字；路线 B 要做到，改动面是：

| 位置 | 现状 | 需改 |
|---|---|---|
| `parser.ts:1086` | 参数名 `=== 'cad'` 否则报错 | 接受任意名，记录为「默认命名空间名」 |
| `parser.ts:1124/1126` | `isNamespaceName` / `nsNames` 字面量含 `'cad'` | 改用「容器参数名 + importBindings」 |
| `parser.ts:365/488/600/1337` | `nsName !== 'cad'` 时省略 `namespace` 字段 | 省略判据改为「== 默认命名空间名」 |
| `runtime.ts:722/736` | `source.namespace ?? 'cad'` | `??` 的兜底值必须由宿主提供，不能写死 |
| `runtime.ts:1279` | `if (ns && ns !== 'cad')` | 判据改为「== 默认命名空间名」（否则第三方库若叫 `cad` 会被误判进内部符号表） |
| `lang/types.ts:96` | 注释「缺省 = 'cad'」 | 语义改为「缺省 = 宿主声明的默认命名空间」 |

**关键点**：这五处（类型层 + parser 四处 + runtime 三处）**必须一次改完**。只改 parser 而不改 `runtime.ts:1279` 的 `ns !== 'cad'`，会立刻产生「名为 cad 的第三方库绕过注册校验」的隐蔽 bug；只改 runtime 不改 parser，用户仍然被迫把参数命名为 `cad`。

**工作量评估**：单看每行都是小改动，但它是一次**跨三层的语义收敛**——把「默认命名空间」从隐含字面量提升为宿主显式声明的契约，且必须同步更新 `StatementIR` 的类型注释与 `statementKey` 的缓存键语义（改键 = 旧缓存全失效）。估 1–2 天，含回归测试。

---

## 6. 两条路线的共同问题：库 vs 脚本的形态区分

无论走哪条路线，"`.faijs` import `.faijs`"都要求先回答：**被 import 的那个文件，是库还是脚本？**

| 形态 | 内容 | 副作用 | 导出物 |
|---|---|---|---|
| **脚本** | 顶层语句直接建模 | 有（产生 Shape、写 ctx） | 终端 Shape 列表 |
| **库** | 只定义函数 | 无（import 时不应产生 Shape） | 函数集合 |

现状的 `.faijs` **只有脚本形态**：唯一合法容器是 `export default async (cad) => {...}`（`parser.ts:11`），没有 export 能力。

两条路线的解法：

- **路线 A**：库文件就是普通 ESM（`export function makeGear(...)`），脚本文件是顶层语句。**天然区分**，靠约定即可。
- **路线 B**：需要新增形态标记（如文件头声明，或扩展名区分 `.faijs` / `.failib`），并让 parser 按形态走不同的校验规则——这又是一条子集规则。

附带问题：**库里的几何能力从哪来？** 现成答案是 mech-lib 的模式（§3.2）：库直接 `import { defineOp } from '@faicad/faijs-core/sdk'`，自己声明实现集。即**库依赖宿主包拿几何能力**，而非由调用方注入。

注意这里与 §3.2b 的关系：`cad` 只是**脚本侧**引用 stdlib 的 binding 名（可任意命名）；而在**库侧**，mech-lib 根本不经过 `cad`，它直接 import 宿主包的 `defineOp`。也就是说「库拿几何能力」这件事**从来不依赖 `cad` 这个名字**——这进一步印证 `cad` 只是脚本层的一个随意别名，把它硬编码成关键字（L0）或赋予"缺省命名空间"语义（L2 `?? 'cad'`/`ns !== 'cad'`）都是多余的耦合。两条路线都可沿用 mech-lib 这个约定。

---

## 7. 优劣对比总表

| 维度 | 路线 A（取消 parser） | 路线 B（保留 parser） |
|---|---|---|
| **R1 控制流** | 原生支持，零成本 | 顶层不可行；函数体内隔离放开，需新增函数体编译 + 变量改写方案 |
| **R2 增量 append** | ctx 持久 + 只跑新增行，无重解析 | 已支持；每次 append 全量重 parse（O(n)） |
| **R2 行号** | 天然准确（固定偏移 3） | 已有 `statementLines`，可用 |
| **R3 import .faijs** | 天然支持（ESM 动态 import） | 三步新做：放开 export + functions 可执行 + 库加载器 |
| **R4 `cad` 随意命名** | ✅ **自动满足**：无 IR / 无 `namespace` 字段，所有库一律平等，"缺省命名空间"概念不存在（额外收益，此前未计入） | ⚠️ **新增必做项**：类型层 + parser 四处 + runtime 三处须一次改完，否则产生"名为 cad 的第三方库绕过注册校验"的隐蔽 bug（§3.2b / §5.4） |
| **R0 终端判定** | 运行时对象图，更准，可删 C5 启发式 | 现状静态判定可用 |
| **代码量** | 净减约 2500 行（parser 限制段、compile、codegen、terminal-dag 静态判定） | 净增（函数体编译 + 库加载器 + 形态标记） |
| **AI 生成代码护栏** | ❌ 消失，改靠运行时错误 + 行号兜底 | ✅ 保留（语法约束 + `E_*` 诊断码精确反馈） |
| **沙箱** | **必做**：`get` 回退 `globalThis` 意味着用户代码可触达宿主全局 | 现状同样执行动态代码，但用户原文不进 VM，攻击面较小 |
| **3d_editor 迁移** | 279 处引用需过一遍；`partN` 命名体系 → 变量名即 part 名；UI 从"改 IR → codegen 回写"变为拼文本 | 基本不动 |
| **拓扑引用 `origin`** | `o1`（语句 id）→ 改为调用序号（ordinal 本就不能做身份，该改造本就要做） | 不变 |
| **文档波及** | `docs/syntax-design.md`（刚重写过）需大改；双语门禁 12 项要重跑 | 小改 |
| **风险特征** | 一次性大改，改完心智统一 | 渐进低风险，但子集规则 + 例外清单长期并存 |

---

## 8. 决策点（需用户定，显著影响工作量）

### D1 沙箱边界（路线 A 必答）

`get` 回退 `globalThis` 意味着用户代码能碰宿主全局。选项：

- **D1-a**：Worker 内执行（浏览器侧已有 `browser-host/worker-csg-backend.ts` 基础），Node 侧用 `worker_threads` + 受限 global
- **D1-b**：构造受限 global 对象（白名单 `Math` / `JSON` / `Array` 等），`get` 回退到它而非 `globalThis`
- **D1-c**：不做隔离，信任脚本来源（适用于 AI 生成 + 本地运行的场景）

### D2 `let` 持久化（路线 A 必答）

实测：`let x = ...` 是词法声明，`with` 拦截不到，**不进 ctx**。选项：

- **D2-a**：约定用户用无声明赋值（`part3 = ...`）——能跑，风格差，且非严格模式下会静默创建全局（有 Proxy 兜底则不会）
- **D2-b**：保留 acorn 做**只读扫描**——只收集顶层声明名，在原文末尾追加一行 `Object.assign(__ctx__, {part3})`，**不拒绝任何语法**。acorn 从"限制器"降级为"作用域分析器"，不影响行号，与"取消限制"不冲突。**推荐**
- **D2-c**：要求全部用 `let`，配合 D2-b 的扫描（写法自然，扫描代价比 D2-b 略高）

### D3 路线 B 下的函数体变量解析（仅选路线 B 时需要）

- **B-1**：发射时 AST 改写 `r` → `ctx.r`（不跨红线，但复杂度与路线 A 相当）
- **B-2**：`new Function` 构造 + `with`（简洁，跨 `parser.ts:22-23` 红线，但风险与现状的动态 `import()` 相当）

### D4 库文件形态（两条路线都需要，但路线 B 更迫切）

- 同一扩展名 + 文件头声明？
- 还是区分扩展名（`.faijs` 脚本 / `.failib` 库）？

### D5 「默认命名空间」怎么表达（仅选路线 B 时需要；路线 A 无此概念）

R4 要求 `cad` 可换成任意名，于是「`namespace: undefined` 该归到哪个库」必须由**宿主显式声明**，不能再是隐含字面量 `'cad'`。选项：

- **D5-a**：`registerLib(binding, ns, { default: true })` —— 宿主指定哪个 binding 是默认命名空间；`statementKey` 的 `??` 与 `runtime.ts:1279` 的分支判据都读它。改动最小，语义清晰。**推荐**
- **D5-b**：取消"缺省"概念，`StatementIR.namespace` 改为**必填**，所有调用一律带 namespace。最干净，但 `statementKey` 全变、旧缓存全失效、parser 四处与全部 fixture/快照要同步更新
- **D5-c**：保留字面量 `'cad'` 但允许宿主覆盖默认名 —— 折中，但"字面量 + 覆盖"双轨容易再次走偏

**注意 D5 与 D3 独立**：即使 D3 选 B-1（不走 `new Function`），R4 仍必须做，因为它是 L0 层的硬编码（`parser.ts:1086`），与函数体方案无关。

---

## 9. 建议

**推荐路线 A**，理由：

1. R1 在路线 B 下是**结构性不可行**（顶层控制流与静态 DAG 冲突），只能函数内隔离——这等于 faijs 永远不是"正常的 JS"，与用户的核心诉求有实质落差。
2. R3 在路线 B 下需要三步新做，且三步都依赖 §5.1 的函数体方案——三个需求在路线 B 下是一条依赖链，不是三个独立任务，隐性耦合成本高于表面工作量。
3. **R4 是纯增量收益**：`cad` 随意命名在路线 A 下自动满足（无 IR，"缺省命名空间"概念不存在）；在路线 B 下则是跨三层的同步改造，且改不干净会留下"名为 cad 的第三方库绕过注册校验"的隐蔽 bug（§3.2b）。这一条让路线 A 的领先又扩大一分。
4. 路线 A 的代码是**净减**约 2500 行，路线 B 是净增。长期看，路线 B 会长期维护"子集规则 + 例外清单"两套心智。

> 补充一条**与路线选择无关、现在做零风险**的事：无论最终选哪条，`runtime.ts:1279` 的 `ns !== 'cad'` 与 `:722` 的 `?? 'cad'` 都值得先抽成一个「默认命名空间」的显式概念（不改名、不改行为，只消除字面量散落）。这样即便选路线 B，R4 也从"跨三层改造"降级为"接一根线"。

**选择路线 B 的合理条件**（若以下任一成立，应重新权衡）：

- AI 生成代码的强护栏是硬需求（`E_*` 诊断码驱动的自我修正闭环已被 3d_editor 依赖）
- 语句级增量粒度是硬需求（而非用户所说的 append 语义）
- 3d_editor 的 279 处引用迁移成本此刻不可接受

**无论如何都该先做的事**（与路线选择无关，零风险）：

1. 让 `module-resolver` 真正被消费——R3 在两条路线下都需要"specifier → 绝对 URL"（§3.5 的硬约束），能力已就位只是没接线。
2. 明确"库 vs 脚本"形态约定（§6），这是 `.faijs` import `.faijs` 的前置。
