# keep 语法设计 —— 统一的内外 keep 机制

日期：2026-08-28
状态：已裁定（决策点 D1/D2/D5/D6/D7 均采纳 §12 推荐），实施中
上位文档：`docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`（第三方库支持路线图）
相关文档：
- `docs/analysis/2026-08-28-canvas-display-set-alternatives.md`
- `docs/plans/2026-08-27-restore-dag-terminal-detection.md`

---

## 0. 需求

| # | 需求 | 判据 / 落实 |
|---|---|---|
| R1 | `keep` 语法叠加在现有 DAG 之上 | §3.3 回归锚点 |
| R2 | 所有方法都支持，含第三方 | §7.1 剥离 → 语言级指令；§2.2 第三方可用 `exec.keep` |
| R3 | 能指明 keep 哪些入参 | §2.3 `keep: [a, b]` 数组 |
| R4 | 能指明 keep 时是否 hidden | §2.3 `keepHidden` / 逐条目 `hidden` |
| R5 | `union(a,b)` 保留 a、b 且隐藏，c 正常显示 | §2.5 union 函数体 `exec.keepHidden` |
| R6 | `group(a,b)` 保留且正常显示 | §2.5 group 函数体 `exec.keep`（可见） |
| R7 | 类型系统中取消 `ReadonlyShape` | §4.1 |
| R8 | DAG 活跃性判断保留 | §3 |
| R9 | 支持签名/类型未知的第三方库 | §2.2 / §3.2 C3 / §5 |
| R10 | 非 shape 如何排除 / 谁判定类型 | §5 |

| R11 | 统一内外 keep：函数体内可声明，调用点可声明 | 两种写法是同一机制的两面（§2） |
| R12 | 用户（调用点）优先级 > 函数内部 | `drill(a, {keep:['a']})` 覆盖函数内部默认（§2.4） |
| R13 | 命名与「是否保留」解耦 | 命名不依赖任何静态保留知识（§4.1） |
| R14 | 命名「总是新名」 | UI 层不复用输入变量名（§4） |

---

## 1. 设计要点总览

| 项 | 设计 |
|---|---|
| keep 声明位置 | **调用点 + 函数体内**，统一机制（§2） |
| 优先级 | **调用点 > 函数体**（§2.4） |
| 消费判定 | C0 调用点 keep → C1 函数体 `exec.keep`/`exec.keepHidden` → C3 无几何输出 → C5 默认消费（§3） |
| 命名 | **一律新名**（只保留 R0/R4；§4） |
| 类型判定 | 运行时自动登记（`isShapeLike`/`isCompoundLike`）+ `activeValues`（§5） |
| 内置默认 | group/assembly/copy → `exec.keep`（保留可见）；union/subtract/intersect → `exec.keepHidden`（保留隐藏，R5）（§2.5） |

---

## 2. 统一的 keep 机制（R11–R13）

### 2.1 两处声明、一个优先级

| 层级 | 写法 | 声明者 | 时机 | 优先级 |
|---|---|---|---|---|
| **调用点** | `cad.drill(a, { keep:['a'], keepHidden:true })` | UI / AI / 用户 | 静态（录制期） | **最高** |
| **函数体** | `exec.keep(...members)` / `exec.keepHidden(...)` | 库作者（内置或第三方） | 运行时（执行期） | 被调用点覆盖 |

```js
// ── 函数体内（库作者写的）──
function group(params, exec) {          // 内置 stdlib
  const members = params.members ?? []
  exec.keep(...members)                 // ← 默认保留成员
  return compound(members)
}
function drill(input, params, exec) {   // 不声明 → 默认消费
  return doDrill(input, params, exec)
}

// ── 调用点（用户写的）──
let g   = cad.group({ members: [a, b] })                      // a、b 被保留（函数体默认）
let d   = cad.drill(c, { diameter: 8 })                       // c 被消费（无声明）
let d2  = cad.drill(c, { diameter: 8, keep: ['c'] })          // c 被保留（调用点覆盖）
let u   = cad.union(a, b)                                      // a、b 默认保留且隐藏（内置 exec.keepHidden），c 正常显示
let h   = mech.makeHeadstock({ spec: 'C6140', keep: [part0] })// 第三方函数同样适用
```

### 2.2 函数体内：`exec.keep` / `exec.keepHidden`

```ts
// ExecContext 新增（同时进入 SDK 导出面，第三方库可用）
keep(...shapes: Shape[]): void         // 声明保留（可见）
keepHidden(...shapes: Shape[]): void   // 声明保留（隐藏）
```

