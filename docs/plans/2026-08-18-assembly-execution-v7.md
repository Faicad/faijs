# 装配执行方案 v7（全新，基于当前代码状态）

> **命名更正（2026-08-20）：本文档中的 `cad.assemble`（动词）为错误命名。定义装配用名词 `assembly`（`const x = cad.assembly({...})`），执行装配用 `do_assemble`。权威文档见 `C:\my\Faicad\3d_editor\docs\plans\2026-08-20-assembly-execution-v8-delete-marker.md`，本文档正文不再修改。**

- 日期：2026-08-18
- 类型：功能设计 + 实施方案
- 依赖：Step 1（BREP 逐 part 链，`docs/plans/2026-08-18-brep-per-part-chain.md`）
- 状态：待评审 → 待实现
- 替代：`2026-08-18-assembly-syntax-design.md`（v1–v6 废弃）

---

## 0. 用户原始要求（原样保留）

### 0.1 装配语法与执行

> 先通读本项目和../3d_editor 项目的源代码，架构文档，了解装配目前是如何实现的。
> 下面的语法，也许未来可以实现，但是这个目前不合适：
>
> ```js
> let assem1 = cad.assemble({ name, members })
> assem1.add_constraint({ type: 'face_mate', fixedPartName, movingPartName, fixedFace, movingFace })
> assem1.add_constraint(more...)
> assem1.do_assemble()
> ```
>
> 目前先采用这样的语法：
> ```js
> const assem1 = cad.assemble({ name, members, constraints })
> assem1.do_assemble()
> ```
> cad.assemble语句保持不变，保持小步快跑的开发节奏，先不碰constraints的语法变更，保持现状。除非现有语法妨碍do_assemble的实现。变更有两点：
> 1. 增加'const assem1 ='的赋值
> 2. 增加assem1.do_assemble()语句
>
> 注意：有一个关键点，3d_editor项目是如何实现timeline节点的。我记得大概是看faijs脚本里有多少个操作，目前就是看有多少个cad.<op>。你要先确认是否是这个逻辑。
> 要保证assem1.do_assemble()不会增加timeline的节点。
>
> 此外，3d_editor项目装配的e2e测试，大概出错了。在没有引入faijs之前，创建一个立方体、再创建一个圆柱体、然后装配。应该是3个timeline节点。
> 加了faijs之后，目前的实现有错误，导致额外出现了两个移动、旋转的节点。
> 这次要彻底修复它。
>
> 如何实现装配，是内部逻辑。不应该把实现装配的移动、旋转泄露出去。
> 也就是要把它收到do_assemble里。导出faijs以后再重新导入时，也是通过do_assemble实现再装配。
> 当然，有一个细节，导出step/stl等文件时，必须保证是装配后的位置。
>
> 而且，不应该在3d_editor里直接处理mesh的几何变更，这是违规。所有几何变更必须走faijs语句执行。
>
> 这是第一步。
> 未来第二步，是实现装配拓扑的优化。可以参考这个文档C:\my\Faicad\3d_editor\docs\plans\2026-08-17-resolve-geom-ref-fallback-fix.md，其中的`faceEvolutionCache` 写入但从未消费——面演化链路断裂。
> 仔细分析它，我的目的是要实现拓扑面的稳定溯源，不能依靠faceOrdinal之类的东西。
> 怎么实现我没有想好，你先详细调研，给出一个初步的方案。

### 0.2 取消 marker

> 正常的语言哪里会有isMaker这种垃圾。你要做的是，如何实现把maker这种东西删除掉。
>
> 1. 所有语句必须执行，不准跳过。就算是空执行，也是执行。
> 2. 所有语句，如果有赋值，一样参与terminal shape 计算。
>    比如 const group1 = cad.group(...)
>    那么输出就应该显示这个group1，而group1里的入参则从terminal shape里删除。显示group的时候，自然显示group里的元素。
> 3. 所有语句，不准跳过schema 校验。下面这句也是错误的
>    runtime.ts:591 — if (stmt.isMarker) continue
> 4. codegen 也必须正常输出。不准有什么maker的判断。

### 0.3 修正 v6 方案的根本错误

> STRUCTURAL_OPS 的去留
> 保留，但语义收窄为"这些 op 不产出几何"——仅用于 terminal shape 计算排除？？ 明明告诉你有赋值就必须一样参与terminal shape 计算。 而且谁说语句执行就一定会产生shape的？你他妈大前提就错了。之前难道不支持赋值语句？以后还有支持更多语法。难道语句执行不能是为了改变状态？不返回值的语句，自然不参与 terminal shape。 你他妈写的都是什么垃圾。给我按正常语言该怎么处理，就怎么处理。

### 0.4 返回值语义——四类返回值类型

> 有返回值的语句，必须在写代码的时候，接收返回值。schema校验必须包含这一点。cad.group明明是有返回值的，你他妈一直说它没有，完全错误。没有返回值的，必须不不能接收返回值。目前只有do_assemble没有返回值。而且你写一份新的文档，不准一直改老的文档。全部重写。全部按照当前代码状态，写清楚改如何实施。

### 0.5 四类返回值类型设计（用户最终决策）

> add_constraint到底怎么设计呢？
> 如果有返回值，好处是可以链式调用。比如assem1.add_constraint().add_constraint()。坏处是目前要求有返回值就必须要有左侧的赋值，不准静默丢弃。
> 最终还是要写成assem1=assem1.add_constraint().add_constraint()，有点丑陋。
> 如果add_constraint没有返回值，那么就没法链式调用。对于建模语言，链式调用是几乎必须支持的。比如cad.box().fillet().drill()之类的写法。
>
> 那么我决定所有faijs语句都有返回值，返回值的类型是
> 1. new_shape， 如cad.box()
> 2. same_shape, 如assemb1.add_constraint()
> 3. 非shape对象, 如const LEN = math.pow(2, 3)
> 4. void
>
> 返回值是void的，不准赋值。返回值是case1/case3的，必须赋值。
> 返回值是same_shape的，可以赋值也可以不赋值，主要用于支持链式调用的时候
>
> 按照我这四个类型的要求，设计实现方案，更新文档。

---

## 1. 核心设计原则

### 1.1 按正常语言处理

