# faijs 语言正常化重构：实施细化文档（从设计文档 §7 展开）

- 日期：2026-08-27
- 状态：已落地（本文档的 inputs/args 双槽语句模型已被 [2026-09-04-faijs-true-js-subset-call-args-design.md](2026-09-04-faijs-true-js-subset-call-args-design.md) 的单一 `positional` 槽模型取代）
- 范围：本文件把 `docs/plans/2026-08-27-faijs-language-normalization-design.md` 第 7 节「实施步骤」展开为**可直接执行的逐阶段实施稿**，目标是：交给另一个大模型/工程师，不依赖设计文档以外的推理即可实施。
- 上级文档：`docs/plans/2026-08-27-faijs-language-normalization-design.md`（设计判定、IR 定义、波及清单以它为准；本文件负责"怎么做"）
- 关联文档：`docs/plans/2026-08-27-faijs-function-contract.md`（作废，勿参考）；`docs/plans/2026-08-27-restore-dag-terminal-detection.md`（DAG 终端判定历史）

---

### 0.2 全局纪律（每条都不可违反）

1. **测试纪律**：先跑自己写的测试 → 再单独跑其它可能被影响的测试 → 全部绿才准跑 `pwsh -NoProfile scripts/ci.ps1`。**严禁通过跑 CI 找 bug**；CI 跑完一次后，之后只重跑失败用例。
2. **stderr 零容忍**：任何测试输出 `stderr |` 行即判失败。故意触发错误的测试必须在测试内 spy `console.warn/error` 并断言。禁止全局静默 stderr。
3. **生成文件纪律**：`src/mesh/api.d.ts`、`src/lang/symbol-table.json`、`docs/ops-api-inventory.md` 均为机器生成，禁手改；改签名后必须重跑生成脚本。
4. **行为零变化闸门（阶段 3 关键）**：同一 `.faijs` 文本重构前后 `ExecutionResult`（terminals/outputs/compounds）必须一致。测试因内部机制消失而红时，**改机制不改语义**。
5. **代码注释一律英文**；commit message 用 conventional commits；仓库文档可用中文。
6. **IR 字段改名是两仓库一起改**（设计文档 §10 决策 1，默认采纳）：`op→callee`、`assemblyTarget→receiver`。faijs 先完成，3d_editor 在阶段 5 跟进。

### 0.3 实施前提：待评审决策点的默认值（评审结论若不同，需联动修改的位置已标注）

| 决策点（设计文档 §10） | 本实施文档默认采纳 | 联动位置 |
|---|---|---|
| 1. IR 字段改名 op→callee / assemblyTarget→receiver | 采纳（机械重命名） | 全仓所有 `stmt.op` / `assemblyTarget` 引用 |
| 2. 旧名兼容删除：partN_vM/grp_N 解析兼容 + loadFile/loadUrl/loadByKey 收敛 | 采纳，全删，fixture 同步迁移 | `allocate-id.ts` 旧名正则、`parser.ts:277-284`、`codegen.ts:452-455`（load 的 `// source:` 注释行随 A4 一并删除） |
| 3. load 的 `// source:` 注释行 | 随 A4 删除（通用打印机不再需要） | `codegen.ts:452-455` |
| 4. R4（Shape[] 等量多入多出） | 禁用：`derivePartName` 抛错 | `derivePartName` 实现 |
| 5. R5（ReadonlyShape+Shape 混合 shape 入参） | 符号表生成期报错禁用 | `scripts/gen-symbol-table.ts` |
| 6. 符号表附带参数类型信息支撑静态参数校验 | 本方案不做（后续迭代） | 无 |

### 0.4 本文件使用的符号约定

- 「删除 A1」等指设计文档 §3.1 的现状缺陷编号（A1–A14、B1–B5、C1–C5）。
- 「§4.x」指设计文档章节号。
- 所有给出代码块的「目标形态」均为可抄写的参考实现，行号以仓库现状为准，实现时以仓库实际代码为基底。
- 每个阶段末尾有「✅ 阶段验收」，包含必须通过的验证命令与完成判据。

---

## 1. 全仓机械重命名（阶段 2 开始前的第一步，行为零变化）

在开始任何语义改造前，先完成下列**纯机械重命名**，做完跑一次 `npx vitest run src/lang src/cad-runtime` 确认仍全绿：

| 旧 | 新 | 范围 |
|---|---|---|
| `CadStatement.op` 字段 | `CadStatement.callee` | `src/lang/types.ts` 定义 + 全仓引用 |
| `stmt.op` / `s.op` | `stmt.callee` / `s.callee` | 全仓（含测试断言） |
| `CadStatement.assemblyTarget` 字段 | `CadStatement.receiver` | `src/lang/types.ts` 定义 + 全仓引用（含测试） |
| `createStatement(id, op, ...)` 形参 `op` | 形参 `callee` | `src/lang/types.ts` |

**重要**：此步骤只改名，**不删任何分支逻辑**。`op: 'boolean'` 的**值**、`if (stmt.op === 'group')` 等分支全部原样保留——它们由后续阶段逐个消灭，现在动会混入语义变化，违背"行为零变化"。

完成判据：`npx vitest run src/lang src/cad-runtime` 全绿。

---

## 2. 阶段 0：规格测试先行（红）

目标：把设计文档 §4.2/§4.3/§4.7/§4.8 的规格写成**可执行测试**。此阶段只新增/修改测试文件，**不改任何 src 代码**。写完跑一次，测试必须红（这是验收规格）。

### 2.1 新语法形态测试：`src/lang/parser-normalization.test.ts`（新文件）

覆盖设计文档 §4.1/§4.3 的全部新语法能力，用 `parseScript` 断言 IR。注意：本阶段 IR 仍是旧字段（op/assemblyTarget），测试先按**目标字段**（callee/receiver/outputKeys/VarRef/CallRef）写——这正是"红"：等阶段 2 的 IR 改造落地才绿。

**用例清单**（每个用例都要 `parseScript` 后断言）：

1. **boolean 归一取消**：`cad.union(a,b)` → 断言 `callee === 'union'`（不再是 `op==='boolean'` 且无 `args.operation`），`inputs` 长度 2。
2. **任意 callee 的对象解构**：`const { front: x, back: y } = await cad.split(part0, {...})` → 断言 `outputKeys === ['front','back']`、`outputs === [x的PartName, y的PartName]`；再写一个非 split callee 的解构（如 `cad.decompose(...)`）也合法。
3. **任意成员调用**：`asm1.add_constraint({...})` 与 `asm1.do_assemble()` → 断言 `receiver === 'asm1'`、`callee === 'add_constraint'` / `'do_assemble'`；再写一个任意方法名 `asm1.myMethod()` 也合法（receiver 须已声明）。
4. **args 内嵌套调用 → CallRef**：`cad.drill(part0, { at: cad.faceCenter(part2), depth: 2 })` → 断言 `args.at` 是 `{$call: { callee: 'faceCenter', args: [...] }}`，其中 args[0] 是 `{$ref: part2的PartName}`。
5. **members 走 VarRef**：`cad.group({ members: [part0, part1] })` → 断言 `args.members` 是 `[{$ref:...}, {$ref:...}]`（不再解析为字符串）。
6. **asset 走 CallRef**：`cad.asset('cfg')` 嵌套在 args 中 → `{$call: { callee: 'asset', args: ['cfg'] }}`。
7. **裸重赋值保留**：`part0 = cad.drill(part0, {...})` → `callee==='drill'`、`inputs=[part0]`（机制不变，只换字段名）。
8. **`load` 别名不再收敛**：`cad.loadFile({ path })` → `callee === 'loadFile'`（A4 删除后的行为）。

### 2.2 命名规则纯函数测试：`src/lang/derive-part-name.test.ts`（新文件）

针对设计文档 §4.7 的 `derivePartName`（**阶段 3 才实现**，本阶段测试先红）。先按目标签名写测试：

```ts
// 目标签名（阶段 3 实现）：
// function derivePartName(input: {
//   callee: string; inputCount: number; outputCount: number; statements: CadStatement[]
// }): { behavior: 'reuse' | 'new'; names: PartName[] }
```

用例（符号表以设计文档 §4.6 示例为假设：copy/group/assembly 有 readonly 标注，drill/union 无）：

| 用例 | callee | inputCount | outputCount | 期望 |
|---|---|---|---|---|
| R0 | do_assemble | 0 | 0 | `{ behavior: 'new', names: [] }` |
| R1a | copy | 1 | 1 | `{ behavior: 'new', names: [partN] }` |
| R1b | group | 0 | 1 | `{ behavior: 'new', names: [partN] }`（members 走 readonlyPaths，不算输入） |
| R2 | drill | 1 | 1 | `{ behavior: 'reuse', names: [] }` |
| R3a | box | 0 | 1 | `{ behavior: 'new', names: [partN] }` |
| R3b | union | 2 | 1 | `{ behavior: 'new', names: [partN] }` |
| R3c | split | 1 | 2 | `{ behavior: 'new', names: [partN, part(N+1)] }` |
| R4 | myBatch | 2 | 2 | **抛错**（禁用） |
| 未知函数 | myLib.clone | 1 | 1 | `{ behavior: 'reuse' }`（默认消费语义） |

partN 递增逻辑复用现有 `getMaxModelNum`（`allocate-id.ts:29-54`），测试构造 statements 断言 N 递增。

### 2.3 活跃性纯函数测试：`src/cad-runtime/terminal-dag-symbol.test.ts`（新文件）

针对设计文档 §4.8 的 `consumes()`（目标签名：`consumes(stmt, v, symbolTable): boolean`）。用例 = §4.8 效果对照表六例全收 + 嵌套调用不消费 + 未知函数默认消费：

| 脚本 | 判定的变量 | 期望 consumed |
|---|---|---|
| `part1 = cad.copy(part0)` | part0 | false（copy 入参 readonly） |
| `part0 = cad.drill(part0, ...)` | part0 | true（drill 无 readonly，右侧出现即消费） |
| `{front,back} = cad.split(part0)` | part0 | true |
| `g = cad.group({members:[part0,part1]})` | part0 / part1 | false（members 路径 readonly） |
| `cad.drill(part0, {at: cad.faceCenter(part2)})` | part2 | false（嵌套调用内引用不消费） |
| `x = myLib.clone(part0)`（未知 callee） | part0 | true（默认消费） |

### 2.4 红确认

`npx vitest run src/lang/parser-normalization.test.ts src/lang/derive-part-name.test.ts src/cad-runtime/terminal-dag-symbol.test.ts` —— 三个文件必须红（新文件编译失败/断言失败均可接受，红即规格已锁定）。

