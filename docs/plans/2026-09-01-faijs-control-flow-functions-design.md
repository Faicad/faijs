# faijs 控制流放松：条件表达式 + 子函数（函数定义）技术实现方案

- 日期：2026-09-01
- 状态：**方案（未实施）**；已按评审意见修订（v1.1，见 §14 评审意见处置）
- 上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）、`docs/plans/2026-08-16-faijs-evolution-roadmap.md`（v2/v3 演进方向）
- 相关文档：`docs/syntax-design.md`、`docs/api-contract.md`、`docs/plans/2026-08-29-faijs-module-runtime-plan.md`（A1 实施来源）
- 代码基线：faijs monorepo（root `C:\my\Faicad\faijs`），当前版本见各包 `package.json`

---

## 1. 需求与背景

### 1.1 用户原话（逐字）

> 我想放松对faijs的语法限制，支持条件表达式，支持函数定义。任何循环和分支必须包裹在这些语法块里。顶层仍然是线性执行流程。

### 1.2 需求解读（normative）

1. **放松 R10「无控制流」为「顶层无控制流」**：控制流不再全局禁止，而是被限定到新的语法块（子函数）内部。
2. **新增两类能力**：
   - **条件表达式**：三元 / 逻辑表达式可作为**值**出现在任何位置（重点是顶层语句的 args 中，运行时求值，不再要求编译期静态折叠）。
   - **函数定义（子函数）**：`function <name>(<params>) { <body> }`，**循环（for/while/do）与分支语句（if/else/switch）只允许出现在函数体内部**。
3. **顶层永远是线性执行流程（§0 不变量，永久）**：顶层不出现控制流*语句*，一行一语句、DAG 可推导的性质保持不变；条件表达式是*值*不是*语句*，不破坏线性。
4. 「任何循环和分支必须包裹在这些语法块里」的精确语义：
   - **循环语句、分支语句**（`if` / `for` / `while` / `switch` / `do` 等）→ 只允许出现在**函数体内**。
   - **分支表达式**（三元 `?:`、逻辑 `&&` / `||` / `??`）→ 是值不是语句，允许出现在**任何表达式位置**（含顶层 args），因此不违反「顶层线性」。

### 1.3 与既有路线图的对齐

`2026-08-16-faijs-evolution-roadmap.md` 已明确 v2/v3 方向，本方案是其落地：

| 路线图条款 | 原文要点 | 本方案落点 |
|---|---|---|
| §0 不变量 | 顶层永远顺序执行；循环、分支等控制流只存在于函数内部 | 顶层拒绝控制流*语句*；函数体放行 |
| v2 §2「子函数引入」 | 控制流只允许出现在子函数内部；函数调用是整体执行单元；顶层保持扁平 | 函数调用=整体执行单元（§6.1） |
| v2 §2「多返回值」 | `return { front, back }` / 解构消费 | 本机函数支持解构消费（§3.4） |
| v3 §2「子函数」 | 参数位置绑定，具名 options 对象照旧 | 调用约定与 `cad.<op>(input, {args})` 一致（§3.4 / §3.6 ABI） |
| §3.5「增量执行边界」 | 顶层永远增量；函数整体重放；函数重放失败=整体失败 | §6.1 / §6.3 |

> ⚠️ 路线图 v2 原文把「表达式赋值」也列为函数体内的控制流形态；本方案进一步把**条件表达式**提升为顶层可用的*值*（§3.3），这是对路线图的直接细化，不冲突。

### 1.4 现状基线（客观事实）

| 事实 | 位置 | 结论 |
|---|---|---|
| 顶层函数定义已解析为 `FunctionDefIR`（函数名/形参/函数体原文切片），**函数定义不是几何语句，不进 statements** | `parser.ts:862-893`（`parseFunctionDeclaration`）、`types.ts:199-206` | A1 已落地「解析 + 往返」 |
| 函数体仍受与顶层相同的控制流黑名单约束 | `parser.ts:899-938`（`validateFunctionBody`） | 现状：函数体内 `if` → `E_CONTROL_FLOW` |
| 控制流黑名单 `CONTROL_FLOW_TYPES`（if/for/while/do/switch/try/throw/break/continue/labeled/with） | `parser.ts:761-766` | 顶层与函数体统一拒绝 |
| 条件/逻辑/二元表达式目前**只允许静态折叠**（仅引用参数/字面量）；引用语句变量 → `E_VALUE` | `parser.ts:143-248`（`tryFoldConstExpr`）、`parser.ts:372-391` | 运行时条件表达式尚未支持 |
| **函数目前不参与执行**：`script.functions` 在 cad-runtime 无消费路径；`compileToModule` 不发射函数 | `compile.ts:215-265`（grep `\.functions` 仅 codegen/parser/测试命中） | 函数是「死代码」，只存原文往返 |
| 编译产物 = 零 import ESM，每条语句一个 `{ id, deps, fn: async (ctx, ns) => {} }` | `compile.ts:215-265`、`module-executor.ts:52-72` | 函数需并入此模块结构 |
| 语句执行前 `setCurrentStmt(source)`，库函数体 `keep()` 登记到当前语句 | `module-executor.ts:210`、`runtime-state.ts` | 函数体内嵌套 `cad.*` 的内部 keep 会污染外层语句（需隔离，见 §5.5） |
| statementKey = `ns.callee | JSON(args 剥离 keep) | deps 的 outputContentKey` | `module-executor.ts:502-515` | 本机函数调用需新的 key 前缀 + 函数体哈希（§6.2） |
| `check()` 符号检查只认 cad 符号表 + 已注册库；本机函数无法通过 | `runtime.ts:1273-1306` | parse 期拦截后无需扩展（§8） |
| `derivePartName` 对**整段代码文本**词法扫描 `\bpart(\d+)\b` | `allocate-id.ts:103-110` | 函数体内的 partN 会污染命名（§7.1） |
| **BREP 句柄是值承载的**：shape 值在身份槽（getSlot）携带 solid；语句执行后 `afterStatement` 按**输出变量**提取写入 `solidCache[partName]` | `module-executor.ts:390-418`（`afterStatement`） | 函数体内中间体的句柄不进 solidCache（§5.6 需定义释放） |
| BREP 分派基于**值级** `hasBrep(input)`，不依赖语句 | `backend-dispatch.ts:67-118`（`dispatchPath`） | 函数体内 `cad.*` 的 mesh/brep 分派无需语句上下文，零改动可用 |
| OCCT 内核句柄用**显式 `kernel.release`**，无 FinalizationRegistry 自动回收 | `occtKernel.ts`（`meshesToStep` 的 finally 模式）、`runtime.ts:1373-1385`（dispose） | 函数体内瞬态句柄如不显式释放即泄漏（§5.6） |
| 顶层 `var` 拒绝；函数体 `var` **现状允许**（`validateFunctionBody` 不检查 VariableDeclaration） | `parser.ts:1140-1143`（顶层）、`parser.ts:899-938`（函数体不查） | §3.1 需更正（见 D12） |
| 顶层支持裸重赋值 `part0 = cad.op(...)` | `parser.ts:1245-1280` | 本机函数调用需同样支持重赋值形态（§3.4 / 遗漏 4） |