**语句执行 ≠ 产出 Shape。** 语句可以：
- 产出新几何（`const part1 = cad.box(...)` → 返回 new_shape）
- 改变已有几何/上下文的状态（`assem1.add_constraint(...)` → 返回 same_shape，即 assem1 自身）
- 执行副作用无返回值（`assem1.do_assemble()` → void，改变已有 part 的位置）
- 返回非几何值（`const len = math.pow(2, 3)` → 非 shape 对象）

### 1.2 四类返回值类型

**所有 faijs 语句都有返回值类型标注，共四类：**

| 类型 | 语义 | 赋值规则 | 参与终端 | 示例 |
|---|---|---|---|---|
| `new_shape` | 返回新几何 | **必须赋值** | 是 | `const part1 = cad.box(...)` |
| `same_shape` | 返回自身/上下文 | **可赋值可不赋值** | 是（如果赋值了） | `assem1.add_constraint(...)` |
| `scalar` | 返回非 shape 值 | **必须赋值** | 否 | `const len = math.pow(2, 3)` |
| `void` | 无返回值 | **不准赋值** | 否 | `assem1.do_assemble()` |

**赋值规则**：
- `new_shape` / `scalar`：必须赋值（`const x = ...`）。裸调用 → 报错。
- `same_shape`：可以赋值也可以不赋值。不赋值时是裸调用，合法（用于链式调用场景）。
- `void`：不准赋值。写 `const x = assem1.do_assemble()` → 报错。

**Terminal shape 判据**：
- `new_shape`：必须赋值 → 赋值了 → 参与终端计算
- `same_shape`：如果赋值了 → 参与终端计算；没赋值 → 不参与
- `scalar`：赋值了但不产出几何 → 不参与终端
- `void`：不赋值 → 不参与终端

**简化判据**：terminal shape 的判据 = 有没有赋值 **且** 返回值类型是 `new_shape` 或 `same_shape`。等价地：有赋值 **且** 返回值不是 `scalar` 和 `void`。

### 1.3 op 返回值类型分类

| op | 返回值类型 | 说明 |
|---|---|---|
| box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load | `new_shape` | 创建几何 |
| translate/rotate/scale | `new_shape` | 变换几何（返回变换后的新 Shape） |
| drill/extrude/split/boolean/engrave/knurl | `new_shape` | 特征操作（返回操作后的新 Shape） |
| group | `new_shape` | 组声明（返回组引用——组本身是一种结构几何） |
| assembly | `new_shape` | 装配声明 |
| assemble | `new_shape` | 装配定义（返回 assembly 上下文引用） |
| add_constraint | `same_shape` | 链式调用，返回 assembly 上下文自身 |
| do_assemble | `void` | 无返回值，执行装配 pass 改变已有 part 的位置 |
| （未来）math.pow / math.sin 等 | `scalar` | 非 shape 返回值 |

**注意**：`assemble` 的返回值类型是 `new_shape`（不是 `same_shape`），因为 `const assem1 = cad.assemble(...)` 是创建一个新的装配上下文。而 `assem1.add_constraint(...)` 返回 `same_shape`——它返回的就是 `assem1` 自身（用于链式调用）。

### 1.4 `STRUCTURAL_OPS` 彻底删除

**不再保留 `STRUCTURAL_OPS` 这个概念。** 删除定义、删除所有引用、删除导出。所有按 op 白名单做特殊处理的逻辑全部消除。返回值类型 `returnType` 替代它。

---

## 2. 现状代码核实

### 2.1 `STRUCTURAL_OPS` 定义与引用全量清单

**定义**：`src/lang/parser.ts:866-869`
```ts
export const STRUCTURAL_OPS = new Set([
  'group', 'assembly',
  'assemble', 'add_constraint', 'do_assemble',
])
```

**faijs 侧引用（8 处 + 定义 + 导出）：**

| 文件 | 行 | 代码 | 用途 |
|---|---|---|---|
| `src/lang/parser.ts` | 866 | `export const STRUCTURAL_OPS = ...` | 定义 |
| `src/lang/parser.ts` | 891 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | terminal shape 计算：跳过"结构型"语句 |
| `src/cad-runtime/runtime.ts` | 29 | `import { ..., STRUCTURAL_OPS }` | 导入 |
| `src/cad-runtime/runtime.ts` | 217 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | replay 主循环：跳过执行 |
| `src/cad-runtime/runtime.ts` | 298 | `filter((s) => !STRUCTURAL_OPS.has(s.op))` | 无终端回退：取最后非"结构型"语句 |
| `src/cad-runtime/runtime.ts` | 384 | `if (STRUCTURAL_OPS.has(s.op)) continue` | resolveShapeRef 子重放：跳过 |
| `src/cad-runtime/runtime.ts` | 451 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | plan() 增量分析：跳过 |
| `src/test-helpers.ts` | 14 | `import { STRUCTURAL_OPS }` | 导入 |
| `src/test-helpers.ts` | 37 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 测试 replay：跳过 |
| `src/test-helpers.ts` | 51 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 测试取终端：跳过 |
| `src/node-host/cli.ts` | 17 | `import { ..., STRUCTURAL_OPS }` | 导入 |
| `src/node-host/cli.ts` | 129 | `filter((s) => !STRUCTURAL_OPS.has(s.op)).pop()` | CLI 导出取终端：跳过 |
| `src/index.ts` | 34 | `export { ..., STRUCTURAL_OPS }` | 导出 |
| `src/browser.ts` | 39 | `export { ..., STRUCTURAL_OPS }` | 导出 |

**3d_editor 侧引用（11 处）：**

