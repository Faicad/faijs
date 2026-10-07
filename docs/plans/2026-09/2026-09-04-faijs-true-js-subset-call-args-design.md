# .fai.js 成为真正 JS 子集：顶层调用实参限制取消 — 技术方案

- 日期：2026-09-04
- 状态：已落地（P1–P6 实施完成；P7 3d_editor 跟进为独立后续）
- 范围：`.fai.js` 顶层调用语句的实参形态（五种调用形态全覆盖）；IR、编译、执行、宿主 API、契约文档的配套改造

---

## 0. 用户原始需求（原话）

> 分析C:\my\Faicad\faijs目录的代码现状，我需要让.fai.js代码真正是一个js语言的子集，除了明确不支持的特性（比如顶层词法作用域的控制流语句，eval， new Function,等），其它任何特性都必须默认支持。比如下面的限制，都必须取消：
>
> 裸字面量不能当实参 → cad.box(10, 20, 30) 在 .fai.js 里直接报 unexpected argument type: Literal。必须写成对象形态：cad.box({ size: [10, 20, 30] })。注意限制只针对实参位置本身：对象里面的值随便复杂，嵌套对象、数组、'base' 这种字面量值都没问题（{ region: 'base', rule: { kFactor: 0.44 } } 合法）。
>
> "最多一个对象实参"是个静默坑 → cad.box({ size: [1,2,3] }, { center: true }) 不报错，但第二个对象整体覆盖第一个（args = parsed 在循环里赋值，后者胜），第一个参数包静默丢失，不合并。
>
> 取不出成员 → p0.solid 是 MemberExpression，也被拒。这就是当时记的那条的由来：sheetmetal 的 hem(part, spec) 要的是数据对象里的内嵌 solid，脚本里拿不出来，所以库必须提供显式终端 solidOf(p1) 把几何取出来。
> 这个限制只在脚本面 → 从 TypeScript 直接调 API 是真正的 JS 调用，位置形态和对象形态都支持。

需求的判定原则：**默认支持，显式禁止**。禁止项只能是契约明文列出的安全/语义红线（顶层控制流、`eval`、`new Function`/`new`、动态 `import()`、`export` 等，见 §3），其余任何合法 JS 表达式在实参位置都必须可用。

## 1. 现状分析

### 1.1 限制的物理位置

parser 对顶层调用实参实行白名单：`Identifier` → `inputs`（变量引用槽），`ObjectExpression` → `args`（静态对象槽），其余一律 `ParseError: unexpected argument type: <NodeType>`（E_VALUE）。白名单散布在 5 处平行的实参循环：

| 调用形态 | 位置（packages/core/src/lang/parser.ts） | 报错行 |
|---|---|---|
| 命名空间调用 `cad.op(...)`（`parseCadStatement`） | 实参循环 :694-720；`args = parsed` 覆盖赋值 :713 | :715/:718 |
| 解构调用 `const {a,b} = cad.op(...)` | :840-856 | :853/:856 |
| 本机函数无赋值调用 `myFn(...)` | :1666-1688 | :1683/:1686 |
| 成员方法调用 `asm1.add_constraint(...)` | :1730-1750、:1780-1791 | :1747/:1750、:1788/:1791 |

由此产生用户列举的三个具体限制：

1. **裸字面量实参被拒**：`cad.box(10, 20, 30)` 命中 :718 的 `unexpected argument type: Literal`。
2. **第二对象实参静默覆盖**：`args = parsed`（:713，解构形态 :851 用 `Object.assign` 但也同槽合并）在循环里反复赋值，后者胜，不报错不合并——这是用户点名的"静默坑"。
3. **MemberExpression 被拒**：顶层实参位置的 `p0.solid` 命中 :718；args 对象*内部*的 `p0.solid` 走另一条路——常量折叠失败后不在 ExprIR 白名单（`isExprWhitelist`，parser.ts:272-296，**no calls, no member access**），报 E_VALUE（:556-560）。

### 1.2 限制的历史定位（为什么当初加上）