### 1.5 非目标（本方案不做）

- `export function` / 函数导出为库（保留 `export` 拒绝，延后到「脚本内库」模型成熟）。
- **函数体内调用其他本机函数（含递归 / 互递归）**——v1 明确禁止，理由见 §3.2 / §10 D10；这是 ABI 冲突的主动收窄，非遗漏。
- 参数声明右侧任意表达式（`const r = n > 0 ? 1 : 2`，roadmap O3 延后项）——`ParamDef` 模型（type/value/default）依赖字面量，本方案只放行**调用 args 内**的条件表达式。
- 函数体内 `keep()` / `keepHidden()` 声明（v1 用调用点 keep 表达保留，见 §5.5 / §10 D5）。
- 函数体引用预检深度校验（v1 只做语法门禁 + 调用点级符号/引用检查；函数体内引用的深度检查列为可选增强，§8）。
- 沙箱 / 多版本 / 运行时 ModuleResolver（既有延后项）。

---

## 2. 设计原则（不可协商红线）

| # | 原则 | 含义 |
|---|---|---|
| **P1** | **顶层永远线性** | 顶层不出现控制流*语句*；「一行一语句」DAG、canvas/timeline 推导（R10/R12）保持不变 |
| **P2** | **函数体是控制流的唯一合法位置** | 循环与分支语句只允许在函数体内；函数调用 = 整体执行单元，函数体对引擎**不透明**（与库函数体同构，R8「op 即函数」） |
| **P3** | **零函数知识不变** | 引擎不解析、不分类函数体；函数体是「acorn 语法门禁 + 子集白名单 + 原文嵌入」的宽松单位（类比 faqts 整模块通道的既有先例） |
| **P4** | **内容寻址** | 函数体文本哈希（bodyHash）进入 statementKey：编辑函数体 → 调用语句 key 变 → 下游失效重算 |
| **P5** | **安全红线不变** | `eval` / `new Function` / 动态 `import()` / 函数体内 `import` 声明 / `export` / `class` 一律拒绝 |
| **P6** | **禁止运行时回退** | 函数重放失败 = 整体失败（`failedAt`），不存在「保留函数内前 k-1 步」的降级（对齐 roadmap §3.5） |
| **P7** | **函数内不产生新调用面** | 函数体只能调 `cad.*` / `<ns>.*`（命名空间 op，ABI 由各 op 自定）；**不能调本机函数**（顶层 ABI 与 verbatim 函数体语义冲突，见 §10 D10） |

---

## 3. 语法契约

### 3.1 允许 / 禁止总表（放松后）

| 形态 | 顶层 | 函数体内 |
|---|---|---|
| 顶层 `import`（模块声明） | ✅ | ❌（`E_IMPORT`） |
| 顶层函数定义 `function f(p) { … }` | ✅（非几何语句，不进 statements） | ✅（嵌套函数） |
| **循环语句**（for/for-in/for-of/while/do-while） | ❌ `E_CONTROL_FLOW` | ✅ |
| **分支语句**（if/else/switch） | ❌ `E_CONTROL_FLOW` | ✅ |
| **条件表达式**（三元 `?:`、逻辑 `&&`/`||`/`??`，引用变量） | ✅（args 值内，运行时求值） | ✅（普通 JS） |
| 二元/一元/比较/等式表达式 | ✅（引用变量时运行时求值；纯参数/字面量仍静态折叠） | ✅ |
| `try`/`catch`/`throw`/`break`/`continue`/`labeled`/`with` | ❌ `E_CONTROL_FLOW` | ✅（with 除外，始终禁） |
| **本机函数调用** `myFn(input, {args})` | ✅（新增四形态，§3.4） | ❌（v1 禁止体内调用兄弟本机函数，见 §3.2 / D10） |
| 动态 `import()` / `eval` / `new Function` | ❌ | ❌（安全红线） |
| `export` / `class` | ❌ | ❌ |
| `var` | ❌ | ✅（**现状即允许**——`validateFunctionBody` 不检查 var，见 D12） |
| `keep` / `keepHidden`（调用点） | ✅ | ✅（函数体调用点等价；函数体**内**的 keep() 见 §5.5） |

> 说明：`with` 始终禁止（严格模式非法）；顶层 `var` 维持拒绝（O2 延后项）。

### 3.2 子函数定义（函数定义）

```
function <name>(<param>, ...) { <body> }
```

- 形参：位置绑定，仅简单 `Identifier`（与现状 `parseFunctionDeclaration` 一致）；禁止解构/默认值/rest 形参。
- 函数体：**任意控制流**（if/else/switch/for/while/do/break/continue/try/catch/throw/labeled）、局部 `let`/`const`/`var` 声明、条件表达式、嵌套函数、任意 `return` 值（Shape / CompoundShape / 数组 / 对象 / 标量）。
- 函数体内的 `cad.<op>(...)` / `<ns>.<fn>(...)` 调用照常执行并产生几何，但**不进 DAG、不参与终端判定**（函数体不透明，P2）。
- **函数体内禁止调用其他本机函数（含递归 / 互递归）**（P7 / D10）：
  - 顶层调用 ABI 是「位置实参 → 前 N 形参 + args 对象按键注入剩余形参」（§3.6）；函数体是 **verbatim 原文**，无法复用该 ABI——函数体内写 `gear(part0, { n: 3 })` 的语义是普通 JS 位置调用，`{ n: 3 }` 只会整体落到第二个形参，与顶层发射不一致（顶层会按形参名把 `n` 拆开）。
  - 函数体内裸 callee 调用 → parse 期 `E_STATEMENT`（明确报错）。递归同理不可达。
  - v2 若开放，需先定义「函数体内调用 ABI」（普通 JS 位置语义，或再走一层编译），不在 v1 范围。
- 仍禁（安全红线，P5）：`eval` / `new` / 动态 `import()` / `import` 声明（函数内）/ `export` / `class` / `with`。
- 函数声明**提升**：可被其后的顶层语句调用（JS 语义）；但因 D10，不存在互递归。

### 3.3 条件表达式

作为**值**出现，编译为运行时表达式，由 JS 引擎求值：

```js
let part0 = cad.box({ size: n > 10 ? 20 : 10 })            // 条件表达式引用顶层参数
let part1 = cad.translate(part0, { offset: cond && hide ? [0,0,0] : [0,1,0] })
let part2 = cad.box({ size: [w, h, r * 2 + 1] })           // 引用变量的数组参数
let part3 = cad.fillet(part1, { radius: pick(r) })         // 嵌套调用仍走 CallRefIR
```

- **语法门禁范围（v1 白名单文法）**：`Literal` / `Identifier`（声明过的参数或顶层变量）/ `UnaryExpression` / `BinaryExpression` / `LogicalExpression` / `ConditionalExpression` / **`ArrayExpression`（元素递归走白名单）** / **`ObjectExpression`（属性值为白名单，键为字面量）**。**不含** `CallExpression`（嵌套调用继续走既有 `CallRefIR`）与 `MemberExpression`。
  - 即 `[w, h, r * 2 + 1]`、`{ x: 1, y: off }` 这类数组/对象字面量内含引用变量的表达式**合法**；`cad.faceCenter(part0)[0]`（调用/成员）不在白名单 → `E_VALUE`。