| 文件 | 行 | 代码 | 用途 |
|---|---|---|---|
| `executeScript.ts` | 199 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 执行跳过 |
| `executeScript.ts` | 335 | `filter((s) => !STRUCTURAL_OPS.has(s.op))` | 无终端回退 |
| `executeScript.ts` | 677 | `if (!STRUCTURAL_OPS.has(s.op)) baseById.set(s.id, s)` | diff 映射排除 |
| `executeScript.ts` | 681 | `if (!STRUCTURAL_OPS.has(s.op)) newById.set(s.id, s)` | diff 映射排除 |
| `executeScript.ts` | 686 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | diff 分类跳过 |
| `executeScript.ts` | 701 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | DELETE 检测跳过 |
| `executeScript.ts` | 710 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 孤儿检测跳过 |
| `executeScript.ts` | 738 | `filter((s) => !STRUCTURAL_OPS.has(s.op)).length` | reused 计数 |
| `executeScript.ts` | 771 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 增量执行跳过 |
| `replay-validator.ts` | 124 | `if (STRUCTURAL_OPS.has(stmt.op)) continue` | 校验 replay 跳过 |
| `replay-validator.ts` | 139 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 取终端跳过 |
| `ScriptEngine.ts` | 1432 | `filter(s => !STRUCTURAL_OPS.has(s.op))` | 取终端跳过 |

### 2.2 Parser 当前状态

**`VariableDeclaration` 分支**（`parser.ts:633-744`）——有赋值：
- `const partN_vM = cad.op(...)` → `parseCadStatement`，id = 变量名
- `const { front: partA, back: partB } = cad.split(...)` → `parseSplitDestructuring`
- `let assem1 = cad.assemble({...})` → 手工解析，id = `grp_${counter}`，设 `assemblyVar = varName`
- `const name = literal` → 参数声明

**`ExpressionStatement` 分支**（`parser.ts:753-836`）——无赋值（裸调用）：
- `cad.group({...})` → id = `grp_${counter}`，无 `assemblyVar` ← **当前代码允许，但 group 是 new_shape，必须赋值，需删除此分支**
- `cad.assembly({...})` → id = `grp_${counter}`，无 `assemblyVar` ← **同上**
- `assem1.add_constraint({...})` → id = `grp_${counter}`，有 `assemblyTarget` ← **add_constraint 是 same_shape，允许裸调用，保留**
- `assem1.do_assemble()` → id = `grp_${counter}`，有 `assemblyTarget` ← **do_assemble 是 void，必须裸调用，保留**
- 其他裸调用 → 抛 ParseError

**当前问题**：
1. `group`/`assembly` 是 `new_shape`，但 parser 只允许裸调用（ExpressionStatement）。→ 违反"new_shape 必须赋值"。需要改为走 VariableDeclaration 分支。
2. `assemble` 是 `new_shape`，parser 用 `let` 接收。→ 应改为 `const`。
3. parser 没有 `returnType` 字段的概念。需要新增。
4. parser 没有赋值校验。需要新增。
5. `add_constraint` 是 `same_shape`，允许裸调用。当前 parser 只支持裸调用，不支持赋值。未来如果要支持 `const c = assem1.add_constraint(...)`，parser 需要支持链式调用的赋值形式。**但当前 faijs 不需要支持赋值形式——`same_shape` 允许裸调用就够了。** 目前 `add_constraint` 只走裸调用路径，合法。

### 2.3 Schema 当前状态

`src/lang/args-schema.ts` 的 `OpSchema` 接口：
```ts
export interface OpSchema {
  op: string
  fields: ArgFieldSchema[]
  minInputs?: number
}
```

**缺少** `returnType` 字段。schema 没有记录 op 的返回值类型。

`validateStatementArgs` 只校验 args 字段和 inputs 数量，**不校验赋值/不赋值**。

### 2.4 Codegen 当前状态

`statementToLine`（`codegen.ts:359-416`）和 `scriptToCode`（`codegen.ts:426-513`）：
- `group`/`assembly` → 裸调用输出：`cad.group({ ... })`。**错误**——group 是 new_shape，应该输出 `const g = cad.group({ ... })`。
- `assemble` → `let assem1 = cad.assemble({ ... })`。**错误**——应该用 `const`。
- `add_constraint` → `assem1.add_constraint({ ... })`。裸调用输出。**正确**——same_shape 允许裸调用。
- `do_assemble` → `assem1.do_assemble()`。裸调用输出。**正确**——void 必须裸调用。

### 2.5 Dispatcher 当前状态

`src/ops/dispatcher.ts:204-225`：
- `group`/`assembly`/`assemble`/`add_constraint` → 返回空 Shape
- `do_assemble` → 创建空 `assemblyDef`，调 `executeDoAssemble`（空操作），返回空 Shape

**问题**：`do_assemble` 的 `assemblyDef` 是空的——`members: []`，`constraints: []`。真正的装配定义在 `assemble` 语句的 `args` 里，但 dispatcher 无法跨语句访问。

### 2.6 assemble.ts 数学已正确

`src/ops/assemble.ts` 已实现：
- `solveFaceMate(fixedCenter, fixedNormal, movingCenter, movingNormal)` → `{ quaternion, pivot, translation, rotationMatrix }`
- `applyTransform(shape, ...)` → 烘焙 mesh 顶点
- `executeDoAssemble(assemblyDef, outputCache)` → 遍历 constraints，求变换写回 outputCache

**缺口 1**：`FaceMateConstraint` 要求 `fixedFace`/`movingFace` 带 `center`/`normal`。但实际约束数据中只有 `faceId`/`surfaceType`。需要 `faceId → {center, normal}` 解析桥。

**缺口 2**：只动 mesh，不动 BREP。`executeDoAssemble` 只烘焙 `outputCache`，不动 `solidCache`。

### 2.7 BREP 变换接口已存在

`src/brep/brep-ops.ts`：
- `matrixToArray(matrix: THREE.Matrix4): number[]` → OCCT 3x4 row-major
- `kernel.transform(solid, matrixArray)` → 刚体变换

### 2.8 拓扑数据

- `FaceRow`（`src/topology/types.ts`）已带 `id`/`center`/`normal`/`surfaceType`
- `ExecutionResult.topology` 从 `topologyCache` 产出
- BREP 件内联拓扑构建：`buildSolidTopologyRuntime(kernel, solid)`
- mesh 件拓扑由宿主在文件加载时注入

---

## 3. 设计：四类返回值类型

### 3.1 Schema 新增 `returnType` 字段

在 `OpSchema` 接口新增 `returnType` 字段：

