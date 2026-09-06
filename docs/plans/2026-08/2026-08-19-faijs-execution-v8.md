# faijs 执行架构 v8（parser 静态提取 + JS 引擎执行 + 库化 op + 增量执行）

- 日期：2026-08-19
- 类型：架构设计方案
- 状态：**已废弃**
- 替代：`2026-08-18-assembly-execution-v7.md`（v7 的返回值四类设计**取消**，见 §0.7 第 2 条）
- ⚠️ 本方案已被 v9 取代，见 [2026-08-23-faijs-execution-v9.md](2026-08-23-faijs-execution-v9.md)

---

## 0. 用户原始要求（原话保留）

### 0.1 定位：faijs = UI 层生成代码

> faijs直接对应UI层生成的代码，没有控制流，顺序执行。faijs语法上也是js。
> 其他js后缀名则是正常的js代码，faijs里可以加载js库。
> 可以用js实现几何库，比如createGear这类的。也可以调用标准的js库。

### 0.2 取消 partN_vM 命名

> 取消现在的partN_vM的变量命名格式。变量的规则和js一致。

### 0.3 终端 = 全局作用域变量

> 判断有哪些solid/shape出现在屏幕上，只看有哪些变量在faijs的全局作用域。
> 比如：
> ```
> let box = cad.box()
> cad.drill(box)
> ```
> 屏幕上有一个box对象
> ```
> let box = cad.box()
> let box2 = cad.drill(box)
> ```
> 屏幕上有一个box, box2两个对象

### 0.4 类型标注必须定义在几何库处

> 不可能在faijs的代码库里定义这些类型。这样的话，第三方就无法扩展里。
> 必须是在定义几何库的地方带上类型。比如你前面定义的createGear函数，应该在这里定义类型

### 0.5 增量执行要求

> 场景1是用户在UI进行了新的操作，要执行一行新的代码。场景2是用户修改了历史feature，需要更新对应的模型。
> 场景2解决不了就全部重算也没关系。场景1必须支持。

### 0.6 执行模型：parser 只解析，执行在 JS VM

> parser只解析语法，实际的执行还是在js vm里，是否可以。
> 否则parser解析完，还是要处理各种js语法，比如如果加载外部库，如何处理库的加载顺序、依赖等等，太多的问题。

### 0.7 四点修正（2026-08-19 评审）

1. **.faijs 与 .js 严格分开**：
> 我的意思是只有.faijs文件需要和UI对应，可以由UI生成。其他代码都是js后缀，可以执行任意的js代码。两者分开。

2. **取消四种返回值类型及校验**：
> 由于判断有哪些solid/shape出现在屏幕上，只看有哪些变量在faijs的全局作用域。所以之前定义的四种返回值类型及其校验自然就无用了，要取消。

3. **op 实现全部库化**：
> 现有的所有写在faijs项目库中的各种op实现，应该改实现为库。要区分faijs执行引擎、faijs的语言（包括后缀.faijs/.js）。也就是不能在执行引擎中，或者说不能在faijs解释器中内置实现这些几何库。

4. **库命名空间与冲突**：
> 库代码的命名空间如何定义？比如cad前缀，如果是库实现的，代码怎么写？如何防止库之前的命名冲突？

**结论**：`cad` 是官方标准库的 namespace import（`@faicad/faijs/stdlib`），op 实现全部外移为库；命名冲突由 ES module 绑定名机制天然解决（import 重命名）。详见 §4.4。

### 0.8 建模能力由库声明，决策由引擎做（2026-08-19 二次评审）

> canUseBrep 毫无疑问是有库自己决定的。这需要有一个约定，就是引擎和库直接的约定。约定哪些是op，显示在UI上，每个op是否支持mesh，是否支持brep。引擎根据各个库的能力和当前的用户设置来决定如何建模

**结论**：定义 **Op 能力声明协议**（§4.6）：库在定义处用 `registerOp` 声明 op 名、参数 schema、几何种类、mesh/brep 支持；引擎持有能力表，按"能力表 + 用户 mode + 输入 solid 链状态"静态决策建模路径（brep/mesh），把决策结果通过 `exec` 上下文传给库函数。详见 §3.5、§4.6。

---

## 1. 核心设计原则

### 1.1 四层分离（引擎 / 语言 / 标准库 / 用户库）

**本次方案的根本边界**——执行引擎不实现任何几何：

| 层 | 内容 | 职责 |
|---|---|---|
| **faijs 执行引擎** | parser、codegen、executor、ctx、终端判定、**Op 能力表与建模决策**、BREP 持久缓存 | 解析/编译/调度/增量/决策，**不含任何几何实现** |
| **faijs 语言** | `.faijs`（UI 生成，无控制流顺序语句）与 `.js`（任意 JS）两种后缀 | 语法规则、调用约定 |
| **官方标准库** | `@faicad/faijs/stdlib`：box/drill/translate/... 全部 op 的库实现（从 `src/ops` 迁出），各自 `registerOp` 声明能力 | 几何库，被 `.faijs` 以 `cad.<name>` 调用 |
| **用户/第三方库** | 任意 `.js` 模块（几何库、标准 JS 库），可 `registerOp` 声明能力 | 被 `.faijs` 以 import 绑定名调用 |