**为什么挂在 `exec` 上而不是全局 `keep()`**：

| 方案 | 问题 |
|---|---|
| 全局 `keep()` | 需要模块级单例作用域 → 与生态路线图 §3.4「运行时状态全局锚点」冲突；且拿不到「当前是哪条语句」 |
| **`exec.keep()`** | `exec` 本就是逐语句注入的（第三方库函数末参即 `exec`，路线图 §4.1）；`exec.currentStmt` **已存在**（`compound.ts:257` 就在用它推导成员名）→ 零新增机制 |

**时机与持久化**（增量执行下必须说清）：

- `exec.keep(shape)` 经 `exec.shapeToName`（`exec-context.ts:127`，`WeakMap<object, PartName>`）反查变量名，写入 `internalKeep: Map<StmtId, {kept: Set<PartName>, hidden: Map<PartName, boolean>}>`；
- **语句执行前**清空本条记录，**执行中**累加；
- 本轮**未执行**（缓存命中）→ 保留上一轮记录。

`shapeToName` 的预填充已存在（`runtime.ts:525-533` 从持久 ctx 预填；`module-executor.ts:242` 执行后写入），可直接使用。

**归属规则**：`exec.keep` 登记到「当前正在执行的语句」（`exec.currentStmt.id`）。嵌套调用（CallRefIR，如 `split(cad.union(a,b),…)`）中库函数发出的 keep 归属到外层语句——内层调用与外层共用同一 `exec.currentStmt`。

**边界**：函数抛异常前已调用的 `exec.keep` 仍会登记。失败结果本就部分，建议宿主在 `failedAt` 存在时不重建场景树。

### 2.3 调用点：`keep` / `keepHidden`

| 键 | 类型 | 语义 |
|---|---|---|
| `keep` | `Array<VarRefIR \| string \| {shape: VarRefIR \| string, hidden?: boolean}>` | 声明保留；**覆盖**函数体内的同名声明。标识符（`keep:[a,b]`）与字符串字面量（`keep:['a']`）两种形态等价 |
| `keepHidden` | `boolean`（默认 `false`） | 语句级 hidden 默认；被逐条目 `hidden` 覆盖 |

### 2.4 合并算法（设计契约）

```ts
interface KeepResolution {
  kept: Set<PartName>
  hidden: Map<PartName, boolean>     // 未列出者 = 可见
}

function resolveKeep(
  stmt: StatementIR,
  internal: { kept: Set<PartName>; hidden: Map<PartName, boolean> } | undefined,
): KeepResolution {
  const user = parseUserKeep(stmt)        // { targets, hidden, statementDefault }

  const kept = new Set(internal?.kept ?? [])
  const hidden = new Map(internal?.hidden ?? [])

  // 调用点声明覆盖（优先级更高）
  for (const v of user.targets) {
    kept.add(v)
    hidden.set(v, user.hidden.get(v) ?? user.statementDefault)
  }
  return { kept, hidden }
}
```

优先级体现为两步顺序：先铺函数体声明，再用调用点声明**覆盖写入**。

### 2.5 内置函数采用函数体声明（统一机制）

R11 要求函数体与调用点是同一机制的两面——内置函数**带头示范**：凡「保留入参」的语义一律在函数体内显式声明，而非依赖推断。收益：① 保留成为**显式契约**（读函数体即知）；② 可带 hidden（`exec.keepHidden`）；③ 第三方库照抄同一写法（R2）。

| 内置函数 | 函数体内声明 | 调用点默认效果 |
|---|---|---|
| `group` / `assembly` | `exec.keep(...members)` | 成员保留且可见（= 现状 R6） |
| `copy` | `exec.keep(input)` | 源保留且可见（= 现状，`copy.ts:9` 明写「画布显示 box 和副本两份」） |
| `union` / `subtract` / `intersect` | `exec.keepHidden(...inputs)` | 输入保留且隐藏（= 3d_editor 现状 R5） |
| `drill` / `extrude` / `transform` / `split` | 不声明 | 输入被消费（= 现状） |

**保留必须显式声明**：第三方库若返回 compound 且成员应保留/隐藏，必须在函数体内 `exec.keep(...members)` / `exec.keepHidden(...members)`——否则成员按 C5 默认消费（不再单独显示）。**SDK 文档须明示此契约**（§10 E2）。

### 2.6 parser 零改动

`parseValueExpr`（`parser.ts:67-147`）已覆盖 `keep`/`keepHidden` 全部形态：