```ts
/** 语句返回值类型。 */
export type ReturnType = 'new_shape' | 'same_shape' | 'scalar' | 'void'

export interface OpSchema {
  op: string
  fields: ArgFieldSchema[]
  minInputs?: number
  /** 返回值类型。缺省 = 'new_shape'。
   *  - new_shape：返回新几何，必须赋值
   *  - same_shape：返回自身/上下文，可赋值可不赋值（用于链式调用）
   *  - scalar：返回非 shape 值，必须赋值
   *  - void：无返回值，不准赋值 */
  returnType?: ReturnType  // 缺省 = 'new_shape'
}
```

**schema 表标注**：

| op | returnType | 说明 |
|---|---|---|
| box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load | `new_shape`（缺省） | 创建几何 |
| translate/rotate/scale | `new_shape`（缺省） | 变换几何 |
| drill/extrude/split/boolean/engrave/knurl | `new_shape`（缺省） | 特征操作 |
| group | `new_shape`（缺省） | 组声明 |
| assembly | `new_shape`（缺省） | 装配声明 |
| assemble | `new_shape`（缺省） | 装配定义 |
| add_constraint | `same_shape` | 链式调用，返回 assembly 上下文自身 |
| do_assemble | `void` | 无返回值，执行装配 pass |

### 3.2 赋值校验逻辑

**核心规则（三句话）**：
1. `new_shape` 和 `scalar` → **必须赋值**。裸调用 → 报错。
2. `same_shape` → **可赋值可不赋值**。裸调用合法，赋值也合法。
3. `void` → **不准赋值**。赋值 → 报错。

**在 parser 中实现**（不是在 schema 校验中，因为赋值信息来自 AST 结构，parser 最清楚）：

parser 在解析每条语句时，已经知道：
- 这条语句是 `VariableDeclaration`（有赋值）还是 `ExpressionStatement`（裸调用/无赋值）
- op 名 → 查 schema → 得到 `returnType`

**校验规则**：

```ts
const returnType = getOpReturnType(stmt.op)  // 'new_shape' | 'same_shape' | 'scalar' | 'void'

if (hasAssignment) {
  // VariableDeclaration：有赋值
  if (returnType === 'void') {
    throw new ParseError(
      `cad.${op}() has no return value (void), cannot assign — use bare call \`xxx.do_assemble()\` instead`,
      line,
    )
  }
  // new_shape、same_shape、scalar → 赋值合法
} else {
  // ExpressionStatement：裸调用（无赋值）
  if (returnType === 'new_shape' || returnType === 'scalar') {
    throw new ParseError(
      `cad.${op}() returns ${returnType}, must assign to a variable — use \`const x = cad.${op}(...)\` instead`,
      line,
    )
  }
  // same_shape、void → 裸调用合法
}
```

### 3.3 `CadStatement` 新增字段

```ts
export interface CadStatement {
  // ... 现有字段 ...
  /** 该语句是否有赋值（`const x = ...` 或 `let x = ...`）。
   *  parser 根据 AST 节点类型设置：VariableDeclaration → true，ExpressionStatement → false。 */
  hasAssignment?: boolean
  /** 该 op 的返回值类型。从 schema 查得，parser 设置。 */
  returnType?: ReturnType
}
```

**不需要 `isChained` 字段**——`same_shape` 类型已经涵盖了链式调用的语义（允许裸调用）。链式调用 `assem1.add_constraint(...)` 就是 `same_shape` 的裸调用，parser 直接允许。

### 3.4 Parser 改动

#### 3.4.1 `group`/`assembly` 改为必须有赋值

**当前**：`group`/`assembly` 只支持裸调用（ExpressionStatement）。

**改动**：
1. `ExpressionStatement` 分支中的 `cad.group(...)` / `cad.assembly(...)` 裸调用分支**删除**——parser 拒绝裸调用（group/assembly 是 new_shape，必须赋值）。
2. `group`/`assembly` 的 `cad.xxx(...)` 形式走 `VariableDeclaration` 分支中的 `parseCadStatement`。需要让 `parseCadStatement` 能处理 group/assembly（当前它处理的是通用 `cad.op(input, {args})` 形式，group/assembly 无 inputs，有 args 对象）。

**实现**：`parseCadStatement` 中，`group`/`assembly` op 走通用路径——inputs 为空（无 Identifier 参数），args 从 ObjectExpression 解析。这和现有逻辑兼容，不需要特殊处理。

3. parser 为 group/assembly 语句设 `assemblyVar = varName`（复用此字段表示"赋值变量名"），codegen 用 `stmt.assemblyVar ?? stmt.id` 作为输出变量名。

#### 3.4.2 `assemble` 改为 `const`

**当前**：`let assem1 = cad.assemble({...})`（parser.ts:662-700，仅允许 `let`）。

**改动**：`stmtNode.kind === 'let'` → 放宽为 `const || let`。codegen 输出 `const`。

#### 3.4.3 所有语句设 `hasAssignment` 和 `returnType`

parser 在创建每条语句时：

```ts
// VariableDeclaration 分支
const stmt: CadStatement = {
  id, op, args, inputs, feature,
  hasAssignment: true,
  returnType: getOpReturnType(op),  // 从 schema 查
}

// ExpressionStatement 分支（add_constraint/do_assemble 裸调用）
const stmt: CadStatement = {
  id, op, args, inputs, feature, assemblyTarget,
  hasAssignment: false,
  returnType: getOpReturnType(op),
}
```

辅助函数：
```ts
function getOpReturnType(op: string): ReturnType {
  const schema = SCHEMAS[op]
  return schema?.returnType ?? 'new_shape'  // 缺省 new_shape
}
```

#### 3.4.4 赋值校验

在 parser 的 `VariableDeclaration` 分支和 `ExpressionStatement` 分支中，创建语句后加一步校验：

```ts
// VariableDeclaration（有赋值）
if (returnType === 'void') {
  throw new ParseError(
    `cad.${op}() has no return value (void), cannot assign`, line,
  )
}