**铁律**：引擎不认识 `box`、不认识 `drill`、不认识 `cad`——只做结构提取、调用编排与**基于能力表的建模决策**。几何实现（包括官方 op）全部在库侧。

### 1.2 静态层 / 编译层 / 执行层

| 层 | 负责 | 不负责 |
|---|---|---|
| **静态层**（parser） | acorn 解析、语句提取（id/op/args/inputs）、schema 参数校验、引用预检、import 绑定校验、callee 能力校验 | 执行语义、库依赖、作用域 |
| **编译层**（codegen） | 每条语句 → 独立 JS 函数 `(ctx, exec) => {...}`；import 语句 → 真 ESM import；生成语句函数表 | 求值、执行 |
| **执行层**（JS 引擎） | 执行编译产物：模块加载、依赖解析、作用域、闭包、库函数调用 | faijs 语句结构、建模决策 |

**关键结论**：库加载顺序、循环依赖、作用域、表达式求值、命名冲突——全部交给 JS 引擎与 ES module 机制。faijs 不实现任何 JS 语义。

### 1.3 语句函数表（Statement Function Table）

**编译产物**是一个 ESM 模块，导出 `statements` 函数数组：

```js
// 编译产物（codegen 生成，每次脚本变更重新生成）
import * as cad from '@faicad/faijs/stdlib'
import { createGear } from './lib/gears.js'

export const statements = [
  { id: 'box',  fn: (ctx, exec) => { ctx.box = cad.box({ size: [10, 20, 5] }, exec) } },
  { id: 'box2', fn: (ctx, exec) => { ctx.box2 = cad.drill(ctx.box, { depth: 3 }, exec) } },
  { id: 'gear1', fn: (ctx, exec) => { ctx.gear1 = createGear({ teeth: 20, module: 1.5 }, exec) } },
]
```

- **`ctx`**：宿主侧持有的持久全局变量容器（`Record<string, unknown>`），跨执行存活
- **`exec`**：引擎每次执行构造的建模上下文（`{ path, solidCache, kernel, mode, ... }`），传给每个库函数
- **每条语句一个函数**：id 与 parser 提取的 CadStatement.id 一一对应（变量名）
- **引擎执行**：宿主调 `statements[i].fn(ctx, exec)`——单语句执行是 JS 函数调用，不是解释器遍历

### 1.4 执行入口（三个语义，对齐 Persistent SolidCache 方案）

| API | 场景 | 行为 |
|---|---|---|
| `execute(script)` | 首跑 / 全量 | 编译产物 → 引擎加载模块 → 依序调用全部语句函数 |
| `append(script, newIds)` | UI 新操作 | **只调用新增语句的函数**（`fn` 直接调，前缀不进循环） |
| `update(script)` | 改历史参数 | plan() 算变更点 → 从变更点起顺序调用语句函数（或全量重调，兜底） |

---

## 2. 现状代码核实

### 2.1 parser 已具备的能力（保留，删四类校验）

- `src/lang/parser.ts`：acorn 解析 → `PartScript`（`parseScript`，:620-851）。已支持：
  - `VariableDeclaration` 分支（:643-768）：`const x = cad.op(...)` → CadStatement，**id = 变量名**（:303-304）
  - `ExpressionStatement` 分支（:777-827）：裸调用（add_constraint / do_assemble）
  - `computeTerminalShapes`（:864-896）
- `src/lang/args-schema.ts`：参数 schema 校验（保留）；`returnType`（:23-34）**删除**（§0.7 第 2 条）
- `src/lang/types.ts`：`CadStatement.hasAssignment/returnType`（:136-143）**删除**；`ReturnType`（:104）**删除**

**删除项**（v7 返回值四类机制）：
- `args-schema.ts`：`returnType` 字段、`getOpReturnType`
- `parser.ts`：赋值校验（void 不准赋值 :734-739、new_shape 必须赋值 :427-431）
- `types.ts`：`ReturnType`、`hasAssignment`、`returnType`
- **行为变化**：`cad.drill(box)` 裸调用合法（不产生新变量 → 不显示）；`let x = assem1.do_assemble()` 合法（x = undefined → 不显示）。一切按 JS 语义，不做特殊校验。

### 2.2 op 实现现状（需外移为库）

`src/ops/` 是引擎内置的 op 实现目录（dispatcher 按 op 白名单分派）：

| 模块 | op |
|---|---|
| `src/ops/primitives.ts` | box/sphere/cylinder/cone/wedge |
| `src/ops/drill.ts` / `extrude.ts` / `split.ts` / `boolean.ts` / `engrave.ts` / `knurl.ts` | 特征操作 |
| `src/ops/transform.ts` | translate/rotate/scale |
| `src/ops/load.ts` / `text.ts` / `screw.ts` / `svgExtrude.ts` / `sdf.ts` | 创建类 |
| `src/ops/assemble.ts` / `group.ts` | 装配/组 |

**全部迁出**为 `@faicad/faijs/stdlib` 库实现（§0.7 第 3 条）。迁移后：

