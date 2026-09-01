# .fai.js 语法设计

[English](syntax-design.md) | 中文

> 定位：本文档是 `.fai.js` 的**语法契约**与**增量执行契约** —— 可以写什么、它如何映射为 `ScriptIR`、生成侧如何命名、终端如何推导、引擎如何只重算变化的部分。
>
> 相邻：[`docs/api-contract.zh.md`](api-contract.zh.md) 是接口契约（身份、语句模型、终端判定、执行、几何分派）；[`docs/ops-api-inventory.zh.md`](ops-api-inventory.zh.md) 是写 `.fai.js` 代码用的生成式 API 手册。
>
> §1 引用本仓库之外 `Faijs语言的思考.md` 里的需求原话；本文档的英文版给出对应的英文转述。

---

## 1. 需求基线

### 1.1 需求原话

> - **R1** 需要能同时支持brep/mesh/sdf（甚至点云逆向）等各种建模方式。
> - **R2** 需要支持多个后端建模引擎，目前brep用occt，mesh用manifold。未来要支持引擎切换。
> - **R3** 需要能同时支持UI建模与AI建模。这是最重要的特性。UI建模也就是用户点击UI的时候生成脚本代码。AI建模是让大模型直接根据文本等描述生成建模源代码。要支持交互式运行，也就是UI和AI代码要能够交替生成，互相兼容。
> - **R4** faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
> - **R5** 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
> - **R6** faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
> - **R7** faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。
> - **R8** faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。
> - **R9** 必需再次强调，faijs必需是正常的语言，必需正常的设计。所有不符合这个要求的设计，都要给我去掉，目前的代码如何实现的不重要。唯一的例外，faijs必需是UI能够自动生成代码，比如AI/UI生成的代码能够和谐共存。
> - **R10** 规定faijs里不准出现控制流语句，也就是不能有if/for/while之类的语句。如此，canvas里如何决定显示哪些几何模型、timeline如何显示等需求不会被AI生成的代码破坏。
> - **R11** 约定 **UI 生成的代码统一采用 `partN`（N 为整数序号）， AI生成的代码不需要遵守此规定。faijs变量名只要是合法的 JS 标识符即可，变量命名规则仅针对 UI 生成的代码，手写或AI生成的代码可以用任意合法的变量名。**
> - **R12** canvas里如何决定显示哪些几何模型：目前是通过mesh dag的最终活跃性来自动推导的。是否沿用这个？最终还是采用这个方案，同时添加了keep语法，用户和库函数都可以设置keep/keepHidden来明确要求保留某个shape。
> - **R13** parser 这是乱来，完全违规。parser 只应对代码进行语法分析，怎么可能改写用户提供的代码。partN 这种命名是 UI 层的事情，怎么可能跑到 parser 层里，完全乱来。还篡改用户代码，莫名其妙。

### 1.2 由原话推出的硬约束

1. **合法 JS 子集** —— acorn 解析任意 `.fai.js` 文件均无错。
2. **先解析后编译** —— 文本先变成 `ScriptIR`，VM 执行的是由它编译出来的模块，绝不是用户原文。`eval` / `new Function` / 动态 `import()` 在 parser 层即被拒绝。
3. **无控制流** —— 唯一的语言级禁令（§2.1）；它保证 canvas 显示集合与"timeline 一行一节点"可推导。
4. **引擎零函数知识** —— parser / compile / codegen / runtime 中没有任何按函数名分支的代码；函数信息只有机器生成的符号表，且只承载"键是否存在"。
5. **UI 与 AI 收敛到同一份 `ScriptIR`** —— 引擎从不区分来源；图标、颜色、显示名都是宿主的职责。
6. **增量执行是强制项** —— 按行录制、按行增量重算（§6.3）。
7. **代码是唯一事实** —— 文本是唯一事实源；`ScriptIR` 只是 parser 从文本编译出的内部表示，属内部细节，可随时变更。`scriptIRToCode` / `statementIRToLine` 只用于调试重打。一个操作一行是扁平格式（UI 录制）的约定，不是投影关系的推论。
8. **命名是生成侧的职责** —— UI / AI / CLI 生成代码时调用 `derivePartName`；parser 既不命名也不改名。