| 源码 | AST | 产出 |
|---|---|---|
| `keep: [a, b]` | Array→Identifier | `[{$ref:'a'},{$ref:'b'}]`（:79-95） |
| `keepHidden: true` | Literal | `true`（:76-77） |
| `{shape:a, hidden:true}` | ObjectExpression | `{shape:{$ref:'a'},hidden:true}`（:97-119） |

守住分层红线：**parser 只做语法分析**。`parseValueExpr:90` 已对未声明标识符抛错，引用不存在的变量在解析期即报错。

---

## 3. 消费判定：C0–C5（R8/R9）

### 3.1 声明层（显式意图）

| # | 规则 | 判据 | 覆盖 |
|---|---|---|---|
| **C0** | **调用点 `keep`** | `resolveKeep().kept.has(v)` | 用户/UI 显式意图；**第三方函数同样可用，且不依赖任何签名知识** |
| **C1** | **函数体 `exec.keep`** | 同上 | group/assembly/copy/union 系/第三方库声明 |

### 3.2 推断层（无声明时的客观默认）

| # | 规则 | 判据 | 覆盖 |
|---|---|---|---|
| **C3** | 本语句无 Shape 输出 | `hasAssignment && outputs.length>0 && 所有 outputs 非 Shape/compound` | **第三方测量/查询/纯数据函数** |
| **C5** | 默认：消费 | — | drill/transform/未声明保留的第三方几何函数 |

判定顺序：C0 → C1 → C3 → C5（短路）。

**两层的关系**：声明层是「有人表态」，推断层是「没人表态时的客观默认」。这不是两套机制 —— 用户面对的机制只有一个（`keep`）。

**C3 为什么成立**：faijs 的执行模型是**纯函数链**（op 返回新 Shape，不原地改写；唯一原地操作是 receiver 形态的 `add_constraint`/`do_assemble`，已由既有 receiver 规则处理）。在此模型下「返回非几何的函数不可能把几何吞进结果」是必然推论 —— 零签名知识。守卫 `hasAssignment && outputs.length>0` 避开 void op。

> ★ 决策点 **D6**：推断层 C3 是否保留？推荐**保留**——C3 是 R9 的关键规则（第三方测量/查询函数无几何输出），去掉后默认消费会误吃输入。

### 3.3 默认行为与兼容性

内置函数的默认行为由 keep 声明表达：

| 场景 | 默认行为 |
|---|---|
| `union(a,b)` | 内置 `exec.keepHidden` → 源保留且隐藏（= 3d_editor 展示现状 R5） |
| `group({members:[a,b]})` | 内置 `exec.keep` → 成员保留且可见（= 现状 R6） |
| `copy(a)` | 内置 `exec.keep` → 源保留且可见 |
| `drill(a, …)`（无任何声明） | C5 默认消费（回归锚点：drill/transform 链） |

---

## 4. 命名：总是新名（R13/R14）

### 4.1 命名与保留信息解耦

命名一律分配新变量名（R13/R14）——不依赖任何「入参是否被保留」的静态知识：无论 callee 是否保留入参，输出都获得新名。因此 `ReadonlyShape` 与符号表的保留字段（`readonlyPositions`/`readonlyPaths`）在命名路径上零参与；类型系统与符号表不再承载保留语义。

### 4.2 新命名规则

```ts
export function derivePartName(input: DerivePartNameInput): DerivePartNameResult {
  const { inputCount, outputCount, code } = input

  // R0：无赋值语句 → 无名字（保留）
  if (outputCount === 0) return { behavior: 'new', names: [] }

  // R4：多入多出且数量相等（Shape[] 批处理）→ 保持禁用（保留；与复用无关的独立决策）
  if (inputCount > 1 && outputCount > 1 && inputCount === outputCount) {
    throw new Error(/* …同现状… */)
  }

  // 唯一规则：一律分配新名
  return { behavior: 'new', names: nextPartNames(code, outputCount) }
}
```

删除：R1（`isAllInputsReadonly`）、R2（复用）、`DerivePartNameInput.callee`、符号表查询。

### 4.3 收益：消灭「复用名」这一整类复杂度（实测）

这是本次改动**最大的价值**，且是读代码量出来的，不是推测：