- `src/ops/dispatcher.ts` **删除**——语句函数表里 `cad.box(...)` 直接调用库函数，无分派
- `canUseBrep` / OpContext：**建模能力与路径选择归库**（§0.8）——库函数签名统一为 `fn(params, exec)`，`exec.path` 由引擎按能力表决策后注入（§3.5、§4.6）
- `src/brep/`、`src/mesh/`、`src/occt-kernel/`：**引擎侧保留**——它们是几何内核/平台（`solid()` 构造器、OCCT kernel、manifold），是库实现要调用的底料，不是"op 实现"
- `args-schema.ts` 的 `SCHEMAS`：**迁入 stdlib**——成为各 op `registerOp` 声明的 schema 字段（§4.6）

**区分标准**：引擎侧 = 与具体 op 无关的平台能力（内核、构造器、缓存、调度、能力表）；库侧 = 具体 op 的几何实现 + 能力声明。`solid()` 属于引擎侧（平台 API），`box()` 属于库侧（调用 `solid()` 与内核的几何实现）。

### 2.3 codegen 现状（扩展而非重写）

- `statementToLine`（:359-417）、`scriptToCode`（:427-517）——文本方向（UI 显示、导出）。
- **缺口**：没有"编译为可执行 JS 函数"能力。新增 `compileToModule(script): string`。

### 2.4 runtime 现状

- `CadRuntime` 已有实例级 `statementCache`（:154-158）、`brepSolidCache`（:161）、`topologyCache`（:168）
- `replay()` 解释执行循环 → v8 后替换为"语句函数表 + 引擎执行"
- `plan()`（:444-474）：stale 集合计算，保留（update 用）

### 2.5 BREP 持久缓存方案（已评审，直接采纳）

`docs/plans/2026-08-18-brepchain-persistent-solid-cache.md`：solidCache 实例级持久、三入口 API、op 层键值存取。v8 保留其 API 与缓存设计，执行单元从 `dispatchStatement(stmt)` 变为 `stmtFns[i](ctx, exec)`。

---

## 3. 设计：执行模型

### 3.1 编译规则（逐条语句）

```ts
// src/lang/codegen.ts 新增
export interface CompiledStatement {
  id: string
  fn: string
}
export function compileToModule(script: PartScript): string
```

| 语句形式 | 编译结果 |
|---|---|
| `const x = cad.op(inp?, {args})` | `(ctx, exec) => { ctx.x = cad.op(ctx.inp, { args }, exec) }` |
| `const x = cad.boolean(a, b)` | `(ctx, exec) => { ctx.x = cad.boolean(ctx.a, ctx.b, { operation }, exec) }` |
| `const {front, back} = cad.split(inp, {args})` | `(ctx, exec) => { const r = cad.split(ctx.inp, {...}, exec); ctx.front = r.front; ctx.back = r.back }` |
| `const x = createGear({args})`（库函数） | `(ctx, exec) => { ctx.x = createGear({ args }, exec) }` |
| `assem1.do_assemble()`（裸调用） | `(ctx, exec) => { ctx.assem1.do_assemble() }` |
| `const name = literal`（参数） | `(ctx, exec) => { ctx.name = literal }` |
| `import { x } from 'path'` | 提升到模块顶部（真 ESM import） |

**调用名解析规则**（§4.4）：语句中的 callee 必须是 `cad.<name>`（官方库）或当前模块的 import 绑定名（第三方库）；解析不到的调用在 parser 报错。

**库函数统一签名**：`fn(params, exec)`——引擎把建模上下文 `exec` 作为第二参数传入（`exec` 含 `path`/`solidCache`/`kernel`/`mode`，§3.5）。**此签名是引擎 ↔ 库的执行约定**，官方 stdlib 与第三方几何库都遵循。

**变量引用**：语句内所有变量引用编译为 `ctx.<name>`（inputs 由 parser 已解析，args 中字面量照抄，表达式原样保留由引擎求值）。

### 3.2 模块加载与执行（runtime 新增）

```ts
// src/cad-runtime/executor.ts（新增）
export interface CompiledModule {
  statements: Array<{ id: string; fn: (ctx: Record<string, unknown>, exec: ExecContext) => void }>
}

export interface ExecContext {
  mode: 'auto' | 'brep' | 'mesh'          // 用户设置
  path: 'brep' | 'mesh'                   // 本条语句的建模路径（引擎决策结果）
  solidCache: Map<string, ShapeHandle>    // 持久 BREP 缓存（Persistent SolidCache）
  kernel: OcctKernel | null
  // ...
}

export class ModuleExecutor {
  readonly ctx: Record<string, unknown> = {}   // 持久全局变量容器

  async load(moduleText: string): Promise<CompiledModule>   // Node: import() 数据 URL；Browser: import(Blob URL)
  async executeAll(module: CompiledModule, exec: ExecContext): Promise<void>
  async executeIds(module: CompiledModule, ids: string[], exec: ExecContext): Promise<void>   // append
  async executeFrom(module: CompiledModule, startIndex: number, exec: ExecContext): Promise<void>  // update
}
```

### 3.3 ctx 与增量

- `executeAll`：全部语句函数调用 → ctx 含所有变量
- `append`：`executeIds(module, ['box2'], exec)` → 只调 `box2` 的 fn → `ctx.box` 已在 ctx → 直接可用，前缀不重跑
- `update`：plan() 得变更 index → `executeFrom(module, i, exec)` → 变更点起顺序重算（语句顺序 = 拓扑序）

### 3.4 终端 = 全局作用域变量（显示规则）