- 纯参数/字面量表达式维持现状**静态折叠**（行为不变）；**仅当**折叠失败（引用了语句变量）才降级为 `ExprIR` 运行时求值——最小行为变更。
- 语句标记 `hasComputedArgs: true`（宿主把该参数编辑面板降级为只读/代码编辑，防表达式丢失，既有语义）。
- 顶层「一行一语句」不变：条件表达式是值，不是语句。
- **ExprIR 求值结果允许为非 JSON 值（含 Shape）**：args 槽收到 Shape 值时原样传给 op，op 自行校验参数（与既有 cad 调用一致）；引用的 Shape 变量按 C5 参与消费判定（见 §4.3 / 遗漏 5）。注意顶层位置实参仍只接受裸变量（§3.6），因此顶层「条件选择几何」通常出现在函数体内（普通 JS）或经 args 槽位表达。

### 3.4 顶层语句形态扩展

在既有形态（赋值 / 解构 / 成员调用 / 无赋值调用 / **裸重赋值** `part0 = cad.op(...)`，`parser.ts:1245-1280`）基础上，新增**本机函数调用**（callee 为裸标识符）：

```
stmt     = ... | let <id> = <localFn>(<input>*, { <k>:<v>, ... }?)
         | <id> = <localFn>(<input>*, { ... }?)            // 既有变量重赋值（新增）
         | const { <k1>: <id1>, ... } = <localFn>(<input>*, { ... }?)
         | <localFn>(<input>*, { ... }?)                   // 无赋值调用（副作用）
```

- `<localFn>` = 脚本内已声明的函数名（**裸标识符 callee**，区别于 `<ns>.<callee>`）。
- 调用约定与 `cad.<op>(...)` 一致：位置实参必须是已声明变量 → `inputs`；尾部对象 → `args`（可省略）；`[await]` 可选并剥离；解构消费多返回值：
  ```js
  function makeGear(count, pitch) { /* 循环生成齿 */ }
  let part0 = cad.box({ size: 20 })
  let part1 = makeGear({ count: 8, pitch: 5 })          // 无位置输入，标量走 args 对象
  let part2 = pattern(part0, { count: 6 })              // 位置输入 + args
  part2 = pattern(part2, { count: 3 })                  // 既有变量重赋值
  const { front: part3, back: part4 } = splitFn(part2, { mode: 'x' })
  ```
- **未知函数名 → parse 期 `E_REFERENCE`**（解析器知道脚本内函数集，最早报错；`check()` symbol 阶段不重复，见 §8）。
- **ABI 绑定契约**（与 §5.2 / §5.3 三处统一，写进 `docs/syntax-design.md`）：

  > 设函数形参表 `[p1..pk]`，调用 `myFn(a1..aM, { key1: v1, ... })`：
  > 1. 位置实参 `a1..aM` 按序绑定 `p1..pM`（**M ≤ k**，超出 → `E_ARG`）；
  > 2. 尾部对象键绑定**剩余形参** `p_{M+1}..p_k`（按名）；**键不在形参表 → `E_ARG`**；**键已被位置实参占用 → `E_ARG`**；
  > 3. 未被绑定的形参（位置未填、对象未给）→ 函数体内为 `undefined`（JS 语义，不报错）；
  > 4. `keep`/`keepHidden` 键先剥离（既有机制），不参与形参校验。

### 3.5 终端语义（不变式）

- 本机函数调用语句是普通 DAG 节点：`inputs` / `args`（含 ExprIR refs）/ `outputs` 照常参与 `consumes()` 判定（C0/C1 调用点 keep → C3 全非几何输出 → C5 默认消费）。
- 函数体内部的中间变量、函数体对 `cad.*` 的内部 keep，**一律不进入**顶层 DAG（隔离机制见 §5.5）。
- 显式 `return [...]`（顶层）优先级不变；本机函数返回的 `{ front, back }` 经解构成为两个顶层变量。

### 3.6 本机函数调用 ABI 总约定

| 项 | 约定 |
|---|---|
| 用户签名 | `function <name>(<p1>, …, <pk>)`，形参全为简单标识符 |
| 包装器签名（编译产物内） | `async function <name>(__ctx, __ns, <p1>, …, <pk>)`（用户形参原文追加在 `__ctx`/`__ns` 之后） |
| 顶层调用 | `myFn(a1..aM, { key1: v1, … })` |
| 位置实参 → 形参 | `a1..aM` 按序 → `p1..pM`；M > k → `E_ARG` |
| args 对象 → 形参 | 键 → `p_{M+1}..p_k`（按名）；未知键 → `E_ARG`；与位置占用冲突 → `E_ARG` |
| 未绑定形参 | `undefined`（JS 语义） |
| keep 键 | 先剥离，不参与校验 |
| 发射形态 | `await <name>(ctx, ns, <pos1>, …, <posM>, <v1>, …, <vL>)`（形参序） |
| 函数体内本机调用 | **禁止**（`E_STATEMENT`，D10） |

---

## 4. IR 扩展

### 4.1 `FunctionDefIR` 扩展（`types.ts:199-206`）

```ts
export interface FunctionDefIR {
  name: string
  params: string[]
  /** 函数体原文（含控制流；花括号内切片，与现状一致） */
  body: string
  /** 函数体文本的稳定哈希（P4 内容寻址；statementKey 用） */
  bodyHash: string
  /** 函数体在原始代码文本中的 [start, end) 区间（parser 用 acorn 坐标；宿主命名/高亮用） */
  bodyRange?: { start: number; end: number }
}
```

- `bodyHash`：确定性哈希（如 FNV-1a 32-bit 十六进制，L0 零依赖即可实现，无需 crypto——增量失效无需抗碰撞）。
- `bodyRange`：供 `derivePartName` 排除函数体（§7.1）与宿主编辑器使用。
- **parse 期查重**：`parseFunctionDeclaration` 在 `functions` 中查同名，已存在 → `E_STATEMENT`（「函数重复定义」；避免 `localFns` 发射与 bodyHash 按名查表的行为不确定，见遗漏 3）。

### 4.2 `StatementIR` 扩展（`types.ts:89-127`）

```ts
export interface StatementIR {
  ...
  /** 本机函数调用：callee 是脚本内函数名（区别于命名空间调用）。缺省 = 命名空间调用。 */
  local?: boolean
}
```

- `local: true` 时 `namespace` 缺省，`callee` 即函数名。不引入魔法命名空间 token（如 `$local`），保持 IR 语义直白。
- 解析路径：赋值 / **重赋值** / 解构 / 无赋值四形态，在「callee 为裸 Identifier 且 ∈ 函数集」时走 `local` 分支（§3.4）。
- `stmt.refs` 照常收集（inputs + args 内 $param/$ref/ExprIR refs + receiver），deps 编译不变。