| 位置 | 复用名带来的复杂度 | 总是新名后 |
|---|---|---|
| `compile.ts:214-227` | 「先算 deps 再写 varToStmtId」的顺序技巧，注释明写是为了「单入单出复用名的变量能正确解析到上游定义语句（而非自己）」 | 每个变量名唯一生产者，**技巧不再必要** |
| `ScriptEngine.ts:167-176` `findLastProducerSummary` | 注释：「单入单出复用名时…用 `.find()` 会命中第一条（最早的生产者，如 load），**导致下游变换语句被丢弃、烘焙出的几何回到原点**」 | `find` 即可，**整段逻辑可删** |
| `ScriptEngine.ts:189-200` `collectPartStmtIds` | 注释：「必须从 consumer 位置向前搜索**最近的 outputs 匹配者（最近前驱）**，否则会命中最早的 load 生产者」 | 无需「最近前驱」搜索 |
| `ScriptEngine.ts:1328` | 「单入单出复用名时取最近前驱，与 executePart 一致」 | 同上 |
| `ScriptEngine.ts:217` | R2 复用名与 split 双输出的并存处理 | 简化 |
| `terminalToScopedId` | 追加模式，同一 scopedId 累积多条 PartName 映射 | 映射显著收敛 |

也就是说：**R2 复用名是一条会持续产生 bug 的复杂源**（上表第一个注释描述的就是一个真实 bug 的成因）。取消它换来的是两个项目共 5+ 处逻辑的简化。

### 4.4 代价与需确认项（★ D7）

| # | 变化 | 影响面 | 需确认 |
|---|---|---|---|
| 1 | `partN` 编号单调增长 | 录制 N 次操作 → part0..partN | 可接受？ |
| 2 | 语义从「这个零件被修改」变成「产生了一个新零件」 | 场景树节点名随每次操作变化（原来 drill 后仍是 `part0`，现在是 `part1`） | 与 timeline「一行 = 一次操作 = 一个 feature」的直觉是否冲突？ |
| 3 | 既有 `.faijs` 文本**不受影响** | 它只是文本，名字写死在里面 | —— |
| 4 | **UI 录制新语句**的命名结果改变 | 相关单测 / e2e 快照需更新 | 需一轮专项回归 |
| 5 | 3d_editor `terminalToScopedId` / feature 归属的行为变化 | §4.3 里 5 处逻辑删除后需验证 | 独立一轮 e2e |


总是新名会让 partN 单调增长，「对 part0 钻孔」在场景树里变成 part1，节点名随每次操作变化。既有 .faijs 文本不受影响（名字写死在文本里），但 UI 录制结果和相关 e2e 快照需要专项回归。

---

## 5. 类型判定：运行时登记 + UI 查询（R10）

### 5.1 现状：自动登记机制今天就在跑

| 机制 | 位置 | 说明 |
|---|---|---|
| `isShapeLike(v)` | `runtime.ts:167-169` | **结构鸭子类型**：`'positions' in v && 'indices' in v`。不依赖 WeakSet → **第三方库直接返回的裸 mesh 对象也算 Shape** |
| `isShape(v)` | `stdlib/shape.ts:54-56` | 构造器登记（WeakSet），用于身份槽 |
| `exec.shapeToName` | `exec-context.ts:127` | Shape 对象 → 变量名的**反向自动登记** |
| `result.outputs` | `runtime.ts:592-598` | **UI 查询入口**：`Map<PartName, Shape>`，含所有 shape 变量 |
| `result.compounds` | `runtime.ts:650-659` | compound 变量 → 成员变量名 |

**结论**：运行时自动登记 + UI 主动查询，且**已生效、对第三方同样有效**。第三方返回私有对象（无 positions/indices）→ 判定非 Shape → 按普通值处理（与路线图 §11 一致）。

### 5.2 非几何不混入 `terminals`，另开 `activeValues`

下游 4 处假设「terminal 必有几何」：`extractBrepSolids`(runtime.ts:706，调用点 :647)、`buildBrepTopology`(runtime.ts:910)、`brepSolids` 契约（ExecutionResult，runtime.ts:102-103）、**宿主 `commitSceneResult` 缺 output 会 `console.warn`**（ScriptEngine.ts:1236-1239）。

加上非几何活跃值目前**零消费方** —— 为不存在的用途改被 4 处依赖的契约不划算。

```ts
export interface ExecutionResult {
  terminals: TerminalShape[]                    // 只含几何（语义不变，零回归）
  activeValues?: Map<PartName, unknown>         // 活跃但非几何（新增，UI 可选消费）
}
```

### 5.3 必须补的洞：compound 改结构判定

`isCompound`（`shape.ts:59-61`）依赖 WeakSet `isShape`。第三方若返回 `{kind:'compound',children:[...]}` 而未经 SDK `compound()` → `isShape` false、又无 `positions` → **完全不识别、静默丢失**。

```ts
function isCompoundLike(v: unknown): v is CompoundShape {
  return !!v && typeof v === 'object'
    && (v as {kind?: string}).kind === 'compound'
    && Array.isArray((v as {children?: unknown}).children)
}
```