// ExpressionStatement（无赋值）
if (returnType === 'new_shape' || returnType === 'scalar') {
  throw new ParseError(
    `cad.${op}() returns ${returnType}, must assign — use \`const x = cad.${op}(...)\` instead`, line,
  )
}
```

#### 3.4.5 Terminal Shape 计算重写

```ts
export function computeTerminalShapes(statements: CadStatement[]): TerminalShape[] | undefined {
  // 1. 收集所有被引用的 id
  const referencedIds = new Set<string>()
  for (const stmt of statements) {
    // 普通语句的 inputs
    for (const inputId of stmt.inputs) {
      referencedIds.add(inputId)
    }
    // 有赋值的语句引用的 members/constraints 中的 partName
    const members = stmt.args?.members
    if (Array.isArray(members)) {
      for (const m of members) {
        if (typeof m === 'string') referencedIds.add(m)
      }
    }
    const constraints = stmt.args?.constraints
    if (Array.isArray(constraints)) {
      for (const c of constraints) {
        if (c && typeof c === 'object') {
          const fn = (c as Record<string, unknown>).fixedScopedId ?? (c as Record<string, unknown>).fixedPartName
          const mn = (c as Record<string, unknown>).movingScopedId ?? (c as Record<string, unknown>).movingPartName
          if (typeof fn === 'string') referencedIds.add(fn)
          if (typeof mn === 'string') referencedIds.add(mn)
        }
      }
    }
    // assemblyTarget 引用的 assemblyVar
    if (stmt.assemblyTarget) {
      const targetStmt = statements.find(s => s.assemblyVar === stmt.assemblyTarget)
      if (targetStmt) {
        referencedIds.add(targetStmt.id)
      }
    }
  }

  // 2. 收集所有参与终端的语句 id
  // 判据：有赋值（hasAssignment=true）且 returnType 是 new_shape 或 same_shape
  const outputIds: string[] = []
  for (const stmt of statements) {
    if (!stmt.hasAssignment) continue  // 无赋值 → 不参与终端
    if (stmt.returnType === 'scalar' || stmt.returnType === 'void') continue  // scalar/void → 不参与终端
    outputIds.push(stmt.id)
    if (stmt.outputs) {
      for (const outId of stmt.outputs) {
        outputIds.push(outId)
      }
    }
  }

  // 3. 终端 = 参与终端的 id 中不被引用的
  const terminals: TerminalShape[] = []
  const seen = new Set<string>()
  for (const id of outputIds) {
    if (referencedIds.has(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    terminals.push({ id })
  }

  if (terminals.length <= 1) return undefined
  return terminals
}
```

**注意**：不再有 `STRUCTURAL_OPS`。判据纯粹是 `hasAssignment` + `returnType`。

### 3.5 Runtime 改动

#### 3.5.1 Replay 主循环：删除跳过，所有语句执行

**当前**（`runtime.ts:214-280`）：
```ts
for (let i = 0; i < script.statements.length; i++) {
  const stmt = script.statements[i]
  if (STRUCTURAL_OPS.has(stmt.op)) continue  // ← 删除
  // ... 执行
}
```

**改动后**：
```ts
// 装配上下文
interface AssemblyContext {
  name?: string
  members: string[]
  constraints: unknown[]
}
const assemblyContexts = new Map<string, AssemblyContext>()

for (let i = 0; i < script.statements.length; i++) {
  const stmt = script.statements[i]

  // 装配上下文收集（在 dispatcher 调用前）
  if (stmt.op === 'assemble' && stmt.assemblyVar) {
    assemblyContexts.set(stmt.assemblyVar, {
      name: stmt.args.name as string | undefined,
      members: (stmt.args.members as string[]) ?? [],
      constraints: (stmt.args.constraints as unknown[]) ?? [],
    })
  }

  if (stmt.op === 'add_constraint' && stmt.assemblyTarget) {
    const ctx = assemblyContexts.get(stmt.assemblyTarget)
    if (ctx) {
      ctx.constraints.push(stmt.args)
    }
  }

  opts?.beforeStatement?.(stmt, i)

  // 解析输入
  const inputGeometries: Shape[] = []
  for (const inputRef of stmt.inputs) {
    let geo = outputCache.get(inputRef) ?? opts?.inputGeometryMap?.get(inputRef)
    if (!geo) {
      geo = await this.resolveShapeRef(inputRef, outputCache, opts?.sceneScript)
      outputCache.set(inputRef, geo)
    }
    inputGeometries.push(geo)
  }

  // do_assemble 装配 pass（在 dispatcher 前执行，副作用写回 outputCache/solidCache）
  if (stmt.op === 'do_assemble' && stmt.assemblyTarget) {
    const def = assemblyContexts.get(stmt.assemblyTarget)
    if (!def) {
      throw new Error(`[CadRuntime] do_assemble: assembly "${stmt.assemblyTarget}" not found`)
    }
    await this.executeAssemblyPass(def, outputCache, brepChain)
  }

  // mesh-only / brep 检查
  if (MESH_ONLY_OPS.has(stmt.op)) { ... }

  // 执行语句（所有语句一律走 dispatcher）
  const result = await dispatchStatement(stmt, inputGeometries, outputCache, paramsMap, brepChain, this.ports, this.mode)
  outputCache.set(stmt.id, result)

  // 写入 statementCache
  const contentKey = computeContentKey(result.positions, result.indices)
  const getInputContentKey = (id: string) => this.statementCache.get(id)?.outputContentKey
  const stmtKey = computeStatementKey(stmt, getInputContentKey)
  this.statementCache.set(stmt.id, {
    statementKey: stmtKey,
    outputContentKey: contentKey,
    output: result,
  })
}
```

#### 3.5.2 `executeAssemblyPass` 方法

```ts
private async executeAssemblyPass(
  def: AssemblyContext,
  outputCache: Map<string, Shape>,
  brepChain: BrepChainState,
): Promise<void> {
  for (const constraint of def.constraints) {
    const c = constraint as Record<string, unknown>
    if (c.type !== 'face_mate' && c.type !== undefined) {
      throw new Error(`[assemble] unsupported constraint type: ${c.type}`)
    }

    const fixedPartName = (c.fixedScopedId as string) ?? (c.fixedPartName as string)
    const movingPartName = (c.movingScopedId as string) ?? (c.movingPartName as string)

    const fixedFace = await this.resolveFace(fixedPartName, c.fixedFace as Record<string, unknown>, outputCache, brepChain)
    const movingFace = await this.resolveFace(movingPartName, c.movingFace as Record<string, unknown>, outputCache, brepChain)

    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      fixedFace.center, fixedFace.normal,
      movingFace.center, movingFace.normal,
    )

    // Mesh（outputCache）：烘焙变换后的顶点
    const movingShape = outputCache.get(movingPartName)
    if (movingShape) {
      const transformed = applyTransform(movingShape, quaternion, pivot, translation, rotationMatrix)
      outputCache.set(movingPartName, transformed)
    }

    // BREP（solidCache）：刚体变换 OCCT 实体
    if (brepChain.kernel && brepChain.solidCache.has(movingPartName)) {
      const solid = brepChain.solidCache.get(movingPartName)!
      const R = new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
      )
      const t = new THREE.Vector3(...translation)
      const piv = new THREE.Vector3(...pivot)
      const Rpivot = new THREE.Vector3(...pivot).applyMatrix4(R)
      const finalTranslation = piv.clone().sub(Rpivot).add(t)
      const M = new THREE.Matrix4().multiply(R, new THREE.Matrix4().makeTranslation(
        finalTranslation.x, finalTranslation.y, finalTranslation.z,
      ))
      const matrixArray = matrixToArray(M)
      const transformedSolid = brepChain.kernel.transform(solid, matrixArray)
      try { brepChain.kernel.release(solid) } catch { /* 已释放 */ }
      brepChain.solidCache.set(movingPartName, transformedSolid)
    }
  }
}
```

#### 3.5.3 `resolveFace` 方法

```ts
private async resolveFace(
  partName: string,
  faceRef: { faceId?: string; surfaceType?: string },
  outputCache: Map<string, Shape>,
  brepChain: BrepChainState,
): Promise<{ center: [number, number, number]; normal: [number, number, number] }> {
  let topo = this.topologyCache.get(partName)

  if (!topo && brepChain.kernel && brepChain.solidCache.has(partName)) {
    const solid = brepChain.solidCache.get(partName)!
    const result = buildSolidTopologyRuntime(brepChain.kernel, solid)
    topo = {
      partName,
      source: 'brep' as TopologySource,
      data: { ...result, faces: result.runtime.faces } as unknown as SelectorRuntimeData,
    }
    this.topologyCache.set(partName, topo)
  }

  if (!topo) {
    throw new Error(`[assemble] topology not available for part "${partName}"`)
  }

  const faces = (topo.data as unknown as { faces: FaceRow[] }).faces
  const face = faces.find(f => f.id === faceRef?.faceId)
  if (!face) {
    throw new Error(`[assemble] face "${faceRef?.faceId}" not found in part "${partName}"`)
  }
  if (!face.center || !face.normal) {
    throw new Error(`[assemble] face "${faceRef?.faceId}" has no center/normal data`)
  }

  return {
    center: [face.center[0], face.center[1], face.center[2]],
    normal: [face.normal[0], face.normal[1], face.normal[2]],
  }
}
```

#### 3.5.4 resolveShapeRef 子重放：删除跳过

删除 `if (STRUCTURAL_OPS.has(s.op)) continue`（384 行）。所有语句走 dispatcher。同时复制装配上下文收集 + do_assemble 执行逻辑（同主循环）。

#### 3.5.5 plan() 增量分析：删除跳过

删除 `if (STRUCTURAL_OPS.has(stmt.op)) continue`（451 行）。所有语句参与增量分析。

#### 3.5.6 无终端回退：改用 `hasAssignment` + `returnType`

**当前**（`runtime.ts:298`）：
```ts
const nonStructStmts = script.statements.filter((s) => !STRUCTURAL_OPS.has(s.op))
```

**改动**：
```ts
// 取有赋值且返回 new_shape/same_shape 的最后一条语句
const terminalCandidates = script.statements.filter((s) =>
  s.hasAssignment && s.returnType !== 'scalar' && s.returnType !== 'void'
)
```

### 3.6 Dispatcher 改动

`src/ops/dispatcher.ts` 的 `do_assemble` 分支简化——装配 pass 已在 runtime 中执行，dispatcher 只需返回空 Shape：

```ts
case 'group':
case 'assembly':
case 'assemble':
case 'add_constraint':
case 'do_assemble': {
  // no-op：这些 op 不产出新几何。
  // group/assembly/assemble：声明结构，dispatcher 无需做事。
  // do_assemble：装配 pass 在 runtime 主循环中执行（副作用写回 outputCache/solidCache），
  //   dispatcher 只需返回空 Shape。
  // add_constraint：约束在 runtime 主循环中收集到 assemblyContext，dispatcher 无需做事。
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}
```

### 3.7 Codegen 改动

#### 3.7.1 `statementToLine` 改动

```ts
// group/assembly：new_shape，必须带赋值
if (stmt.op === 'group' || stmt.op === 'assembly') {
  const parts = buildArgsParts(stmt)
  const varName = stmt.assemblyVar ?? stmt.id
  return `const ${varName} = cad.${stmt.op}({ ${parts.join(', ')} })`
}