**取消返回值四类与终端推导的复杂判据**（§0.7 第 2 条）。执行完成后：

```ts
function collectVisibleShapes(ctx: Record<string, unknown>): TerminalShape[] {
  const terminals: TerminalShape[] = []
  for (const [varName, value] of Object.entries(ctx)) {
    if (isShape(value)) terminals.push({ id: varName })   // 值是 Shape 实例 → 显示
  }
  return terminals
}
```

- `isShape(v)`：`v instanceof Shape` 或带 `kind` 字段的类型化几何对象（§4.2）
- 用户案例验证：
  - `let box = cad.box(); cad.drill(box)` → ctx 只有 `box` → 1 个对象 ✓
  - `let box = cad.box(); let box2 = cad.drill(box)` → ctx 有 `box`、`box2` → 2 个对象 ✓
- 非几何变量（数字、字符串、undefined——含 void 语句赋值）不显示
- `computeTerminalShapes` 删除或保留为静态预检工具（显示判定以 ctx 值为准）

### 3.5 建模决策（能力表 + 用户设置 → path）

**引擎在调用每条语句函数前，静态决策建模路径**（§0.8）——能力在库、决策在引擎：

```ts
function decidePath(stmt: CadStatement, decl: OpDeclaration, execBase): 'brep' | 'mesh' {
  if (execBase.mode === 'mesh') {
    if (!decl.mesh) throw new Error(`op "${stmt.op}" does not support mesh`)   // 静态判定，调用前报错
    return 'mesh'
  }
  if (execBase.mode === 'brep') {
    if (!decl.brep) throw new Error(`op "${stmt.op}" does not support brep`)
    return 'brep'
  }
  // auto：优先 brep——op 支持 brep 且所有输入 solid 链存活
  if (decl.brep && stmt.inputs.every((id) => solidCache.has(id))) return 'brep'
  if (!decl.mesh) throw new Error(`op "${stmt.op}" supports neither mesh nor brep`)
  return 'mesh'
}
```

- `decl` 来自能力表（`registerOp` 声明，§4.6）；`solidCache` 是持久缓存（断链 = 输入无 solid → 走 mesh）
- 决策结果写入 `exec.path`，随语句函数传入库实现——库函数内部按 `exec.path` 走对应实现
- **不变量保持**：静态判定，禁止运行时回退（库实现抛异常 = 设计缺陷，直接暴露）
- `canUseBrep` 的等价逻辑由此声明表驱动的 `decidePath` 取代

---

## 4. 设计：库加载、命名空间与类型标注

### 4.1 .faijs 与 .js 严格分开（§0.7 第 1 条）

| | `.faijs` | `.js` |
|---|---|---|
| 生成者 | **UI 生成**（也可手写） | 用户/第三方手写 |
| 语法 | 无控制流，顺序语句 + import | 任意 JS |
| 执行 | 经引擎：parser → codegen → JS 引擎执行 | JS 引擎直接执行（作为库被 .faijs import） |
| 角色 | 调用方（语句） | 被调用方（库） |

### 4.2 官方标准库：`@faicad/faijs/stdlib`

op 实现全部外移（§0.7 第 3 条），官方标准库作为单独入口：

```
@faicad/faijs
├── @faicad/faijs            # 执行引擎（parser/codegen/executor/ctx/能力表/缓存/平台 API）
├── @faicad/faijs/stdlib     # 官方几何库（box/drill/translate/... 全部 op 实现 + registerOp 声明）
```

```js
// stdlib 内部（src/stdlib/，从 src/ops 迁出）
import { solid, registerOp } from '@faicad/faijs'

export function box({ size, center, nRad }, exec) {
  if (exec.path === 'brep') { /* OCCT 构造 */ }
  return solid(meshData)                     // mesh 路径
}
registerOp({
  name: 'box', kind: 'solid', mesh: true, brep: true,
  schema: [ { name: 'size', type: 'numberOrVec3', required: true }, ... ],
})
```

**命名约定**：标准库导出裸函数名（`box`、`drill`），`.faijs` 通过 `import * as cad from '@faicad/faijs/stdlib'` 获得 `cad.box`、`cad.drill` 命名空间。

### 4.3 用户/第三方库

任意 `.js` 模块，`export` 函数即可被 `.faijs` 引用；若想让 UI 认识、让引擎决策建模路径，**可选** `registerOp` 声明：

```js
// lib/gears.js（第三方，标准 JS + JSDoc）
import { solid, registerOp } from '@faicad/faijs'

export function createGear({ teeth, module }, exec) {
  return solid(buildGearMesh({ teeth, module }))   // 默认仅 mesh，无需判断 exec.path
}

registerOp({
  name: 'createGear',
  kind: 'solid',
  mesh: true,
  brep: false,                       // 只支持 mesh
  schema: [ { name: 'teeth', type: 'number', required: true }, ... ],
})
```

**未注册的函数**：`isShape` 运行时判定兜底（能显示、能调用），但引擎无法为其做建模决策（auto 模式按 mesh 处理）与参数校验（UI 无表单）——建议几何库全部注册。

### 4.4 命名空间与冲突（§0.7 第 4 点）

**规则：faijs 语句中的调用名 = ES module 绑定名**。引擎不维护任何函数表，不内置任何命名空间：