**实施者注意**：2.1 的 parser 测试在阶段 2 才绿；2.2/2.3 在阶段 3 才绿。阶段 0 的红是预期，**禁止**为了绿去改 src。

---

## 3. 阶段 1：符号表 + 库层签名（行为零变化阶段）

目标：建立 `ReadonlyShape` 品牌类型与机器生成的符号表；boolean 拆三函数；emitBrepLost 内移。**此阶段符号表尚无消费方**，全量 vitest 必须保持全绿（行为零变化）。

### 3.1 新增 `ReadonlyShape` 品牌类型

位置：`src/mesh/types.ts`（与 Shape 同文件，契约文档面）——设计文档 §4.5-2 允许放 `src/mesh/types.ts` 或 `src/stdlib/shape.ts`，**选择 `src/mesh/types.ts`**（品牌类型属于类型契约，与 Shape 同层，供 stdlib 与外部库引用）。

在 `src/mesh/types.ts` 的 Shape 定义后追加：

```ts
declare const readonlyBrand: unique symbol

/**
 * Shape 类型的强化：承诺本函数不修改、不消费该入参。
 * 可选品牌属性使任何 Shape 可赋给 ReadonlyShape 形参（调用方零负担）。
 * 它是文档 + 符号表提取源 + 实现契约；契约靠契约测试守护，不靠类型系统强制。
 */
export type ReadonlyShape = Shape & { readonly [readonlyBrand]?: true }
```

### 3.2 库层签名标注（机械工作，无逻辑变化）

逐个修改下列文件，把"不修改、不消费"的 shape 入参类型从 `Shape` 改为 `ReadonlyShape`，同时保持函数体不变：

| 文件 | 函数 | 改动 |
|---|---|---|
| `src/stdlib/copy.ts` | `copy(input: Shape, _params, exec)` | `input: ReadonlyShape` |
| `src/stdlib/compound.ts` | `group(params, _exec)` | 新增可选标注（见下） |
| `src/stdlib/compound.ts` | `assembly(params, exec)` | 同上 |
| `src/stdlib/transform.ts` | `translate/rotate/scale` | **不改**（它们原地修改，保持 Shape） |
| `src/stdlib/boolean.ts` | 拆分出的三函数 | 见 3.3 |

group/assembly 的 members 是 `params.members`（对象属性数组），其元素类型标注方式（设计文档 §4.6 的 `readonlyPaths` 提取规则）：

```ts
// src/stdlib/compound.ts 目标签名（仅类型标注变化）
export interface GroupParams {
  name?: string
  /** Compound members: read-only references, never mutated by group/assembly. */
  members?: readonly ReadonlyShape[]
  memberNames?: string[]
}
export interface AssemblyParams extends GroupParams {
  constraints?: AssemblyConstraint[]
}
export function group(params: GroupParams, _exec: ExecContext): CompoundShape { /* body 不变 */ }
export function assembly(params: AssemblyParams, exec: ExecContext): CompoundShape { /* body 不变 */ }
```

> **重要**：`members?: readonly ReadonlyShape[]` 用 `readonly` 修饰数组——符号表提取器据此识别 `readonlyPaths: ['members']`。如果只写 `ReadonlyShape[]`，提取器必须也能识别（设计文档说 `readonly ReadonlyShape[]`，实施时**两种都识别**更稳，见 3.4 提取规则）。

### 3.3 boolean 拆三函数

`src/stdlib/boolean.ts`：把单个 `boolean(...)` 导出改为三个薄函数，共享内部实现。**删除** `assertBooleanParams`（operation 参数不存在了）。

目标形态：

```ts
// src/stdlib/boolean.ts
import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solidToShape } from '../brep/brep-ops'
import { cutWithHistoryBrep, fuseWithHistoryBrep, intersectWithHistoryBrep } from '../brep/face-evolution'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

const brepImpl = true

type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 共享内部实现（原 boolean 函数体，operation 从参数改为入参） ──
async function booleanImpl(operation: BooleanOperation, inputs: Shape[], params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  const path = resolvePath(exec, inputs, brepImpl)
  if (path === 'brep') return booleanBrep(inputs, operation, exec)
  return solid(await booleanMesh(inputs, operation))
}

// ── 三个薄导出（统一 ABI：(…sourceArgs, exec)，见阶段 3） ──
export function union(...rest: unknown[]): Promise<Shape> {
  const exec = rest.pop() as ExecContext
  const params = (rest.pop() ?? {}) as Record<string, unknown>
  const inputs = rest as Shape[]
  return booleanImpl('union', inputs, params, exec)
}
export function subtract(...rest: unknown[]): Promise<Shape> {
  const exec = rest.pop() as ExecContext
  const params = (rest.pop() ?? {}) as Record<string, unknown>
  const inputs = rest as Shape[]
  return booleanImpl('subtract', inputs, params, exec)
}
export function intersect(...rest: unknown[]): Promise<Shape> {
  const exec = rest.pop() as ExecContext
  const params = (rest.pop() ?? {}) as Record<string, unknown>
  const inputs = rest as Shape[]
  return booleanImpl('intersect', inputs, params, exec)
}
```

同时把 `booleanBrep` / `booleanMesh` 的签名从 `(inputs, params, exec)` / `(inputs, operation)` 改为接收 `operation` 直接参数（原实现从 `params.operation` 取值，现在 operation 已由薄函数决定）。

> **注意 ABI 兼容**：阶段 1 的编译产物仍是旧 ABI（`cad.boolean(inputs, {operation}, exec)`），adapter 仍转发 `boolean`。拆函数后 adapter 的 `boolean: (...rest) => booleanOp(...rest)` 会指向不存在的导出——**阶段 1 保留一个过渡**：`src/stdlib/boolean.ts` 同时导出兼容的 `boolean`（内部按 params.operation 分派到三个实现），阶段 3 删除。这是"行为零变化"的要求。

### 3.4 符号表生成器 `scripts/gen-symbol-table.ts`（新文件）

**输入**：TypeScript Compiler API 扫描 `src/stdlib/*.ts` 的导出函数签名。
**输出**：`src/lang/symbol-table.json`（生成文件）。

```jsonc
// src/lang/symbol-table.json（阶段 1 完成时的期望内容，示意）
{
  "copy":       { "readonlyPositions": [0] },
  "group":      { "readonlyPaths": ["members"] },
  "assembly":   { "readonlyPaths": ["members"] },
  "drill":      {},
  "union":      {},
  "subtract":   {},
  "intersect":  {},
  // …其余函数空对象或缺失（缺失=无 readonly 信息=默认消费语义）
}
```

**提取规则（纯机械，来自设计文档 §4.6）**：

1. 遍历 `src/stdlib/*.ts` 每个导出函数声明的**形参类型注解**（用 `ts.createProgram` + `ts.getTypeChecker`，对每个导出 FunctionDeclaration / VariableDeclaration（箭头函数）取 `checker.getSignatureOfDeclaration` 的 `getParameters()`，读每个参数的声明类型）。
2. 位置形参（排除末尾 `exec: ExecContext`）：类型为 `ReadonlyShape` → `readonlyPositions.push(该参数下标)`。
3. options 对象形参（如 `params: GroupParams`）：取其类型属性，属性类型为 `ReadonlyShape` 或 `readonly ReadonlyShape[]` / `ReadonlyShape[]` → `readonlyPaths.push(属性名)`。
4. **R5 检测（决策点 5）**：同一函数的位置形参中**同时**出现 `Shape` 与 `ReadonlyShape`（混合 shape 输入）→ 生成期抛错退出（`console.error` + `process.exit(1)`），报错信息含函数名。
5. 写 `src/lang/symbol-table.json`（`JSON.stringify(..., null, 2)`）。

实现要点：

```ts
// scripts/gen-symbol-table.ts（骨架）
import { createProgram, getPreEmitDiagnostics, ... } from 'typescript'
// 用 ts-morph 或原生 ts API 均可；关键是把"形参类型名"与"options 属性类型名"解析成字符串比较：
//   typeName === 'ReadonlyShape' → readonly
//   typeName === 'Shape' → shape（R5 判定用）
// 数组类型：typeName 是 'ReadonlyShape[]' 或 'readonly ReadonlyShape[]' → readonly-array
// exec 形参（类型名 ExecContext / ExecContextImpl）跳过
```

> 符号表 JSON 的**键** = 导出函数名（callee 名）。**boolean 拆分后不存在 `boolean` 键**——三个真实函数各占一栏。

### 3.5 符号表类型 + 消费入口

`src/lang/symbol-table.ts`（新文件，L0 层，零依赖）：

```ts
// src/lang/symbol-table.ts
import symbolTable from './symbol-table.json'

export interface FunctionSymbol {
  /** 位置形参中 ReadonlyShape 的下标 */
  readonlyPositions?: number[]
  /** options 对象中 readonly 的属性名（members 等） */
  readonlyPaths?: string[]
}

/** 标准库符号表：callee → readonly 标注。均匀数据，无 per-函数代码。 */
export type SymbolTable = Record<string, FunctionSymbol>

/** 生成的符号表（禁手改，由 scripts/gen-symbol-table.ts 生成） */
export const SYMBOL_TABLE: SymbolTable = symbolTable as SymbolTable

/** 未知函数（不在表中）→ undefined，消费方按默认语义处理 */
export function getFunctionSymbol(callee: string): FunctionSymbol | undefined {
  return SYMBOL_TABLE[callee]
}
```

> 注意：`import symbolTable from './symbol-table.json'` 需要 tsconfig 允许 `resolveJsonModule`——检查 `tsconfig.json` / `tsconfig.build.json`，若未开启则开启（或改用 `readFileSync` + `JSON.parse`，但浏览器端零依赖要求下 prefer import；构建产物 dist 需要把 json 一起拷出——`tsc` 会保留 json import 吗？不会自动拷贝。**备选方案**：用 `readFileSync` 在 node 环境读 + 浏览器端注入，见阶段 4 导出面处理；若工程已有 json import 先例则照抄）。

### 3.6 一致性守卫测试（替换 op-set-consistency）

`src/lang/op-set-consistency.test.ts` 改造为**符号表 ↔ stdlib 签名一致性守卫**：

- 对 `src/stdlib/*.ts` 每个导出函数，断言 `SYMBOL_TABLE` 中有条目（键一致）；
- 对 `SYMBOL_TABLE` 每个键，断言 stdlib 中确有导出；
- copy 的 `readonlyPositions` 包含 0；group/assembly 的 `readonlyPaths` 包含 'members'；
- **R5 反例**：构造一个签名混合 Shape+ReadonlyShape 的临时函数（在测试内联声明），断言 `gen-symbol-table` 的提取逻辑对它抛错（可直接调用生成器的核心提取函数，生成器应导出纯函数 `extractSymbolTable(sourceFiles): SymbolTable` 供测试 import）。