### 4.3 `ArgIR` 扩展：运行时表达式 `ExprIR`（`types.ts:52`）

```ts
export interface ExprIR {
  /** 运行时表达式：语义=由 JS 引擎求值，不做编译期折叠 */
  $expr: {
    /** 表达式原文（acorn 坐标切片；语法门禁已过） */
    text: string
    /** 引用的顶层变量名（VarRef 语义 → deps / terminal 消费判定） */
    refs: string[]
    /** 引用的参数名（ParamRef 语义 → deps；参数本身是 ctx 键） */
    params: string[]
  }
}
export type ArgIR = JsonValue | ParamRefIR | VarRefIR | CallRefIR | ExprIR
```

- **不存 AST、不重写文本**：存 `text` + 引用名集合。编译期用「箭头包装」发射（§5.4），无需 mini-printer、无需对用户文本做任何改写（R13 保持）。
- 类型守卫 `isExprRef(arg)` 与 `isParamRef` 等并列（`types.ts:61-81`）。
- 依赖收集：`collectRefsFromArg`（`parser.ts:719-741`）、`getStatementRefs`（`compile.ts:121-155`）、`consumes()`（`terminal-dag.ts:76-98`）、`validateKeepDirectives` 扫描（`keep.ts:195-210`）四处的递归遍历需识别 `$expr`，把 `refs`/`params` 并入。
- **ExprIR 值语义（允许非 JSON / Shape）**：`$expr` 求值结果**不限制为 JSON 值**——白名单内 `Identifier` 可引用 Shape 变量，求值可得到 Shape。语义：
  - args 槽收到 Shape 值 → 原样传给 op，op 自行校验参数（与既有 cad 调用对非标量参数的行为一致，op 是最终裁判）；
  - `$expr.refs` 已并入 `stmt.refs` → 被引用的 Shape 变量按 C5 参与消费判定（该语句「使用」了它）；
  - `hasComputedArgs = true` 不变。
  - 边界：这是 feature 而非错误；「条件选择几何」的完整表达（`let g = cond ? cad.box(...) : cad.sphere(...)`）在**函数体内**以普通 JS 完成，顶层 ExprIR 只能把 Shape 送进接受它的 args 槽。
- 嵌套调用（`cad.faceCenter(part0)` 等）**不进入** ExprIR 文法（v1），继续由 `CallRefIR` 表达——条件表达式中出现调用/成员 → `E_VALUE`（明确报错，不静默）。

---

## 5. 编译（compile.ts）

### 5.1 模块结构扩展

编译产物从 `export const statements = [...]` 扩展为：

```js
export const statements = [ ...既有语句... ]
export const localFns = { makeGear, pattern, splitFn, ... }   // 或直接模块级函数声明
```

- `compileToModule(script)`（`compile.ts:215-265`）在 statements 之前发射全部 `FunctionDefIR`（按源码顺序）。
- 函数体原文嵌入模块（语法门禁后，P3/P5）；`localFns` 映射供语句 fn 调用。

### 5.2 子函数编译与命名空间绑定（ABI 方案 A）

```js
// 用户签名：function makeGear(count, pitch) { ... }
async function makeGear(__ctx, __ns, count, pitch) {
  const cad = __ns.cad
  const mech = __ns.mech            // 顶层 import 绑定名逐个绑定
  <用户函数体原文>
}
```

- **包装器形参 = `(__ctx, __ns, ...用户形参名)`**：用户形参**逐个、按名**成为包装器形参（修复评审缺陷 1 的「形参从未绑定」）。位置实参与 args 对象在调用点按 §3.6 绑定成实参。
- **用户签名不变**：用户写的是 `function makeGear(count, pitch)`；`__ctx`/`__ns` 是引擎注入的编译层包装参数，不触碰用户参数列表文本（往返保真，D7）。
- 命名空间绑定：在包装体内 `const cad = __ns.cad`、`const mech = __ns.mech`（注入 `cad` 与全部顶层 import 绑定名），使函数体内裸 `cad.box(...)` / `mech.fn(...)` 可解析。
- **不注入 `ctx`、不注入兄弟函数名**：函数体是纯计算单元，经「参数 → 返回值」通信；函数体内本机调用已被禁止（D10），无需也不应注入兄弟函数（修复评审缺陷 2）。
- 函数体顶层 `await` 可用（包装为 async）。

### 5.3 本机函数调用语句发射（`buildStatementFnBody`，`compile.ts:158-199`）

```js
// function pattern(input, count) ；调用 let part2 = pattern(part0, { count: 6 })
// ABI：位置实参 part0 → input；对象键 count → 剩余形参 count
ctx.part2 = await localFns.pattern(ctx, ns, ctx.part0, 6)

// function makeGear(count, pitch) ；调用 let part1 = makeGear({ count: 8, pitch: 5 })
ctx.part1 = await localFns.makeGear(ctx, ns, 8, 5)

// 重赋值 part2 = pattern(part2, { count: 3 })
ctx.part2 = await localFns.pattern(ctx, ns, ctx.part2, 3)

// 解构 const { front: part3, back: part4 } = splitFn(part2, { mode: 'x' })
const { front, back } = await localFns.splitFn(ctx, ns, ctx.part2, 'x')
ctx.part3 = front
ctx.part4 = back
```

- 发射顺序 = **形参序**：位置实参占前 M 个实参位，args 对象键按形参名补到剩余位（§3.6）。
- 与既有发射共用 `withoutKeepDirectives`（调用点 keep 剥离后传入函数，与 `cad.*` 调用一致）。
- `localFns.<name>` 定位：从 `script.functions` 按 `callee` 查函数名（编译期存在性已知；parse 期已查重）。

### 5.4 ExprIR 发射（箭头包装，零改写）

```js
// cad.box({ size: n > 10 ? 20 : 10 })   →  args.size = ExprIR{ text:'n > 10 ? 20 : 10', params:['n'] }
ctx.part0 = await ns.cad.box({ size: ((n) => n > 10 ? 20 : 10)(ctx.n) })

// 数组参数 cad.box({ size: [w, h, r * 2 + 1] })   →  args.size = ExprIR{ text:'[w, h, r * 2 + 1]', refs:['w','h','r'] }
ctx.part0 = await ns.cad.box({ size: ((w, h, r) => [w, h, r * 2 + 1])(ctx.w, ctx.h, ctx.r) })
```

- 发射模板：`((${names}) => ${text})(${args})`，其中 `names` = `[...params, ...refs]`（去重，保持声明顺序），`args` = `ctx.<name>, ...`（与 names 一一对应）。
- 不重写用户表达式文本；标识符经参数绑定解析到 `ctx.<name>`；语法门禁在 parse 期完成（§3.3 白名单文法，含 Array/Object 递归）。
- 嵌套调用出现在 ExprIR 文法外 → parse 期 `E_VALUE`（§4.3），不会漏进 `text` 被任意执行。

### 5.5 keep 隔离（关键语义）