```js
// 零件.faijs
import * as cad from '@faicad/faijs/stdlib'                    // 官方库命名空间
import { createGear } from './gears.js'                        // 第三方库
import { createGear as makePinion } from './pinion.js'         // 冲突解决：import 重命名

const box1 = cad.box({ size: [10, 20, 5] })                    // ① cad.<name> → 官方库
const gear1 = createGear({ teeth: 20 })                        // ② 绑定名 → 第三方库
const pinion1 = makePinion({ teeth: 12 })                      // ③ 重命名后的绑定名
```

**防冲突机制**：

1. **作用域 = import 绑定表**：库与库之间通过 ES module 隔离，同名导出用 import 重命名解决（JS 原生机制，引擎零参与）
2. **`cad` 不是保留字**：只是官方库的约定命名空间；第三方可 `import * as myCad from './my-lib.js'` 后写 `myCad.op(...)`
3. **parser 校验**（唯一防冲突规则）：
   - 语句 callee 是 `cad.<name>` → 校验 `<name>` 在能力表中存在（官方库注册表）
   - 语句 callee 是裸标识符 `<name>` → 校验 `<name>` 必须是 import 绑定名（当前模块的 `imports` 列表）
   - 两者都不满足 → ParseError（未知函数）
   - 变量名与绑定名相同（遮蔽）：按 JS 语义执行，parser 提示不拦截

### 4.5 类型标注：双层机制

**运行时值类型（主判据，事实）**——引擎提供类型化构造器：

```js
// @faicad/faijs 导出（平台 API，属于引擎侧）
export function solid(meshData): Shape      // kind: 'solid'
export function shape2d(data): Shape        // kind: 'shape2d'
export function curve(data): Shape          // kind: 'curve'
```

**静态声明（辅助）**——JSDoc，定义在库文件处：

```js
// lib/gears.js
/**
 * 创建齿轮
 * @param {{teeth: number, module: number}} params
 * @returns {import('@faicad/faijs').Solid}
 */
export function createGear(params, exec) { return solid(buildGearMesh(params)) }
```

**读取与使用**：

- Node/CLI：加载模块时用 typescript 库解析 JSDoc → 注册几何种类（仅用于编辑器提示/工具链）
- 浏览器：运行时值判定兜底（构造器产物自带 kind），JSDoc 解析可跳过
- 冲突时以运行时值为准（事实永远正确）

**赋值校验**：**取消**（§0.7 第 2 条）——`const x = ...` 与裸调用都不校验，显示与否只看 ctx 值是否 Shape。

### 4.6 Op 能力声明协议（引擎 ↔ 库契约，§0.8）

**这是引擎与库之间唯一的契约**：库在定义处声明能力，引擎持有能力表并据此决策。

```ts
// @faicad/faijs 导出（引擎侧）
export interface ArgFieldSchema {
  name: string
  type: 'number' | 'vec3' | 'string' | 'boolean' | 'any' | 'numberOrVec3'
  required: boolean
}

export interface OpDeclaration {
  name: string                            // op 名（= 导出函数名）
  kind: 'solid' | 'shape2d' | 'curve'     // 返回几何种类（缺省 'solid'）
  mesh: boolean                           // 是否支持 mesh 路径
  brep: boolean                           // 是否支持 brep 路径
  schema?: ArgFieldSchema[]               // 参数 schema（UI 表单 + 校验）
  displayName?: string                    // UI 显示名（可选）
}

export function registerOp(decl: OpDeclaration): void   // 库在模块顶层调用
```

**注册时机**：库模块被编译产物 import 时执行（模块副作用）→ 引擎能力表更新。引擎 `load()` 后能力表即完整。

**能力表的消费方**：

| 消费方 | 用途 |
|---|---|
| **建模决策** | `decidePath`（§3.5）：mode + decl.mesh/brep + 输入 solid 链 → path |
| **UI** | op 列表（哪些 op 显示在 UI 上）、参数表单（schema）、能力提示（mesh/brep 徽标） |
| **parser 校验** | callee 能力存在性、参数 schema 校验（调用前静态拦截） |

**能力表 ≠ 实现**：引擎只持有声明数据，不持有函数引用。调用始终通过 import 绑定（§4.4）。

---

## 5. 设计：增量执行（三入口语义）

### 5.1 execute（全量）

```ts
async execute(script: PartScript): Promise<ExecutionResult> {
  const moduleText = compileToModule(script)
  const module = await this.executor.load(moduleText)      // 加载 → 库模块副作用 → 能力表更新
  for (let i = 0; i < module.statements.length; i++) {
    const exec = this.buildExec(script.statements[i])      // decidePath → exec.path
    await this.executor.executeOne(module, i, exec)
  }
  return this.collectResult()   // 终端 = ctx 中的 Shape 变量
}
```

### 5.2 append（场景 1：UI 新操作，必须支持）

```ts
async append(script: PartScript, newIds: string[]): Promise<ExecutionResult> {
  const moduleText = compileToModule(script)
  const module = await this.executor.load(moduleText)
  for (const id of newIds) {
    const i = module.statements.findIndex((s) => s.id === id)
    const exec = this.buildExec(script.statements[i])
    await this.executor.executeOne(module, i, exec)   // 只调新增语句的 fn
  }
  return this.collectResult()
}
```

