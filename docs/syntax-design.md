# .faijs 语法设计

> 定位：这是 `.faijs` 的**语法契约**与**增量执行契约**（长期有效）。
> 需求总纲：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`
> 相邻文档：`docs/api-contract.md`（接口契约）、`docs/ops-api-inventory.md`（API 手册，写给 AI/用户）、`docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md`（执行架构实施）。

版本状态（2026-08-28 重写）：本文档随 **语言正常化重构**（消灭 op 概念）与 **DAG 终端判定恢复** 两轮改造重写。
与旧版的关键差异：① 废弃 `partN_vM` 版本链命名，改为**可重赋值的 `partN`**（模型即变量）；② `op` 概念消灭，函数就是函数（`callee`），引擎零函数知识；③ 语句身份 `StmtId`（`sN`）与变量身份 `PartName` 分离；④ 终端判定恢复为 **DAG 活跃性**（最后写者 + 下游无消费），由符号表的 readonly 数据驱动。

---

## 0. 需求与约束

### 0.1 用户原话（需求基线，不准删除）

来自 `Faijs语言的思考.md`：

> 1. 需要能同时支持brep/mesh/sdf（甚至点云逆向）等各种建模方式。
> 2. 需要支持多个后端建模引擎，目前brep用occt，mesh用manifold。未来要支持引擎切换。
> 3. 需要能同时支持UI建模与AI建模。这是最重要的特性。UI建模也就是用户点击UI的时候生成脚本代码。AI建模是让大模型直接根据文本等描述生成建模源代码。要支持交互式运行，也就是UI和AI代码要能够交替生成，互相兼容。

> 4. faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
> 5. 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
> 6. faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
> 7. faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。

> faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。

> 必需再次强调，faijs必需是正常的语言，必需正常的设计。所有不符合这个要求的设计，都要给我去掉，目前的代码如何实现的不重要。唯一的例外，faijs必需是UI能够自动生成代码，比如AI/UI生成的代码能够和谐共存。

> 规定faijs里不准出现控制流语句，也就是不能有if/for/while之类的语句。如此，canvas里如何决定显示哪些几何模型、timeline如何显示等需求不会被AI生成的代码破坏。

> UI 层是"死"的，必须有一套确定的命名方案才能稳定生成与回放代码，因此约定 **UI 生成的代码统一采用 partN（N 为整数序号）。faijs变量名只要是合法的 JS 标识符即可，变量命名规则仅针对 UI 生成的代码，手写或AI生成的代码可以用任意合法的变量名。**

> 其实最终就是一句话：dag活跃性，加ReadonlyShape的入参不被消费。最终存活下来的shape显示在canvas中。

> parser 这是乱来，完全违规。parser 只应对代码进行语法分析，怎么可能改写用户提供的代码。
> partN 这种命名是 UI 层的事情，怎么可能跑到 parser 层里，完全乱来。还篡改用户代码，莫名其妙。

### 0.2 由原话推出的硬约束

1. **`.faijs` 必须是 JavaScript 的合法子集** —— 任意 JS 解析器（acorn）都能无错解析。
2. **禁止 `eval` / `new Function` / 动态 `import()` 真执行** —— 存在安全风险，且会让"子集边界"毫无意义。文本必须**先经语法解析**还原为结构化 IR（parse-then-compile），执行交给 JS 虚拟机——编译产物由引擎从 IR 生成，用户原文不进 VM。
3. **无控制流** —— 唯一禁令：禁止 `if` / `for` / `while` / `do` / `switch` / `try` 等控制流语句与动态 `import()`（§2.4）。这是"canvas 显示集合可静态推导"与"timeline 一行一节点"的前提，也是 AI 生成代码不破坏宿主推导的保证。函数定义、模板字符串、IIFE 等非控制流 JS 特性是合法子集成员（实施见开发计划）。
4. **引擎零函数知识** —— parser / compile / codegen / runtime 中不允许存在任何按函数名分支的代码。函数的信息只以**机器生成的符号表**（§5.3）形式存在，且是均匀数据。
5. **UI 建模 与 AI 建模 在同一份代码上交织** —— 两者收敛到同一个 `ScriptIR`；引擎只认 `ScriptIR`，不区分语句来源（来源标注是宿主职责，faijs 不处理 UI 状态）。
6. **引擎必须增量执行** —— 按行录制、按行增量重算（§6.3）。
7. **只有一份代码** —— 不存在"语句对象"与"代码文本"两份表示的转化函数，文本是 `ScriptIR` 的确定性序列化投影（`scriptToCode` / `statementToLine`），parser 与 codegen 双向同构。**一个操作对应一行代码**（注释/空行不计）。
8. **命名职责分层** —— `derivePartName`（partN 分配服务）由**生成侧**（UI/AI/CLI）在生成代码文本时调用；**parser 不调用命名服务、不做任何名称翻译**，解析时原样保留源码里的词法变量名。

---

## 1. 核心抽象：ScriptIR 是唯一事实源

```
       Human UI 操作                    AI / 手写代码 (.faijs 文本)
            │                                    │
            │ 追加一行语句                        │ acorn 解析（不执行）
            ▼                                    ▼
   ┌────────────────────────────────────────────────────────┐
   │  ScriptIR（场景级单一 DAG）              ← 唯一事实源   │
   │   params:     const size = 20                          │
   │   statements: let part0 = cad.box({ size })            │
   │               part0 = cad.drill(part0, { diameter: 5 })│
   │               const { front: part1, back: part2 } = …   │
   └────────────────────────────────────────────────────────┘
                            │
                            ▼
        compileToModule → 零 import ESM → 动态 import()（JS VM 执行）
                            │
                            ▼
              ExecutionResult { outputs, terminals, compounds, … }