**问题**：执行本机函数调用语句时 `setCurrentStmt(source)` 把当前语句设为该函数调用语句（`module-executor.ts:210`）；函数体内嵌套的 `cad.union(...)` 等库函数体内部会 `keepHidden(...)`（Surface C），若直接登记会污染外层语句的 keep 记录，导致错误的终端/隐藏判定。

**v1 决策**：函数体执行期间**抑制全部内部 keep 登记**——保留语义一律由**调用点 keep** 表达：

```js
function myFn(a) {
  let b = cad.copy(a)      // copy 函数体内部 keep(a) —— 执行期间被抑制
  return b
}
let part0 = cad.box({ size: 20 })
let part1 = myFn(part0, { keep: ['part0'] })   // 调用点 keep 是唯一保留声明通道
```

**实现**：

1. `ModuleExecutor` 增 `userFunctionDepth: number`。执行 `local` 语句的 `compiled.fn(...)` 时 `depth++`，结束后 `depth--`（`executeIds`，`module-executor.ts:196-226`）。
2. `registerKeep`（`module-executor.ts:330-340`）在 `depth > 0` 时直接 return（no-op）。
3. `setCurrentStmt` 保持设置外层语句不变（`part-brep-lost` 事件、shape 命名仍需要它，`module-executor.ts:210`）。
4. 函数体内部 `cad.*` 调用照常产生几何与 BREP 槽；只有 keep **登记**被抑制。

**语义后果（写进契约）**：函数内部的 `copy`/`group` 等「体内保留」不向顶层传播；需要保留就在调用点 `keep`。函数体侧 `keep()` 声明列为 v2 扩展（需要独立于库内部 keep 的登记路径，见 §10 D5）。

### 5.6 函数 BREP 域（体内几何与 OCCT 句柄生命周期，遗漏 1）

**语义（写进契约）**：

1. **体内 `cad.*` 的 mesh/brep 分派不变**：`dispatchPath` 基于值级 `hasBrep(input)`（`backend-dispatch.ts:67-118`），函数体内照常工作，零改动。
2. **体内几何不进顶层 `solidCache`**：`afterStatement`（`module-executor.ts:390-418`）只对**语句输出变量**提取 shape 槽位句柄写 `solidCache[partName]`。函数体内中间变量不是输出 → 其句柄永不进 `solidCache`。
3. **返回值的句柄照常归顶层链**：函数返回的 shape 值写入顶层输出变量 → `afterStatement` 提取其槽位句柄写入 `solidCache[partName]`（与普通语句一致，无需新机制）。
4. **瞬态句柄由「函数 BREP 域」在函数返回时释放**：
   - runtime 维护函数级句柄登记栈 `functionBrepStack`；`userFunctionDepth > 0` 期间，op 把**新产生的输出句柄**登记到栈顶域（hook 点在 op 输出 shape 槽位写入处）。
   - 包装器用 `try/finally` 包住函数体：`finally` 中收集返回值（可能为 shape / compound / 数组 / 对象）可到达的全部句柄为 keep 集，**释放登记域内除 keep 集外的全部句柄**（对齐既有「调用方负责句柄生命周期」`brep-ops.ts:11` 与 `meshesToStep` 的 finally 模式）。
   - 循环体每轮迭代的中间句柄累积在域内，函数返回一次性释放——**不做逐轮释放**（避免引用计数复杂度），单次调用内存有界。
   - 异常路径同样走 `finally` 释放（除已返回值的句柄外全部释放）。

**实现要点**：`functionBrepStack` 生命周期 = 一次本机函数调用；嵌套（函数体内不会再调本机函数，D10，故无嵌套域）。若「登记表」实现成本高，备选收紧为「函数体内中间体仅 mesh（auto 模式对体内中间体强制 mesh）、仅返回值允许携带 BREP 句柄」——但该备选削弱 BREP 能力，**不作为首选**。

**风险**：与 keep 隔离并列为 Phase 2 实现风险最高的两项；需专项测试（循环重函数句柄数不增长，见 §12）。

---

## 6. 执行与增量（module-executor）

### 6.1 函数调用 = 整体执行单元

- 顶层函数调用语句照常参与 deps 拓扑调度：`inputs` + args 内 `$param`/`$ref`/ExprIR refs → `refs` → `deps`。
- **函数体整体重放**：任一参数/依赖变化 → 语句 key 变化 → 整条函数调用语句重跑（函数体内全部重跑）。**不做函数体内语句级 diff**（对齐 roadmap §3.5）。
- 函数体中间变量不进 `ctx`、不进 `outputs`、不进终端判定；只有函数返回值成为语句输出。
- 增量 `append`：新语句若调用函数，函数体已在本轮模块中（模块级缓存 `load()` 按 code 文本缓存，`module-executor.ts:172-177`）。

### 6.2 statementKey 与 bodyHash（P4）

`computeKey`（`module-executor.ts:502-515`）对 `local` 语句：

```
key = local.<callee>#<bodyHash> | JSON(args 剥离 keep) | deps 的 outputContentKey
```

- `bodyHash` 从 `this.script.functions` 按函数名查得（`setCompiled` 已存 script）。
- 效果：**编辑函数体文本 → 所有调用该函数的语句 key 变化 → 下游失效重算**；不改函数体时零重算。
- 非 `local` 语句 key 格式不变（`ns.callee | ...`），零回归。

### 6.3 失败语义与执行护栏

- 函数体抛错 → 语句失败 → `ExecutionResult.failedAt` 指向**函数调用语句**，`message` 带函数名与原始错误（不吞错，H2）。
- 不做「函数内前 k-1 步保留」的部分降级（P6，对齐 roadmap §3.5）。
- **执行护栏（v1 可选，默认关闭）**：`ExecuteOptions.executionTimeoutMs?`——**整轮超时**（覆盖 `execute`/`append`/`update` 全程，含全部函数体重放），超时抛 `E_EXEC_LIMIT`（防 `while(true)` 死循环挂死 worker/UI；护栏粒度明确为整轮而非单语句，见遗漏 6）。无限递归由 JS 原生 `RangeError`（栈溢出）触发，转为 `failedAt` 即可。护栏为新增可选能力，不改现有行为。

### 6.4 part-brep-lost

`emitBrepLost`（`module-executor.ts:471-490`）基于语句 `inputs`/`outputs` 判定：本机函数调用语句的输入在链上、输出不在链上（如函数体内调了 `knurl`）→ 对该**外层语句**发 `part-brep-lost`。语义正确，无需改动——函数返回值的句柄已由 `afterStatement` 决定是否上链（§5.6），该判定与普通语句完全一致。

---

## 7. 命名与宿主边界

### 7.1 `derivePartName` 作用域（`allocate-id.ts:103-110`）

- **问题**：`nextPartNames` 对整段 `code` 词法扫描 `\bpart(\d+)\b`；函数体内 `let part0 = ...` 会污染扫描，导致顶层下一个名字从错误基数开始。
- **修正**：`derivePartName` 的调用方（宿主）或 `allocate-id.ts` 在扫描前剔除函数体区间。方案：`FunctionDefIR.bodyRange`（§4.1）随 IR 提供；宿主在调 `derivePartName` 前用函数区间把 `code` 的对应片段替换为空白，或 `nextPartNames` 增加「排除区间」参数。
- UI 生成的顶层代码仍用 `partN`；函数体内变量名由用户/AI 自由命名（不强制 partN），与「partN 只约束 UI 生成代码」的既有规则一致（R11）。