---

## 2. 语法契约：合法的 JS 子集

### 2.1 允许与禁止

| 允许 | 说明 |
|---|---|
| 顶层 `import` | 模块声明而非控制流：必须是顶部连续的一块；命名空间须已在运行时注册 |
| 顶层函数定义 | 记为 `FunctionDefIR`；不是语句，不进 DAG |
| 可静态折叠的表达式 | 二元 / 模板 / 三元 / 展开折叠为字面量，并把语句标记为 `hasComputedArgs`（§2.4） |
| 任意被调函数、任意解构键 | parser 不知道也不需要校验函数名 |
| 成员方法调用 | `asm1.add_constraint({ … })`；调用永不消费它的接收者 |
| `return { shape: … }` / `return [ … ]` | 显式终端集，覆盖 DAG 的推导结果 |
| `await` | 可选且被剥离；codegen 从不输出它 |

| 禁止 | 诊断 |
|---|---|
| `if` / `for` / `while` / `do` / `switch` / `try` | `E_CONTROL_FLOW` —— canvas 与 timeline 将无法推导 |
| 动态 `import()` | `E_IMPORT` —— 控制流构造 |
| `eval` / `new Function` | `E_SYNTAX` —— 安全红线 |
| `export` | `E_SYNTAX` —— 声明输出是引擎的事 |
| 函数体内的 import、非连续的顶层 import | `E_IMPORT` |

### 2.2 文件容器

- **扁平格式**（UI 录制推荐）：一段纯语句序列；文本里没有 `export default` 时，parser 会在交给 acorn 之前把它包进合法容器，并按原始文本报错误行号。
- **`export default async (cad) => { … }`** 同样合法，直接解析；**`// apiVersion: N`** 是可选头部，默认 `1`。

### 2.3 语句形式

```
script   = import* function* (comment | param | stmt)*

param    = const <name> = <literal | foldable expression>

stmt     = (const|let) <id> = [await] <ns>.<fn>(<input>*, { <k>:<v>, … }?)
         | const { <k1>: <id1>, … } = [await] <ns>.<fn>(<input>*, {…}?)
         | <id> = [await] <ns>.<fn>(<input>*, {…}?)
         | <id>.<method>({ <k>:<v>, … }?)
         | return { shape: <id>, name?, color?, … }
         | return [ { shape: <id>, … }, … ]
```

- `<ns>` 是 `cad` 或 `mech` 这类导入的命名空间；位置参数必须是已声明的变量（零个、一个或多个），末尾的选项对象可以省略，也可以带 `keep` / `keepHidden`（§5.1）。
- 裸重赋值就是对已声明变量的普通 JS 赋值；"修改这个模型"在代码里就长这样。

### 2.4 表达式

| 形式 | 结果 |
|---|---|
| 字面量（数字 / 字符串 / 布尔 / null） | `JsonValue` |
| 参数名，或简写 `{ size }` | `ParamRefIR { $param }` —— 执行时才解析，永不折叠 |
| 已声明的变量名 | `VarRefIR { $ref }` |
| 数组 / 对象（递归） | `JsonValue[]` / `Record<string, ArgIR>` |
| 嵌套的 `<ns>.<fn>(…)` 调用 | `CallRefIR { $call }` —— 只读查询，不消费任何东西 |
| 二元 / 模板 / 三元 / 展开 | 折叠为字面量；语句被标记 `hasComputedArgs: true` |

折叠后的语句在 IR 里只留下字面量，因此宿主的编辑面必须把它降级为只读：把值写回去会抹掉原始表达式。

### 2.5 标识符

本项目产出的标识符（codegen 的变量名与参数名、固定词汇 `cad`、函数名、参数名）不得是 JavaScript（含严格模式与模块保留字）、Python 3、C11 或 Java 的保留字。AI 与手写代码可以用任意合法的 JS 标识符。

---

## 3. 语句模型 ↔ `StatementIR` 映射