- 前缀语句函数**不调用**——执行成本 = O(新增语句数)
- 新语句输入变量已在 ctx（此前执行写入）——命中持久 ctx，天然可用
- 不检查、不遍历、不验证前缀（调用方操作顺序保证 ctx 完整性）
- `buildExec` 对每条语句独立决策 path（新增语句的输入 solid 链来自持久 solidCache）

### 5.3 update（场景 2：改历史参数）

```ts
async update(script: PartScript): Promise<ExecutionResult> {
  const changeIndex = this.plan(script)
  if (changeIndex < 0) return this.collectResult()
  const moduleText = compileToModule(script)
  const module = await this.executor.load(moduleText)
  for (let i = changeIndex; i < module.statements.length; i++) {
    const exec = this.buildExec(script.statements[i])
    await this.executor.executeOne(module, i, exec)
  }
  return this.collectResult()
}
```

- 语句顺序 = 拓扑序 → 变更点起连续重算即正确；跨 part 引用 → resolveShapeRef 子重放兜底
- 解决不了就全量重算兜底（场景 2 无硬性要求）

### 5.4 编译缓存

脚本未变 → 编译产物按文本 hash 缓存；引擎加载与函数调用开销是 O(新增语句) 量级，编译 O(语句数) 可接受；未来可增量拼接（开放决策）。

---

## 6. 逐文件改动契约

### 6.1 faijs 侧

| 文件 | 改动 |
|---|---|
| `src/lang/types.ts` | (1) 删除 `ReturnType`、`CadStatement.hasAssignment/returnType`。(2) `PartScript` 新增 `imports?: { source: string; names: string[] }[]`。(3) 新增 `ShapeKind`（'solid' \| 'shape2d' \| 'curve'）。 |
| `src/lang/parser.ts` | (1) 新增 `ImportDeclaration` 分支（记录 imports）。(2) 库函数调用（callee 非 cad.*）解析为普通语句，op = 绑定名；校验绑定名在 imports 中。(3) 删除赋值校验（:734-739 等 v7 四类校验）。(4) 删除 `_grpCounter` id 依赖。(5) callee 校验：`cad.<name>` 查能力表，裸绑定名查 imports。 |
| `src/lang/args-schema.ts` | (1) 删除 `returnType`、`getOpReturnType`。(2) `SCHEMAS` 迁往 stdlib（成为 registerOp 的 schema）。(3) 引擎侧保留 `validateStatementArgs` 通用校验器（消费能力表 schema）。 |
| `src/lang/codegen.ts` | (1) 新增 `compileToModule(script): string`（语句函数表 + import 提升 + ctx 引用注入 + `exec` 第二参数）。(2) `statementToLine`/`scriptToCode` 保留（UI 显示、导出）。 |
| `src/ops/**` → `src/stdlib/**` | **全部 op 实现迁出**为 `@faicad/faijs/stdlib` 库：box/drill/extrude/split/boolean/engrave/knurl/transform/load/text/screw/svgExtrude/sdf/assemble/group。每个 op：函数签名改 `fn(params, exec)` + `registerOp` 声明（kind/mesh/brep/schema）。`dispatcher.ts` 删除。 |
| `src/cad-runtime/executor.ts` | **新增**：`ModuleExecutor`（ctx 容器 + load/executeAll/executeOne/executeFrom）。 |
| `src/cad-runtime/runtime.ts` | (1) 新增 `execute`/`append`/`update` 三入口（内部走 ModuleExecutor）。(2) `replay` 别名或删除（开放决策）。(3) solidCache 持久化按 Persistent SolidCache 方案。(4) `collectResult`：终端 = ctx 中 Shape 变量。(5) 新增能力表（Map\<name, OpDeclaration\>）与 `buildExec`/`decidePath`。 |
| `src/ops/types.ts` | `Shape` 新增 `kind?: ShapeKind`；`OpContext` → `ExecContext`（mode/path/solidCache/kernel），由引擎构造。 |
| `src/index.ts` / `src/browser.ts` | (1) 引擎侧导出：`solid`/`shape2d`/`curve` 构造器、`compileToModule`、`ModuleExecutor`、`registerOp`、`OpDeclaration` 类型。(2) 新增 `src/stdlib/index.ts` 作为 `@faicad/faijs/stdlib` 入口（package.json exports 增加 `./stdlib`）。 |
| `src/test-helpers.ts` | 适配：replayScript 可选走 ModuleExecutor；终端取 ctx 值。 |

### 6.2 3d_editor 侧

| 文件 | 改动 |
|---|---|
| `executeScript.ts` | 终端创建改为遍历执行后的 ctx 值；sceneScript 存储新增 imports 字段。 |
| `ScriptEngine.ts` | (1) append 场景（recordPrimitive/recordDrill/commitAndRecord 等）→ `runtime.append(script, [新语句id])`。(2) `editStatement` → `runtime.update(script)`。(3) `replayPart` 删除每次 releaseBrepChainState。 |
| `assemble-store.ts` | `confirmAssemble` 删除独立 rotate/translate 语句（v7 已定），改 assemble + do_assemble 语句。 |
| `TimelinePanel.tsx` | do_assemble 不产生节点；库调用语句显示为一条节点（op=库函数名）。 |
| **op 面板（新增/改造）** | op 列表与参数表单改由能力表驱动：遍历 `registerOp` 注册的 op（UI 只显示注册过的 op，§0.8"约定哪些是 op，显示在 UI 上"）。 |
| 各测试 | 适配变量名规则、终端 = ctx 值。 |