2026-08-27 语言正常化设计文档如实记录：`inputs` 与 `args` 的分工（位置引用 vs 选项对象）是"全部现有函数都符合 `(...inputs, options?)` 形态"的**现状描述，不是安全红线**。它服务于三个派生机制：

- **依赖图**：`stmt.refs`（parser 收集，:1027-1034 `collectStatementRefs`）→ 编译期翻译为 `deps`（compile.ts:283-296）；
- **增量 key**：`computeKey` = callee + `JSON.stringify(args 去 keep)` + 各依赖 content fingerprint（module-executor.ts:593-610）；
- **终端/存活判定**：C5 默认消费 = "inputs 位置引用 或 args 内变量引用"（api-contract.md §6.1；terminal-dag.ts:90-97）。

`packages/tests/faijs/p23-cad-face/p23-cad-face.test.ts:26-27` 已明确记载："位置形态进 `.fai.js` 属语言层变更（StatementIR 需新增 positional 槽 + 增量 key 覆盖 + 宿主编辑面板适配），超出 P23 范围"——即放开被预见到，且已点名要动的三块。

### 1.3 关键资产：ExprIR 已打通运行时求值链路

放开限制**不需要发明新机制**。args 内部的 `ExprIR`（types.ts:58-67）已经实现了"表达式原文切片 + 引用名集合 → 编译期箭头包装发射 → JS 引擎运行时求值"的完整链路：

- parser：折叠失败且节点 ∈ 白名单 → `buildExprIR`（parser.ts:394-414），原文零改写（R13 保持）；
- compile：`translateArg` 把 `$expr` 发射为 `((${names}) => ${text})(${ctx args})`（compile.ts:94-98），标识符经箭头参数绑定到 `ctx.<name>`；
- refs：`$expr.refs + params` 已纳入 `collectRefsFromArg`（parser.ts:994-1021），deps/增量 key 天然兼容。

本方案的本质是：**把这条已验证的链路从"args 对象内部的属性值"推广到"顶层调用的位置实参槽"**，并扩展白名单以覆盖 MemberExpression。

### 1.4 影响面全景

`inputs: PartName[]` 当前的消费方（放开后全部需要适配）：

- **编译发射**：`buildStatementFnBody` 把 inputs 逐字映射为 `ctx.<name>` 位置实参（compile.ts:210）；
- **终端判定**：terminal-dag.ts C2（按下标消费位置输入，:76-91）、C5（`inputs.includes(v)`）；
- **keep 语义**：keep.ts:194（keep 目标 ∈ inputs ∪ args 引用）；
- **执行器**：module-executor.ts:544-551（装配成员下游失效）、:559-578（emitBrepLost 按 inputs 取 Shape 判 BREP 链断开）；
- **校验/摘要/回印**：runtime.ts:1460-1479（check 引用预检）、statement-summary.ts:36-37、codegen.ts:150,201,254；
- **宿主 API**：code-to-args.ts:89-104（只返回对象槽，位置实参被静默丢弃）、`formatCodeLine`；
- **3d_editor**：`script-store.ts:172-196`（updateStatementArgs 按旧双槽形态重新生成整行）、`:205-240`（removeCodeAt 假设"恰好一个 passthrough 输入"做重接线）、`ScriptEngine.ts:259-280`（collectPartStmtIds 沿 inputs 追溯）、各 feature 的 backfill 链（codeToArgs 消费方）。

失败语义缺口（必须先补齐）：ExprIR 由 JS 引擎求值，表达式内部运行时报错（如 `p0.solid` 中 `p0` 为 undefined）是普通异常，**不是 OpError**，不会被 `runWithFailureHandling`（runtime.ts:864-896）归并为 `ExecutionResult.failedAt`，会穿透 `execute()`。现网 ExprIR 已有此缺口，放开位置实参后暴露面大幅扩大，必须在本方案内修复。

## 2. 目标与非目标

### 2.1 目标