// assemble：new_shape，带赋值
if (stmt.op === 'assemble') {
  const parts = buildArgsParts(stmt)
  const varName = stmt.assemblyVar ?? 'assem1'
  return `const ${varName} = cad.assemble({ ${parts.join(', ')} })`  // let → const
}

// add_constraint：same_shape，允许裸调用
if (stmt.op === 'add_constraint') {
  const parts = buildArgsParts(stmt)
  const target = stmt.assemblyTarget ?? 'assem1'
  return `${target}.add_constraint({ ${parts.join(', ')} })`
}

// do_assemble：void，必须裸调用
if (stmt.op === 'do_assemble') {
  const target = stmt.assemblyTarget ?? 'assem1'
  return `${target}.do_assemble()`
}
```

#### 3.7.2 `scriptToCode` 改动

同 `statementToLine`：
- `group`/`assembly` → `const ${varName} = cad.${op}({ ... })`
- `assemble` → `const ${varName} = cad.assemble({ ... })`（let → const）
- `add_constraint` → `${target}.add_constraint({ ... })`（不变）
- `do_assemble` → `${target}.do_assemble()`（不变）

### 3.8 Schema 校验改动

`validateStatementArgs` 新增赋值校验（作为 parser 层的补充，双重保障）：

```ts
export function validateStatementArgs(stmt: CadStatement): ValidationError[] {
  const schema = SCHEMAS[stmt.op]
  if (!schema) return []

  const errors: ValidationError[] = []

  // ... 现有字段校验 ...

  // 赋值校验（与 parser 层双重保障）
  const rt = stmt.returnType ?? schema.returnType ?? 'new_shape'
  if (rt === 'void' && stmt.hasAssignment) {
    errors.push({
      field: 'assignment',
      message: `op "${stmt.op}" is void, cannot assign to a variable`,
    })
  }
  if ((rt === 'new_shape' || rt === 'scalar') && !stmt.hasAssignment) {
    errors.push({
      field: 'assignment',
      message: `op "${stmt.op}" returns ${rt}, must assign to a variable`,
    })
  }

  return errors
}
```

### 3.9 test-helpers.ts 改动

删除 `STRUCTURAL_OPS` 导入和跳过。终端回退改用 `hasAssignment` + `returnType`：

```ts
// 不再 import STRUCTURAL_OPS