### 6.3 package.json

`exports` 新增 `./stdlib` 子路径（`dist/stdlib/index.js` + `.d.ts`）。

---

## 7. 落地案例

### 案例 1：UI 基础操作流（append 增量，场景 1）

**用户操作序列**（3d_editor）：

1. 建方体 → `.faijs` 追加 `let box = cad.box({ size: [10, 20, 5] })`
2. 钻孔 → 追加 `let box2 = cad.drill(box, { depth: 3 })`
3. 再建球 → 追加 `let sphere1 = cad.sphere({ radius: 4 })`

**执行轨迹**：

```
第 1 次: execute  → 编译 [f1]         → 调 f1(ctx, exec1) → ctx = { box: Shape }
第 2 次: append   → 编译 [f1, f2]     → 只调 f2(ctx, exec2)，ctx.box 直接取用 → ctx = { box, box2 }
第 3 次: append   → 编译 [f1, f2, f3] → 只调 f3(ctx, exec3) → ctx = { box, box2, sphere1 }
```

**结果**：屏幕 3 个对象，每次操作只执行一条语句函数。

### 案例 2：加载几何库（createGear + 能力声明）

```js
// lib/gears.js（第三方库，标准 JS + JSDoc + registerOp）
import { solid, registerOp } from '@faicad/faijs'

/**
 * 创建齿轮
 * @param {{teeth: number, module: number, width: number}} params
 * @returns {import('@faicad/faijs').Solid}
 */
export function createGear({ teeth, module, width }, exec) {
  return solid(buildGearMesh({ teeth, module, width }))   // 只支持 mesh，无需判断 exec.path
}

registerOp({
  name: 'createGear', kind: 'solid', mesh: true, brep: false,
  schema: [
    { name: 'teeth', type: 'number', required: true },
    { name: 'module', type: 'number', required: true },
    { name: 'width', type: 'number', required: true },
  ],
})
```

```js
// 零件.faijs（UI 生成 + 用户手写 import）
import { createGear } from './lib/gears.js'
let box = cad.box({ size: [10, 20, 5] })
let gear1 = createGear({ teeth: 20, module: 1.5, width: 4 })
let box2 = cad.drill(box, { depth: 3 })
```

**执行**：

- 编译产物 import gears.js → 模块加载 → `registerOp` 执行 → 能力表新增 createGear
- `gear1` 语句：`decidePath`（auto 模式，createGear.brep=false）→ path='mesh' → exec.path='mesh' → 调 createGear(params, exec) → 返回 solid 产物 → 屏幕显示
- **用户在 brep 模式下** → `decidePath` 调用前抛错 `op "createGear" does not support brep`（静态判定，无回退）
- **UI op 面板**：createGear 出现在列表（含 schema 表单、mesh 徽标）

### 案例 3：修改历史参数（update，场景 2）

用户把 `box` 的 size 从 `[10,20,5]` 改为 `[12,20,5]`：

```
语句: [box(变了), box2(依赖 box), gear1(独立)]
plan(): stale = [box, box2]
update(): executeFrom(changeIndex) → 调 f_box → 调 f_box2；f_gear1 不调用，ctx.gear1 保留
```

失败 → 全量 executeAll 兜底。

### 案例 4：标准 JS 库调用（非几何返回值）

```js
// lib/math.js
export function ratio(w, d) { return w / d }

// 零件.faijs
import { ratio } from './lib/math.js'
let r = ratio(10, 5)              // 数字 → 不显示（isShape false）
let box = cad.box({ size: [10, 20 * r, 5] })   // 表达式由引擎求值
```

### 案例 5：终端显示规则（用户 0.3 案例直接验证）

```
let box = cad.box()
cad.drill(box)         // ctx = { box: Shape } → 1 个对象 ✓
```
```
let box = cad.box()
let box2 = cad.drill(box)   // ctx = { box, box2 } → 2 个对象 ✓
```

### 案例 6：命名冲突（§4.4 验证）

```js
import * as cad from '@faicad/faijs/stdlib'
import { gear } from './gears.js'
import { gear as pinion } from './pinion.js'    // 同名 → 重命名

let a = cad.box({ size: 10 })    // 官方库
let b = gear({ teeth: 20 })      // gears.js
let c = pinion({ teeth: 12 })    // pinion.js — 无冲突
```

### 案例 7：双路径 op 的建模决策（§3.5 验证）

```js
// stdlib: drill 声明 mesh:true, brep:true
let box = cad.box({ size: 10 })                  // auto: box.brep=true, 无输入 → path='brep'
let box2 = cad.drill(box, { depth: 3 })          // auto: drill.brep=true, 输入 box 有 solid → path='brep'
let gear1 = createGear({ teeth: 20 })            // auto: createGear.brep=false → path='mesh'
let box3 = cad.drill(box2, { depth: 2 })         // auto: 输入 box2 有 solid → path='brep'
let box4 = cad.engrave(box3, { text: 'X' })      // engrave 声明 mesh:true, brep:false → path='mesh'（断链）
let box5 = cad.drill(box4, { depth: 1 })         // auto: 输入 box4 无 solid（engrave 断链）→ path='mesh'
```