1. 五种顶层调用形态（命名空间调用、解构调用、成员方法调用、本机函数调用 × 赋值/无赋值）的位置实参槽接受**任意合法 JS 表达式**：字面量、参数引用、变量引用、MemberExpression、嵌套 `<ns>.<fn>(...)` 调用、可折叠运算、运行时表达式，以及任意顺序/数量混排。
2. 多个对象实参不再静默覆盖：按位置如实传递（D11 双形态归一仍在 TS 面函数内部，api-contract.md §7.7 不变）。
3. 保持三条架构红线：parse-then-compile（绝不 eval 用户文本）、R13（parser 不改写用户代码，表达式原文切片）、零函数知识（parser 不认识任何函数名）。
4. 依赖图、增量执行、终端判定的正确性在新形态下不退化：表达式实参中的变量引用必须进 refs/deps/statementKey。
5. 表达式运行时错误归并为 `failedAt`，不穿透 `execute()`。

### 2.2 非目标（本轮不做，显式声明）

- **不放开顶层控制流**、不放开 §3 禁止清单中的任何一项。
- **不做一般化的 `const x = <任意表达式>` 值语句**（非调用的顶层赋值语句仍限于参数声明/几何语句/重赋值）。这是通往"完全 JS 子集"的下一步，需单独设计值语句的 DAG 参与规则，不在本方案范围。
- **不放开 args 对象属性值之外的表达式上下文**（return 语句形态、函数体语义均不变）。
- **不引入全局对象白名单**（`Math.max(...)` 等）作为一等支持；`Math` 等未知标识符仍报 E_REFERENCE。若后续需要，作为独立决策另立方案。
- 3d_editor 侧适配只定义接口契约与跟进清单，实施在 faijs CI 全绿后按 3d_editor/CLAUDE.md 流程进行。

## 3. 保留的禁止清单（契约不动部分）

`syntax-design.md` §2.1 Forbidden 表原样保留，一字不改：顶层控制流（E_CONTROL_FLOW）、动态 `import()`（E_IMPORT）、`eval`/`new Function`/`new`（E_SYNTAX，函数体内同）、`export`（E_SYNTAX）、函数体内 import / 顶层 import 不连续（E_IMPORT）、函数体内调用本机函数（E_STATEMENT）、顶层未知本机函数名（E_REFERENCE）、函数重名（E_STATEMENT）。这些即用户所说"明确不支持的特性"，是本方案的唯一拒绝依据——**任何不在此表内的实参形态，parser 不得拒绝**。

## 4. 设计

### 4.0 核心决策一览

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| D1 | 位置实参槽的 IR 形态 | `inputs: PartName[]` **替换为** `positional: ArgIR[]`，不保留双字段 | 单一真源；`inputs` 的"纯净变量引用"语义由 `positional.filter(isVarRef)` 一行派生，不值得为它维护平行结构 |
| D2 | MemberExpression 的 IR 承载 | 扩展 ExprIR 白名单 += `MemberExpression`（含可选链以外的全形态）；嵌套 `<ns>.<fn>(...)` 调用仍走 CallRefIR，不入 ExprIR | CallRefIR 有独立的"只读查询、不消费"语义与发射路径（compile.ts:82-86），两套机制各司其职；`a.b(c)` 这类方法调用表达式归入 ExprIR |
| D3 | 表达式中变量引用的消费语义 | 与 C5 对齐：**引用即消费**。`positional` 内任何形式的变量引用（VarRef / ExprIR.refs / CallRef 递归）都计入 refs，参与 deps、终端判定与 keep 可达集 | 与 args 内引用的现有语义一致，避免"位置不同语义不同"的新坑 |
| D4 | 表达式运行时错误的失败语义 | 编译发射的语句 fn 体整体包 try/catch，非 OpError 异常包装为带语句上下文的 `OpError`（code `E_EXPR`）后重抛，由既有 `runWithFailureHandling` 归并为 `failedAt` | 补 1.4 的失败语义缺口；语句边界错误归属是 cad 脚本面的既有契约（语句边界 unwrap），表达式不应例外 |
| D5 | 多对象实参 | 不做合并、不做报错：每个对象就是一个独立的 `positional` 元素（JsonValue 对象），按位置如实发射 | 位置形态下"第二对象"是合法调用的第二参数，归一职责在 TS 面函数（D11），语言层不越权 |
| D6 | `hasComputedArgs` 语义 | positional 中含 ExprIR / 折叠产物时同样置 true；statement-summary 增加 `positionalKinds` 投影供宿主降级编辑面板 | 宿主（3d_editor 编辑面板）需要知道"这行不能安全回填为表单" |