### 7.2 statement-summary 与 codegen 往返

- `analyzeCode`（`statement-summary.ts:58-79`）：`local` 语句的 summary 增 `local: true`，`callee` = 函数名、`namespace`/`packageName` 缺省。宿主据此渲染「本机函数」节点（只读编辑，函数体不透明）。
- `scriptIRToCode`（`codegen.ts:300-330`）：
  - 函数段 `fmtFunction`（`codegen.ts:280-283`）原样打印（body 含控制流，verbatim 往返不变）。
  - `printStatement`（`codegen.ts:145-180`）增加 `local` 分支：callee 无命名空间前缀 → `let part1 = myFn(part0, { wall: 3 })` / `part2 = myFn(part2, {...})`（重赋值形态）。
  - `fmtValue`（`codegen.ts:57-71`）处理 `ExprIR`：打印回原文 `(<text>)`（往返保真；`<text>` 是合法 JS 表达式）。
- 往返不变式：parse → codegen → parse 逐位相等（含控制流函数体、本机调用四形态、ExprIR 参数）。

---

## 8. check() 扩展（`runtime.ts:1247-1365`）

| 阶段 | 现状 | 扩展 |
|---|---|---|
| parse | acorn + 黑名单 | 函数体放行控制流（白名单文法，§3.1）；本机调用/ExprIR 在 parse 期完成形态校验；**未知函数名在 parse 期拦截（`E_REFERENCE`）**；重复函数名 parse 期拦截（`E_STATEMENT`） |
| symbol | callee ∈ 符号表 / 注册库 | **无需扩展**——本机函数存在性已在 parse 期校验（矛盾 2 取 parse 期拦截方案） |
| keep | `validateKeepDirectives` | 不变（调用点 keep 照常校验；函数体内部 keep 已被抑制） |
| reference | inputs/refs 须先定义 | 本机调用的 inputs/refs（含 ExprIR refs）照常预检 |
| （可选增强）函数体快速校验 | — | parse 期用宽松模式把函数体当迷你脚本解析（形参视为已声明、`return` 视为终端），提前暴露函数体内的引用错误；v1 可只输出 `warnings`，不阻塞 |

---

## 9. 安全边界

- **函数体原文嵌入编译产物 = 用户源码进 VM**。这是对「用户文本不进 VM」（R-3）的**明确例外**，边界是：acorn 语法门禁 + 子集白名单（§3.1）+ 引擎生成的包装层。与 `faqts` 整模块通道（`api-contract.md §10.5`）同构，需写进契约。
- 安全红线不变（P5）：`eval` / `new Function` / 动态 `import()` / 函数内 `import` 声明 / `export` / `class` / `with` 仍拒。`var` 在函数体允许（D12，非安全项）。
- ExprIR 只接受白名单表达式文法（含 Array/Object 递归，无调用/无成员访问），条件表达式文本经语法门禁后嵌入，不扩大求值面到任意 JS（嵌套调用仍走 `CallRefIR` 白名单）。
- 执行护栏（§6.3）作为可选防线，防死循环。
- 函数体内禁止本机函数调用（D10）**同时是安全收窄**：切断了「用户函数体内的不可控递归/互递归」，函数体与运行时的交互面收敛为「`cad.*` 命名空间调用」。

---

## 10. 关键决策记录（D1–D15）

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| **D1** | `local: true` 字段标识本机函数调用（无魔法 namespace） | 用 `$local` 命名空间 token | IR 直白；statementKey 前缀 `local.` 语义清晰 |
| **D2** | ExprIR 只覆盖**调用 args 内**；参数声明保持字面量 | 参数右侧任意表达式（O3） | `ParamDef` 模型依赖字面量；最小行为变更；O3 独立延后 |
| **D3** | ExprIR 存 `text + refs/params`，编译期**箭头包装**发射 | 存 AST + mini-printer；存渲染后文本 | 零改写用户文本（R13）；无 mini-printer；无二次解析；确定性 |
| **D4** | ExprIR 文法**不含调用/成员访问**，但**递归放行 Array/Object** | 禁止 Array/Object | 收窄求值面（安全）；数组/对象参数（如 `[w,h,r*2+1]`）是真实高频需求（矛盾 1） |
| **D5** | v1 **抑制函数体内 keep**，保留一律走调用点 | 函数体 keep() 登记到外层语句 | 避免嵌套库内部 keep 污染；语义可预测；函数体 keep 留 v2（需独立登记路径） |
| **D6** | 函数体文本哈希（bodyHash）进 statementKey | 函数定义为伪语句 | 内容寻址一致；编辑函数体 → 下游失效；伪语句改动大 |
| **D7** | 包装器 `(__ctx, __ns, ...用户形参名)`；用户签名不变 | 只注入单个 `params` 对象 | **修复缺陷 1**：形参按名逐一绑定，值真正进入形参；往返保真（§5.2 / §3.6） |
| **D8** | 执行护栏 v1 可选（`executionTimeoutMs`，**整轮**） | 默认强制；单语句粒度 | 不改现有行为；防死循环由宿主按需开启；无限递归走原生 RangeError（遗漏 6） |
| **D9** | 保留 `export` 拒绝（不开放 `export function`） | 开放 export function | 「脚本内库」模型未成熟；export 语义与 DAG 终端冲突待定 |
| **D10** | **v1 禁止函数体内调用本机函数（含递归）** | 定义体内调用 ABI | 顶层 ABI（位置+对象键绑定）与 verbatim 函数体（普通 JS 位置调用）语义冲突；同时收窄安全面（缺陷 2） |
| **D11** | **ABI 绑定契约（§3.6）**：位置→前 M、对象键→剩余按名、未知键/超位/占用 → `E_ARG` | 丢弃未知键；全按名绑定 | 显式、可报错、防 typo；三处（§3.4/§5.2/§5.3）统一（缺陷 1） |
| **D12** | **函数体内 `var` 允许**（不新增收紧） | 新增 var 检查 | `validateFunctionBody` 现状不查 var（`parser.ts:899-938`），函数体 var 已放行；函数体不透明，var 的作用域语义无害（遗漏 2） |
| **D13** | **函数 BREP 域**：体内瞬态句柄登记，函数返回释放除返回值外全部 | 体内强制 mesh | 值级分派零改动；句柄不泄漏；单次调用内存有界（遗漏 1） |
| **D14** | **parse 期查重函数名**（`E_STATEMENT`） | 允许后声明覆盖 | 消除 `localFns`/bodyHash 按名查表的行为不确定（遗漏 3） |
| **D15** | **未知函数名 parse 期 `E_REFERENCE`**，check() symbol 不重复 | symbol 阶段校验 | 最早报错；check() 无需改动（矛盾 2） |

---

## 11. 分阶段实施

### Phase 1 —— 条件表达式（ExprIR）