`StatementIR` 与 `ScriptIR` 的字段级契约属于 [`docs/api-contract.zh.md`](api-contract.zh.md)；本节负责文本 ↔ IR 的映射。

### 3.1 映射规则

| 文本（扁平格式） | IR |
|---|---|
| `const size = 20` | 参数语句：`params += { name:'size', default:20 }`；引用形式是 `ParamRefIR { $param:'size' }`，编译为 `ctx.size = 20` |
| `let part0 = cad.box({ size })` | `{ id:'s2', callee:'box', args:{ size:{ $param:'size' } }, outputs:['part0'] }` |
| `let part1 = cad.drill(part0, { diameter:5 })` | `{ callee:'drill', inputs:['part0'], outputs:['part1'] }` |
| 嵌在参数里的 `cad.faceCenter(part0)` | `args.at = CallRefIR { $call:{ callee:'faceCenter', … } }` —— 语义由库解释；引擎并不知道 `faceCenter` |
| `const { front: part1, back: part2 } = cad.split(part0)` | `{ callee:'split', inputs:['part0'], outputs:['part1','part2'], outputKeys:['front','back'] }` |
| `let part2 = cad.union(part0, part1)` | `{ callee:'union', inputs:['part0','part1'], outputs:['part2'] }` —— `union` / `subtract` / `intersect` 是三个独立的函数 |
| `let g = cad.group({ members: [part0, part1] })` | `{ callee:'group', inputs:[], args:{ members:[{$ref:'part0'},{$ref:'part1'}] }, outputs:['g'] }` —— 成员来自通用的 `VarRefIR` 扫描 |
| `asm1.add_constraint({ type:'face_mate' })` | `{ callee:'add_constraint', receiver:'asm1', inputs:[], outputs:[] }` |
| `let part3 = mech.makeHeadstock({ length:120 })` | `{ namespace:'mech', callee:'makeHeadstock', outputs:['part3'] }` —— 命名空间取自 import 说明符 |
| `return [{ shape: part0 }, { shape: part2 }]` | `terminalShapes = [{ id:'part0' }, { id:'part2' }]` |

### 3.2 IR 是文本的编译产物

方向只有一个：文本 → `parseScript` → `ScriptIR` → `compileToModule` → VM（§6.1）；`scriptIRToCode` / `statementIRToLine` / `formatCodeLine` 只是调试用的重打工具，不是文本的来源。打印规则是机械的：已声明的名字裸重赋值（`part0 = …`），未声明的则声明（`let part0 = …`），解构渲染为 `const { front: a, back: b } = ns.callee(…)`，数字最多六位小数且不保留尾随零。

---

## 4. 生成侧的命名

### 4.1 `derivePartName` —— 一律新名

| 规则 | 条件 | 结果 |
|---|---|---|
| R0 | `outputCount === 0` | 没有名字（成员调用或空调用） |
| 唯一规则 | 其余所有情况 | 每个输出分到一个新的 `partN` |
| R4 | `inputCount > 1 && outputCount > 1 && inputCount === outputCount` | 拒绝：`Shape[]` 批量操作不是语言特性 |

入参只带语法事实 —— `inputCount`、`outputCount` 和代码文本，由词法扫描（`/\bpart(\d+)\b/g`）取下一个空闲序号；不解析、不查函数元数据。命名与被调函数是否保留入参无关：两种情况下都分配新名，保留由 `keep` 表达（§5）。

### 4.2 parser 不命名

parser 只做语法分析：把词法名字抄进 `inputs` / `outputs` / `receiver` / `$ref`，并检查被引用的变量已声明。它既不分配也不改写名字，因此 UI 生成的 `partN` 与 AI 写的 `asm1` 都会原样保留。

---

## 5. `keep` 与终端判定

### 5.1 声明保留

保留声明说的是"这次调用不消费这些入参"，让它们留在 canvas 上。它写在调用点，或在库函数体里声明一次；调用点优先。

```js
let part1 = cad.copy(part0)                                   // body keeps part0
let part2 = cad.drill(part0, { diameter: 8, keep: ['part0'] }) // call-site keep
let part3 = cad.union(part0, part1, { keepHidden: true })      // kept, hidden
```