与 `isShapeLike` 的既有风格一致（`runtime.ts` 的终端判定本来就只用结构判定）。

> **口径区分**：引擎内部的终端/消费判定 → 结构判定（对第三方零要求）；SDK 公开的 `isShape` → 保持 WeakSet 严格（身份槽依赖它）。★ **D5**

---

## 6. 数据结构（设计契约）

```ts
// ── keep 指令（调用点）──
type KeepEntryIR =
  | VarRefIR
  | { shape: VarRefIR; hidden?: boolean }

interface KeepDirective {
  targets: PartName[]
  hidden: Map<PartName, boolean>
  statementDefault: boolean          // 来自 keepHidden，默认 false
}

// ── 终端 ──
export type VarKind = 'shape' | 'compound' | 'value'

export interface TerminalShape {
  id: PartName
  meta?: ScriptMetaIR
  kind?: VarKind                     // 运行时登记，缺省 'shape'
  hidden?: boolean                   // 保留但 canvas 不渲染，缺省 undefined → 可见
}

// ── DAG 运行时视图 ──
export interface DagRuntimeView {
  value(name: PartName): unknown                       // 变量当前值
  internalKeep(stmt: StatementIR):                     // 函数体 exec.keep 登记
    { kept: Set<PartName>; hidden: Map<PartName, boolean> } | undefined
}

export function computeLeafTerminals(
  script: ScriptIR,
  varNames: Set<PartName>,
  view?: DagRuntimeView,            // 省略 → 纯静态（C0 + C5），供既有单测
): TerminalShape[]
```

`src/lang/keep.ts`（L0 零依赖）负责：`parseUserKeep` / `withoutKeepDirectives` / `resolveKeep`。**keep 语义的唯一集中点。**

### 6.1 可见性的「最后一次保留声明」规则（★ D2）

```
hiddenOf: Map<PartName, boolean>      // 缺省 false

for stmt of script.statements:        // 顺序遍历
  for v of varNames:
    if v ∈ resolveKeep(stmt).kept:       hiddenOf[v] = resolveKeep(stmt).hidden.get(v) ?? false
```

`union(a,b)`（内置 `exec.keepHidden`）后接 `group({members:[a,b]})`（内置 `exec.keep`）→ a、b **可见**（group 声明「我保留且可见」，后声明压过 union 的隐藏默认）。

---

## 7. 编译 / 缓存层改动

### 7.1 调用发射前剥离 keep 两键

`buildStatementFnBody`（`compile.ts:157-191`）：

```ts
const runtimeArgs = withoutKeepDirectives(stmt.args)   // 剥离 keep / keepHidden
const argsStr = translateArgs(runtimeArgs)
const hasArgs = Object.keys(runtimeArgs).length > 0    // ← 必须在剥离之后
```

**顺序是硬要求**：`cad.union(a,b,{keep:[a,b]})` 剥离后为空 → `hasArgs=false` → 发射 `cad.union(ctx.a, ctx.b, exec)`，与现状逐字一致。先算 `hasArgs` 会命中下面的崩溃路径。

*必须剥离的证据*（不剥离会崩）：

| 签名 | 位置 | 透传后果 |
|---|---|---|
| `union(...rest)` | `boolean.ts:100-104` | options 对象被当 Shape 传进 `booleanImpl` |
| `split(...rest)` | `split.ts:237` | 同上 |
| `copy(input, exec)` | `copy.ts:52` | 无 params 槽 → `exec` 错位成 `undefined` |
| `box(params, exec)` | `primitives.ts:67` | 混入 params，可能触发 `assertBoxParams` |

### 7.2 statementKey 排除 keep（零重算）

`computeKey`（`module-executor.ts:266-267`）改为 `JSON.stringify(withoutKeepDirectives(source.args))`。

切换保留/隐藏状态**零几何重算** —— 已验证 `runtime.ts:347-349` 在无 stale 时仍走 `collectResult`。不排除的话，用户点一次眼睛就会重算整条布尔链。

### 7.3 codegen 零改动

`buildArgsParts`（:91-93）是通用打印机，`fmtValue`（:47-61）已覆盖 `{$ref}`/数组/对象 → 往返自动守恒。

### 7.4 check 校验（纯静态，第三方同样适用）

| 规则 | 说明 |
|---|---|
| `keep` 元素必须是变量引用（或 `{shape,hidden}`） | `$param`/`$call`/字面量 → 报错 |
| 引用目标必须是本语句 inputs 之一，或出现在 args 中 | 纯静态，**不依赖第三方签名** |
| `keepHidden` 必须是 boolean | — |