| # | 任务 | 文件 | 验收（可执行断言） |
|---|---|---|---|
| P1a | `ExprIR` 类型 + `isExprRef` 守卫 | `lang/types.ts` | typecheck 通过 |
| P1b | parser：`parseValueExpr` 中折叠失败且节点 ∈ 白名单文法（**含 Array/Object 递归**）时构建 ExprIR（收集 refs/params，标 `hasComputedArgs`）；文外调用/成员 → `E_VALUE` | `lang/parser.ts:256-396` | `cad.box({ size: n > 10 ? 20 : 10 })` parse 成功且 args.size 为 ExprIR；`cad.box({ size: [w, h, r*2+1] })` parse 成功；`cad.box({ size: cad.f(part0) ? 1 : 2 })` → `E_VALUE` |
| P1c | compile：`translateArg` 发射箭头包装 | `lang/compile.ts:88-104` | 编译产物含 `((n) => n > 10 ? 20 : 10)(ctx.n)` 与 `((w,h,r) => [w,h,r*2+1])(ctx.w,ctx.h,ctx.r)` |
| P1d | 依赖收集四处识别 `$expr` | `parser.ts:719-741`、`compile.ts:121-155`、`terminal-dag.ts:76-98`、`keep.ts:195-210` | ExprIR refs 进 deps；consumes 对 ExprIR 内变量按 C5 判定 |
| P1e | codegen `fmtValue` 打印 ExprIR 原文 | `lang/codegen.ts:57-71` | 往返逐位相等 |
| P1f | 测试 | `lang/*.test.ts` | parse/compile/key/terminal/往返/增量各覆盖；纯参数表达式仍折叠（行为不变）；ExprIR 引用 Shape 变量的 args 槽位语义（§4.3） |

### Phase 2 —— 函数体放开控制流 + 本机函数调用

| # | 任务 | 文件 | 验收（可执行断言） |
|---|---|---|---|
| P2a | `validateFunctionBody` 放行控制流（保留安全红线与 `with` 拒绝；**不新增 var 检查**，D12）；**新增「体内禁止本机函数调用」**（裸 callee 调用 → `E_STATEMENT`，D10） | `lang/parser.ts:899-938` | 函数体内 `if`/`for`/`while`/`switch`/`try`/`throw`/`var` 可解析；`eval`/`new`/动态 `import()`/`import`/`export`/`class`/`with` 仍拒；体内 `gear(...)` 裸调用 → `E_STATEMENT` |
| P2b | `FunctionDefIR` 增 `bodyHash` + `bodyRange`；**parse 期查重**（同名 → `E_STATEMENT`，D14） | `lang/types.ts:199-206`、`lang/parser.ts:862-893` | 哈希确定；区间覆盖函数体；重复 `function f` → `E_STATEMENT` |
| P2c | parser：顶层本机函数调用**四形态**（赋值/重赋值/解构/无赋值）+ **ABI 绑定契约**（§3.6）+ parse 期未知函数名 `E_REFERENCE` | `lang/parser.ts:410-605`、`lang/parser.ts:1245-1280`、`lang/parser.ts:1288-1384` | `let p = myFn(part0, {k:1})` 得 `{local:true, callee:'myFn', inputs:['part0'], outputs:['p']}`；`part0 = myFn(...)` 重赋值通过；未知函数名/未知键/超位/占用 → 对应错误 |
| P2d | compile：模块级函数发射（包装器 `(__ctx, __ns, ...形参)`，D7）+ ABI 发射（位置→前 M、对象键→按名补剩余，按形参序） | `lang/compile.ts:215-265`、`lang/compile.ts:158-199` | 产物含 `localFns`；`makeGear({count:8,pitch:5})` 发射 `await makeGear(ctx, ns, 8, 5)`；`pattern(part0,{count:6})` 发射 `await pattern(ctx, ns, ctx.part0, 6)` |
| P2e | executor：`userFunctionDepth` keep 隔离 + bodyHash key + **函数 BREP 域**（句柄登记 + finally 释放，D13）+ 执行护栏（整轮超时，D8） | `cad-runtime/module-executor.ts:196-226`、`:330-340`、`:502-515` | 函数体内 `cad.union` 的内部 keep 不污染外层；编辑函数体 → 下游 key 变；循环重函数句柄数不增长（§12）；`executionTimeoutMs` 超时 → `E_EXEC_LIMIT` |
| P2f | check()：**不扩展 symbol**（parse 已拦截，D15）；引用预检照常 | `cad-runtime/runtime.ts:1273-1306` | 未声明函数名 → parse 期即报错；已声明 → 通过 |
| P2g | `derivePartName` 排除函数体区间；`analyzeCode` 增 `local` 字段；codegen `printStatement` local 分支（含重赋值形态）+ 往返 | `lang/allocate-id.ts:103-110`、`lang/statement-summary.ts:58-79`、`lang/codegen.ts:145-180` | 函数体内 partN 不影响顶层命名；四形态往返逐位相等 |
| P2h | 测试 | `lang/function-def.test.ts` 重构 + 新增 | 原「函数体内控制流 → E_CONTROL_FLOW」用例反转；ABI 绑定矩阵、重复函数名、体内本机调用、函数 BREP 域、增量、terminal 全绿 |

### Phase 3 —— 收尾

| # | 任务 | 说明 |
|---|---|---|
| P3a | 契约文档修订 | 实施时更新 `docs/syntax-design.md`（§2.1 允许/禁止表、§2.3 语句形态、§2.4 表达式、§3.6 ABI、§7 AI 契约）与 `docs/api-contract.md`（§5、§7.5 增量、§8 双路径、§13.5 兼容性）——**本方案不引用、不修改 standing doc** |
| P3b | Agent Note | 实施 PR 内新增决策记录（D1–D15 摘要 + 放弃项） |
| P3c | 回归 | parity（BREP vs mesh）、往返、增量、`npm run ci` 全绿 |

---

## 12. 测试计划

| 层 | 用例 |
|---|---|
| parser | 函数体控制流放行矩阵（if/for/while/switch/do/try/throw/break/continue/labeled/嵌套函数/var）；安全红线保持；本机调用四形态；**ABI 绑定矩阵**（位置/对象键/未知键 `E_ARG`/超位/占用/缺失→undefined）；重复函数名 `E_STATEMENT`；体内本机调用 `E_STATEMENT`；ExprIR 文法白名单（含 Array/Object 递归）；未知函数名 `E_REFERENCE` |
| compile | 模块结构含 `localFns`；包装器形参按名；ABI 发射按形参序；本机调用四形态发射；ExprIR 箭头包装（含数组）；keep 剥离 |
| executor | keep 隔离（函数内 `copy` 不向顶层传播保留，调用点 keep 生效）；**函数 BREP 域**（循环重函数执行后句柄数不增长；返回值上链 / 中间体释放）；bodyHash 增量（改函数体 → 重放；不改 → 零重算）；执行护栏（整轮超时）；失败 → `failedAt` 指函数调用语句 |
| terminal-dag | 本机调用语句 C0/C1/C3/C5 判定；函数体中间变量不参与；part-brep-lost 对函数调用语句正确；ExprIR 引用 Shape 变量的消费判定 |
| codegen/命名 | 往返逐位相等（含控制流函数体/本机调用四形态/ExprIR 数组参数）；函数体内 partN 不污染 `derivePartName` |
| 集成 | `packages/tests/faijs/` 新增 fixture：条件表达式数组参数（`size: [w,h,r*2+1]`）、函数体内条件选择几何（普通 JS `let g = cond ? cad.box(...) : cad.sphere(...)`）、带循环的齿轮/阵列函数、解构消费、函数内断链（knurl）→ part-brep-lost |