---

## 8. 测试计划

### 8.1 faijs

1. **append 只执行新语句**：executeAll 后 append → 新增语句函数被调用、前缀函数未被调用（spy）、ctx 输出正确
2. **终端 = ctx 变量**：混合几何/非几何/undefined 变量 → collectVisibleShapes 只返回 Shape
3. **库调用语句**：编译产物含 import；执行后 ctx 含库返回值；registerOp 能力表注册生效
4. **update 变更点重算**：改 args → plan 得变更 index → executeFrom 只重算后缀
5. **表达式求值**：args 含 `20 * ctx.r` → 引擎求值正确
6. **类型化构造器**：`solid()`/`shape2d()`/`curve()` 产物 kind 正确；JSDoc 与运行时冲突以运行时为准
7. **BREP 持久缓存**：append 后新语句输入 solid 命中持久缓存
8. **命名校验**：未知 callee（非 cad.*、非 import 绑定）→ ParseError；import 重命名后调用成功
9. **stdlib 迁移**：op 实现从 src/ops 迁出后，全部 op 功能测试照常通过（stdlib 作为库被调用）
10. **四类校验删除**：`cad.drill(box)` 裸调用合法；`let x = assem1.do_assemble()` 合法且 x 不显示
11. **建模决策**（§3.5）：auto 模式优先 brep；brep 模式下调 mesh-only op → 调用前报错；mesh 模式下调 brep-only op → 报错；断链（engrave）后下游自动 mesh（案例 7 全序列）
12. **能力表驱动 UI**：注册的 op 出现在列表，未注册的不出现；schema 驱动表单字段

### 8.2 3d_editor

1. 案例 1 操作流端到端：3 次操作 → 3 个对象、timeline 3 节点
2. `recordDrill` 走 append：只执行新语句断言
3. `editStatement` 走 update：stale 集合断言
4. op 面板按能力表渲染（mesh/brep 徽标、模式切换后不可用 op 置灰）

---

## 9. 边界情况

| 场景 | 行为 |
|---|---|
| import 路径错误 / 循环依赖 | JS 引擎报错 → 透传给宿主（faijs 不处理模块错误） |
| 库函数返回非 Shape | isShape false → 不显示 |
| 未 registerOp 的库函数 | 可调用、可显示（运行时判定）；无建模决策（按 mesh）、无 UI 表单 |
| 浏览器无 JSDoc 解析 | 跳过静态注册，运行时判定正常 |
| 首跑 / dispose 后 | executeAll 全量 |
| 用户在 mesh 模式下调 brep-only op | decidePath 调用前报错（静态判定） |
| 变量名与 JS 保留字冲突 | parser 拒绝（变量规则与 JS 一致） |
| 两个库同名导出 | import 重命名（JS 原生） |
| `cad` 命名空间被第三方占用 | 允许（`cad` 非保留字），用户自行 import 重命名官方库 |
| 库调用语句 append | 与普通语句同路径（能力表已含该 op） |
| 能力表重复注册同名 op | 后注册覆盖（警告），顺序 = import 执行顺序 |

---

## 10. 开放决策

1. **`replay` 改名 `execute` 的兼容**：建议直接替换全部调用点，不留别名。
2. **编译产物缓存**：脚本文本 hash → 缓存编译结果；增量拼接留作增强。
3. **JSDoc 解析器放置**：Node 侧用 typescript 库；浏览器侧完全靠运行时判定（保持体积）。
4. **stdlib 拆包时机**：先同仓多入口（`@faicad/faijs/stdlib`），未来量大再拆独立包。
5. **`import` 语句是否允许 UI 生成**：UI 只生成 cad.* 语句；import 由用户手写追加（编译时统一提升）。
6. **库函数产物的 BREP 能力**：库内部用 OCCT 构造 API（`exec.kernel`）+ `solidFromBrep` 构造器才有 BREP；默认 mesh。`solidFromBrep` 构造器二期提供。
7. **能力表与 schema 校验时机**：parser 静态校验（加载库后）还是执行前动态校验？建议执行前（库加载后能力表才完整）。
8. **registerOp 的模块副作用与编译缓存**：编译产物缓存的模块在引擎重新 load 时副作用重新执行（能力表重新注册）——幂等约定写入契约。

---

## 11. 一句话总结

> **faijs 执行引擎不含任何几何实现**：parser 只做静态提取（语句、import 绑定、参数校验），codegen 把每条语句编译成 `(ctx, exec) => {...}` 独立 JS 函数，JS 引擎执行编译产物。op 实现全部外移为库——官方标准库 `@faicad/faijs/stdlib`（`.faijs` 中以 `cad.<name>` 调用）与用户/第三方 `.js` 库（以 import 绑定名调用，冲突靠 import 重命名）。**引擎 ↔ 库契约 = Op 能力声明协议**：库在定义处 `registerOp` 声明（op 名、参数 schema、几何种类、mesh/brep 支持），引擎持有能力表，按"能力表 + 用户 mode + 输入 solid 链状态"静态决策建模路径（`exec.path`），库函数按 path 走对应实现。终端判定取消返回值四类校验，只看执行后 ctx 中哪些变量是 Shape。增量 = 只调用新增语句的函数（append）/ 从变更点重算（update）。