---

## 8. 分阶段实施

| Phase | 内容 | 文件 |
|---|---|---|
| **P0** | 裁定 D1/D2/D5/D6/D7 | 本文档 |
| **P1** | 删 `ReadonlyShape`（类型 + copy/compound 签名 + index/browser 导出 + gen 脚本 + api.d.ts + op-set-consistency 测试） | §11 清单 |
| **P2** | `exec.keep` / `exec.keepHidden` + `internalKeep` 持久化与失效 | `exec-context.ts`、`module-executor.ts` |
| **P3** | 内置函数改函数体声明：group/assembly/copy → `exec.keep`；union/subtract/intersect → `exec.keepHidden` | `compound.ts`、`copy.ts`、`boolean.ts` |
| **P4** | `src/lang/keep.ts` + terminal-dag 改 C0/C1/C3/C5 | `lang/keep.ts`（新）、`terminal-dag.ts`、`runtime.ts:645` |
| **P5** | 编译层剥离 + statementKey 排除 + check 校验 | `compile.ts`、`module-executor.ts`、`runtime.ts` |
| **P6** | 命名改为总是新名（删 R1/R2/符号表查询） | `allocate-id.ts` |
| **P7** | compound 结构判定 + `activeValues` | `shape.ts`、`runtime.ts:642`、`types.ts` |
| **P8** | faijs 测试（§9） | — |
| **P9** | **命名变更的宿主专项回归**（§4.4 第 5 项） | 3d_editor 5 处 + e2e |
| **P10** | 宿主消费 `terminal.hidden` + `activeValues`（保留 legacy 回退，§10） | 3d_editor |

**P1–P5 与 P6/P7 可并行**；P1–P8 纯 faijs，可独立交付验证。

> **P6 与 P9 必须串行且 P9 独立验证**：命名变更会动到 3d_editor 5 处逻辑，不能与功能开发混在一起跑。

---

## 9. 验收标准（测试提纲，分层）

**ReadonlyShape 与静态保留信息删除（P1）**
- `src/` 中 `ReadonlyShape` 零残留；符号表无保留字段（`readonlyPositions`/`readonlyPaths`）
- `derivePartName` 不再查符号表；`DerivePartNameInput` 无 `callee`

**内外 keep 与优先级（P2–P4）**
- 回归锚点：`cad.drill(a, {diameter:8})`（无任何 keep 声明）→ 与今天逐位相同
- `cad.union(a,b)` → a、b 是终端且 **hidden**（内置 `exec.keepHidden` 生效），c 正常显示（= 3d_editor 现状 R5）
- `cad.group({members:[a,b]})` → a、b 是终端且可见（函数体 `exec.keep` 生效）
- `cad.copy(a)` → a 是终端（函数体 `exec.keep` 生效）
- `cad.drill(c, {keep:['c']})` → c 是终端（调用点覆盖无声明的函数）
- `cad.drill(c, {keep:['c'], keepHidden:true})` → c hidden
- **第三方模拟**：`mech.measure(a)`（返回 number）→ a 不被消费（C3）
- **第三方模拟**：`mech.makeGroup({members:[a,b]})` 内部调 `exec.keep` → a、b 是终端
- **第三方模拟**：`mech.makeGroup({members:[a,b]})` **未**声明 → a、b 被消费（C5），只剩 group 是终端（契约：保留必须显式声明）
- 优先级：函数体 `exec.keep(a)` + 调用点 `keepHidden:true` → **用户胜**（union 默认隐藏的源可用调用点 `keep:[a]` 改可见）
- 增量：语句缓存命中（未重跑）时，上轮的 `internalKeep` 仍然生效

**命名（P6）**
- 任何 callee（drill / group / copy / union）→ 一律新名，`behavior:'new'`
- R0（无输出）、R4（多入多出抛错）不变
- `compile.ts` 生成的 deps 在唯一生产者下正确

**编译层（P5/P7）**
- 编译产物逐字断言：`cad.union(a,b,{keep:[a,b]})` → `cad.union(ctx.a, ctx.b, exec)`
- `cad.copy(a,{keep:[a]})` → `cad.copy(ctx.a, exec)`（**关键**：copy 无 params 槽）
- `computeKey` 在仅 keep 变化时不改变
- `parse → codegen → parse` 往返逐位相等（含 `keep`/`keepHidden`）
- 第三方返回未注册 compound → 进 `outputs`；普通对象 → 进 `activeValues`、不进 `terminals`

---

## 10. 风险与边界情况