for (const stmt of script.statements) {
  // 所有语句走 dispatcher
  const inputGeometries: Shape[] = []
  for (const inputRef of stmt.inputs) {
    const geo = outputCache.get(inputRef) ?? inputGeometryMap?.get(inputRef)
    if (!geo) {
      throw new Error(`[replayScript] missing input geometry for ref "${inputRef}" in statement "${stmt.id}"`)
    }
    inputGeometries.push(geo)
  }
  const result = await executeStatement(stmt, inputGeometries, outputCache, params, brepChain, ports, mode)
  outputCache.set(stmt.id, result)
}

// 取终端
const terminals = script.terminalShapes ?? []
if (terminals.length > 0) {
  const lastTerm = terminals[terminals.length - 1]
  const finalShape = outputCache.get(lastTerm.id)!
  return { contentKey: computeContentKey(...), shape: finalShape, brepChain }
}

// 回退：最后一条有赋值且返回 new_shape/same_shape 的语句
const candidates = script.statements.filter(s =>
  s.hasAssignment && s.returnType !== 'scalar' && s.returnType !== 'void'
)
if (candidates.length === 0) {
  throw new Error(`[replayScript] empty script — no geometry statements`)
}
const lastStmt = candidates[candidates.length - 1]
```

### 3.10 cli.ts 改动

删除 `STRUCTURAL_OPS` 导入。终端回退改用 `hasAssignment` + `returnType`。

### 3.11 index.ts / browser.ts 改动

删除 `STRUCTURAL_OPS` 导出。

### 3.12 runtime.test.ts 改动

"structural statements are skipped" 测试改为"all statements are executed"。

### 3.13 各测试文件改动

删除 `STRUCTURAL_OPS` 导入。`filter(s => !STRUCTURAL_OPS.has(s.op))` 改为 `filter(s => s.hasAssignment && s.returnType !== 'scalar' && s.returnType !== 'void')`。

---

## 4. 逐文件改动契约

### 4.1 faijs 侧

| 文件 | 改动 |
|---|---|
| `src/lang/types.ts` | `CadStatement` 新增 `hasAssignment?: boolean` 和 `returnType?: ReturnType` 字段。新增 `ReturnType` 类型导出。 |
| `src/lang/args-schema.ts` | `OpSchema` 新增 `returnType?: ReturnType`。`add_constraint` 标注 `returnType: 'same_shape'`。`do_assemble` 标注 `returnType: 'void'`。其余 op 缺省 `new_shape`。`validateStatementArgs` 新增赋值校验。 |
| `src/lang/parser.ts` | (1) 删除 `STRUCTURAL_OPS` 定义。(2) `computeTerminalShapes` 重写：以 `hasAssignment` + `returnType` 为判据。(3) `group`/`assembly` 改为必须走 `VariableDeclaration`（有赋值），删除 ExpressionStatement 中的裸调用分支。(4) `assemble` 放宽 `let` → `const\|\|let`。(5) 所有语句设 `hasAssignment` 和 `returnType`。(6) 新增赋值校验。 |
| `src/lang/codegen.ts` | (1) `group`/`assembly` 输出从裸调用改为 `const ${var} = cad.${op}({...})`。(2) `assemble` 的 `let` → `const`（2 处）。 |
| `src/cad-runtime/runtime.ts` | (1) 删除 `STRUCTURAL_OPS` 导入。(2) replay 主循环删除跳过，所有语句走 dispatcher。(3) 新增装配上下文收集。(4) 新增 do_assemble 装配 pass。(5) 新增 `executeAssemblyPass` 方法。(6) 新增 `resolveFace` 方法。(7) resolveShapeRef 子重放删除跳过。(8) plan() 删除跳过。(9) 无终端回退改用 `hasAssignment` + `returnType`。(10) 新增 import。 |
| `src/ops/dispatcher.ts` | `do_assemble` 分支简化：合并到统一 no-op 分支。 |
| `src/test-helpers.ts` | 删除 `STRUCTURAL_OPS` 导入和跳过。终端回退改用 `hasAssignment` + `returnType`。 |
| `src/node-host/cli.ts` | 删除 `STRUCTURAL_OPS` 导入。终端回退改用 `hasAssignment` + `returnType`。 |
| `src/index.ts` | 删除 `STRUCTURAL_OPS` 导出。新增 `ReturnType` 类型导出（如需要）。 |
| `src/browser.ts` | 删除 `STRUCTURAL_OPS` 导出。 |
| `src/cad-runtime/runtime.test.ts` | 测试逻辑翻转。 |
| 各测试文件 | 删除 `STRUCTURAL_OPS` 导入，改用 `hasAssignment` + `returnType`。 |

### 4.2 3d_editor 侧

| 文件 | 改动 |
|---|---|
| `executeScript.ts` | (1) 删除所有 `STRUCTURAL_OPS` 执行跳过。(2) diff 逻辑改用 `hasAssignment` + `returnType`。 |
| `replay-validator.ts` | 删除执行跳过。终端取值改用 `hasAssignment` + `returnType`。 |
| `ScriptEngine.ts` | 终端取值改用 `hasAssignment` + `returnType`。 |
| `assemble-store.ts` | `confirmAssemble` 删除 rotate/translate 语句。改为 `createAssembly` + `recomputePart`。 |
| `model-store.ts` | `createAssembly` 改为 `op=assemble` + 追加 `do_assemble` 语句。`do_assemble` 不设 feature。 |
| `TimelinePanel.tsx` | 跳过 `do_assemble` 不产生 timeline 节点。 |
| `feature-registry.tsx` | 注册 `assemble` kind。 |
| `test/e2e/assembly.spec.ts` | 节点计数 6→3。导出文本断言改为 `cad.assemble` + `do_assemble`。 |

---

## 5. Timeline 节点计数

- timeline 节点 = 每条有 feature 的语句一个节点。
- `do_assemble` 不设 feature → 不渲染 → 0 个节点。
- 装配内部 rotate/translate 不再作为独立语句 → 6→3。
- 3 个节点 = cube + cylinder + assemble。

---

## 6. 装配 pass 数学说明

`applyTransform`（mesh）公式：`p' = R*(p-pivot) + pivot + translation`