### 4.1 IR 变更（lang/types.ts）

```ts
export interface StatementIR {
  // ... 其余字段不变 ...
  /** 位置实参槽（原 inputs）。每个元素是一个 ArgIR：
   *  Identifier      → VarRefIR { $ref }
   *  参数名          → ParamRefIR { $param }
   *  Literal         → JsonValue
   *  ObjectExpression→ JsonValue 对象（属性值递归为 ArgIR，与 args 内部规则一致）
   *  <ns>.<fn>(...)  → CallRefIR
   *  其余表达式      → ExprIR（白名单扩展后，D2） */
  positional: ArgIR[]
  args: Record<string, ArgIR>   // 不变：仅当"尾随选项对象"形态存在时填充？——见下
}
```

**args 槽的存废决策**：旧模型中唯一的 ObjectExpression 进 `args`。新模型下尾随对象与中间对象在 AST 层不可区分（都是位置实参），因此**统一进 `positional`**；`args` 字段保留但仅承载引擎内部使用的命名槽（keep/keepHidden 仍从尾随对象的 keep 键解析——keep 指令的提取规则不变：扫描最后一个 positional 元素若为纯对象则取 keep 键）。statement-summary、codeToArgs 等宿主面 API 的投影规则在 §4.6 定义。

### 4.2 parser 改造（lang/parser.ts）

1. **五处实参循环统一为一个 `parsePositionalArg(argNode): ArgIR`**，规则：
   - `Identifier`：已声明参数 → `ParamRefIR`；已声明变量 → `VarRefIR`；未知 → E_REFERENCE（与 args 内现行规则一致）；
   - `Literal` / `TemplateLiteral` / 可折叠运算：先走 `tryFoldConstExpr`，成功 → JsonValue；
   - `ObjectExpression`：递归解析为 JsonValue 对象（属性值复用 args 内部的现有规则：fold → ParamRef/VarRef/CallRef/ExprIR 降级）；
   - `ArrayExpression`：同理递归（含 spread 折叠的现有逻辑）；
   - `<ns>.<fn>(...)` / 本机函数嵌套调用：`CallRefIR`（现有 buildCallRef 逻辑上移复用）；
   - 折叠失败且 ∈ 扩展后白名单：`buildExprIR`（D2，白名单 += MemberExpression）；
   - 其余节点：E_VALUE（如 `function(){}`、箭头函数、`new`、`await` 表达式等——这些属于§3 红线或真正的语义空白，报错是"显式禁止"而非"默认拒绝"）。
2. **ExprIR 白名单扩展**：`isExprWhitelist`（:272-296）增加 `MemberExpression`（computed 与非 computed 均收）；`collectExprIdentifiers`（:359 起）增加 MemberExpression 遍历：沿 `.object` 链走到根 Identifier 收为 ref（`p0.solid` → refs=['p0']；`p0.holes[0].center` → refs=['p0']）。链上出现 CallExpression 时（`a.b().c`）整个表达式仍合法，调用子树照收，标识符收集递归穿透。
3. **refs 收集**：`collectStatementRefs` 的位置槽分支从"inputs 直接计入"改为"positional 逐元素走 `collectRefsFromArg`"（该函数已具备全部递归能力，零新增逻辑）。
4. **ABI 绑定校验**（本机函数，§6.2 positional-plus-named）：位置实参个数校验不变；`validateLocalAbi` 的"位置实参必须可绑定到形参"不再要求 Identifier 形态，只数个数。
5. **删除**：`:713` 的 `args = parsed` 覆盖赋值（静默坑根除）；`:718`、`:856`、`:1686`、`:1750`、`:1791` 的 `unexpected argument type` 报错路径随白名单循环一并删除。