| # | 场景 | 处理 | 风险 |
|---|---|---|---|
| E1 | 第三方原地改写入参并返回状态（违反纯函数模型） | C3 会误判为不消费 | 中；faijs 无原地改写语义（receiver 除外），SDK 文档须明示 |
| E2 | 第三方返回未注册 compound 且未声明 keep | 成员按 C5 默认**消费**（不再单独显示） | 中；**契约**：保留必须显式声明，SDK 文档须明示 |
| E3 | 函数在 `exec.keep` 之后抛异常 | 记录已登记 | 低；建议宿主在 `failedAt` 存在时不重建场景树 |
| E4 | `keep` 拼错（`keeps`） | 未知键透传给 params | 中；建议 check 对 `keep*` 前缀未识别键给 warning |
| E5 | 命名变更导致 UI 录制结果变化 | §4.4 | **高；需 P9 独立回归** |
| E6 | 保留的中间体在增量执行中被回收 | 不成立（ctx 常驻） | 无 |
| E7 | 嵌套调用（CallRefIR）中库函数发出的 `exec.keep` 归属到外层语句（共用 `exec.currentStmt`） | 内层 keep 声明记录在外层语句名下（§2.2 归属规则） | 低；罕见场景，语义可接受 |

---

## 11. 宿主（3d_editor）与迁移纪律

### 11.1 消费 `terminal.hidden`

`ScriptEngine.commitSceneResult`（`ScriptEngine.ts:1219-1282`）在 `commitGeometry` 后：

```ts
useModelStore.getState().setNodeVisible(scopedId, !terminal.hidden)
```

`setNodeVisible` 已存在（`model-store.ts:966-971`，经 `setNodeInTree` :690-701 递归实现）。

### 11.2 ★ 迁移纪律：**禁止同一次改动删除既有的 op 类型隐藏**

现状：`buildCombinedTree`（`model-store.ts:395-483`）在 :466 调用 `setNodeVisibleInPlace(preservedTree, sourceId, false)` 按 `operationResults` 隐藏源部件，由 op 类型在 feature 层登记，**仍在生效**（`BooleanResultLayer.tsx:37,88` 以其为 single source of truth）。

1. **本次**：faijs 产出 `terminal.hidden`，宿主**优先采用**；语句无 keep 声明时回退 legacy。两条路径并存，行为不变。
2. **独立一轮**（需单独 e2e 验证）：确认 keep 覆盖全部场景后，再评估移除 legacy 分支。

理由：legacy 分支被真实使用且被 e2e 覆盖；新分支零运行证据。提前提为唯一路径等于把纸面推论当结论。

---

## 12. 决策点汇总（已裁定）

| # | 问题 | 推荐 | 状态 |
|---|---|---|---|
| **D1** | `keep` 默认可见还是隐藏？ | **默认可见**（保证 `group({members})` 与 `group({members,keep:[a,b]})` 等价；union 的保留+隐藏已是内置 `exec.keepHidden` 默认，调用点 keep 默认可见与其不冲突） | **已裁定：采纳推荐** |
| **D2** | hidden 用「最后一次保留声明胜出」还是「只由 keep 决定」？ | **前者**（与「最后写者」同构；解决 union→group 场景） | **已裁定：采纳推荐** |
| **D5** | `isShape`（WeakSet 严格）与 `isShapeLike`（结构宽松）双口径 | **保持双口径**：引擎内部用结构判定（对第三方零要求），SDK 公开 `isShape` 保持严格 | **已裁定：采纳推荐** |
| **D6** | 推断层 C3 是否保留？ | C3 推荐**保留**（去掉后第三方测量函数误吃输入） | **已裁定：采纳推荐** |
| **D7** | 命名「总是新名」的代价是否接受？ | 收益（消灭两项目 5+ 处复用名复杂度）显著；需确认 §4.4 第 1/2 项（partN 单调增长、场景树节点名随操作变化） | **已裁定：采纳推荐（用户提出）** |

---

## 附录 B：证据索引

**faijs**