```js
export function group(params) {
  keep(...params.members)
  return compound(params.members)
}
```

`keep` 接受变量引用或 `{ shape, hidden }` 条目；`keepHidden` 设置语句级默认值。`validateKeepDirectives` 会拒绝非数组的 `keep`、非变量引用的条目、既不是入参也不是参数变量的目标，以及非布尔的 `keepHidden`。

### 5.2 效果

| 脚本 | 终端 |
|---|---|
| `let part0 = cad.box({…})` | `part0` |
| `let part0 = cad.box(…)` 然后 `let part1 = cad.drill(part0, …)` | `part1` —— drill 消费了 `part0` |
| `let part1 = cad.copy(part0)` | `part0`、`part1` —— 函数体保留了源 |
| `const { front: part1, back: part2 } = cad.split(part0)` | `part1`、`part2` |
| `let g = cad.group({ members: [part0, part1] })` | `part0`、`part1`、`g` |
| `let a = cad.assembly({ members: [part0] })` 然后 `a.do_assemble()` | `part0`、`a` —— 成员调用永不消费它的接收者 |
| `let c = cad.bboxCenter(part0)` | `part0`、`c` —— 所有输出都是非几何，因此什么都不消费 |

这张表背后的判定链 —— 先保留，再"所有输出都是非几何"，最后默认消费 —— 以及叶子终端算法，属于 [`docs/api-contract.zh.md`](api-contract.zh.md)。

---

## 6. 执行与增量执行

### 6.1 流水线

```
.fai.js text
  → parseScript (acorn gate, zero function knowledge) → ScriptIR
  → compileToModule → zero-import ESM (one { id, deps, fn } per statement)
  → dynamic import() (Node: data: URL; browser: Blob URL)
  → ModuleExecutor: persistent ctx, statements called in topological order
  → collectResult: outputs / terminals / compounds / brepSolids / topology
```

编译只消费 IR，因此用户文本永不进入 VM。产物不带 import，是因为 `data:` URL 与 Blob URL 都无法解析裸说明符 —— 这是加载机制的属性，不是语言规则。

### 6.2 统一 ABI

库函数签名就是源码里写的样子 —— 没有隐式注入，没有尾随的上下文参数。编译发射四种形式：

```
assignment:      ctx.<out> = await ns.<ns>.<callee>(ctx.<input>, …, { …args })
destructuring:   const { <keys> } = await ns.<ns>.<callee>(…); ctx.<out_i> = <key_i>
member call:     await ctx.<receiver>.<callee>({ …args })
no assignment:   await ns.<ns>.<callee>(…)
```

`$param` 与 `$ref` 都编译成 `ctx.<name>`，嵌套的 `$call` 编译成 `await ns.<ns>.<callee>(…)`。参数声明本身也是语句（`ctx.size = 20`），所以改一个参数会像其它依赖一样级联。

### 6.3 增量执行（三个入口）

| API | 行为 |
|---|---|
| `execute(code)` | 全量：加载模块，然后执行每条语句 |
| `append(code, newIds)` | 只执行新语句 —— 前缀已在常驻 ctx 里 |
| `update(code)` | `plan()` 算出失效集 → `reconcileCtx` → 按拓扑序从该集重算；无失效时零执行 |

三个入口都接收代码文本（引擎内部解析文本为 IR 再执行）。`plan()` 是内容寻址的，不是 id diff。`statementKey` 由带命名空间的被调函数名、剔除 `keep` / `keepHidden` 后的 `args` JSON、以及每个依赖的 `outputContentKey` 组成；参数语句用 `param|JSON(value)`。因此保留与可见性零成本：切换 `keep` 不重算任何几何。语句失效的条件是某个依赖失效，或自身的 key 变了。

### 6.4 `check()`