### 4.3 compile 改造（lang/compile.ts）

1. `buildStatementFnBody`（:178-250）：位置实参发射从 `inputs.map(i => ctx.<i>)` 改为 `positional.map(translateArg)`——`translateArg`（:101-118）已支持全部 ArgIR 变体，零新增翻译逻辑。
2. **失败语义（D4）**：发射的 fn 体整体包裹：

```ts
fn: async (ctx, ns) => {
  try {
    /* 原有发射体：ctx.<out> = await ns.<ns>.<callee>(<positional...>, ...) */
  } catch (e) {
    if (e instanceof OpError) throw e   // 语句边界 unwrap 的既有异常原样透传
    throw new OpError(`expression evaluation failed: ${e.message}`, { code: 'E_EXPR' })
  }
}
```

`OpError` 在编译产物内的引用方式：编译产物是零 import ESM（compile.ts:266-344 的硬约束），不能 import OpError——改为 executor 侧包装：`ModuleExecutor.executeIds`（module-executor.ts:243-289）在 `await compiled.fn(...)` 外层 catch，结合 `setCurrentStmt` 已记录的当前语句，把非 BrepUnsupported/MeshUnsupported/OpError 的普通异常包装为 OpError（code `E_EXPR`）重抛。**采纳 executor 侧方案**（发射体零依赖约束不动）。

3. `getStatementRefs`（:135-174）的兜底扫描分支同步扫 positional。

### 4.4 执行器与增量（cad-runtime/module-executor.ts、runtime.ts）

1. **增量 key**：`computeKey`（:593-610）的 args 哈希改为 `JSON.stringify({ positional: withoutKeepDirectives(source.positional), args: withoutKeepDirectives(source.args) })`。ExprIR 可 JSON 化（text+refs+params），表达式文本变化即触发重算；表达式引用的上游变量变化经 deps 的 outputContentKey 传递（compile.ts:605-608 既有机制），前提是 refs 收集正确（§4.2.3 已保证）。
2. **emitBrepLost**（:559-578）：从"按 inputs 取 Shape"改为"按 positional 中的 VarRefIR 取 Shape + ExprIR.refs 中的 Shape"——判定 BREP 链断开只需知道引用了哪些 Shape 变量。
3. **check 引用预检**（runtime.ts:1460-1479）：inputs 遍历改 refs 遍历（refs 是超集，预检更完整）。
4. **legacy statementKey**（runtime.ts:1219-1230）：位置槽按 positional 序列化拼 key。

### 4.5 终端判定与 keep（terminal-dag.ts、keep.ts）

1. **C2 位置下标语义重定义**：`positional[i]` 为 `VarRefIR` 时按下标消费（与现状一致）；为 ExprIR/CallRefIR/字面量时不构成 C2 消费，但其中引用按 D3 计入 C5 类消费。即：**C2 的精确下标语义退化为 C5 的超集**，实现上 terminal-dag 的位置分支改为递归扫描（复用 args 的现有扫描器）。
2. **keep 可达集**（keep.ts:194）：keep 目标集合 = positional 引用 ∪ args 引用（改为 refs 驱动，语义不变）。
3. `validateKeepDirectives`（keep.ts:184-242）的递归扫描器直接复用于 positional。

### 4.6 宿主 API 与 codegen