### 3.7 emitBrepLost 内移（B2 部分消灭）

现状：`src/cad-runtime/internal-stdlib-adapter.ts:91-95,107-111` 在 sdf/knurl 转发时发 `part-brep-lost` 事件。

目标：移入函数体内（设计文档 §4.5-1）。给 `ExecContext` 接口（`src/cad-runtime/exec-context.ts`）增加一个只读辅助：

```ts
// exec-context.ts — ExecContext 接口追加
/** 当前执行语句（库函数内发事件/取输出名用）。 */
readonly currentStmt?: CadStatement
```

`ExecContextImpl` 已有 `currentStmt`（exec-context.ts:130），接口补上声明即可。

`src/stdlib/sdf.ts` 与 `src/stdlib/knurl.ts` 函数体内开头加：

```ts
// sdf.ts / knurl.ts
import { asPartName } from '../identity'
import type { ExecContext } from '../cad-runtime/exec-context'

export async function sdf(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  if (exec.mode === 'auto') {
    exec.ports?.events.emit('part-brep-lost', {
      partName: asPartName(exec.currentStmt?.outputs[0] ?? ''),
      op: 'sdf',
      reason: 'mesh-only op output',
    })
  }
  // …原 resolvePath + cad.sdf 逻辑不变
}
```

> 注意：`ExecContext` 接口目前没有 `ports` 字段，事件经 `exec.events`（exec-context.ts:77 已有 `events: EventSink`）。用 `exec.events.emit(...)`，不要引入 `exec.ports`。

### 3.8 ✅ 阶段 1 验收

1. `npx vitest run src/lang src/cad-runtime src/api-dts-sync.test.ts` 全绿（**行为零变化**：符号表尚无消费方，adapter 仍走旧 ABI，boolean 兼容导出仍在）。
2. `npm run build` 通过（tsc 编译新文件）。
3. `npx tsx scripts/gen-symbol-table.ts` 成功产出 `src/lang/symbol-table.json` 且内容与 §3.4 期望一致。

---

## 4. 阶段 2：IR + parser 纯化

目标（设计文档 §4.2/§4.3）：`CadStatement` 收敛为通用调用语句；parser 删 A1–A8 全部按函数名特判，变成**零函数知识的纯语法解析**；同时让 compile/codegen **适配新 IR 但保留旧分支**（本阶段不删 compile/codegen 的 per-op 分支，保证切换点干净，阶段 3 才做无分支化）。parser 与 codegen 的 round-trip 测试必须全绿。

> **为什么 compile/codegen 要本阶段一起动**：IR 类型一改（GeomRef/AssetRef 退役、Arg 加 VarRef/CallRef），`translateGeomRef/translateAssetRef`、`fmtGeomRef/fmtAssetRef` 立即失去类型来源，必须同步删除/替换，否则 typecheck 红。但它们的**分支逻辑**（boolean/split/group 等）保留到阶段 3 删。

### 4.1 types.ts：IR 收敛（§4.2 落地）

`src/lang/types.ts` 改造：

```ts
// ── Arg 变体：退役 GeomRef/AssetRef，新增 VarRef/CallRef ──
export interface ParamRef {
  $param: string
}

/** 变量引用：args 内出现的已声明变量（如 members 元素）。编译为 ctx.<name>。 */
export interface VarRef {
  $ref: string
}

/** 嵌套调用：args 内的 cad.<callee>(...)。编译为 cad.<callee>(…, exec)。 */
export interface CallRef {
  $call: {
    callee: string
    args: Arg[]
  }
}

export type Arg = JsonValue | ParamRef | VarRef | CallRef
```

删除 `GeomRef`、`AssetRef` 接口与 `isGeomRef`/`isAssetRef` 守卫（A7 的数据类型基础）。新增守卫：

```ts
export function isVarRef(arg: Arg): arg is VarRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$ref' in arg
}
export function isCallRef(arg: Arg): arg is CallRef {
  return arg !== null && typeof arg === 'object' && !Array.isArray(arg) && '$call' in arg
}
```

`CadStatement` 字段级收敛（`op→callee`、`assemblyTarget→receiver` 已在 §1 机械改名完成，此处补 `outputKeys`）：

```ts
export interface CadStatement {
  id: StmtId
  callee: string                      // ← 已改名
  receiver?: PartName                 // ← 已改名（成员调用接收者）
  inputs: ShapeRef[]
  args: Record<string, Arg>
  /** 解构键：const {front: a, back: b} = ... → ['front','back']。与 outputs 一一对应。 */
  outputKeys?: string[]
  outputs: PartName[]
  refs?: string[]
  hasAssignment?: boolean
  seq?: number
}
```

`createStatement` 工厂签名随字段改名（`op` 形参 → `callee`）。

### 4.2 parser.ts：删除清单（A1–A8）

| 编号 | 现状位置 | 处置 |
|---|---|---|
| A1 | `BOOLEAN_OP_NAMES`（:67）+ `parseCadStatement` 的 boolean 改写分支（:237-250） | 删除常量与分支。`cad.union(a,b)` 走普通 op 路径：callee='union'，两个 Identifier 入 inputs，无 args |
| A2 | `parseSplitDestructuring`（:315-407）整函数 | 删除。解构解析改为通用（4.3-2） |
| A3 | `parseScript` 的 E15.1 group/assembly 特判分支（:764-809） | 删除。group/assembly 走普通调用路径（members 数组元素经 VarRef 通用扫描） |
| A4 | load 别名收敛（:277-284） | 删除。`cad.loadFile(...)` 的 callee 就是 'loadFile'（决策 2：不收敛） |
| A5 | void 校验（:823-828，依赖 `options.schemas`） | 删除。赋值给无返回值调用得到 undefined，JS 语义无害 |
| A6 | 成员方法只认 add_constraint/do_assemble（:921） | 删除名字白名单，改为任意方法名（4.3-3） |
| A7 | `GEOMREF_FEATURES`/`ASSET_FEATURES`（:68-69）+ `parseValueExpr` 的 GeomRef/AssetRef 分支 | 删除常量与分支，改为通用嵌套调用 CallRef（4.3-1） |
| A8 | `NON_CONSUMING_OPS`（:563）+ `validateConsumption`（:580-639）+ `parseScript` 的调用（:988） | 整段删除（消费语义移入 terminal-dag，阶段 3） |

同时：`ParseOptions.schemas` 字段（:643-647）删除；`parseScript` 的 `options?.schemas?.[stmt.op]` 校验（:823-828）删除；`import type { OpSchema } from './args-schema'`（:43）删除；`allocateStatementId` 调用点改为临时签名（阶段 3 换 derivePartName）。

### 4.3 parser.ts：新增通用能力（§4.3 六条规则落地）

**4.3-1 `parseCadStatement` 通用化**（删除 A1/A3/A4/A5 后）：

```ts
function parseCadStatement(
  declNode: ASTNode,
  paramNames: Set<string>,
  varToId: Map<string, PartName>,
): ParsedStatement {
  // …原样：提取 varName、init、校验 CallExpression、校验 callee 是 cad.<ident>
  const calleeName = callee.property.name   // 不再做 BOOLEAN_OP_NAMES 判断
  const inputs: PartName[] = []
  let args: Record<string, Arg> = {}
  for (const argNode of init.arguments) {
    if (argNode.type === 'Identifier') {
      const inputId = varToId.get(argNode.name)
      if (!inputId) throw new ParseError(`unknown variable "${argNode.name}" in inputs`, getLine(argNode))
      inputs.push(inputId)
    } else if (argNode.type === 'ObjectExpression') {
      const parsed = parseValueExpr(argNode, paramNames, varToId, line)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, Arg>
      } else {
        throw new ParseError('args must be an object', line)
      }
    } else {
      throw new ParseError(`unexpected argument type: ${argNode.type}`, getLine(argNode))
    }
  }
  const stmt: CadStatement = { id: asStmtId('__pending__'), callee: calleeName, args, inputs, outputs: [], hasAssignment: true }
  return { stmt, varName, declaredOutputs: [varName] }
}
```

注意：**多输入布尔**（`cad.union(a,b,c)`）不再有"全参数必须是 Identifier"的专项校验——通用循环已覆盖（每个 Identifier 都进 inputs）。

**4.3-2 通用解构**（替代 parseSplitDestructuring，任意 callee、任意键）：

在 `parseScript` 的 VariableDeclaration 分支中，`decl.id?.type === 'ObjectPattern'` 时：

```ts
// 通用解构：const { k1: v1, k2: v2 } = await cad.<any>(...)
// 任意键数（1..N），任意 callee
const props = decl.id.properties
if (props.length === 0) throw new ParseError('destructuring must have at least one property', line)
const keys: string[] = []
const valueNames: string[] = []
for (const prop of props) {
  if (prop.type !== 'Property' || prop.key?.type !== 'Identifier') {
    throw new ParseError('destructuring properties must be identifiers', line)
  }
  if (prop.value?.type !== 'Identifier') {
    throw new ParseError(`destructuring value for "${prop.key.name}" must be an identifier`, line)
  }
  keys.push(prop.key.name)
  valueNames.push(prop.value.name)
}
// 提取 init（可包 AwaitExpression），必须是 cad.<ident>(...) CallExpression（复用 parseCadStatement 的提取逻辑，
// 但 outputs 改为按解构键数分配，outputKeys=keys）
const stmt: CadStatement = {
  id: asStmtId('__pending__'), callee: calleeName, args, inputs,
  outputKeys: keys, outputs: [], hasAssignment: true,
}
// varName → varToId 注册：valueNames[i] → outputs[i]（PartName）
```

> 输出命名：阶段 3 前临时沿用 `allocateStatementId`/`allocateSplitIds`（设计文档：`allocateSplitIds` 被 `derivePartName(outputCount:2)` 吸收）；阶段 3 换 `derivePartName` 后 outputs 按 `outputCount = keys.length` 分配。

**4.3-3 通用成员方法**（替代 A6，任意方法名）：

```ts
// ExpressionStatement 分支：expr 是 CallExpression 且 callee 是 MemberExpression 且 object 是 Identifier
const targetVar = expr.callee.object.name
const methodName = expr.callee.property.name
// 校验 targetVar 已声明（变量作用域检查，非 op 知识）——varToId 覆盖普通变量与装配变量
if (!varToId.has(targetVar)) {
  throw new ParseError(`unknown variable "${targetVar}" in .${methodName}() call`, line)
}
// args 解析同现状（ObjectExpression → parseValueExpr）
const memberStmt: CadStatement = {
  id: asStmtId('__pending__'), callee: methodName, args,
  inputs: [], outputs: [], receiver: targetVar, hasAssignment: false,
}
```