| 事实 | 位置 |
|---|---|
| `consumes()` 静态二元判定；未知 callee 即消费（第三方会误判） | `src/cad-runtime/terminal-dag.ts:23-25,31-64` |
| `computeLeafTerminals` 最后写者 + 下游无消费 | `src/cad-runtime/terminal-dag.ts:76-122` |
| 终端计算调用点（结果组装期，ctx 已就绪） | `src/cad-runtime/runtime.ts:645` |
| `shapeVarNames` 由运行时 `isShapeLike`/`isCompound` 得出 | `src/cad-runtime/runtime.ts:642` |
| `isShapeLike` = 结构鸭子类型（不依赖 WeakSet） | `src/cad-runtime/runtime.ts:167-169` |
| `isShape` WeakSet；`isCompound` 依赖它（第三方漏洞） | `src/stdlib/shape.ts:54-61` |
| `ReadonlyShape` 类型（品牌可选，不强制） | `src/mesh/types.ts:40-49` |
| 符号表从 **TS 类型节点**提取 readonly（第三方永为空） | `scripts/gen-symbol-table.ts:5-7,84,110-112` |
| 符号表字段定义（`readonlyPositions`/`readonlyPaths`） | `src/lang/symbol-table.ts:17-22` |
| **命名规则 R0–R4**（R1 依赖符号表、R2 复用） | `src/lang/allocate-id.ts:55-95` |
| `isAllInputsReadonly` | `src/lang/allocate-id.ts:90-95` |
| `copy` 产出**新对象**（恒等判定失效，须函数体声明） | `src/stdlib/copy.ts:52-61`；`:9` 明写源需显示 |
| compound 成员名推导（已用 `exec.currentStmt`） | `src/stdlib/compound.ts:257-274` |
| `exec.shapeToName` 反向登记 | `src/cad-runtime/exec-context.ts:127`；写 `module-executor.ts:242`；预填 `runtime.ts:525-533` |
| `result.outputs` = UI 查询入口 | `src/cad-runtime/runtime.ts:592-598` |
| `extractBrepSolids` 函数体 | `src/cad-runtime/runtime.ts:706`（调用点 :647） |
| `buildBrepTopology` | `src/cad-runtime/runtime.ts:910` |
| stdlib 签名（keep 必须剥离的证据） | `boolean.ts:100`、`split.ts:237`、`copy.ts:52`、`primitives.ts:67` |
| 编译期调用发射（hasArgs 顺序硬要求） | `src/lang/compile.ts:157-191` |
| **复用名顺序技巧** | `src/lang/compile.ts:213-227` |
| `statementKey = callee \| JSON(args) \| deps` | `src/cad-runtime/module-executor.ts:260-273` |
| 无 stale 时仍走 collectResult（零重算前提） | `src/cad-runtime/runtime.ts:347-349` |
| `extractBrepSolids` 对非几何终端容错 | `src/cad-runtime/runtime.ts:647` |
| `parseValueExpr` 覆盖 keep 全部形态 | `src/lang/parser.ts:67-147` |
| codegen 通用 args 打印机（往返守恒） | `src/lang/codegen.ts:91-93,47-61` |

**3d_editor**

| 事实 | 位置 |
|---|---|
| `SceneTreeNode.visible` 已存在 | `src/shared/types.ts:153` |
| 宿主按 op 类型隐藏源（**当前生效分支，禁止同批删除**） | `src/stores/core/model-store.ts:395-483`（调用点 :466） |
| `operationResults` 仍是 result 节点唯一数据源 | `src/engine/components/renderers/BooleanResultLayer.tsx:37,88` |
| `setNodeVisible` 已存在 | `src/stores/core/model-store.ts:966-971`（递归实现 :690-701） |
| 终端 → 场景树提交（hidden 应用落点） | `src/engine/script-engine/ScriptEngine.ts:1219-1282` |
| `setNodeVisible` / `setNodeInTree` 递归实现 | `src/stores/core/model-store.ts:966-971` / `:690-701` |
| **复用名复杂度①**：`.find()` 会致「几何回到原点」 | `ScriptEngine.ts:167-176` |
| **复用名复杂度②**：须搜「最近前驱」 | `ScriptEngine.ts:189-200` |
| **复用名复杂度③** | `ScriptEngine.ts:1328`、`:217` |

**路线图与参考**

| 事实 | 位置 |
|---|---|
| 第三方库目标场景（四层依赖、含非 CAD） | 路线图 §0.3 |
| SDK 导出面（`solid`/`compound`/`ExecContext`） | 路线图 §4.1；`exec.cad` 供库调内置 op |
| 库返回非 Shape → 按普通值处理 | 路线图 §11 |
| 运行时状态全局锚点（单例正解） | 路线图 §3.4 |
| faijs 函数定义（V1.3）→ 用户自定义函数亦可用函数体 keep | 路线图 §10 V1.3 |
| Onshape `keepTools` / `NewBodyOperationType` | `boolean.fs:77,108,229`；`tool.fs:66-76` |
| FreeCAD `Visibility` 属 Gui 层（存在性 vs 可见性两维） | `ViewProviderDocumentObject.cpp:64` |