```

### 1.1 四层分离（引擎零几何、零函数名）

| 层 | 内容 |
|---|---|
| **语言** | `.faijs`（UI 录制、无类型、无控制流）；`.faits`（AI 编写、带类型，去类型后同管道，**远期**，§10） |
| **引擎** | parser、codegen、`compileToModule`、`ModuleExecutor`、`ExecContext`、Shape 构造器、BREP/mesh **内核平台**——**不含任何函数名知识** |
| **stdlib** | 全部官方函数的**库函数实现**（`src/stdlib/**`，`@faicad/faijs/stdlib`）。几何运算在这里，不在引擎 |
| **第三方库** | 任意 JS 模块，遵守"末参 exec"约定即可被 `.faijs` 调用（远期） |

### 1.2 身份契约：`StmtId` 与 `PartName` 是两个命名空间

```
part0 = cad.box(...)          // part0 是 PartName（变量身份）
        ↑ 这条语句的身份是 StmtId = s1（语句身份）
```

- **`StmtId`**（`s1..sN`）：语句身份，用于依赖图（deps）与增量执行缓存键。参数语句占前段 `s1..sK`，语句占 `s(K+1)..s(K+N)`。**一条语句有且只有一个 StmtId**。
- **`PartName`**：左值变量名（任意合法 JS 标识符）。一条语句可以有 **0 个**（成员调用）、**1 个**（普通赋值）或 **N 个**（解构）PartName。
- 引擎与宿主都以 `PartName` 为**不透明 key**（`outputs: Map<PartName, Shape>`、`terminalToScopedId: Record<PartName, …>`），**不解析 `partN` 的结构**。`partN` 只是 UI 生成代码的命名约定。
- 因此**同一变量名可以被多条语句写入**（重赋值 = 模型被修改），这是本语言与 SSA 版本链（`partN_vM`）的根本区别。

### 1.3 执行永远走 JS VM

`cad.*` 在文本里只是**约定**（合法 JS 子集），应用内执行时 parser 还原为 IR → 编译为**零 import ESM** → 动态 `import()` 由 JS 引擎执行。引擎不解释任何几何语义；几何运算在 stdlib 库函数里，BREP/mesh 双链路由库函数内部 `resolvePath` **静态判定**（禁止运行时回退，见 `docs/api-contract.md` §8）。

"合法 JS"是**序列化契约**，不是"加载后真跑的代码"——这规避安全风险，同时保留了按行增量重算的粒度。

---

## 2. 语法规范（合法 JS 子集）

> **本章双层结构——规范要求与当前实现必须分清**：
> - **规范要求（目标契约，语言应该是什么样）**：faijs 是**正常 JS 的合法子集**，除控制流语句外一切合法（"faijs 必需是正常的 js 的子集，除了没有控制流语句"）。
> - **当前实现（现状，可能临时、可能错）**：parser 白名单只支持其中一部分形态，其余暂报 `ParseError`。**实现不是规范**——规范以本章"规范要求"为准；实现差距与实施见开发计划 `docs/plans/2026-08-29-faijs-normal-js-subset.md`。

### 2.1 文件容器

**规范要求**：
- 文件是合法 JS（除控制流外一切合法），可含**顶层 `import` 段**（路线图 V1.1）：允许 `import * as mech from 'mech-lib'` 等模块声明。`import` 是**模块声明而非控制流**，不破坏 DAG 与 timeline（路线图 §1.1 关键澄清）。
- **扁平格式**是 UI 录制推荐的形态（一行一语句），**不是唯一格式**——AI/手写代码可用任意合法 JS 形态。

**当前实现**：
- **扁平格式**：纯语句序列，无 `export default`、无 `return`、无 `await`、无 `apiVersion` 头。parser 检测到文本不含 `export default` 时，自动封装为 `export default async (cad) => { … }` 再交给 acorn（行号扣掉封装偏移，报错行号始终相对原始文本）。
- **`export default async (cad) => { … }` 容器**：同样合法（历史格式），parser 直接解析。
- **`// apiVersion: N`** 注释可选（`getApiVersion`，缺省 1）。
- **顶层 `import` 尚未支持**（V1.1 实施中；当前 import 落进函数体即语法错误）。

### 2.2 语句形态（开放子集，不是封闭清单）

**规范要求**：语句形态是**开放的**——任何不构成控制流的合法 JS 语句都允许：声明、赋值、表达式语句、函数调用、`return`、顶层 `function` 声明（V1.3）、顶层 `import`（V1.1）。不存在"缺一不可、多一不可"的封闭清单。

**当前实现**：parser 只接受以下形态（其余一律 `ParseError` "unsupported statement"）：

```
script   = ( <comment> | <param> | <stmt> )*

comment  = // 单行注释（不占操作行）

param    = const <name> = <literal>                       // 参数：右侧仅字面量

stmt     = (const|let) <id> = [await] cad.<fn>(<input>*, { <k>:<v>, … }?)   // 声明赋值
         | const { <k1>: <id1>, … } = [await] cad.<fn>(<input>*, {…}?)      // 对象解构（必须 const）
         | <id> = [await] cad.<fn>(<input>*, {…}?)                          // 裸重赋值（<id> 须已声明）
         | <id>.<method>({ <k>:<v>, … }?)                                   // 成员方法调用（<id> 须已声明）
         | return { shape: <id>, name?, color?, … }                         // 显式终端（可选）
         | return [ { shape: <id>, … }, … ]                                 // 显式多终端（可选）
```

- `cad.<fn>(…)` 的 `<fn>` 是**任意函数名**，parser 不认识也不关心；位置参数 `<input>*` 必须是**已声明的变量标识符**（0 个、1 个或多个均可）；尾部的选项对象 `{…}` **可省略**（如 `cad.split(part0)`）。
- `await` 可选（parser 剥离），codegen 不产出 `await`。
- 解构的键与 callee **均无限制**（`const { a, b } = cad.mySplit(x)` 合法）；解构必须用 `const`。
- 成员方法调用的接收者必须是已声明变量，方法名任意（`asm1.add_constraint({…})`、`asm1.do_assemble()`）；这类语句**无输出**（`outputs = []`）。
- 显式 `return` 只用于**指定终端集合**（§5.1 优先级）；绝大多数代码不写 `return`。

### 2.3 表达式（args 与赋值右侧）

**规范要求**：值是**正常 JS 表达式**——字面量、标识符、一元/二元运算、模板字符串、三元、数组/对象字面量、函数调用（含嵌套 `cad.<fn>()` 与用户自定义函数，V1.3）、展开运算符等，只要不含控制流。例：

```js
let part0 = cad.box({ size: base + 20 })                    // 二元表达式
let part1 = cad.box({ size: r, name: `板-${n}` })            // 模板字符串
let part2 = cad.drill(part0, { at: cad.faceCenter(part0), depth: flag ? 5 : 0 })
```

**当前实现**：`parseValueExpr` 是白名单，只接受：

| 形态 | 结果 |
|---|---|
| 字面量（数/串/布尔/null）、负数字面量 `-5` | `JsonValue` |
| 参数名 / 对象简写 `{ size }`（须是已声明的 param） | `ParamRefIR { $param: 'size' }` |
| 已声明变量名 | `VarRefIR { $ref: 'part0' }` |
| 数组 / 对象（递归） | `JsonValue[]` / `Record<string, ArgIR>` |
| `cad.<fn>(…)` 嵌套调用（递归，任意 fn） | `CallRefIR { $call: { callee, args } }` |

> 当前实现**不支持**二元表达式（`cad.box({ size: [10, 20 * r, 5] })` 报 `unsupported value expression: BinaryExpression`）、模板字符串、三元、展开等——这些是**临时实现限制，不是语言规范**，实施见开发计划。

### 2.4 禁止清单（规范禁令 vs 当前实现限制）

**规范要求（唯一禁令）**：

| 禁止 | 理由 |
|---|---|
| 控制流语句：`if` / `for` / `while` / `do` / `switch` / `try` | 破坏"canvas 显示哪些几何"与"timeline 一行一节点"的静态可推导性（用户原话） |
| 动态 `import()` | 属控制流范畴（路线图 V1.5：parse 阶段专用错误码显式报错） |
| `eval` / `new Function` | 安全红线：文本必须先进 parser 校验（parse-then-compile），执行交给 JS VM |
| `export` | 保持自动 export 方案（路线图 O3 裁定） |

**当前实现额外禁止（临时限制，非规范）**：函数声明/表达式、类、`new`、模板字符串、IIFE、`var`、多声明器（`const a = 1, b = 2`）、裸表达式语句（非成员调用）、顶层 `import`。这些是**当前 parser 白名单的临时限制**，随 V1 语言正常化逐步放开（路线图 V1.1/V1.3，见开发计划）。

### 2.5 标识符命名约束（关键字黑名单）——可读性约束

本条约束的是**本项目生成/拥有的代码**：`codegen` 输出的所有标识符（变量名、参数名）、引擎自身的固定词汇（`cad`、函数名、参数名）。

上述标识符**不得**是以下任一门语言的保留关键字：**JavaScript**（含严格模式/模块保留字）、**Python 3**、**C**（C11）、**Java**。

仅仅是可读性要求，不构成对 AI/手写代码标识符的语法限制（§0.1 原话：任意合法 JS 标识符即可）。

---

## 3. 语句模型 ↔ `StatementIR` 映射

`src/lang/types.ts` 的 IR 定义（**这是 IR 的真源**）：

```ts
interface StatementIR {
  id: StmtId                    // 顺序 sN（参数语句占前段）
  callee: string                // 函数名：源码里写什么就是什么（union/split/add_constraint/…）
  args: Record<string, ArgIR>   // 尾参选项对象（可为空）
  inputs: PartName[]            // 位置参数中的变量引用
  outputs: PartName[]           // 绑定的变量名（0/1/N 个）
  outputKeys?: string[]         // 解构键，与 outputs 一一对应
  receiver?: PartName           // 成员方法调用的接收者变量
  refs?: string[]               // 依赖分析用：inputs + args 中的 $ref/$param + receiver
  hasAssignment?: boolean       // 纯语法事实：是否有赋值
  seq?: number                  // 宿主层填充：timeline 跨 part 线性排序
}

interface ScriptIR {
  params: ParamDef[]            // const name = literal
  statements: StatementIR[]
  meta?: ScriptMetaIR           // 单终端时的 name/appearance
  terminalShapes?: TerminalShape[]  // 显式 return 指定（可选）
}
```

映射规则表：

| 文本（扁平） | IR |
|---|---|
| `const size = 20` | `params += { name:'size', type:'number', value:20, default:20 }`；引用处为 `ParamRefIR { $param:'size' }`（**不折叠**，执行前求值）。参数在编译产物里是普通语句（`ctx.size = 20`） |
| `let part0 = cad.box({ size })` | `{ id:'s2', callee:'box', args:{ size:{ $param:'size' } }, inputs:[], outputs:['part0'], hasAssignment:true }` |
| `part0 = cad.drill(part0, { diameter:5 })` | `{ id:'s3', callee:'drill', args:{…}, inputs:['part0'], outputs:['part0'] }`（**同一变量名 → 语义是"修改这个模型"**） |
| `cad.faceCenter(part2)`（args 内嵌套） | `args.at = CallRefIR { $call:{ callee:'faceCenter', args:[{$ref:'part2'}] } }`。拓扑语义由 geom 库函数自己解释，引擎不认识 `faceCenter` |
| `const { front: part1, back: part2 } = cad.split(part0)` | `{ callee:'split', inputs:['part0'], outputs:['part1','part2'], outputKeys:['front','back'] }` |
| `let part2 = cad.union(part0, part1)` | `{ callee:'union', inputs:['part0','part1'], outputs:['part2'] }`（union/subtract/intersect 是**三个独立函数**，不再归并为 `op='boolean'`） |
| `let g = cad.group({ members:['part0','part1'] })` | `{ callee:'group', inputs:[], args:{ members:[{$ref:'part0'},{$ref:'part1'}] }, outputs:['g'] }`。members 元素是通用 `VarRefIR` 扫描结果，无 group 特判 |
| `asm1.add_constraint({ type:'face_mate' })` | `{ callee:'add_constraint', receiver:'asm1', inputs:[], outputs:[], hasAssignment:false }` |
| `asm1.do_assemble()` | `{ callee:'do_assemble', receiver:'asm1', outputs:[], hasAssignment:false }` |
| `return [{ shape: part0 }, { shape: part2 }]` | `terminalShapes = [{ id:'part0' }, { id:'part2' }]`（显式终端，优先于 DAG 推导） |

> **`feature.createdBy` / `FeatureKind` 已从 faijs 彻底移除**（`src/` 下无残留）。"这一步是 UI 做的还是 AI 做的"、图标、颜色、显示名等**全部是宿主职责**——faijs 不处理 UI 状态（§0.1 原话 6）。

---

## 4. 变量命名：`partN` 约定（**生成侧**职责）

### 4.1 核心原则（用户原话）

> 核心的底层原则是要看给定一个函数调用后，是否有独立的新的shape生成了。有新的shape生成了，就需要新的变量名。如果是在原来的shape的基础上的修改，则不需要分配新的变量名。

> 1. 如果输入是ReadonlyShape, 且输出是Shape的，需要一个新的变量名。比如copy，group，assemble
> 2. 如果输入是一个Shape，输出是一个shape的，不需要变量名。代表修改这个入参本身。比如drill、fillet
> 3. 如果输入和输出的（非readonly的）shape数量不同，则需要一个新的变量名。比如split/boolean

### 4.2 `derivePartName`：引擎提供的命名服务，但**只有生成侧调用**

```ts
derivePartName(input: {
  callee: string        // 函数名（语法事实）
  inputCount: number    // 位置输入数（语法事实）
  outputCount: number   // 输出数（含解构键数，语法事实）
  code: string          // 当前代码文本：内部词法扫描已用 partN，取下一个序号
}): { behavior: 'reuse' | 'new'; names: PartName[] }
```

规则（按优先级）：

| 规则 | 条件 | 命名 | 例 |
|---|---|---|---|
| R0 | `outputCount === 0` | 无名字（无赋值语句） | `do_assemble` |
| R1 | callee 在符号表且**全部 shape 入参位置都标了 readonly**（含无位置输入的 `group`/`assembly`） | **新名** partN（每输出一个） | `copy`、`group`、`assembly` |
| R2 | `inputCount===1 && outputCount===1`（消费性单入单出） | **复用** inputs[0]（写回同一变量名） | `drill`、`fillet`、`translate` |
| R3 | 其余（0 入 1 出创建类；入出数量不同） | **新名**（每输出一个 partN） | `box`、`union`、`split` |
| R4 | 多入多出且数量相等（`Shape[]` 批处理） | **禁用**（`derivePartName` 抛错） | — |
| R5 | 同一函数 `ReadonlyShape` 与 `Shape` 混合 shape 入参 | **禁用**（符号表生成期报错） | — |

- **未知函数**（不在符号表，如第三方/AI 自造）→ 默认消费语义 → 命中 R2/R3。解析、编译、执行、命名、活跃性**全部正常工作**，只是命名退化为默认规则。这是"引擎不认识函数也能跑"的试金石。
- partN 序号由 `code` 文本词法扫描（`/part(\d+)/`）取 `max+1`，**不 parse**（允许解析生成中的代码）。
- `allocateSplitIds` 已被 `outputCount: 2` 吸收。

### 4.3 分层红线：parser 不做命名（2026-08-28 修复）

> partN 这种命名是 UI 层的事情，怎么可能跑到 parser 层里……这个 parser 是 faijs 语言的 parser，居然去改 UI 层生成的代码？

- **parser 只做语法分析**：提取 `declNode.id.name` → 原样写入 `outputs` / `inputs` / `receiver` / `$ref` / return，**不做命名分配、不做名称翻译**。
- `varToId` 映射恒等（词法名 → 词法名），仅用于**作用域校验**（"变量是否已声明"）。
- 调用方（3d_editor FeatureDef、AI 管线、CLI）在**生成代码文本时**调用 `derivePartName`——"谁写代码谁命名"。
- 后果：UI 生成的 `partN` 被原样保留；AI/手写写 `asm1` 也原样保留。两者在引擎里一视同仁。

---

## 5. 终端判定：DAG 活跃性（canvas 显示什么）

### 5.1 一句话规则（用户原话）

> DAG 活跃性判断就是**看一个变量是否被消费**——被消费了，就不出现在终端。规则只有一条：**compound shape 不消费其子 shape**，所以返回 compound 的语句要从"消费方"里排除；其它语句，只要 shape 出现在右侧，就认为被消费了。

判定算法（`src/cad-runtime/terminal-dag.ts` `computeLeafTerminals`，执行收尾由 `runtime.collectResult` 调用）：

```
对每个 shape 变量名 v（含 compound 变量）：
  P = 最后一条 outputs 含 v 的语句（最后写者）
  若 P 之后存在语句 T 使 consumes(T, v) 为真 → v 被消费 → 不进终端
  否则 → v 进终端
```

- 判定单位是 **PartName**（变量名），不是 StmtId——天然支持同一名字被多次写入。
- 显式 `return [...]`（`script.terminalShapes`）**优先**于 DAG 推导；没有 `return` 时才推导。
- **这是 faijs 引擎的职责**，宿主不重复实现该判定（切换算法不应影响下游）。

### 5.2 `consumes(T, v)`：符号表驱动，三条例外

```ts
function consumes(stmt, v): boolean {
  // 默认：v 出现在 stmt 的 inputs 或 args 的 VarRefIR 中 → 消费
  // 例外 1：嵌套调用 CallRefIR 内部的引用 = 只读查询，不消费
  //          （cad.drill(part0, { at: cad.faceCenter(part2) }) 不吃掉 part2）
  // 例外 2：符号表 readonlyPositions 命中的 inputs 下标 → 不消费（copy 的源）
  // 例外 3：符号表 readonlyPaths 命中的 args 属性 → 不消费（group/assembly 的 members）
  // 成员调用（receiver）是原地修改 compound，不消费 receiver
}
```

- 未知 callee → 无 readonly 信息 → **右侧出现即消费**（默认）。
- `exec.touch` 机制（装配变换后的原地修改通知）与活跃性判定无关，结果记在 `ExecutionResult.changed`。

### 5.3 符号表：唯一的函数信息载体（机器生成，无 per-函数代码）

`src/lang/symbol-table.generated.ts`（由 `scripts/gen-symbol-table.ts` 从 stdlib 的 **TS 签名**生成，禁手改 + 守卫测试）：

```jsonc
{
  "group":    { "readonlyPaths": ["members"] },
  "assembly": { "readonlyPaths": ["members"] },
  "copy":     { "readonlyPositions": [0] },
  "box": {}, "drill": {}, "union": {}, …      // 无 readonly 标注 → 空对象 = 默认消费语义
}
```

提取规则（纯机械）：位置形参类型为 `ReadonlyShape` → 记下标；options 属性类型为 `ReadonlyShape` / `readonly ReadonlyShape[]` → 记属性名。**库作者唯一的额外工作就是在签名里写类型**——这正是"第三方库提供是否修改入参的申明"的落地方式。

```ts
// src/mesh/types.ts
export type ReadonlyShape = Shape & { readonly [readonlyBrand]?: true }
```

可选品牌属性使任何 `Shape` 可赋给 `ReadonlyShape` 形参（调用方零负担）；它是**文档 + 符号表提取源 + 实现契约**，契约由测试守护，不靠类型系统强制。

符号表只有三个消费方，全部是均匀查表：`derivePartName`（§4.2）、`consumes`（§5.2）、`check()`（§6.4）。

### 5.4 效果对照

| 脚本 | 判定 | canvas 显示 |
|---|---|---|
| `let part0 = cad.box({…})` | 无消费者 | part0 |
| `part0 = cad.box(); part0 = cad.drill(part0, …)` | drill 即最后写者，其后无消费 | part0（最新状态） |
| `let part0 = cad.box(); let part1 = cad.drill(part0, …)` | part0 被 drill 消费 | part1 |
| `let part0 = cad.box(); let part1 = cad.copy(part0)` | copy 入参 readonly → 不消费 | part0、part1（两份） |
| `const { front: part1, back: part2 } = cad.split(part0)` | split 消费 part0 | part1、part2 |
| `let g = cad.group({ members:['part0','part1'] })` | members 路径 readonly → 不消费 | part0、part1、g |
| `let a = cad.assembly({members:['part0']}); a.do_assemble()` | 成员调用不消费 receiver | part0、a |
| `let x = myLib.clone(part0)`（未知函数） | 默认消费 part0 | x（命名侧走 R2 复用 part0，此处即 part0 显示新值） |

> `group` / `assembly` 自身也是 shape，同样按"是否被消费"判定终端。成员是否作为独立层级显示由宿主从 `ExecutionResult.compounds` 展开，**不对成员做二次活跃性判定**。

---

## 6. 执行模型与增量执行

### 6.1 管线

```
.faijs 文本
  → parseScript（acorn 闸门 + AST walk，零函数知识）→ ScriptIR
  → compileToModule → 零 import ESM 文本（每条语句一个 { id, deps, fn }）
  → 动态 import()（Node: data: URL；浏览器: Blob URL）
  → ModuleExecutor：持久 ctx 容器 + 按拓扑序调用语句 fn
  → collectResult：outputs / terminals / compounds / brepSolids / topology
```

**当前实现（取舍，非规范）**：编译产物是**零 import ESM**——`data:` URL 与 Blob URL 无法解析裸说明符，零 import 使产物能在两个平台直接 `import()`，无需 import map / 打包器 / 文件系统。这是**当前加载机制的实现取舍**，**不是语言规范要求**（路线图 §0.2 E4：语言能力不能被实现取舍反向阉割）。

**规范要求**：语言层允许顶层 `import`（路线图 V1.1），届时编译产物携带 import 说明符，模块解析由宿主 `ModuleResolver` 负责（V3）。

**红线（不变）**：编译输入只有 IR，用户原文不进 VM（parse-then-compile：执行完全交给 JS 虚拟机，VM 运行的是从 IR 编译的产物）。

### 6.2 统一 ABI（编译产物发射的唯一模板）

所有可从 `.faijs` 调用的可调用体签名：

```ts
(…源码里写了什么实参, exec: ExecContext) => Result | Promise<Result>
```

- compile 只按 IR 机械发射，**无任何按函数名的分支**：
  ```
  赋值语句:   ctx.<out> = await cad.<callee>(<inputs→ctx.*>, <args>, exec)
  解构语句:   const {<keys>} = await cad.<callee>(…, exec); ctx.<out_i> = <key_i>
  成员调用:   await ctx.<receiver>.<callee>(<args?>, exec)
  无赋值调用:  await cad.<callee>(…, exec)
  ```
- `cad` 命名空间 = 对象字面量装配（`internal-stdlib.ts` 的 `createInternalStdlib()`），全文件无任何 per-函数逻辑；`exec` 作为隐藏末参注入，不出现在 `.faijs` 文本与 `api.d.ts` 中。
- `ArgIR` 翻译：`VarRefIR → ctx.<name>`；`CallRefIR → cad.<callee>(…, exec)`；`ParamRefIR → ctx.<param>`。
- **参数即语句**：`const size = 20` 编译为 `ctx.size = 20`，占 `s1..sK`。

### 6.3 增量执行（三入口）

| API | 行为 |
|---|---|
| `execute(script)` | 全量：load 模块 → 逐条执行 |
| `append(script, newIds)` | **只执行新增语句**（前缀依赖已在持久 ctx） |
| `update(script)` | `plan()` 算出 stale 集 → `reconcileCtx` → 从 stale 集起重算（stale 集对 deps 封闭，按拓扑序） |

`plan()` 的判定（内容寻址，非 id diff）：

```
statementKey = callee | JSON(args) | 各依赖的 outputContentKey
              （参数语句的 key = param|JSON(value)）

对每条语句（拓扑序）：
  任一依赖 stale            → 本语句 stale（deps 级联）
  statementKey 与缓存相同    → 命中缓存，复用（记入 reused）
  否则                      → stale
stale 为空 → 零执行，直接用持久 ctx 组装结果
```

- `outputContentKey` = 输出 mesh 的内容哈希（参数语句 = 参数值），因此"上游几何变了但参数没变"也能正确级联。
- 参数语句参与 deps 级联——改参数会使全部引用它的语句 stale。
- 无赋值的语句（`hasAssignment: false`）不产出几何，不参与增量分析。

### 6.4 `check()`：dryRun 校验（零几何副作用）

`CadRuntime.check(code)` 四阶段，**全部无 per-函数代码**：

1. **parse** —— acorn 闸门 + AST walk（零知识解析），`ParseError` 带行号。
2. **符号检查** —— `callee ∈ 符号表`，未知 → `function "xxx" does not exist in the stdlib symbol table`（正常语言的未定义符号诊断）。有 `receiver` 的成员方法不查表（那是对象方法）。
3. **引用预检** —— 每条语句的 `inputs` 必须已由前面的语句或参数定义。
4. **终端引用预检** —— 显式 `return` 引用的变量必须已定义。

> 参数的**值域校验不在此处**：零向量、直径 ≤ 0、未知字段等由**各库函数自己检查并抛带上下文的 Error**（brepjs 模式），经 `ExecutionResult.failedAt` 反馈。`SCHEMAS`/`args-schema.ts` 已删除。

---

## 7. AI 代码生成模型 与 引擎增量执行

### 7.1 AI 如何生成代码：**总是全量，不生成 patch**

1. LLM 最擅长生成完整可运行代码，最难可靠生成结构化 patch。
2. **增量识别的职责放在引擎侧**（确定性算法），比依赖 AI 的 patch 格式更稳。
3. 这正好匹配"人类说把尺寸翻倍，AI 只需去更改原先的尺寸参数"——在全量视角下，就是 AI **保留那一行、只改 `size` 的值**。

AI 提交的契约（写进代码生成 system prompt）：

- 读取当前 `.faijs` **全文**（扁平格式，含所有既有语句）。
- 输出**完整新全文**：保留所有既有语句（除非用户要求删除），仅在既有行改值/改 callee，新增语句写在末尾。
- **不得重排、不得重命名既有变量**（重命名 = 旧的被删 + 新的被加，语义丢失且下游引用断裂）。
- **不得写控制流**（§0.1 原话）。不输出 `export default` / `return`。
- 新增变量可用任意合法 JS 标识符；若希望与 UI 生成的代码风格一致，可按 §4.2 规则命名。

> AI 提交 = "一次完整重写"，引擎负责"和上次提交比对，找出改了什么"。引擎无需信任 AI 的意图描述——**全部基于解析后的 IR 做客观比对**。

### 7.2 宿主侧 id 对齐（3d_editor 职责）

faijs 的增量是 `statementKey` 内容寻址（§6.3）；**语句级的新增/修改/删除分类由宿主按 `StmtId`/`PartName` 对齐**后，再调用 `append` / `update`：

| 判定 | 条件 | 类别 |
|---|---|---|
| 双方都有同一身份，`callee` 与 `args` 完全相同 | 内容 key 相同 | **UNCHANGED** |
| 双方都有同一身份，`callee` 同 `args` 异 | — | **PARAM 变更** |
| 双方都有同一身份，`callee` 异 | — | **STRUCT 变更** |
| 仅在新脚本中有 | 新增 | **ADD** → `append` |
| 仅在旧脚本中有 | 消失 | **DELETE** → 失效其缓存与下游 |

- **身份契约是硬约束**：引擎与宿主都只靠身份对齐，不看行号位置。AI 若把 `part0` 改名成 `p0`，会被判成"删 part0 + 加 p0"——功能上可能仍跑，但下游 `inputs:['part0']` 全部断引用报错。
- **DELETE 级联**：若某语句被删而其输出仍被下游引用（孤儿），推荐直接拒绝提交（AI 全量生成通常一并删除下游）；若确需级联，则把孤儿一并判为 DELETE 并级联其下游。

### 7.3 场景对照

| 场景 | AI 改动（全量文本） | 判定 | 引擎动作 |
|---|---|---|---|
| 把方块尺寸翻倍 | 保留 `part0 = cad.box(…)`，改 `size 20→40` | `part0` 参数变更 | 重算该语句，下游随 deps 级联重放 |
| 给零件加高（追加） | 末尾加 `part0 = cad.extrude(part0, { length:3 })` | ADD | 只执行新增（`append`） |
| 把钻孔改成雕刻 | 改 `callee: drill→engrave` | STRUCT 变更 | 从该语句起重放 |
| 人类滚花顶面（UI 追加） | UI 追加 `part0 = cad.knurl(part0, {…})` | ADD | 只执行新增 |
| 多 mesh：split + 布尔 | 追加 split（双输出）+ 立柱 + union | 全部 ADD | 只执行新增，跨模型引用直接命中 ctx |

---

## 8. 人类 UI ↔ AI 交织流程

**人类钻孔（UI）**：
1. 用户点击面 → 宿主根据交互派生 args。
2. 宿主调 `derivePartName({ callee:'drill', inputCount:1, outputCount:1, code })` → `behavior:'reuse'` → 语句写回 `part0`（不新分配名字）。
3. 追加语句到 `ScriptIR`，`CadRuntime.append(...)` 增量重算。
4. `scriptToCode(script)` 回写 `.faijs` 全文（代码视图同步）。

**AI 倒角（代码）**：
1. AI 读取当前 `.faijs` 全文。
2. AI 输出全量新全文（保留既有行、追加新语句）。
3. `parseScript` 解析（合法性闸门）→ 宿主按身份 diff（§7.2）→ 判定新增 → `append`，或判定参数变更 → `update`（`plan()` 算 stale 集合）。
4. 成功执行的 `ScriptIR` 写回宿主 store 作为下一次提交的基线。

两条路径**收敛到同一个 `ScriptIR`**，引擎只认 `ScriptIR`；人类和 AI 永远在改同一份事实源。AI 与 UI 的**来源标注、图标、颜色、timeline 展示**全部在宿主侧（faijs 不处理 UI 状态）。

---

## 9. 场景走查（端到端）

```js
// 0. 人类：建方块（UI 生成，创建类 → 新名 part0）
let part0 = cad.box({ size: 20 })

// 1. 人类：钻孔（单入单出 → 复用 part0，语义是"修改这个模型"）
part0 = cad.drill(part0, { diameter: 5, depth: 0, position: cad.faceCenter(part0), direction: 'normal' })

// 2. AI：加高（追加，单入单出 → 仍复用 part0）
part0 = cad.extrude(part0, { length: 3 })

// 3. AI：把尺寸翻倍（改 part0 那一行 box 的 size）
//    let part0 = cad.box({ size: 40 })   ← 仅改值

// 4. 人类：split 成两个模型（入出数量不同 → 新名 part1/part2，且 part0 被消费）
const { front: part1, back: part2 } = cad.split(part0, { normal: [0, 0, 1], offset: 0, cutMode: 'plane' })

// 5. AI：新立柱 + 布尔合并（新名 part3/part4；part1、part3 被 union 消费）
let part3 = cad.cylinder({ radius: 5, height: 40 })
let part4 = cad.union(part1, part3)

// 6. 人类：把 part2 归入装配（compound 不消费成员 → part2 仍在 canvas）
let asm1 = cad.assembly({ name: 'A', members: ['part2'], constraints: [] })
asm1.do_assemble()
```

终端推导（步骤 6 之后）：`part2`（被 assembly 引用但不被消费）、`part4`（无下游）、`asm1`（无下游）→ 三个终端。`part0`/`part1`/`part3` 已被消费，不显示。

增量表现：步骤 2/4/5/6 都是 ADD，只执行新增语句；步骤 3 只重算 `part0` 的 box 语句并级联下游；未被变更的前缀命中持久 `ctx`，**不重算**。

---

## 10. 远期：`.faits` 与第三方库

以下来自 `Faijs语言的思考.md`，**当前未实现**，仅记录方向，不构成本文档契约：

- **`.faits`**：带类型的源码（TS 形态），仅供 AI 编写，UI 不参与；去类型后与 `.faijs` 走同一管道。
- **第三方库**：任意 `.js`/`.faits` 模块，遵守"末参 exec"约定即可被 `.faijs` 调用；动态加载方案参考 brepjs（`C:\git\OpenCascade\brepjs\docs\dynamic-third-party-library-loading_cn.md`）。加载时随包提供同款符号表 json，合并进引擎符号表。
- **timeline 与特征**：timeline 是线性列表，一个节点对应一次操作（宿主侧 feature）。未来 faijs 支持函数定义后，可规定 feature 与函数一对一；第三方未知函数在 timeline 中可只显示只读函数名，不支持特征编辑。
- **不做的事**（明确非目标）：`Shape[]` 批量操作（R4，需语言层新语法）、控制流、`ReadonlyShape`+`Shape` 混合入参（R5）。

---

## 附：与旧版文档的差异速查

| 旧版（≤2026-08-26） | 现在 |
|---|---|
| `partN_vM` 版本链（SSA，一条语句一个新名） | `partN` + 重赋值（模型即变量，R2 复用名） |
| `op` 字段 + `op='boolean'` + `args.operation` | `callee`（`union`/`subtract`/`intersect` 三个函数） |
| `CadStatement` / `PartScript` | `StatementIR` / `ScriptIR`（`src/lang/types.ts`） |
| `stmt.id` = 变量名 | `stmt.id` = `sN`（StmtId）；变量名在 `outputs`（PartName） |
| `MESH_ONLY_OPS` / `BREP_NATIVE_OPS` 白名单 | 库函数内部 `resolvePath` 静态判定（无 brep 实现即 mesh-only） |
| `SCHEMAS` + `validateStatementArgs`（引擎集中校验） | 校验进各库函数；`check()` 只做 parse + 符号 + 引用诊断 |
| `NON_CONSUMING_OPS`（parser 与 terminal-dag 各硬编码一份） | 符号表的 readonly 数据（唯一真源），`consumes()` 查表 |
| "所有活跃 Shape 变量都显示" | DAG 活跃性：最后写者 + 下游无消费 |
| `GeomRef` / `AssetRef` 白名单（5 个 geom 名 + asset） | `CallRefIR`（任意 `cad.<fn>()` 嵌套调用） |
| `feature.createdBy` / `FeatureKind` | 已移除，来源与 UI 元数据是宿主职责 |
| parser 调用 `derivePartName` 改名 | parser 保留词法名；命名只在生成侧 |