> 现状的 `assemblyVars` Set（:724、:804-806、:926）随之删除——`varToId` 已包含装配变量（A3 删除后 group/assembly 也走普通路径注册 varToId），无需额外集合。

**4.3-4 `parseValueExpr` 扩展：VarRef + CallRef**（替代 A7）：

```ts
// parseValueExpr 的 Identifier 分支：
case 'Identifier': {
  const name = node.name
  if (paramNames.has(name)) {
    return { $param: name } as ParamRef        // 参数变量（保留）
  }
  if (varToId.has(name)) {
    return { $ref: varToId.get(name)! } as VarRef   // 已声明变量 → VarRef（新）
  }
  throw new ParseError(`unknown identifier "${name}" in args value (not a declared param or variable)`, line)
}

// 新增 CallExpression 分支（嵌套调用 → CallRef）：
case 'CallExpression': {
  const calleeNode = node.callee
  if (
    calleeNode?.type !== 'MemberExpression' ||
    calleeNode.object?.type !== 'Identifier' ||
    calleeNode.object.name !== 'cad' ||
    calleeNode.property?.type !== 'Identifier'
  ) {
    throw new ParseError('nested calls in args must be cad.<ident>(...)', line)
  }
  const innerCallee = calleeNode.property.name
  const innerArgs = node.arguments.map((a: ASTNode) => parseValueExpr(a, paramNames, varToId, line))
  return { $call: { callee: innerCallee, args: innerArgs } } as CallRef
}
```

> 注意顺序：先查 paramNames，再查 varToId，最后报错。`cad.faceCenter(part2)` 的 `part2` 走 VarRef；`cad.asset('cfg')` 的实参是字符串字面量。

**4.3-5 引用收集纯化**（A10/A8 基础）：`collectRefsFromArg`（:521-540）改造为：

```ts
function collectRefsFromArg(value: Arg, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  if (isParamRef(value)) { out.add(value.$param); return }
  if (isVarRef(value)) { out.add(value.$ref); return }
  if (isCallRef(value)) { for (const a of value.$call.args) collectRefsFromArg(a, out); return }
  if (Array.isArray(value)) { for (const v of value) collectRefsFromArg(v as Arg, out); return }
  if (typeof value === 'object') { for (const v of Object.values(value)) collectRefsFromArg(v as Arg, out) }
}
```

`collectStatementRefs`（:546-558）删除 group/assembly 的 members 字符串特判（:551-556）——members 现在是 VarRef，被通用遍历覆盖。

**4.3-6 `parseScript` 主循环清理**：

- 删除 `validateConsumption(statements)` 调用（:988）。
- `ParseOptions` 接口删除 `schemas` 字段；`parseScript(code, options?)` 签名保留（options 可空或删除——**建议删除 options 参数**，调用方同步改：`runtime.check` 阶段 4 改、`cli.ts:93` 等）。
- group/assembly 特判分支（A3）删除后，其 `args` 解析并入普通路径。

### 4.4 compile.ts / codegen.ts：适配新 IR（保留分支）

**compile.ts**：
- 删除 `translateGeomRef`/`translateAssetRef`（:75-88,:96-98）与 `isGeomRef/isAssetRef` import；`translateArg`（:101-117）改为递归处理 VarRef/CallRef：

```ts
function translateArg(value: Arg): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return fmtNum(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return fmtStr(value)
  if (isParamRef(value)) return translateParamRef(value)
  if (isVarRef(value)) return `ctx.${value.$ref}`
  if (isCallRef(value)) {
    const { callee, args } = value.$call
    const inner = args.map((a) => translateArg(a)).join(', ')
    return `cad.${callee}(${inner}, exec)`
  }
  if (Array.isArray(value)) return `[${value.map((v) => translateArg(v as Arg)).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, Arg>)
    return `{ ${entries.map(([k, v]) => `${k}: ${translateArg(v)}`).join(', ')} }`
  }
  return String(value)
}
```

- `getStatementRefs`（:134-162）的兜底扫描同步支持 VarRef/CallRef（照抄 4.3-5 的遍历逻辑）。
- **保留** `buildStatementFnBody` 的六个分支（:165-222）——本阶段只把 `stmt.op` 改成 `stmt.callee`（§1 已改），**分支逻辑原样**。注意：parser 已产出 `callee='union'`，而 `buildStatementFnBody` 的 `if (stmt.callee === 'boolean')` 不再命中——union 会走默认分支 `cad.union(ctx.a, ctx.b, {}, exec)`，多出一个空 `{}` 参数。**布尔薄函数要能容忍**（见下）。

**stdlib/boolean.ts 兼容**：薄函数 `union(...rest)` 中 `rest.pop()` 弹 exec 后，`params = rest.pop()` 会把 `{}`（编译产物多发的空 args）弹掉，`inputs = rest` 恰好是两个 Shape——**现状 boolean.ts:95-100 的弹栈顺序天然兼容**（`rest.pop()` exec、`rest.pop()` params、rest 为 inputs）。`{}` 被当作 params 弹掉，无副作用。保持此弹栈顺序即可。

**codegen.ts**：
- 删除 `fmtGeomRef`/`fmtAssetRef`（:83-91,:78-80）与 `isGeomRef/isAssetRef` import；`fmtValue`（:51-65）加 VarRef/CallRef 分支：

```ts
// fmtValue 内新增：
if (isVarRef(value)) return value.$ref                    // 打印裸变量名
if (isCallRef(value)) {
  const { callee, args } = value.$call
  const inner = args.map((a) => fmtValue(a, varNames)).join(', ')
  return `cad.${callee}(${inner})`
}
```

- **保留** `buildArgsParts` 的 per-op switch（:108-328）——本阶段不删，只把 `stmt.op` 换成 `stmt.callee`（§1 已改）。round-trip 能过即可。

### 4.5 fixture / 测试断言适配清单

| 文件 | 改动 |
|---|---|
| `test/faijs/boolean/*.faijs` | 已直写 `cad.union/subtract/intersect`（union.faijs 就是 `let part2 = cad.union(part0, part1)`），无需改文本；但 `boolean.test.ts` 若断言 `op==='boolean'` 需改 callee |
| `src/lang/parser.test.ts` | boolean 归一断言（:302-320）改为 `callee==='union'` 且无 `args.operation`；load 旧名兼容用例（:325-339）**删除**（决策 2）；split 解构断言改 `outputKeys` |
| `src/lang/codegen.test.ts` | boolean/split/group 断言随新 IR 调整（buildArgsParts 输出不变则少改） |
| `src/lang/compile.test.ts` | `stmt.op` 断言改 `callee`；group members 特判测试（:118-139）改为通用路径断言 |
| `src/cad-runtime/runtime.test.ts` | makeStmt 工厂（:54-61）与手写 CadStatement（:900）的 `op` 字段改 `callee`；boolean 手工语句改 `callee:'union'`、无 operation |
| `src/cad-runtime/terminal-dag.test.ts` | 测试内嵌代码的 `members: ['part0','part1']` **改** `members: [part0, part1]`（VarRef 形态），其余断言等阶段 3 再动 |
| `src/brep/case2-load-stl-cylinder-assembly.test.ts` | `s.op === 'assembly'` → `s.callee === 'assembly'` |
| `test/faijs/syntax.test.ts` | `sa.op`（:45,:52,:80）→ `sa.callee` |
| `test/faijs/source-code.test.ts` | `validateScriptArgs(script.statements, SCHEMAS)` 的用例（:36-49）阶段 4 随 args-schema 删除一起处理，本阶段可先红 |

### 4.6 ✅ 阶段 2 验收

1. `npm run typecheck`（src/**）通过。
2. `npx vitest run src/lang/parser.test.ts src/lang/parser-normalization.test.ts src/lang/codegen.test.ts test/faijs/syntax.test.ts` 全绿（**round-trip：text→IR→text 幂等**，含 union 直写、任意解构、成员调用、嵌套调用）。
3. **允许红**：依赖执行链的测试（runtime/terminal-dag/parity/check）本阶段可以红——它们依赖阶段 3 的命名/活跃性切换与 ABI 落地。**禁止**为了绿它们而提前改阶段 3 内容。

---

## 5. 阶段 3：compile/codegen 机械化 + 命名/活跃性切换

目标（设计文档 §4.4/§4.7/§4.8/§4.5-3）：编译与代码生成**无分支化**；统一 ABI 落地（adapter 删除 → 对象字面量）；`derivePartName` 上线（删 op 白名单）；terminal-dag 符号表化（删两处 NON_CONSUMING_OPS）。**本阶段结束 = 行为零变化闸门**：全量 vitest + parity + demo e2e 全绿，`ExecutionResult` 语义与重构前一致。

> 顺序建议：5.1→5.2→5.3（编译链路）→ 5.4（命名）→ 5.5（活跃性）→ 5.6（runtime 随动）。每步保持可运行。

### 5.1 compile.ts：无分支化（A9/A11 消灭）

`buildStatementFnBody`（compile.ts:165-222）重写为**纯机械翻译**，六分支删除，只按 IR 语法形态分四类（设计文档 §4.4 模板）：

```ts
/** 生成单条语句的 fn 体（缩进 6 空格，嵌入模块文本）。纯机械：按 IR 形态发射，无 callee 分支。 */
function buildStatementFnBody(stmt: CadStatement): string {
  const inputs = stmt.inputs.map((inp) => `ctx.${inp}`).join(', ')
  const argsStr = translateArgs(stmt.args)
  const hasArgs = Object.keys(stmt.args).length > 0

  // 调用实参序列：有 inputs 则前置；有 args 则后置（空 args 不发射，见 §4.4 空槽规则）
  const callArgs = inputs
    ? (hasArgs ? `${inputs}, ${argsStr}` : inputs)
    : (hasArgs ? argsStr : '{}')

  // 1) 对象解构赋值：outputKeys 存在
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const keys = stmt.outputKeys.join(', ')
    const assigns = stmt.outputs.map((out, i) => `      ctx.${out} = ${stmt.outputKeys![i]}`).join('\n')
    return [
      `      const { ${keys} } = await cad.${stmt.callee}(${callArgs}, exec)`,
      assigns,
    ].join('\n')
  }

  // 2) 成员调用（表达式语句）：receiver 存在
  if (stmt.receiver) {
    return `      await ctx.${stmt.receiver}.${stmt.callee}(${callArgs}, exec)`
  }

  // 3) 无赋值调用（表达式语句，outputs 为空且无 receiver）
  if (stmt.outputs.length === 0) {
    return `      await cad.${stmt.callee}(${callArgs}, exec)`
  }

  // 4) 普通赋值（单输出）
  return `      ctx.${stmt.outputs[0]} = await cad.${stmt.callee}(${callArgs}, exec)`
}
```

要点：

- **统一 `await`**：同步函数被 await 是合法 JS，无需区分 async/sync（设计文档 §4.4）。
- **空 args 不发射**：`cad.union(ctx.a, ctx.b, exec)` 而不是 `cad.union(ctx.a, ctx.b, {}, exec)`（§4.4 的"空槽规则"；无 inputs 无 args 时兜底 `{}`）。
- **成员调用**：`add_constraint` 与 `do_assemble` 走同一模板（A9 的 no-op/do_assemble 特判删除）。但要注意——现状 `add_constraint` 编译为 no-op 注释、`do_assemble` 编译为 `await ctx.<asm>.do_assemble(exec)`（无 args）。新模板统一发射 `await ctx.<receiver>.<callee>(args, exec)`。**行为差异**：`add_constraint` 现在是 no-op，改成真调用后会调用 compound 上不存在的 `add_constraint` 方法 → 运行时 TypeError。
  - **处置**：现状 add_constraint 的语义就是 no-op（Phase 1 已知缺口：约束由 assembly 语句 args.constraints 读取），因此**编译产物应保留"不调用"语义**。但"不调用"不能按 callee 分支——方案：给 compound 对象挂一个**通用 no-op 方法**（见 5.2），`add_constraint` 是 compound 的成员方法，调用它不会崩。这样成员调用模板对 add_constraint/do_assemble 都统一为真调用，语义不变（add_constraint no-op、do_assemble solve）。

- **解构**：`const { front, back } = await cad.split(...)` 后按 outputKeys 机械写 `ctx.<out_i> = <key_i>`。outputKeys 与 outputs 一一对应（§4.2 IR 保证）。

`getStatementRefs`（:134-162）：兜底扫描改为纯 Arg 树遍历（4.4 已做），删除 group/assembly members 特判（:155-160）。

`compileToModule` 的 writes 计算（:248-253）：`writes = stmt.outputs`（A11 的 add_constraint/do_assemble 特判删除——这两类 outputs 本来就是 []，机械写法天然正确）。

### 5.2 stdlib/adapter：统一 ABI + 对象字面量（B2 消灭）

**统一 ABI**（设计文档 §4.4）：所有可从 .faijs 调用的可调用体签名为 `(…sourceVisibleArgs, exec) => Result | Promise<Result>`，exec 是引擎注入的隐藏末参。

- **编译产物**发射 `cad.<callee>(<源码实参…>, exec)`（5.1 已做到）。
- **stdlib 函数**保持现状 `(...rest)` 弹 exec 形态（boolean 已弹、geom 已弹、primitives `(params, exec)` 形态也兼容——它们的参数序就是"源码实参 + exec"）。**逐函数核对**：`box(params, exec)` ← 编译发射 `cad.box({size:20}, exec)` ✓；`drill(input, params, exec)` ← `cad.drill(ctx.part0, {diameter:5}, exec)` ✓；`translate(input, params, exec)` ✓；`group(params, exec)` ← `cad.group({members:[ctx.a,ctx.b]}, exec)` ✓；`split(input, params, exec)` ✓；`copy(input, params, exec)` ✓。
- **成员方法**：compound 对象挂 `do_assemble(exec)`（已有）与 `add_constraint(args, exec)`（新增 no-op 方法，保持现状语义）：

```ts
// src/stdlib/compound.ts assembly() 内：
;(c as CompoundShape & { do_assemble?: (e: ExecContext) => void }).do_assemble = (e: ExecContext) => {
  behavior.solve(e)
}
// 新增 no-op 成员方法（现状 add_constraint 编译为 no-op，保持语义）：
;(c as CompoundShape & { add_constraint?: (args: unknown, e: ExecContext) => void }).add_constraint = () => {
  // Phase 1 semantics: constraints are read from the assembly statement's args.constraints;
  // add_constraint is intentionally a no-op (kept for ABI uniformity).
}
```

**adapter 删除，对象字面量上线**（`src/cad-runtime/internal-stdlib-adapter.ts` → 重写为 `src/cad-runtime/internal-stdlib.ts`，或原位改写）：

```ts
// src/cad-runtime/internal-stdlib.ts（替代 adapter；全文件无任何 per-函数逻辑）
import { box, sphere, cylinder, cone, wedge } from '../stdlib/primitives'
import { translate, rotate, scale } from '../stdlib/transform'
import { extrude } from '../stdlib/extrude'
import { knurl } from '../stdlib/knurl'
import { sdf } from '../stdlib/sdf'
import { text } from '../stdlib/text'
import { screw } from '../stdlib/screw'
import { svgExtrude } from '../stdlib/svgExtrude'
import { load } from '../stdlib/load'
import { drill } from '../stdlib/drill'
import { split } from '../stdlib/split'
import { union, subtract, intersect } from '../stdlib/boolean'
import { engrave } from '../stdlib/engrave'
import { group, assembly } from '../stdlib/compound'
import { copy } from '../stdlib/copy'
import { faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax } from '../stdlib/geom'
import type { StdlibNamespace } from './exec-context'