---

## 13. 风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| 函数体原文进 VM（安全面扩大） | 用户源码成为模块一部分 | acorn 语法门禁 + 白名单 + 引擎包装；与 faqts 先例同构；安全红线保持（P5）；体内本机调用禁止进一步收窄（D10） |
| **函数 BREP 域实现复杂**（句柄登记 + 可达性 keep 集） | OCCT 句柄泄漏（循环内大量中间体） | 登记 hook 点明确（op 输出槽位写入处）；finally 释放；专项句柄计数测试；备选收紧为「体内中间体 mesh-only」（§5.6） |
| keep 隔离改变既有「体内保留」预期 | 函数内 `copy` 不再自动保留源 | v1 明确契约「保留走调用点 keep」；函数体 keep 列 v2（D5） |
| ABI 表达力受限（体内不能调函数） | 复杂算法必须单函数实现 | v1 收窄（D10）；v2 定义体内调用 ABI（普通 JS 位置语义） |
| bodyHash 碰撞 | 编辑函数体但下游不失效（极端） | FNV-1a 32bit 对脚本规模足够；可升级 64bit/两段拼接 |
| 死循环挂死 worker | 阻塞执行 | 可选 `executionTimeoutMs` 整轮护栏（D8） |
| ExprIR 表达力不足（无调用/成员） | 部分条件表达式写不了 | v1 收窄；嵌套调用走 CallRefIR；数组/对象已递归放行（D4）；后续可扩展文法 |
| 与既有「零函数知识」冲突 | 引擎开始识别函数名 | 不解析函数体，仅按名字查 `script.functions` 做存在性校验与发射定位——仍是数据驱动 |

**回退策略**：Phase 1（ExprIR）与 Phase 2（函数）相互独立、可分拆；任一阶段如遇阻塞，另一阶段可先行落地。Phase 2 中 keep 隔离（P2e）与**函数 BREP 域**（P2e）是有行为/资源语义风险的改动，须配套专项测试后再合并。

---

## 14. 评审意见处置（v1.1）

> 全部评审意见经代码事实核实后**采纳并写入方案**。其中四处存在可选方案，本文档作出选择并说明理由；无「不采纳」项。

| 评审点 | 类型 | 处置 | 落点 |
|---|---|---|---|
| 缺陷 1：调用 ABI 三处矛盾、形参从未绑定 | 致命 | **采纳**，选「方案 A」：包装器 `(__ctx, __ns, ...用户形参名)`，位置实参→前 M、对象键→剩余按名；新增 §3.6 ABI 总约定统一三处 | §3.4 / §3.6 / §5.2 / §5.3 / D7 / D11 / P2c / P2d |
| 缺陷 2：函数体内调用兄弟/互递归未闭环 | 致命 | **采纳**评审给出的选项 (b)：**v1 明确禁止函数体内调用本机函数**（含递归）。理由：顶层 ABI（位置+对象键绑定）与 verbatim 函数体（普通 JS 位置调用）语义冲突，`gear(part0, {n:3})` 在函数体内会把 `{n:3}` 整体落到第二个形参，与顶层发射不一致；同时收窄安全面。v2 再定义体内调用 ABI | §3.1 / §3.2 / §5.2 / D10 / P2a |
| 矛盾 1：示例数组参数与白名单互斥 | 自相矛盾 | **采纳**：白名单递归放行 `ArrayExpression` / `ObjectExpression`（元素/属性值仍走白名单），示例 `[w,h,r*2+1]` 成立 | §3.3 / §4.3 / D4 / P1b / P1c |
| 矛盾 2：未知函数名报错阶段不一致 | 自相矛盾 | **采纳**评审建议：**parse 期拦截**（最早报错，check() 无需改动）；§8 symbol 阶段删去 local 校验扩展 | §3.4 / §8 / D15 / P2c / P2f |
| 遗漏 1：函数体内 BREP solidCache 生命周期 | 遗漏 | **采纳**（已核实：BREP 句柄是值承载、`afterStatement` 只对语句输出写 solidCache、OCCT 内核无自动回收——泄漏风险属实）。新增 **§5.6 函数 BREP 域**：体内句柄登记、函数返回 finally 释放除返回值外全部、单次调用内存有界 | §5.6 / §1.4 / D13 / P2e / §12 |
| 遗漏 2：var 现状描述不准确 | 遗漏 | **采纳**事实更正：`validateFunctionBody` 不查 var，函数体 var **现状已放行**。本文档选择**不新增 var 检查**（D12，非「行为收紧」而是「维持现状」），理由：函数体不透明、var 作用域无害 | §3.1 / §3.2 / D12 / P2a |
| 遗漏 3：重复函数名未定义行为 | 遗漏 | **采纳**：parse 期查重 → `E_STATEMENT` | §4.1 / D14 / P2b |
| 遗漏 4：重赋值形态缺失 | 遗漏 | **采纳**（已核实：顶层 `part0 = cad.op(...)` 重赋值在 `parser.ts:1245-1280` 已支持）：本机函数调用增补重赋值形态 | §3.4 / §4.2 / D 系列无新决策 / P2c / P2g |
| 遗漏 5：ExprIR 求值为 Shape 的情形未定义 | 遗漏 | **采纳**：明确**允许**（feature），写清边界——args 槽收到 Shape 原样传 op、op 自校验、refs 按 C5 消费；顶层位置实参仍限裸变量；完整条件几何选择在函数体内以普通 JS 完成 | §3.3 / §4.3 / P1f / §12 |
| 遗漏 6：executionTimeoutMs 粒度未定义 | 遗漏 | **采纳**：明确为**整轮超时**（覆盖 execute/append/update 全程，含函数体重放） | §6.3 / D8 / P2e |

**实施时备注**：缺陷 1 的 ABI 与缺陷 2 的「禁止体内调用」是相互锁定的——若未来 v2 开放体内调用，必须先定义体内调用 ABI（普通 JS 位置语义），届时顶层 ABI（§3.6）与体内 ABI 的分野需在 `docs/syntax-design.md` 固化。

---

## 15. 交付时的文档/决策记录更新点

- 实施后需修订 standing doc（不引用本方案）：`docs/syntax-design.md`（语法契约、§3.6 ABI）、`docs/api-contract.md`（执行/增量/双路径/兼容性）、`.agents/notes/`（决策记录）。
- 本方案文档按 `docs/plans/` 规则于下月 1 号归档到 `yyyy-mm/`。