1. **codegen.ts**（IR→文本打印机）：`statementIRToLine` / `printStatement`（:150-156）的位置槽打印从变量名列表改为 `positional.map(printArg)`——`printArg` 复用 args 属性值的现有打印器（`fmtValue`，:57-73；ExprIR 打印为 `(<原文>)` 保证往返，:66）。往返保真测试：`parse(print(parse(x))) ` IR 等价。
2. **formatCodeLine**（:214-264）：`FormatCodeLineInput.inputs: string[]` → `positional: ArgIR[]`。宿主生成代码时传字面量/变量引用/表达式原文均可。这是 3d_editor 的跟进点。
3. **codeToArgs**（code-to-args.ts:89-104）：现契约"只返回对象槽"在位置形态下静默丢数据（3d_editor backfill 链依赖）。新契约：返回 `{ positional: JsonValue[], args: Record<string, JsonValue> }`，positional 元素中的 ExprIR/VarRefIR 以 strip 后的标记对象呈现（宿主据此降级为只读）；**IR strip 红线不变**（宿主不接触 IR 类型）。
4. **statement-summary.ts**：`inputs` 投影改为 `positional` 的 strip 投影 + `positionalKinds: Array<'literal'|'varRef'|'paramRef'|'call'|'expr'|'object'>`，供宿主判断编辑面板可用性；`hasComputedArgs` 语义按 D6 扩展。

### 4.7 3d_editor 跟进清单（faijs 落地后）

按 3d_editor/CLAUDE.md 流程：faijs CI 全绿 → push → 更新 package.json hash → 实施。

1. `script-store.ts:172-196` updateStatementArgs：按新 codeToArgs 契约回填/回写；位置表达式行降级为代码编辑（沿用 hasComputedArgs 只读降级的既有模式）。
2. `script-store.ts:205-240` removeCodeAt 重接线：判定"恰好一个 passthrough 输入"改为"`positional` 中恰好一个 VarRefIR 且其余无变量引用"；不满足维持现状（throw），但报错信息需含语句行号。
3. `ScriptEngine.ts:259-280` collectPartStmtIds：沿 refs（替代 inputs）追溯。
4. 各 feature backfill（transform/primitive/knurl/fai_split/fai_extrude 等）：适配 codeToArgs 新返回形态。
5. 测试钉扎：`script-engine.test.ts` inputs 断言 6 处、`transform-session.test.ts:245`、`contract-entry.test.ts:56-63,228-229`。

## 5. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 IR + parser | §4.1、§4.2：IR 换字段、五处实参循环统一、ExprIR 白名单扩展、refs 收集、删除静默覆盖 | 新增 parser 测试全绿（§6.1）；存量 parser 测试适配后全绿 |
| P2 compile + executor | §4.3、§4.4：发射、executor 侧失败包装、增量 key、emitBrepLost、check 预检 | 新增 compile/executor 测试全绿；`cad.box(10,20,30)` 与 `cad.box({size:[10,20,30]})` 几何一致的集成测试通过 |
| P3 终端 + keep | §4.5 | terminal-dag / keep 测试全绿（含新形态消费判定用例） |
| P4 codegen + 宿主 API | §4.6 | 往返保真测试、codeToArgs/formatCodeLine 新契约测试全绿 |
| P5 文档 + Agent Note | §7 清单全部落地，`npm run doc-sync` 通过 | doc-sync 12 项门禁绿 |
| P6 CI | 按 AGENTS.md 纪律：先自写测试 → 波及测试 → 全绿后 `pwsh -NoProfile scripts/ci.ps1` | CI 全绿 |
| P7 3d_editor 跟进 | §4.7 | 3d_editor 分层测试按序通过 |

每阶段遵守全局纪律：stderr 零容忍；`symbol-table.generated.ts`、`api.d.ts`、`ops-api-inventory.md` 等生成文件禁手改；代码注释英文、commit message conventional commits（英文）。

## 6. 测试计划

### 6.1 新增测试（P1/P2 核心）

parser 层（`parser.test.ts` / `parser-normalization.test.ts`）：

- `cad.box(10, 20, 30)` → positional = [10, 20, 30]（JsonValue）；
- `cad.box({size:[1,2,3]}, {center:true})` → positional 两个对象元素，**不覆盖不合并**；
- `cad.hem(p0.solid, {kFactor: 0.44})` → positional[0] = ExprIR，refs=['p0']；
- `mech.hem(part0.solid, spec)`（命名空间 + MemberExpression 混排）；
- `cad.box(w * 2, h, d)`（foldable）→ 折叠字面量 + hasComputedArgs；
- `cad.pattern(part0, n > 10 ? 20 : 10)` → ExprIR 运行时表达式；
- `cad.translate(part0, cad.center(part1))` → CallRefIR 嵌套；
- 未知标识符 `cad.box(x)` → E_REFERENCE（不回归）；
- 红线保留：`new Foo()`、箭头函数实参 → E_VALUE/E_SYNTAX（显式禁止而非默认拒绝）。