/** Assemble stdlib functions into the cad namespace. Uniform ABI: (…sourceArgs, exec). */
export function createInternalStdlib(): StdlibNamespace {
  return {
    box, sphere, cylinder, cone, wedge,
    text, screw, svgExtrude, sdf, load,
    translate, rotate, scale,
    drill, extrude, engrave, knurl,
    union, subtract, intersect,
    split, group, assembly, copy,
    faceCenter, faceNormal, bboxCenter, bboxMin, bboxMax,
  }
}
```

**asset 查询**（原 adapter 的 `assetQuery`，B2 残余）：asset 是 stdlib 的普通函数（`cad.asset(key, exec)` 嵌套调用走 CallRef）。**新建 `src/stdlib/asset.ts`**：

```ts
// src/stdlib/asset.ts
import type { ExecContext } from '../cad-runtime/exec-context'

/** `cad.asset(key, exec)`：经 exec.assets 解析为 UTF-8 字符串（SVG 等文本资产）。 */
export async function asset(key: string, exec: ExecContext): Promise<string> {
  if (!exec.assets) {
    throw new Error(`[stdlib/asset] asset "${key}" cannot be resolved: exec.assets not available`)
  }
  const result = await exec.assets.resolveByKey(key)
  return new TextDecoder('utf-8').decode(new Uint8Array(result.bytes))
}
```

加入对象字面量与 `src/stdlib/index.ts` 导出。

**删除**：`internal-stdlib-adapter.ts` 文件删除；`runtime.ts:212` 的 `createInternalStdlib()` 调用不变（签名未变）；`parseCall` 弹栈逻辑连根消灭。

### 5.3 codegen.ts：通用打印机（A12 消灭）

**`buildArgsParts`（:99-332）**：per-op switch 删除，改为通用打印——**IR 里有什么打印什么**，不再做默认值省略（设计文档 §4.4：比现状更忠实）：

```ts
/** 通用 args 打印机：IR 里的每个键按原样打印，无 callee 分支、无默认值省略。 */
export function buildArgsParts(stmt: CadStatement, varNames?: Map<string, string>): string[] {
  return Object.entries(stmt.args).map(([k, v]) => `${k}:${fmtValue(v, varNames)}`)
}
```

**`statementToLine`（:355-408）与 `scriptToCode`（:418-516）**：删除 group/assembly/add_constraint/do_assemble/split/boolean/load 全部分支（含 :452-455 的 `// source:` 注释行，决策 3）。按 IR 形态机械打印：

```ts
function printStatement(stmt: CadStatement, declared: Set<string>, varNames: Map<string, string>): string {
  const argsParts = buildArgsParts(stmt, varNames)
  const argsStr = argsParts.length > 0 ? `, { ${argsParts.join(', ')} }` : ''
  const inputVars = stmt.inputs.map((id) => varNames.get(id) ?? id).join(', ')

  // 1) 解构：outputKeys + outputs 一一对应
  if (stmt.outputKeys && stmt.outputKeys.length > 0) {
    const destructure = stmt.outputKeys.map((k, i) => `${k}: ${stmt.outputs[i]}`).join(', ')
    return `const { ${destructure} } = cad.${stmt.callee}(${inputVars}${argsStr})`
  }

  // 2) 成员调用
  if (stmt.receiver) {
    return `${stmt.receiver}.${stmt.callee}(${argsParts.length > 0 ? `{ ${argsParts.join(', ')} }` : ''})`
  }

  // 3) 无赋值调用
  if (stmt.outputs.length === 0) {
    return `cad.${stmt.callee}(${inputVars}${argsStr})`
  }

  // 4) 赋值：outputs[0] 已声明 → 裸重赋值；未声明 → let 声明
  const out = stmt.outputs[0]
  if (declared.has(out)) return `${out} = cad.${stmt.callee}(${inputVars}${argsStr})`
  declared.add(out)
  return `let ${out} = cad.${stmt.callee}(${inputVars}${argsStr})`
}
```

`scriptToCode` 的参数声明、varNames 登记、declared 集合逻辑保留（:418-516 骨架），主体换成 `printStatement`。`primaryOutput` 保留（回退用）。

### 5.4 derivePartName：命名服务上线（A13 消灭）

`src/lang/allocate-id.ts` 重写为 `derivePartName`（设计文档 §4.7；A13 的 `isCreatorOp/isCloneOp/isBooleanOp` 白名单与 group/assembly 特判全部删除；`allocateSplitIds` 被 outputCount 吸收）：

