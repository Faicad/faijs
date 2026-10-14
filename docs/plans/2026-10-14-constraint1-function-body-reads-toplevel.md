# 约束 1 修复方案：函数体内读顶层变量（读支持 / 写不支持）

> 状态：已实施（2026-10-14，core 全量回归通过）
> 日期：2026-10-14
> 优先级：HIGH
> 方案出处：GLM-5.3-Flash + WorkBuddy

## 1. 需求

用户决定（2026-10-14）：

- 函数体内**支持读**顶层 `const` / `let` 变量和顶层函数（库函数本来就可调用）。
- **不支持**在函数体内写（赋值）顶层变量——赋值落在函数本地绑定，顶层值不变。

典型场景：

```javascript
const SIZE = 5
function mk(d) { return cad.box(SIZE + d, SIZE, SIZE) }
let part = mk(2)   // 期望：产出 7×5×5 的 box
```

当前行为：`SIZE is not defined`（两后端均失败）。

## 2. 当前行为（探针实测）

| 场景 | vm 后端 | interp 后端 |
|---|---|---|
| 函数体读顶层 `const` | `SIZE is not defined` | `SIZE is not defined` |
| 函数体读顶层 `let` | `SIZE is not defined` | `SIZE is not defined` |
| 函数体调用顶层函数 | `helper is not defined` | `helper is not defined` |
| 函数体读顶层 const + 用参数 | `SIZE is not defined` | `SIZE is not defined` |
| 嵌套函数读外层函数局部（D3 闭包） | 正常 | 正常 |
| 递归（函数体调用自身） | 正常 | 正常 |

两后端行为一致：函数体可见绑定 = 参数 + 函数本地 let/const + 命名空间绑定 + S4 安全全局；顶层 ctx 变量/函数不可见。递归和 D3 闭包正常。

## 3. 根因（现状代码事实）

### 3.1 interp 后端

`cad-runtime/interp/env.ts:86`：

```typescript
if (this.kind !== 'function' && Object.prototype.hasOwnProperty.call(this.ctx, name)) {
  return { where: 'ctx', value: this.ctx[name] }
}
```

`this.kind !== 'function'` 条件让 function env 跳过 ctx 查找。function env 的 `this.ctx` 是 `state.host.ctx`（全局 ctx，`interp/closure.ts:47`），lookup 刻意不查它。

`interp/closure.ts:49`：定义环境是 root 时 parent 设为 `undefined`（丢弃 root parent）。这只影响 parent chain 上的 vars 查找；ctx 查找走 `this.ctx`，不经 parent chain。

### 3.2 vm 后端

`cad-runtime/direct-executor.ts:1022-1038` `transformFunction`：