`CadRuntime.check(code)` 是无几何副作用的干跑，分四阶段：**解析** —— acorn 闸门，`ParseError` 带行号与诊断码；**符号** —— `cad` 调用查符号表，带命名空间的调用查已注册的库，成员方法跳过；**keep** —— `validateKeepDirectives`，外加对拼错的 `keep` 前缀选项给出警告；**引用** —— 每个入参与显式终端都必须更早定义。值域不在这里检查：每个库函数自行校验入参并带上下文抛错，经 `ExecutionResult.failedAt` 暴露。

---

## 7. AI 与 UI 的交织

### 7.1 AI 提交全文

1. 模型最擅长产出完整可运行的代码，最不擅长产出可靠的结构化补丁。
2. 增量识别属于引擎 —— 一个确定性算法 —— 而不是模型。
3. "把尺寸翻倍"在全文视角下就是"保留那一行，把 `size` 的值改掉"。

AI 契约：读当前完整的 `.fai.js` 文本，返回完整的新文本 —— 除非要求删除，否则保留每一条已有语句；已有行只改值或被调函数名；新语句追加在末尾；绝不重排或重命名已有变量，绝不写控制流、`export default` 或 `return`。

### 7.2 宿主侧的对齐

引擎的增量是内容寻址的（§6.3）；把一条语句判定为新增、修改还是删除，是宿主的职责 —— 在调用 `append` 或 `update` 之前先对齐身份（`StmtId` / `PartName`）。

| 对比 | 类别 |
|---|---|
| 身份相同，被调函数与参数相同 | UNCHANGED |
| 身份相同，被调函数相同，参数不同 | PARAM 变更 |
| 身份相同，被调函数不同 | STRUCT 变更 |
| 只出现在新脚本里 | ADD → `append` |
| 只出现在旧脚本里 | DELETE → 作废它及其下游的缓存 |

对齐不看行号，所以把 `part0` 改名成 `p0` 会被读成"删掉 part0、新增 p0"，并打断所有下游的 `inputs: ['part0']`。被删语句的输出若仍被引用，就是孤儿：拒绝这次提交。

### 7.3 场景

| 场景 | 全文里的变化 | 引擎动作 |
|---|---|---|
| 把方块尺寸翻倍 | 改已有 box 行的 `size` | 重算该语句并级联 |
| 把零件加高 | 追加一行 `extrude` | `append`：只执行新语句 |
| 把钻孔改成刻字 | 改那一行的被调函数 | 从该语句起重放 |
| 人工给某个面滚花 | UI 追加一行 `knurl` | `append` |
| 切开后再布尔两个零件 | 追加 split、一根柱子和 union | `append`；跨零件引用命中 ctx |

---

## 8. 端到端示例

```js
// 0. UI creates a block
let part0 = cad.box({ size: 20 })
// 1. UI drills (part0 consumed)
let part1 = cad.drill(part0, { diameter: 5, depth: 0, position: cad.faceCenter(part0), direction: 'normal' })
// 2. AI makes it taller
let part2 = cad.extrude(part1, { length: 3 })
// 3. AI doubles the size: set size to 40 on the box line (a PARAM change)
// 4. UI splits (part2 consumed)
const { front: part3, back: part4 } = cad.split(part2, { normal: [0, 0, 1], offset: 0, cutMode: 'plane' })
// 5. AI adds a post and unions (part3, part5 consumed)
let part5 = cad.cylinder({ radius: 5, height: 40 })
let part6 = cad.union(part3, part5)
// 6. UI assembles part4 and keeps it visible
let asm1 = cad.assembly({ name: 'A', members: [part4], constraints: [], keep: [part4] })
asm1.do_assemble()
```

第 6 步之后的终端是 `part4`（被装配体保留）、`part6`、`asm1`；其余都被消费了。第 1、2、4、5、6 步只执行新语句；第 3 步重算 box 行并级联；未触及的前缀留在 ctx 里。

---

## 9. 相邻通道与非目标

- **整模块 TypeScript** 是第二条执行通道：剥掉类型后作为一个模块导入，由 `export` 指明输出。它不生成 IR，也永不进入 timeline —— 是一个逃生口，不属于 `.fai.js` 语句语言。
- **非目标**：控制流、`Shape[]` 批量操作、以及对已发布 Shape 的原地修改。