```ts
// src/lang/allocate-id.ts（重写）
import type { CadStatement } from './types'
import { asPartName, type PartName } from '../identity'
import { getFunctionSymbol } from './symbol-table'

const PART_RE = /^part(\d+)$/

/** 从语句 outputs 中提取最大模型号（PartName 均为 partN 新名；旧名兼容已删，决策 2）。 */
export function getMaxModelNum(statements: CadStatement[]): number {
  let max = -1
  for (const stmt of statements) {
    for (const outId of stmt.outputs) {
      const m = PART_RE.exec(outId)
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > max) max = n
      }
    }
  }
  return max
}

export interface DerivePartNameInput {
  callee: string
  /** 语法事实：位置输入数 */
  inputCount: number
  /** 语法事实：输出数（含解构键数） */
  outputCount: number
  /** 现有语句（取下一个 partN） */
  statements: CadStatement[]
}

export interface DerivePartNameResult {
  behavior: 'reuse' | 'new'
  /** behavior='new' 时分配的名字（长度=outputCount）；'reuse' 时为空 */
  names: PartName[]
}

/**
 * 变量名自动推导（设计文档 §4.7 R0–R5）。
 * 输入只含语法事实 + 符号表查询，调用方不传任何函数元数据。
 * 未知 callee（不在符号表）→ 默认消费语义，走 R2/R3。
 */
export function derivePartName(input: DerivePartNameInput): DerivePartNameResult {
  const { callee, inputCount, outputCount, statements } = input

  // R0：无赋值语句 → 无名字
  if (outputCount === 0) return { behavior: 'new', names: [] }

  const info = getFunctionSymbol(callee)

  // R1：callee 在符号表且全部 shape 入参位置都被标 readonly → 新名（copy/group/assembly）
  //   group/assembly 无位置输入（members 走 readonlyPaths），inputCount=0 时也视为"无消费性输入"→ 新名
  const allInputsReadonly = info !== undefined && isAllInputsReadonly(info, inputCount)
  if (allInputsReadonly) {
    return { behavior: 'new', names: nextPartNames(statements, outputCount) }
  }

  // R2：单入单出（消费性）→ 复用 inputs[0]
  if (inputCount === 1 && outputCount === 1) return { behavior: 'reuse', names: [] }

  // R4：多入多出且数量相等（Shape[] 批处理）→ 禁用（决策 4）
  if (inputCount > 1 && outputCount > 1 && inputCount === outputCount) {
    throw new Error(
      `[derivePartName] "${callee}" has equal multi-input/multi-output counts ` +
      `(${inputCount}→${outputCount}); Shape[] batch ops are disabled (design decision R4)`,
    )
  }

  // R3：其余（创建类、入出数量不同）→ 新名，每输出一个 partN
  return { behavior: 'new', names: nextPartNames(statements, outputCount) }
}

function isAllInputsReadonly(info: { readonlyPositions?: number[] }, inputCount: number): boolean {
  if (inputCount === 0) return true            // 无位置输入（group/assembly：members 走 readonlyPaths）→ 新名
  const pos = info.readonlyPositions ?? []
  for (let i = 0; i < inputCount; i++) if (!pos.includes(i)) return false
  return true
}

function nextPartNames(statements: CadStatement[], count: number): PartName[] {
  const base = getMaxModelNum(statements) + 1
  return Array.from({ length: count }, (_, i) => asPartName(`part${base + i}`))
}
```

> **R1 对 group/assembly 的说明**：`group` 的 inputCount=0（members 在 args 里），`isAllInputsReadonly` 对 inputCount=0 返回 true → 新名 ✓（设计文档 §4.7 表格：group/assembly → 新名）。`copy` 的 inputCount=1 且 readonlyPositions=[0] → 新名 ✓。`drill` 无 readonly 标注 → 走 R2 复用 ✓。

**调用方适配**（parser.ts）：`allocateStatementId`/`allocateSplitIds` 调用点（:750、:793、:832、:904）全部替换：

```ts
// parseScript 内的统一命名调用（普通赋值 / group / 解构 / 裸重赋值共用）
const result = derivePartName({
  callee: stmt.callee,
  inputCount: stmt.inputs.length,
  outputCount: /* 普通=1；解构=keys.length；裸重赋值=1 */,
  statements,
})
if (result.behavior === 'reuse') {
  stmt.outputs = [stmt.inputs[0]]          // 复用输入名
} else {
  stmt.outputs = result.names
}
// varToId 注册用 outputs[i]（原逻辑不变）
```

**删除**：`isPartVmId`/`isGrpId`/`getModelNum`/`getVersionNum`/`getGroupNum`/`parseVersionNum`/`PART_VM_RE`/`GRP_RE`（决策 2，旧名兼容删除）——同步检查 `src/index.ts`/`src/browser.ts` 的导出（阶段 4 导出面收敛）与 3d_editor 引用（阶段 5）。

### 5.5 terminal-dag：符号表化（B1/A8 消灭）

`src/cad-runtime/terminal-dag.ts`：`NON_CONSUMING_OPS` 与 `isNonConsumingOp` 删除，改为符号表驱动的 `consumes()`（设计文档 §4.8）：

```ts
// src/cad-runtime/terminal-dag.ts（改写）
import type { PartScript, TerminalShape, CadStatement, Arg } from '../lang/types'
import type { PartName } from '../identity'
import { getFunctionSymbol } from '../lang/symbol-table'
import { isVarRef, isCallRef } from '../lang/types'

/**
 * 判定语句 stmt 是否"消费"变量 v（替换 NON_CONSUMING_OPS 查表）。
 * 规则（设计文档 §4.8）：
 * - 未知 callee → 无 readonly 信息 → 右侧出现即消费（默认）
 * - 嵌套调用（CallRef）中的引用 = 只读查询，不消费
 * - 符号表标记的 readonly 位置/路径不消费（copy 的源、group/assembly 的 members）
 */
export function consumes(stmt: CadStatement, v: PartName): boolean {
  // inputs：位置引用（符号表 readonlyPositions 命中的位置不消费）
  const idx = stmt.inputs.indexOf(v)
  if (idx >= 0) {
    const info = getFunctionSymbol(stmt.callee)
    if (!info?.readonlyPositions?.includes(idx)) return true
  }
  // args：递归扫描 VarRef（CallRef 内不消费；readonlyPaths 属性内不消费）
  let consumed = false
  const scan = (value: Arg, inCallRef: boolean, path: string[]): void => {
    if (consumed) return
    if (value === null || typeof value !== 'object') return
    if (isVarRef(value)) {
      if (value.$ref !== v) return
      if (inCallRef) return                       // 嵌套调用内 = 只读查询
      const info = getFunctionSymbol(stmt.callee)
      // readonlyPaths 匹配路径首段（如 members）
      if (info?.readonlyPaths?.includes(path[0] ?? '')) return
      consumed = true
      return
    }
    if (isCallRef(value)) {
      for (const a of value.$call.args) scan(a, true, path)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item as Arg, inCallRef, path)
      return
    }
    for (const [k, vv] of Object.entries(value)) scan(vv as Arg, inCallRef, [...path, k])
  }
  for (const [k, vv] of Object.entries(stmt.args)) scan(vv, false, [k])
  return consumed
}

/** 计算 DAG 叶子终端集合（骨架不变，消费判定换 consumes）。 */
export function computeLeafTerminals(
  script: PartScript,
  shapeVarNames: Set<PartName>,
): TerminalShape[] {
  // …原样：lastProducer 预计算 + 每个 shapeVarName 遍历
  // 原 NON_CONSUMING_OPS 跳过逻辑（:68）删除，改为：
  //   if (consumes(stmt, partName)) { consumed = true; break }
  // …其余不变
}
```

要点：

- `consumes` 只看 `stmt.inputs` + `stmt.args` 树，**不依赖 `stmt.refs`**（refs 是扁平集合，丢失了"在不在 CallRef 内"的位置信息）。
- 效果对照（设计文档 §4.8 表格）逐例验证：copy 不消费源 ✓、drill 消费 ✓、split 消费 ✓、group members 不消费 ✓、faceCenter(part2) 不消费 ✓、未知函数默认消费 ✓。
- 3d_editor 消费侧（`result.terminals`）零改动（设计文档 §4.8 末句）。

### 5.6 runtime.ts 随动

- **`extractBrepSolids` 的 assembly 特判（:677）**：`stmt.op !== 'assembly'` → 改为按**运行时 compound 值**判定（设计文档 §4.11-6 / B4）：检查 `outputs[0]` 对应的 shape 是否为 compound（`isCompound`，runtime.ts:44 已 import）。等价逻辑：遍历 statement，若 `stmt.outputs[0]` 的 shape 是 compound 且 args.members 存在则提取成员 solid。**注意保持语义**：只有 assembly（带 members）需要提取，group 无约束不参与（若 group 也命中 compound 检测，行为变化需谨慎——用 `args.members` 存在性 + `isCompound` 双条件，实际等价于原 assembly 判定）。
- **`computeLegacyStatementKey`（:772）与 `module-executor.computeKey`（:266）**：`parts = [stmt.op]` → `[stmt.callee]`（机械改名，§1 已做）。
- **check()**：阶段 4 才改三阶段；本阶段保持现状（`SCHEMAS` 注入仍可用，阶段 4 删）。
- **`createInternalStdlib` 调用点（:212）**：不变。

### 5.7 ✅ 阶段 3 验收（行为零变化闸门）

1. `npm run typecheck` 通过。
2. `npx vitest run src/lang src/cad-runtime` 全绿（含阶段 0 的命名/活跃性新测试——此时 `derive-part-name.test.ts` 与 `terminal-dag-symbol.test.ts` 必须绿）。
3. **parity**：`npx vitest run test/faijs/parity` 全绿（BREP/mesh 双链路一致，无回归）。
4. **全量**：`npx vitest run` 全绿——**行为零变化**：与重构前同文本的 `ExecutionResult` 一致（terminals/outputs/compounds/failedAt）。
5. **demo e2e**：`npm run pack`（根目录）→ `demo/` 里 `npm install` → demo 构建/冒烟通过（AGENTS.md：demo 依赖 npm pack 的 tarball）。
6. 若测试因"内部机制消失"（如 `validateConsumption` 的报错用例、`op==='boolean'` 断言）而红——按测试策略 §8-1：**改机制不改语义**，逐个更新断言后仍要全绿。

---

## 6. 阶段 4：校验与文档面收口

目标（设计文档 §4.9/§4.10/§4.5-4）：删除 SCHEMAS 框架（A14 消灭）；`check()` 三阶段化；参数校验补进各库函数；`gen-api-dts` 签名驱动重写（B5 消灭）；导出面收敛；CI 全绿后 push。

### 6.1 删除 SCHEMAS 框架（A14）

- 删除文件：`src/lang/args-schema.ts`、`src/stdlib/schemas.ts`（整个删除）。
- 删除 import 点（逐个 grep 清理）：
  - `src/cad-runtime/runtime.ts:28-29`（validateStatementArgs / SCHEMAS）→ 阶段 6.2 重写 check 时移除；
  - `src/lang/parser.ts:43`（OpSchema 类型）→ 阶段 2 已删；
  - `src/lang/op-set-consistency.test.ts` → 已被符号表守卫测试替代（3.6）；
  - `src/api-dts-sync.test.ts` → 随 gen-api-dts 重写（6.4）；
  - `test/faijs/source-code.test.ts:12-13,36-49`（validateScriptArgs / SCHEMAS）→ 删除该 describe 块（参数校验进函数后，缺失必填参数的断言改为运行时错误路径测试，见 6.3）；
  - 3d_editor 的 `executeScript.ts:19`（C3）→ 阶段 5。