compile/executor 层（`compile.test.ts`、packages/tests 集成）：

- 位置表达式发射后执行结果 == TS 面直调结果（复用 p23 的跨层等价模式）；
- deps 正确性：`cad.hem(p0.solid, {})` 的 deps 含 p0 的定义语句；p0 重算时 hem 语句级联失效（增量测试）；
- 失败语义：`const h = cad.hem(p0.solid, {})` 在 p0 非数据对象时 → `ExecutionResult.failedAt` 指向 hem 语句，不穿透；
- 多对象实参端到端：位置形态与对象形态几何一致（parity 测试，mesh/brep 双链）。

### 6.2 存量适配

- `expr-ir.test.ts:154-178`：两条白名单边界断言改为断言"MemberExpression 现在收为 ExprIR"；
- `p23-cad-face.test.ts:17-27` 头注释更新（边界已放开）；
- `f1-normalization.test.ts:54,294,324`、`function-def.test.ts:182-197`：inputs → positional 断言迁移；
- `function-def.test.ts:227-245`：ABI 校验断言适配（个数校验保留，形态校验删除）。

## 7. 文档更新清单（P5，与代码同 PR）

1. `docs/syntax-design.md`（+`.zh.md`+`.i18n.yaml`）：§2.3 语句产生式（`<input>*` → `<expr>*`，删除 "positional inputs must be declared variables"）；§2.4 表达式表（ExprIR 白名单 += MemberExpression；新增"位置实参"行）；§3.1 映射表（inputs → positional）；§6.2 ABI 发射形态。
2. `docs/api-contract.md`（+双语配对）：§4 语句模型（positional args + options）；§6.1 C5（引用即消费的精确化）；§7.5 增量 key（positional 入 key）。
3. `docs/library-dev-guide.md`（+双语配对）：§7「脚本面调用矩阵」**整节重写**——位置形态/对象形态/成员表达式在脚本面全部可用；"每个脚本面函数都需要对象形态入口"的推论降级为"对象形态仅作为结构化参数的推荐风格"；"第二对象实参静默覆盖"警告删除（改为按位置传递的如实描述）；`solidOf` 的历史由来加注（终端函数仍保留，但脚本面不再必须）。
4. `docs/ops-api-inventory.md`：生成文件，改生成源后重跑。
5. `.agents/notes/`：新增一篇 Agent Note 记录 D1–D6 决策（非平凡变更的强制要求）。

## 8. 风险与缓解

1. **ExprIR 白名单扩大 = 运行时求值面扩大**：任何表达式 bug 从 parse 期错误变成运行时错误。缓解：D4 的失败包装保证错误归属到语句；parser 对红线节点（new/箭头/await 表达式等）仍显式拒绝。
2. **依赖缺失导致增量不重算**：refs 收集漏一个标识符，上游变更就不会级联。缓解：refs 收集走统一递归器（collectRefsFromArg），新增 fuzz 性质测试——随机表达式实参的 refs 与 acorn 遍历结果对比。
3. **3d_editor 的 codeToArgs 静默丢数据是现存坑**（位置实参本就被丢），本方案把它变成显式契约（§4.6.3）；faijs 落地后 3d_editor 未跟进前，旧行为不破（旧形态脚本仍是新模型的子集：Identifier→VarRefIR、单对象→positional[0]，序列化结果与旧 inputs+args 一一对应）。
4. **存量脚本零迁移**：旧模型产生的所有 `.fai.js` 文本在新 parser 下解析为语义等价的 IR（对象形态 = 单元素 positional），无需 fixture 迁移——这必须在 P1 用全量 fixture 重解析测试钉死。