展开后：`p' = R*p + (pivot - R*pivot + translation)`

BREP 路径用同一个矩阵 `M = R * T(pivot - R*pivot + translation)`，经 `matrixToArray` 转为 OCCT 格式后调 `kernel.transform`。

两者数学一致，保证 mesh 与 BREP 位置同步。

---

## 7. 导出位置保证

- mesh 件：`outputCache[movingPartName]` 已被 `applyTransform` 烘焙。
- BREP 件：`solidCache[movingPartName]` 已被 `kernel.transform` 刚体变换。
- 导出层无需装配感知代码。
- faijs 再导入：导出的文本含 `cad.assemble({...constraints})` + `do_assemble()` → 重新 parse + replay → 位置复现。

---

## 8. `STRUCTURAL_OPS` 删除清单

### 8.1 faijs 侧

| 文件 | 动作 |
|---|---|
| `src/lang/parser.ts` | 删除定义和引用。 |
| `src/cad-runtime/runtime.ts` | 删除导入和 4 处引用。 |
| `src/test-helpers.ts` | 删除导入和 2 处引用。 |
| `src/node-host/cli.ts` | 删除导入和 1 处引用。 |
| `src/index.ts` | 删除导出。 |
| `src/browser.ts` | 删除导出。 |
| 6 个测试文件 | 删除导入和引用。 |
| `runtime.test.ts` | 测试逻辑翻转。 |

### 8.2 3d_editor 侧

| 文件 | 动作 |
|---|---|
| `executeScript.ts` | 删除所有引用，改用 `hasAssignment` + `returnType`。 |
| `replay-validator.ts` | 删除引用。 |
| `ScriptEngine.ts` | 删除引用。 |

---

## 9. 开放决策

1. **move flush 的处理**：建议保留为独立 transform 语句。
2. **mesh 件拓扑约束**：通用 mesh 装配依赖 3d_editor 在 `setTopology` 注入面拓扑。
3. **grp_N id 不稳定问题**：group/assembly 语句现在必须有赋值（变量名），id = 变量名。`add_constraint`/`do_assemble` 仍是 `grp_N`，diff 逻辑改用 `hasAssignment` 排除无赋值的语句。

---

## 10. 第二步：拓扑面稳定溯源（初步方案，待评审）

> 用户原始要求（原样保留）：
>
> 第二步，是实现装配拓扑的优化。可以参考这个文档 C:\my\Faicad\3d_editor\docs\plans\2026-08-17-resolve-geom-ref-fallback-fix.md，其中的 `faceEvolutionCache` 写入但从未消费——面演化链路断裂。
> 仔细分析它，我的目的是要实现拓扑面的稳定溯源，不能依靠faceOrdinal之类的东西。
> 怎么实现我没有想好，你先详细调研，给出一个初步的方案。

### 10.1 现状调研结论

1. `faceEvolutionCache` 写入端已实现，但读取端从未接线。
2. hash 不可持久化（内存地址哈希）。
3. ordinal 不可靠（布尔操作改变面顺序）。

### 10.2 初步方案：FaceLineage —— 面谱系

核心思路：把面身份系在面从哪来（谱系链）上，重放时沿语句链重建谱系 → 定位当前面。

`FaceLineage = { root: { stmtId, ordinal }, tags: Array<{ op, ordinal }> }`

### 10.3 实施顺序

1. P0（本次实现）：`resolveFace` 的 `faceId` 解析主路径落地 → 装配可运行。
2. P1：`faceEvolutionCache` 补全写入 + 穿越算法。
3. P2：装配约束引用 lineage。
4. P3：root 定位降级几何指纹。

---

## 11. 一句话总结

按正常语言处理：所有 faijs 语句的返回值分四类——`new_shape`（必须赋值）、`same_shape`（可赋值可不赋值，用于链式调用）、`scalar`（必须赋值，不参与终端）、`void`（不准赋值）。terminal shape 判据 = 有赋值且返回值是 new_shape/same_shape。`STRUCTURAL_OPS` 彻底删除。所有语句一律执行。

```js
const assem1 = cad.assemble({ name, members, constraints })
assem1.do_assemble()
```

- faijs 侧：schema 新增 `returnType`；parser 新增 `hasAssignment`/`returnType`，group/assembly 改为必须有赋值，assemble 改为 const，新增赋值校验（new_shape/scalar 必须赋值，void 不准赋值，same_shape 自由）；codegen 输出 const + 带赋值；runtime 删除所有 STRUCTURAL_OPS 跳过，所有语句走 dispatcher，do_assemble 处执行装配 pass；dispatcher 统一 no-op；test-helpers/cli 改用 hasAssignment + returnType；index/browser 删除 STRUCTURAL_OPS 导出。
- 3d_editor 侧：confirmAssemble 删除独立 rotate/translate 语句；改为 createAssembly 产出 assemble + do_assemble 语句；TimelinePanel 过滤 do_assemble；feature-registry 注册 assemble kind；6→3 节点。
- 效果：装配几何变更全经 faijs 语句执行（红线修复）；do_assemble 不产生 timeline 节点；独立 rotate/translate 语句消失 → 6→3；导出天然取装配后位置；faijs 再导入经同一 pass 复现装配。
- 第二步（拓扑面稳定溯源）给出 FaceLineage 谱系方案，待评审。