- 删除导出：`src/index.ts:50-51`、`src/browser.ts:58-59` 的 `validateStatementArgs/validateScriptArgs/getOpSchema/hasOpSchema` 与类型（6.6 导出面收敛一并处理）。

### 6.2 check()：三阶段（§4.9）

`src/cad-runtime/runtime.ts` 的 `check()`（:879-983）重构为三阶段，全部无 per-函数代码：

```ts
check(code: string): CheckResult {
  const errors: CheckError[] = []
  const warnings: string[] = []

  // ① parse（不变，零知识解析；schemas 注入删除）
  let script: PartScript
  try {
    const result = parseScript(code)          // 不再传 schemas
    script = result.script
  } catch (err) { /* …原样转 CheckError stage:'parse' */ }

  // ② 符号检查（新）：callee ∈ 符号表（未知 → "函数不存在"）；receiver 已声明
  for (const stmt of script.statements) {
    const fnSymbol = getFunctionSymbol(stmt.callee)
    if (!fnSymbol && !isKnownNonFunction(stmt)) {   // 见下
      errors.push({
        stage: 'symbol',
        message: `function "${stmt.callee}" does not exist in the stdlib symbol table`,
        stmtId: stmt.id,
      })
    }
    // receiver 变量已声明（parser 已拦截，此处兜底）
    if (stmt.receiver) { /* 若需要：检查 receiver 在已执行语句的 outputs 中 */ }
  }

  // ③ 引用预检（不变：inputs/refs 须先定义，原 :942-961 逻辑保留）
  // ④ 终端引用预检（不变，原 :963-971 逻辑保留）

  const ok = errors.length === 0
  return { ok, errors, warnings, script: ok ? { statements: script.statements.length, callees: script.statements.map((s) => s.callee) } : undefined }
}
```

要点：

- `CheckError.stage` 类型：`'parse' | 'schema' | 'reference'` → **`'parse' | 'symbol' | 'reference'`**（schema 阶段不存在了；`CheckResult.script.ops` → `callees`，字段名随 IR 收敛）。
- **`isKnownNonFunction` 说明**：符号表只收录 `src/stdlib/*.ts` 导出的函数。以下 callee 不在表内但**合法**，必须放行：
  - **成员方法名**（receiver 非空）：`add_constraint`/`do_assemble` 等 compound 方法不在符号表（它们是对象方法，不是命名空间函数）——`stmt.receiver` 存在时不查符号表；
  - **geom 查询**：`faceCenter/faceNormal/bboxCenter/bboxMin/bboxMax` 在 stdlib 导出（表内有）；
  - **asset**：stdlib 导出（表内有）。
  - 即：**只有无 receiver 的调用才查符号表**。这是"正常语言的未定义符号诊断"（设计文档 §4.9-2）。
- 未知 callee 报错 vs 运行时报错：设计文档 §4.9 明确"callee ∈ 符号表（未知 → 报错"函数不存在"）"。但**注意与"第三方函数默认可用"的张力**——设计文档 §4.7 说未知函数默认语义工作。§4.9 又说 check() 报"函数不存在"。实施取舍：**check() 报错是诊断服务**（AI 自检用），执行照常（VM 执行不拦未知函数）；`check()` 的报错仅当**符号表存在且该 callee 确非库函数**时给出。第三方库未来并入符号表后自然放行。按设计文档 §4.9 原样实施：未知 → 报错。

### 6.3 参数校验补进各函数（§4.5-4，错误路径测试）

SCHEMAS 删除后，参数合法性由**各库函数自己检查并抛带上下文的 Error**。逐函数核对（现状已有部分断言，如 boolean.ts 的 `assertBooleanParams`——它随拆函数删除，改为各薄函数内部的 operation 已由分派保证，无需再断言）：

| 函数 | 需补的校验（示例） |
|---|---|
| `primitives.ts` | box size > 0；sphere radius > 0；cylinder radius/height > 0；cone 两半径 ≥ 0、height > 0；wedge 尺寸 > 0（现状 brep 路径可能已有，mesh 路径补） |
| `drill.ts` | diameter > 0、> 0 的 depth（现状 mesh 路径可能已断言，核对错误消息带 `[stdlib/drill]` 前缀） |
| `extrude.ts` | length ≠ 0 |
| `split.ts` | normal 非零向量 |
| `sdf.ts` / `load.ts` / `text.ts` / `screw.ts` / `svgExtrude.ts` | 必填字段缺失即抛错（`code`/`key|path|url` 互斥、`text` 非空等） |
| `engrave.ts` / `knurl.ts` | 必填字段缺失即抛错 |

错误消息统一格式：`[stdlib/<name>] <描述>`，抛出位置在 `resolvePath` 调用之前（参数错误不应进入双链路分派）。

**错误路径测试**（stderr 零容忍纪律不变）：新建 `src/stdlib/args-validation.test.ts`（或并入各文件 .test.ts）：

```ts
it('drill rejects non-positive diameter', async () => {
  const exec = /* 测试用 fake ExecContext（mode:'mesh'，空 ports） */
  await expect(drill(solid({ positions: new Float32Array(0), indices: new Uint32Array(0) }), { diameter: 0 }, exec))
    .rejects.toThrow(/diameter/)
})
```

> 每个故意抛错的测试若产生 `console.error/warn` 输出（CLI/错误处理器可能打印），必须在测试内 spy；无输出的直接断言 throw。

### 6.4 gen-api-dts 签名驱动重写（B5 消灭）

`scripts/gen-api-dts.ts`：输入从 SCHEMAS 改为 **stdlib TS 签名**（与 gen-symbol-table 同一提取管线）。`SPECIAL_OPS`/`isAsync` 名单死亡：

- async 判定：返回类型是否为 `Promise<...>`（TS Compiler API 读签名返回类型）。
- union/subtract/intersect 就是三个真实函数（不再 SPECIAL）。
- split 的 `{front, back}` 从返回类型提取。
- `load` 的 key/path/url 互斥从参数类型（可选字段）机械生成，不再硬编码。

目标产物（`src/mesh/api.d.ts`，示意）：

```ts
export interface CadAPI {
  // ── 从 stdlib 签名机械生成 ──
  box(params: { size: number | [number, number, number]; center?: [number, number, number]; nRad?: number }): Shape
  sphere(params: { radius: number; segments?: number; center?: [number, number, number]; nRad?: number }): Shape
  drill(shape: Shape, params: { diameter: number; depth?: number; … }): Promise<Shape>
  union(a: Shape, b: Shape, ...rest: Shape[]): Promise<Shape>
  subtract(a: Shape, b: Shape): Promise<Shape>
  intersect(a: Shape, b: Shape): Promise<Shape>
  split(shape: Shape, params: { … }): Promise<{ front: Shape; back: Shape; wedge?: Shape | null }>
  group(params: { name?: string; members?: readonly Shape[] }): Shape
  assembly(params: { name?: string; members?: readonly Shape[]; constraints?: … }): Shape
  copy(shape: Shape): Shape
  // …
}
```

- **保留硬编码**：`boundingBox/bboxCenter/volume/faceAt` 查询方法与 GeomRef helpers——**注意**：GeomRef 退役后（A7），`bboxCenter(of: string)` 这类 `$geom` helper 声明**删除**；`faceCenter/faceNormal` 现在是普通 stdlib 函数（`(of: Shape, anchor?, ordinal?)`），从签名生成。
- 守卫测试 `src/api-dts-sync.test.ts` 保持机制（generate() vs 文件 diff），改 import 源。
- `docs/ops-api-inventory.md`：手工文档，按新 API 面更新（写 `.faijs` 的 API 手册，从 api.d.ts 同步）。

### 6.5 导出面收敛（§5.1 index/browser）

`src/index.ts` / `src/browser.ts` 导出调整：

| 动作 | 内容 |
|---|---|
| 删除 | `allocateStatementId`/`allocateSplitIds`/`isPartVmId`/`getModelNum`/`getVersionNum`/`isGrpId`/`getGroupNum`（决策 2：旧名兼容删除；`isPartId` 若保留则列明） |
| 删除 | `validateStatementArgs`/`validateScriptArgs`/`getOpSchema`/`hasOpSchema` 及 `OpSchema/ArgFieldSchema/ArgType/ValidationError` 类型 |
| 删除 | `GeomRef`/`AssetRef` 类型、`isGeomRef`/`isAssetRef` 守卫、`resolveGeomRef` 导出（`src/index.ts:55`，若 geom-ref 内部已无引用） |
| 新增 | `derivePartName` + `DerivePartNameInput/DerivePartNameResult` 类型 |
| 新增 | `ReadonlyShape` 类型（`src/mesh/types.ts`） |
| 新增 | `SYMBOL_TABLE`/`SymbolTable`/`FunctionSymbol`/`getFunctionSymbol`（`src/lang/symbol-table.ts`） |
| 保留 | `parseScript`（签名去 options）、`statementToLine`/`scriptToCode`、`PartScript/CadStatement/Arg/VarRef/CallRef` 等 |

**符号表 JSON 的跨平台问题**（§3.5 遗留）：`symbol-table.json` 需要进构建产物。检查 `tsconfig.build.json` 的 `resolveJsonModule`；若 tsc 不拷贝 json 到 dist，则方案：
- `src/lang/symbol-table.ts` 改为运行时加载：node 端 `readFileSync` + 浏览器端 import json（`// @ts-expect-error` + `resolveJsonModule`）；或
- 把符号表**内联为 .ts 常量文件**（`src/lang/symbol-table.generated.ts`，仍由 gen-symbol-table.ts 生成，禁手改）。**推荐后者**——避免 json 进 dist 的打包问题，与 api.d.ts 同纪律。生成器输出改为 .ts 文件（`export const SYMBOL_TABLE = {...} as const`）。

### 6.6 ✅ 阶段 4 验收

1. `npm run typecheck` 通过。
2. `npx tsx scripts/gen-symbol-table.ts` + `npx tsx scripts/gen-api-dts.ts` 重跑，产物入库，守卫测试绿。
3. **全量 vitest 绿**（含新的参数校验错误路径测试；check.test.ts 的 stage/schema 断言已更新）。
4. `npm run lint` 绿。
5. `pwsh -NoProfile scripts/ci.ps1` 全绿（lint → typecheck → build → vitest + stderr 检查 → pack + demo e2e）。
6. **push faijs**：先单独征求用户同意再 push（发布纪律：commit 与 push 均需用户明确同意）。

---