```typescript
const bodyText = code.slice(node.body.start + 1, node.body.end - 1)  // 原始函数体文本
const binds = nsNames.map((n) => `  const ${n} = __ns.${n}`).join('\n')
const body = [
  `__ctx.${name} = async function ${name}(${params.join(', ')}) {`,
  binds,       // const cad = __ns.cad
  bodyText,    // 原始函数体文本（逐字嵌入）
  '}',
].join('\n')
```

`bodyText` 逐字嵌入 `new Function` 作用域，函数体里的顶层变量名（`SIZE`）是自由标识符，解析不到（`SIZE` 在 `__ctx` 上，函数体没有 `__ctx` 引用）。

递归能工作：具名函数表达式的名字（`async function fib(n)` 的 `fib`）在函数作用域绑定到自身。D3 闭包能工作：interp 侧嵌套 closure 的 parent chain 保留外层函数 env；vm 侧嵌套函数文本嵌在外层函数作用域内，天然闭包。

## 4. 目标语义（契约）

| 场景 | 语义 |
|---|---|
| 读顶层 `const` / `let` / 顶层函数 | 支持。**call-time 取当前值**：两次调用之间顶层 `let` 变更，后续调用取新值 |
| 函数体内写顶层名（`SIZE = 20`） | 不写顶层。赋值落到函数本地绑定（新建本地 `SIZE`），顶层不变，同一函数其它调用不受影响 |
| 局部遮蔽 | JS 作用域规则：函数体/嵌套块/嵌套函数声明的同名局部优先 |
| 前向引用（函数定义在顶层声明之前，调用在其之后） | 支持（call-time 解析） |
| 参数默认值引用顶层变量（`function mk(d = SIZE)`） | 不支持（见 §5.5） |

## 5. 修复方案

### 5.1 interp 后端（1 行改动）

`interp/env.ts:86` 去掉 `this.kind !== 'function'` 条件：

```typescript
// 改后：
if (Object.prototype.hasOwnProperty.call(this.ctx, name)) {
  return { where: 'ctx', value: this.ctx[name] }
}
```

function env 的 `this.ctx` 是全局 ctx（`closure.ts:47`），去掉条件后 lookup 解析顺序变为 vars → parent vars → ctx → ns → S4 全局，函数体即获得 call-time 读顶层的能力。

- **不改 `closure.ts:49`**：ctx 查找走 `this.ctx`，不走 parent chain，丢弃 root parent 不影响。
- **不改 `assign`（`env.ts:104-118`）**：function env 赋值写本地 `vars`（`env.ts:105`），天然满足「写不落顶层」。同一调用内先写后读取本地值（lookup 先查 vars），与 vm 一致。

同步更新 `env.ts` / `closure.ts` 模块头注释中「函数体不可见 ctx」的描述。

### 5.2 vm 后端：transformFunction 注入 call-time 解构

在函数体开头注入解构，把函数体引用到的顶层名从 `__ctx` 解构为本地可变绑定：

```typescript
const outerVars = this.collectFnBodyOuterRefs(node, allCtxNames, params, nsNames)
const guards = outerVars.map(
  (v) => `  if (!Object.prototype.hasOwnProperty.call(__ctx, '${v}')) throw new ReferenceError('${v} is not defined')`,
)
const body = [
  `__ctx.${name} = async function ${name}(${paramsText}) {`,
  binds,
  ...guards,
  ...(outerVars.length > 0 ? [`  let { ${outerVars.join(', ')} } = __ctx`] : []),
  bodyText,
  '}',
].join('\n')
```

用 `let` 不用 `const`：函数体内对顶层名赋值时写本地解构变量（不写 `__ctx`），与 interp 的 `assign` 语义一致（两后端都不修改顶层变量）。解构发生在**每次调用时**，天然获得 call-time 快照语义。

**call-time 守卫（hasOwnProperty）**：候选名已入 allCtxNames 但调用时尚未写入 ctx（函数在顶层声明行执行前被调用、块内声明所在块未执行）→ 抛 `ReferenceError('<name> is not defined')`——与 interp 的 ctx miss → ReferenceError（`interp/eval-expr.ts:35` 同文案）对齐，杜绝 vm 静默拿到 `undefined` 继续产几何。

#### 5.2.1 候选全集 allCtxNames（预扫，不能用逐语句累积的 declared）

`parseAndTransform`（`direct-executor.ts`）的 `declared` 是按源码顺序逐语句累积的。若用它过滤，函数定义在顶层声明之前时（前向引用），变换到函数时该名尚未入集 → 漏注入 → vm 调用失败，而 interp call-time 查 ctx 成功 → 双后端分叉。

因此（`collectAllCtxNames`）：

```typescript
const allCtxNames = new Set<string>(Object.keys(this.ctx))
for (const node of nodes) {
  // 递归收集 VariableDeclarator.id 绑定名 + FunctionDeclaration.id；
  // 不下潜函数体（FunctionDeclaration / FunctionExpression / ArrowFunctionExpression）——
  // 函数局部量永不入 ctx（块内声明收：vm 的 hoistBlockText 把块内声明提升写 ctx，
  // interp 的 root env 块级写入同样落 ctx）
}
for (const nsName of nsNames) allCtxNames.delete(nsName)
```

- `Object.keys(this.ctx)` 覆盖 params/imports 预置键（`runCode` 先于 parseAndTransform 预置进 ctx）与 append 场景先前执行的产出键。
- 全 AST 声明名覆盖本脚本的所有 `const`/`let`/function 名，无论与函数定义的先后顺序。
- 变换后逐语句仍维护 `declared`（供 `emitCall` 等既有逻辑使用），互不干扰。

#### 5.2.2 collectFnBodyOuterRefs

```typescript
private collectFnBodyOuterRefs(
  node: ASTNode,
  allCtxNames: Set<string>,
  params: string[],
  nsNames: string[],
): string[] {
  const shadow = new Set<string>(params)
  this.collectFnShadowNames(node.body, shadow)   // 本函数作用域遮蔽集
  const referenced = new Set<string>()
  this.collectFnReferences(node.body, referenced) // 全函数体引用集（含嵌套函数体）
  return [...referenced].filter(
    (v) => allCtxNames.has(v) && !shadow.has(v) && !nsSet.has(v),
  ).sort()
}
```

**遮蔽集 collectFnShadowNames（决定哪些名不注入）**——收集本函数**函数作用域**上声明的名：

- 函数参数。
- 函数体**顶层语句列表**直接声明的 `let`/`const`/`function` 名。
- 所有 `var` 声明名（无论声明在哪个块里——var 是函数级作用域；否则块内 `var SIZE` 与注入的 `let { SIZE }` 会 SyntaxError）。
- 任意块深的 function 声明名（vm 的 new Function 体是 sloppy 模式，块内 function 声明经 Annex B 提升到函数级）。
- **不下潜嵌套函数体**（FunctionDeclaration / FunctionExpression / ArrowFunctionExpression 的 body）：嵌套函数自己的声明只遮蔽它内部，不应阻止外层注入。
- **块级 let/const 不入遮蔽集**：它们是块作用域，与注入的函数级 `let { ... }` 并存是合法遮蔽，语义正确。

不下潜嵌套函数体收集遮蔽名的原因：

```javascript
const SIZE = 5
function mk() {
  const helper = () => { let SIZE = 10; return SIZE }  // 嵌套函数本地遮蔽
  return SIZE + helper()   // 期望 15：外层 SIZE=5，helper 返回 10
}
```

若把嵌套体内的 `let SIZE` 计入 mk 的遮蔽集 → mk 不注入 SIZE → 外层 `SIZE` 解析失败（ReferenceError）。正确做法是注入：mk 级 `let { SIZE } = __ctx`（值 5），helper 内本地 `let SIZE = 10` 只遮蔽 helper 内部。interp 侧无注入、动态查链（mk env 无 SIZE → ctx 取 5），两后端一致得 15。

**引用集 collectReferences**——下潜整个函数体（**含嵌套函数体**），收集引用位置的 Identifier。嵌套函数引用的顶层名注入到外层函数作用域后，嵌套函数经闭包可见——不做逐作用域分析，行为与 JS 闭包一致。

区分声明位置与引用位置的规则（acorn AST）：

| 节点类型 | 排除（声明/绑定位置，不收集） | 收集（引用位置） |
|---|---|---|
| VariableDeclarator | `.id`（含 Pattern 展开） | `.init` |
| FunctionDeclaration | `.id`、`.params` | `.body` |
| FunctionExpression / ArrowFunctionExpression | `.params` | `.body` |
| Property（对象字面量） | `.key`（shorthand=false 且 computed=false） | `.value`；shorthand=true 时 `.key` 同时是引用；computed=true 时 `.key` 是引用 |
| MemberExpression | `.property`（computed=false） | `.object`；computed=true 时 `.property` |
| AssignmentPattern | `.left` | `.right`（默认值表达式） |
| ArrayPattern / ObjectPattern / RestElement | 模式内绑定位置 | —（模式内默认值 `.right` 按 AssignmentPattern 处理） |
| ForStatement / ForInStatement / ForOfStatement 头部声明 | 绑定名 | 初值/右侧/循环体 |
| CatchClause | `.param` | `.body` |
| LabeledStatement / BreakStatement / ContinueStatement | label | — |

经典坑必须有测试钉住：`return { SIZE }` 的 shorthand 属性是引用；`{ SIZE: 1 }` 的 key 不是。

**赋值目标也收集**：函数体内的 `SIZE = 20` / `SIZE++` / 解构赋值目标——不注入的话，vm sloppy 模式会给未声明标识符赋值创建隐式全局（比 ReferenceError 更糟），必须注入让赋值落到本地解构变量。

#### 5.2.3 同名冲突处理

```javascript
const SIZE = 5
function mk() { let SIZE = 10; return cad.box(SIZE, SIZE, SIZE) }
```

`SIZE` 在 mk 顶层语句列表声明 → 进遮蔽集 → 不注入 → 函数体 `SIZE` 解析到本地 `let SIZE = 10`。局部遮蔽全局，正确。

```javascript
const SIZE = 5
function mk() { return cad.box(SIZE, SIZE, SIZE) }
```

`SIZE` 不在遮蔽集 → 注入 `let { SIZE } = __ctx` → 正确读到 5。

递归自名（`fib` 在 allCtxNames 里）：注入 `let { fib } = __ctx`，call-time `__ctx.fib` 已是函数自身，递归语义不变（测试钉住）。

#### 5.2.4 函数体直接作用域的 await 注入（约束 1 配套）

函数体文本逐字嵌入后，其内部调用**从不注入 await**——vm 里 `fib(n-1) + fib(n-2)` 拿到的是 `Promise + Promise`（`"[object Promise][object Promise]"`），而 interp 的 `evalExpr` 原生 await。这是函数体调用语义的既有缺陷（旧测试只断言不失败、未比对值，未暴露）；「函数体调用顶层函数」契约要成立必须补齐：

`collectFnAwaitEdits`（AST 定位 + 偏移插入 `await `，右→左保持偏移有效）：

- 资格：callee 是 Identifier 且在 allCtxNames（顶层本机函数），或 callee 是 MemberExpression 且 object 是命名空间名（`cad.box` 等）。
- 覆盖函数体直接作用域的全部调用位置（数组元素、实参、模板、二元等）+ **参数默认值表达式**（签名区与体区偏移分开插入）。
- 已显式 `await` 的调用不重复注入（其参数里的调用仍递归处理）。
- **不下潜嵌套函数**：嵌套 sync function 体内 await 是 SyntaxError；嵌套函数内的调用维持既有行为（VM 不 await / interp await——见 §5.5 例外）。

#### 5.2.5 形参保留源文（默认值不剥离）

`transformFunction` 原先只取 `p.name` 拼签名，会把默认值静默剥离（`d = SIZE` 变成 `d`）。改为按源文切片拼签名（`code.slice(p.start, p.end)`）：字面量默认值真实生效；默认值引用顶层变量在 call 时 ReferenceError（默认值先于注入解构求值），与 interp 的 E_UNSUPPORTED_SYNTAX 同为失败（§5.5）。

#### 5.2.6 unit.refs 维持空（设计决定）

`transformFunction` 返回的 `refs` 维持 `[]`。`refs` 仅供 append 前置校验（`missingPrefixVar`）对「尚未执行单元」做静态检查；函数体引用是 call-time 解析，若计入 refs，append 场景下「函数体引用同批后文才声明的变量」会被静态误拒（call-time 本可成功）。缺失引用在调用时以 ReferenceError 暴露，两后端一致。

### 5.3 函数体内写顶层名（两后端现状即满足，不改代码）

| 后端 | `SIZE = 20` 在函数体内 | 顶层 `SIZE` |
|---|---|---|
| interp | function env `assign` 写本地 `vars`（`env.ts:105`） | 不变 |
| vm | 写本地解构变量（`let { SIZE }` 可写） | 不变 |

同一调用内先写后读，两后端都取本地值 20；其它调用与顶层读取仍取原值。差分测试钉住（§7 用例 7）。

### 5.4 双后端一致性

| 场景 | interp | vm | 一致 |
|---|---|---|---|
| 读顶层 const | call-time 查 ctx | call-time 解构 `__ctx` | ✅ |
| 读顶层 let | 同上 | 同上（call-time 取当前值） | ✅ |
| 调用顶层函数 / 前向引用 | call-time 查 ctx | call-time 解构 + allCtxNames 预扫 | ✅ |
| 局部遮蔽（函数级/块级/嵌套函数级） | vars → ctx 查链 | JS 作用域规则 + 遮蔽集过滤 | ✅ |
| 写顶层名 | 写本地 vars | 写本地解构变量 | ✅ |
| 参数默认值引用顶层变量 | E_UNSUPPORTED_SYNTAX（非 Identifier 参数，`closure.ts:56`） | ReferenceError（默认值先于注入解构求值） | 都失败，错误形态不同（见 5.5） |

### 5.5 参数默认值（既有差异边界）

interp 对非 Identifier 参数一律抛 `E_UNSUPPORTED_SYNTAX`（`closure.ts:51-58`），即完全不支持默认参数（含字面量默认值 `function mk(d = 5)`）；vm 保留参数源文（§5.2.5），字面量默认值可用。这是**既有差异**，本方案不改 interp。

默认值引用顶层变量的场景：vm 中默认值求值先于注入的解构（函数体作用域之前）→ ReferenceError；interp 抛 E_UNSUPPORTED_SYNTAX。两后端都失败 → 负面差分测试钉住「都不成功」。默认值**调用**顶层函数（`d = helper()`）：vm 经 §5.2.4 注入 await 后可用，interp 仍抛 E_UNSUPPORTED_SYNTAX——属上述既有差异的延伸，不在本方案对齐。

## 6. 影响面

### 6.1 语义契约更新点

- `interp/env.ts`、`interp/closure.ts` 模块头注释：函数体可见绑定描述（call-time 读 ctx、写本地）。
- `direct-executor.ts` 模块头注释：顶层函数提升条目补外层引用注入与 await 注入。
- `docs/library-dev-guide.zh.md` / `docs/library-dev-guide.md` §4.5 第 1、2 条：约束 1 改为「支持读、不支持写」+ 函数体直接作用域 await 契约。
- `docs/language-design.md` §6.2 描述的是模块编译路径 ABI（`(__ctx, __ns, …)` 形态），不涉及 DirectExecutor 函数体语义，无需改动。

### 6.2 增量执行

函数解构是 call-time 读 `__ctx`：顶层 `let` 变更后引擎重放相关行，函数调用取新值。vm 的注入在 parse 阶段完成、与执行顺序无关（allCtxNames 全集预扫保证前向引用也不漏）。两后端一致。

### 6.3 现有测试

已搜证（`packages/core/test` 无函数体读顶层变量的负面用例）：无测试钉住当前 `is not defined` 行为，无删除负担。现有函数测试（`mk(d)`、`fib(n)`、`adder(base)`）不引用顶层变量，不受影响。`exec-backend-diff.test.ts` 的 `runBoth` 助手（`:42`）直接复用。

## 7. 测试计划（已实施）

新增 describe（`packages/core/test/cad-runtime/exec-backend-diff.test.ts`，复用 `runBoth`），11 条用例：

1. **读顶层 const**（§1 典型场景）：两后端成功，`keys`/`fp` 一致。
2. **读顶层 let + 调用间变更**：`let a = mk(); W = 8; let b = mk()`——call-time 快照语义，fp 一致且含 2 个不同 content key。
3. **调用顶层函数（调用者定义在被调用者之前）**。
4. **前向引用顶层 const**：函数定义在 `const SIZE` 之前、调用在其之后。
5. **函数级局部遮蔽**：函数体 `let SIZE = 10`。
6. **嵌套函数本地遮蔽不误伤**：`SIZE + helper()` = 15。
7. **块级遮蔽不阻止注入**：未执行分支的块内声明不影响注入值的读取。
8. **对象 shorthand**：`return { SIZE }`（引用收集正确）。
9. **函数体内写顶层名**：同调用内可见本地值（box 20×1×1）、顶层不变（`q` 直接断言为 5、box 5×1×1）——fp 一致 + 逐后端 `ex.ctx.q === 5`。
10. **递归 + 解构自名**：`fib(10)` 组合运算 fp 一致（此用例暴露并钉住 §5.2.4 的 await 既有缺陷）。
11. **参数默认值引用顶层变量**（负面）：两后端都 `failedAt`。

回归：core 全量（345 文件 / 3857 tests）通过后跑 `scripts/ci.ps1` 一次。

## 8. 实施步骤（已全部完成）

1. interp：`env.ts:86` 去掉 `this.kind !== 'function'` 条件，同步改 `env.ts` / `closure.ts` 模块头注释。
2. vm：`parseAndTransform` 增加 allCtxNames 预扫（§5.2.1）→ `collectFnShadowNames` + `collectFnReferences`/`walkFnPattern` + `collectFnBodyOuterRefs`（§5.2.2）→ `transformFunction` 注入守卫 + `let { ... } = __ctx`（§5.2）→ `collectFnAwaitEdits` await 注入（§5.2.4）→ 形参保留源文（§5.2.5）。
3. 差分测试先行（§7），全绿后跑 core 全量回归。
4. 文档更新（§6.1）。

## 9. 待确认项

1. **参数默认值的既有差异**（vm 支持默认参数 / interp 一律抛 E_UNSUPPORTED_SYNTAX）：本方案不处理，是否另行对齐待定。
2. **嵌套同步函数内的调用不注入 await**（§5.2.4 例外）：VM 产出未决 Promise / interp await——既有行为维持，是否对齐待定。
3. 顶层变量读写语义已按用户决定固化：**读支持（const/let 一致，call-time 取值）、写不落顶层（写本地）**。若后续要支持函数体写顶层变量，需改 interp `assign`（root 直写）+ vm 解构改直写 `__ctx.<name>`，另立方案。