## 7. 阶段 5：3d_editor 适配（faijs 全绿并 push 后开始）

目标（设计文档 §5.2 / §4.11）：宿主侧随新 IR 适配，**机制全部保留**（FeatureDef 注册表、Timeline 一行一节点、executeScriptDiff 增量通道、`result.terminals` 消费方式），只改数据结构与命名调用。

> 前置：faijs 已 push（阶段 4 结束）。宿主工作目录是 `C:\my\Faicad\3d_editor`，遵循 3d_editor 的 CLAUDE.md 开发流程。

### 7.1 包 hash 更新

1. `3d_editor/package.json` 中 `@faicad/faijs` 的依赖 hash 更新为 faijs 新 commit。
2. `npm install`（拉新 tarball）。
3. 冒烟：跑一次宿主现有最小测试确认新包可加载。

### 7.2 §5.2 全表适配（逐项）

| 文件 | 改动 |
|---|---|
| `src/engine/features/*.ts` | `buildStatement` 构造的 CadStatement 用新字段：`callee`（替代 op）、`receiver`（替代 assemblyTarget）、解构语句补 `outputKeys: ['front','back']`；命名从 `allocateStatementId/allocateSplitIds` 改为 `derivePartName`（faijs 导出） |
| `src/engine/features/boolean.ts`（C2） | 单 op `'boolean'` 注册改为 **union/subtract/intersect 三个 callee** 注册到同一 FeatureDef（`byOp` 改按 callee 匹配，机制不变，键名随动） |
| `src/engine/script-engine/ScriptEngine.ts` | `getAllocateCtx` 相关：入参从 op 改为 `derivePartName` 所需（callee/inputCount/outputCount/statements）；:1146 的过滤改通用 |
| `src/engine/script-engine/executeScript.ts`（C3） | 删除 `validateScriptArgs`/SCHEMAS import 与校验阶段（:19）；参数错误经 runtime `failedAt` 反馈 |
| `src/engine/script-engine/executeScript.ts:36-47`（C4） | `isVoidOrSameShape`/`isNewShape` 从"op 名排除 group/assembly"改为**按语句/结果事实**判定：outputs 为空 → void；terminal 对应值 `isCompound`（faijs 运行时 compound 检测）→ 同 shape |
| `src/renderer/model-store.ts`（C4） | :1279/1360/1414-1468 的 assembly/split/boolean 专用编排随新 IR 适配（receiver/callee/outputKeys）；`createAssembly` 直写处同步 |
| `src/renderer/CommandPipeline.ts`（C4） | :398 的 split/boolean 编排改通用（callee 匹配） |
| `src/renderer/scene-mutator.ts:67-80`（C4） | op→中文名表改按 callee 查（纯宿主显示元数据，保留在宿主） |
| `Timeline / feature-icon-map` | `byOp` → `byCallee`（机制不变，键名随动） |
| `src/engine/__tests__/contract-entry.test.ts:55-228`（C5） | 导出面白名单更新：`allocateStatementId/allocateSplitIds` → `derivePartName`；删 `SCHEMAS/validateScriptArgs` 相关；新增 `ReadonlyShape`、`SYMBOL_TABLE` 类型导出 |

### 7.3 命名调用统一（宿主侧）

宿主所有"给新语句分配名字"的位置（FeatureDef buildStatement、AI 管线、appendAndCommit）统一改为：

```ts
import { derivePartName } from '@faicad/faijs'   // faijs 导出

const result = derivePartName({
  callee,                  // 函数名（从 UI 选择的 feature 映射）
  inputCount,              // 选中 shape 数（语法事实）
  outputCount,             // 1（普通）/ 2（split 解构）
  statements,              // 当前 sceneScript.statements
})
const outputs = result.behavior === 'reuse' ? [inputs[0]] : result.names
```

### 7.4 分层验证（只跑相关测试，不跑全量）

按顺序执行，每层绿才进下一层（AGENTS.md：严禁通过跑 CI 找 bug）：

1. `npm run lint`（宿主 lint）
2. `npm run tsc` / `tsc --noEmit`（宿主 typecheck）
3. `npx vitest run`（宿主单测；重点：contract-entry、features、script-engine 相关）
4. `npm run test:components`
5. `npm run build`（宿主构建）
6. 只跑受影响的 e2e spec（装配/布尔/split 相关），不跑全量 e2e

### 7.5 ✅ 阶段 5 验收

- 宿主 lint/tsc/单测/components/build 全绿；
- 装配、布尔、split 三个 feature 的 e2e 冒烟通过（UI 生成代码 → 执行 → canvas 显示与重构前一致）；
- Timeline 逐语句回放正常；undo/redo 增量通道正常。

---

## 8. 验收总表 + 删除清单核对表 + 风险提示

### 8.1 全局验收对照（实施完成后逐项勾选）

| 验收项 | 判据 | 对应章节 |
|---|---|---|
| 无按函数名分支 | `grep` 检查 src 下无 `callee === 'x'` / `callee==='x'` 的代码路径（符号表数据、宿主显示元数据除外） | §4/§5 |
| 符号表机器生成 | `npx tsx scripts/gen-symbol-table.ts` 可重跑，`src/lang/symbol-table.generated.ts` 入库 | §3.4/§6.5 |
| 命名服务 | `derivePartName` 五规则 + R4 禁用测试绿；3d_editor 用同一函数 | §5.4/§7.3 |
| 活跃性 | `consumes()` 六例 + 嵌套调用 + 未知函数测试绿；两处 NON_CONSUMING_OPS 已删 | §5.5 |
| 行为零变化 | 阶段 3 全量 vitest + parity + demo e2e 绿 | §5.7 |
| 校验收口 | SCHEMAS/args-schema 文件已删；check() 三阶段；函数内参数校验 + 错误路径测试 | §6 |
| 文档面 | api.d.ts / symbol-table / ops-api-inventory.md 由脚本生成且守卫测试绿 | §6.4/§6.5 |
| CI | `pwsh -NoProfile scripts/ci.ps1` 全绿 | §6.6 |
| 宿主 | 3d_editor lint/tsc/单测/components/build/e2e 冒烟全绿 | §7.4 |

### 8.2 删除清单核对表（op 概念消灭的完整账目）

**faijs 侧**：

| 编号 | 现状位置 | 消灭于 | 核对 |
|---|---|---|---|
| A1 | parser BOOLEAN_OP_NAMES + boolean 改写分支 | §4.2 | ☐ |
| A2 | parseSplitDestructuring | §4.2 | ☐ |
| A3 | group/assembly E15.1 特判 | §4.2 | ☐ |
| A4 | load 别名收敛 | §4.2（决策 2） | ☐ |
| A5 | schema.void 校验 | §4.2 | ☐ |
| A6 | 成员方法名白名单 | §4.3-3 | ☐ |
| A7 | GEOMREF/ASSET_FEATURES + GeomRef/AssetRef 类型 | §4.2/§4.1 | ☐ |
| A8 | parser NON_CONSUMING_OPS + validateConsumption | §4.2 | ☐ |
| A9 | compile 六分支 | §5.1 | ☐ |
| A10 | getStatementRefs members 特判 | §5.1 | ☐ |
| A11 | compile writes 特判 | §5.1 | ☐ |
| A12 | codegen per-op case / 分支 | §5.3 | ☐ |
| A13 | allocate-id 白名单 | §5.4 | ☐ |
| A14 | args-schema + schemas 表 | §6.1 | ☐ |
| B1 | terminal-dag NON_CONSUMING_OPS | §5.5 | ☐ |
| B2 | internal-stdlib-adapter parseCall/emitBrepLost | §5.2 | ☐ |
| B3 | runtime check SCHEMAS 注入 | §6.2 | ☐ |
| B4 | extractBrepSolids assembly 特判 | §5.6 | ☐ |
| B5 | gen-api-dts SPECIAL_OPS/isAsync | §6.4 | ☐ |

**3d_editor 侧**：

| 编号 | 位置 | 消灭于 | 核对 |
|---|---|---|---|
| C2 | boolean.ts 单 op 注册 | §7.2 | ☐ |
| C3 | executeScript SCHEMAS 校验 | §7.2 | ☐ |
| C4 | isVoidOrSameShape/isNewShape、op→中文名表、split/boolean 编排、do_assemble 特判 | §7.2 | ☐ |
| C5 | contract-entry 白名单 | §7.2 | ☐ |

### 8.3 风险提示（实施中高频踩坑点）

1. **空 args 槽**：`cad.union(ctx.a, ctx.b, exec)` 不能多出 `{}`（§5.1 空槽规则）。实现后立即用 `cad.union(a,b)` 跑一遍，确认编译产物无空对象。
2. **add_constraint 语义保持**：统一成员调用模板后，add_constraint 必须仍是 no-op（挂 compound 通用方法，§5.2），do_assemble 仍是 solve。测试 `test/faijs/` 与 `runtime.test.ts` 的装配用例是哨兵。
3. **符号表 JSON 进 dist**：优先 `.generated.ts` 方案（§6.5），避免 `resolveJsonModule` + tsc 不拷 json 的坑。
4. **check() 的 stage 字段**：`'schema' → 'symbol'`，`ops → callees`，`check.test.ts` 与宿主消费方同步。
5. **members 从字符串数组改 VarRef**（`['part0']` → `[part0]`）：compile/terminal-dag/3d_editor createAssembly 三处同步改，round-trip 测试兜底（设计文档 §9 风险行）。
6. **行为零变化≠代码零变化**：阶段 3 允许机制消灭（NON_CONSUMING_OPS 等），但同一文本的 ExecutionResult 必须一致；若不一致，先怀疑 5.5 的 consumes 路径判定。
7. **未知 callee 的双重语义**：check() 报"函数不存在"（§6.2），但执行照常（VM 不拦）——这是设计文档 §4.7/§4.9 的明确安排，不要在 parser 里拦未知 callee。

---

## 附：本实施文档与设计文档的章节对照

| 实施文档 | 设计文档 |
|---|---|
| §1 机械重命名 | §10 决策 1 |
| §2 阶段 0 | §7 阶段 0 / §8 测试策略 4-5 |
| §3 阶段 1 | §7 阶段 1 / §4.5 / §4.6 |
| §4 阶段 2 | §7 阶段 2 / §4.2 / §4.3 |
| §5 阶段 3 | §7 阶段 3 / §4.4 / §4.7 / §4.8 / §8-1 行为零变化闸门 |
| §6 阶段 4 | §7 阶段 4 / §4.9 / §4.10 / §4.5-4 |
| §7 阶段 5 | §7 阶段 5 / §4.11 / §5.2 |
| §8 验收与核对 | §7 / §9 风险与对策 |
