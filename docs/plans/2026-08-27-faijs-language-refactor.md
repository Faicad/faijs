# faijs 语言化重构：去 op 概念，函数即一等公民

- 日期：2026-08-27
- 状态：待评审
- 范围：faijs 引擎 + 3d_editor 宿主两个项目；本文档只写方案，不包含实施
- 关联文档：`docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md`（VM 执行方案，schema 源于 §2.2）、`docs/plans/2026-08-27-restore-dag-terminal-detection.md`（DAG 终端判定方案，`NON_CONSUMING_OPS` 写死问题由此方案根治）

---

## 1. 需求原话（不准删除）

来自用户 2026-08-27 会话。

> 这个schema根本不像正常语言应该有的东西。你参考C:\git\OpenCascade\brepjs项目，看它如何实现op的校验的，还是完全无校验依赖js vm？正确的做法应该是在faijs语言的源代码里定义这些函数，不应该再有op的概念。faijs的引擎解析这些函数，自然知道其输入、输出的格式。写一份重构文档，要让faijs成为真正的变成语言。

> faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念

> 第三方库当然需要提供是否修改入参的申明呀，就是我说的readonly语义，如何实现？

> 不考虑array，有哪些方案

> 现在的设计：parser 静态校验（规则 A/B）+ runtime 终端判定需要知道"哪些语句不消费其输入"（NON_CONSUMING_OPS）。现在的实现：写死 {group, assembly, copy}，或将来通过 schema 声明 mutatesInput。用户的目标：faijs 是通用语言，op 就是函数，第三方库写 function 就行，不需要声明元数据。

文档编辑注记（非用户原话）：

- 本方案是对 `2026-08-27-restore-dag-terminal-detection.md` 中"写死 NON_CONSUMING_OPS / 命名分类 / schema 声明"问题的根治：不是继续扩展 schema，而是**从语言层面消灭 op 概念**；
- 参考对象：`C:\git\OpenCascade\brepjs`（普通 TS 库，函数即 API，无 op/schema 概念）；
- 关键澄清：**readonly 语义（是否修改入参）是函数契约的一部分，第三方库需要声明**（用户原话"当然需要提供是否修改入参的申明"）；但这份声明应该以"函数定义"的形式存在，而不是独立的 op schema 表。

---

## 2. 现状调查

### 2.1 brepjs 项目的做法（参考对象）

brepjs 是 OpenCascade 的 WASM 封装，提供 3D 建模 API。调查结论（`C:\git\OpenCascade\brepjs`）：

| 维度 | brepjs 的做法 |
|---|---|
| **op 概念** | **完全没有**。没有 op 注册表、没有 schema 表、没有"操作"概念 |
| **函数定义** | 普通 TypeScript 函数即 API：`export function extrude(face, height): Result<Solid>` |
| **入参校验** | **函数内运行时校验**（非 schema）：`getKernel().isNull(...)`、`vecLength < 1e-10` 等，返回 `Result<T,E>`（ok/err）或错误码 |
| **输入/输出格式** | 由 **TS 类型签名**表达（`OrientedFace<Dimension> & PlanarFace<Dimension>` 等品牌类型），编译期约束 |
| **依赖 JS VM？** | 是——函数就是普通 JS/TS 函数，直接调用内核，**无语言层解释器** |
| **错误处理** | `Result<T, E>`（`src/core/result.ts`：`ok(value)` / `err(error)` + `map`/`isOk` 等组合子） |
| **校验时机** | 调用时（运行时）——函数入口检查 + try/catch 内核错误转 `kernelError` |

brepjs 的关键启示：
1. **函数签名就是契约**——输入输出格式由函数定义自身表达（TS 类型），不需要额外的 schema 表；
2. **校验在函数内部**——每个函数自己检查入参合法性，返回结构化错误（Result/错误码），不依赖外部校验器；
3. **"op"不是语言概念**——调用方直接调用函数，引擎/库不需要知道"这是什么操作"。

### 2.2 faijs 现状：op 概念的全部存在点

faijs 当前把"op"当成一类特殊语言实体，硬编码点如下：

| 文件 | op 概念硬编码 | 问题 |
|---|---|---|
| `src/lang/parser.ts` | `BOOLEAN_OP_NAMES`（L237：union/subtract/intersect → op='boolean'）；split 解构特判（L373）；group/assembly E15.1 特判（L691-692）；load 旧名收敛（L277）；`options.schemas` 注入 void 校验（L742） | parser 必须认识特定函数名/调用形态 |
| `src/lang/compile.ts` | `buildStatementFnBody` 对 add_constraint/do_assemble/group/assembly/split/boolean 特判（L167-217）；`getStatementRefs` 对 group/assembly members 特判（L155-160） | 编译器必须认识特定函数名 |
| `src/cad-runtime/internal-stdlib-adapter.ts` | `createInternalStdlib()` 手写 cad 命名空间，按调用形态分类（无输入/1 输入/boolean/split/结构型/查询，L80-131） | 每加一个函数手写一个转发 |
| `src/stdlib/schemas.ts` | `SCHEMAS` 手写聚合表（op → 字段/类型/required/minInputs/void） | **本方案要消灭的**：schema 不是语言该有的东西 |
| `src/lang/args-schema.ts` | `OpSchema`/`ArgType` 类型 + `validateStatementArgs` 纯函数 | schema 框架本身 |
| `src/lang/allocate-id.ts` | `isCreatorOp` 写死列表（L88-90）；`isBooleanOp`（L95-97）；group/assembly 特判（L129-132） | 命名规则按 op 名分类 |
| `src/lang/codegen.ts` | boolean/split/group/assembly 特判（L382-390、L432-450、L466-512） | 代码生成按 op 名特判 |
| `src/cad-runtime/runtime.ts` | `isCompound` 判定（L597）；assembly 成员 solid 提取特判（L676）；`parseScript(code, { schemas: SCHEMAS })`（L887） | 终端/提取逻辑按 op 名特判 |
| `src/stdlib/*.ts` | 每个函数独立文件（transform.ts/drill.ts/…），签名 `(input, params, exec)` | 函数本身 OK，但被 schema/adapter 绑定 |

**核心矛盾**：faijs 是"通用语言"（合法 JS 子集，用户写 `let part0 = cad.box(...)`），但引擎用"op 目录 + schema 表 + op 名特判"来理解这些调用——这像"语言 + 内置函数库"之外的第三套机制，第三方库无法融入。

---

## 3. 问题分析：为什么 schema 不像正常语言该有的东西

1. **正常语言的函数调用不需要"op 目录"**：JS/TS 里调用 `box(args)`，编译器/运行时从**函数定义本身**知道参数个数、参数类型、返回值。faijs 却要维护一张与函数实现分离的 schema 表——函数实现与契约分家，必然漂移（API 变了 schema 忘改 → 校验错位）。
2. **op 概念是"伪一等公民"**：`cad.box(...)` 在语法上就是函数调用（acorn 解析为 CallExpression + MemberExpression），但引擎把它特殊对待——按 op 名特判（boolean/split/group/assembly）、按调用形态分类（adapter）、按命名规则分类（allocate-id）。同样的语法，不同的语义待遇，语言不统一。
3. **第三方库无法融入**：第三方库"写代码、实现 function"（用户原话），但当前必须：写实现 + 写 schema 表 + 注册 adapter 转发 + 命名分类特判——四份工作，且 schema 与命名分类还可能是写死的。这违背"faijs 是通用语言"的定位。
4. **校验时机与语言语义脱节**：brepjs 的启示是"函数入口自校验 + 返回 Result"——校验是**函数的职责**，不是语言的职责。faijs 用 schema 在执行前校验，等于把函数的职责抢走了，而且校验规则（字段名/类型）与函数真实行为可能不一致。
5. **消费语义（readonly）本质是函数契约**：前序方案（restore-dag）已确认：copy/group 不消费源、drill 消费源，本质是"函数是否修改入参"（用户原话：readonly 语义）。这是**函数的属性**，应该挂在函数定义上，而不是写死在 `NON_CONSUMING_OPS = {group, assembly, copy}` 集合里或独立的 schema 字段里。
6. **长期方向：op 就是函数**（用户原话）：faijs 是通用语言，未来的第三方库就是写 function。引擎解析这些函数定义，**自然知道其输入、输出的格式**——不需要 op 概念、不需要 schema 表。

---

## 4. 目标设计

### 4.1 核心思想：函数即一等公民，引擎从函数定义推导契约

把 faijs 从"op 目录驱动的 DSL"重构为"**函数定义驱动的通用语言**"：

```
现状：  语句 cad.box(...) → 查 SCHEMAS 表（op → 字段/类型） → op 名特判（命名/编译/终端）
目标：  语句 cad.box(...) → 查函数注册表（name → FunctionDef） → 从函数定义推导一切
```

每个内置函数/第三方函数是一个**函数定义对象**（`FunctionDef`），函数的全部契约（输入输出格式、消费语义、命名分类）都从它推导：

```ts
interface FunctionDef {
  // 函数本身（实现）
  impl: (inputs: Shape[], params: Record<string, unknown>, exec: ExecContext) => unknown
  // 契约（可从签名推导或显式声明）
  name: string
  params: { name: string; type: ArgType; required?: boolean; default?: unknown }[]  // 参数表
  inputShapes: number        // 输入 shape 个数（0=创建类 / 1=单入 / 多=多入）
  outputShapes: number       // 输出 shape 个数（1=单出 / 2=split 双出）
  mutatesInput: boolean      // readonly 语义：是否修改入参（默认 true）
}
```

### 4.2 函数注册表取代 schema 表

- 新增 `src/cad-runtime/function-registry.ts`（或 stdlib 内）：`registerFunction(def: FunctionDef)` + `getFunction(name)`；
- 内置函数（box/translate/drill/boolean/split/group/assembly/copy…）全部走注册表，**删掉 `src/stdlib/schemas.ts` 的 SCHEMAS 表**；
- 引擎三处消费点从"查 SCHEMAS + op 名特判"改为"查 FunctionDef"：
  - parser：参数校验（字段名/类型/required）→ 用 `def.params`；
  - compile / adapter：调用形态（创建/单入/多入/split/compound）→ 用 `def.inputShapes`/`def.outputShapes`；
  - allocate-id / runtime：命名规则与消费判定 → 用 `def.inputShapes`/`def.outputShapes`/`def.mutatesInput`。

### 4.3 消费语义（readonly）成为函数契约字段

前序方案中写死的 `NON_CONSUMING_OPS = {group, assembly, copy}` 彻底消失，改为**每个函数声明自己的 readonly 语义**：

```ts
registerFunction({
  name: 'copy',
  impl: ...,
  inputShapes: 1, outputShapes: 1,
  mutatesInput: false,     // copy 不修改入参 → 引擎自动判定"不消费源"
})
registerFunction({
  name: 'drill',
  impl: ...,
  inputShapes: 1, outputShapes: 1,
  mutatesInput: true,      // drill 修改入参 → 引擎自动判定"消费源"
})
```

- parser 静态校验规则 A/B（restore-dag §4.1）改为：消费计数按"语句对应函数的 `mutatesInput === true`"判定——不再有 op 名集合；
- runtime 终端判定（`nonConsumingProducers`）同样改为按 `def.mutatesInput`；
- 命名规则：`inputShapes === 0` → 新名；`inputShapes === 1 && outputShapes === 1 && mutatesInput === true` → 保名（单入单出修改）；其余 → 新名。**`isCreatorOp`/`isBooleanOp`/copy 分支全部删除**。

### 4.4 校验职责还给函数（brepjs 模式）

- **静态校验**（parse 期，轻量）：参数个数/字段名/类型/required —— 从 `def.params` 校验（替代 SCHEMAS 校验），纯函数 `validateStatementArgs` 保留但数据源换成 FunctionDef；
- **运行时校验**（函数内，brepjs 模式）：几何合法性（如 translate 零向量、drill 直径>0）由各函数实现内部检查，抛错或返回错误——不再需要 schema 的字段级几何校验；
- **错误形态**：引入轻量 `Result` 或错误码（参考 brepjs `src/core/result.ts`），可选阶段。

### 4.5 语法不变，变化在引擎内部

- `.faijs` 语法**完全不变**（仍是合法 JS 子集，`let part0 = cad.box(...)`）；
- 变化集中在引擎内部：parser/compile/adapter/allocate-id/codegen/runtime 从"op 名特判 + SCHEMAS"改为"查 FunctionDef"；
- 第三方库接入方式：`registerFunction`（faijs 提供，等价于 JS 里定义并导出函数）——第三方写 function + 一份 FunctionDef 契约（或从实现推导）。

### 4.6 内置函数全部函数化

| 现状 op | 目标 FunctionDef |
|---|---|
| box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load | `inputShapes: 0, outputShapes: 1, mutatesInput: true`（无入参） |
| translate/rotate/scale/drill/extrude/engrave/knurl | `inputShapes: 1, outputShapes: 1, mutatesInput: true` |
| copy（新增） | `inputShapes: 1, outputShapes: 1, mutatesInput: false` |
| boolean（union/subtract/intersect） | `inputShapes: 2+, outputShapes: 1, mutatesInput: true`（parser 不再特判 BOOLEAN_OP_NAMES，改由函数名映射） |
| split | `inputShapes: 1, outputShapes: 2, mutatesInput: true`（双输出解构由 outputShapes 驱动） |
| group/assembly | `inputShapes: 0, outputShapes: 1, mutatesInput: false`（compound 返回，不消费成员） |
| add_constraint/do_assemble | `void: true`（结构型，无输出，赋值即错） |

### 4.7 波及的引擎内部改造点

| 现状 | 目标 |
|---|---|
| parser `BOOLEAN_OP_NAMES`/split/group/assembly/load 特判 | 统一按"调用形态"（由 FunctionDef 推导）解析：多输入→inputs 收集；双输出→解构允许 |
| parser `options.schemas` void 校验 | `getFunction(stmt.op)?.void` |
| compile `buildStatementFnBody` 特判 | 按 `def.outputShapes`/`def.void` 生成：1→`ctx.out = await cad.fn(...)`；2→解构；void→成员方法调用 |
| adapter `createInternalStdlib` 手写转发 | 从注册表自动装配：`cad[name] = wrap(def)`（wrap 按 inputShapes 形态拼参） |
| allocate-id `isCreatorOp`/`isBooleanOp`/group/copy 特判 | 纯按 `def.inputShapes`/`def.outputShapes`/`def.mutatesInput` 推导 |
| codegen boolean/split/group 特判 | 按 `def` 推导调用形态 |
| runtime `isCompound`/assembly 特判 | 按 `def.outputKind === 'compound'`（或 `mutatesInput: false`）推导 |

---

## 5. 波及文件清单（两项目，已调查确认）

### 5.1 faijs（引擎侧）

| 文件 | 改动 |
|---|---|
| `src/cad-runtime/function-registry.ts`（**新增**） | 函数注册表：`registerFunction(def)` / `getFunction(name)` / `listFunctions()`；FunctionDef 类型定义 |
| `src/stdlib/schemas.ts` | **删除** SCHEMAS 表（被注册表取代） |
| `src/lang/args-schema.ts` | `OpSchema`/`ArgType` 保留作 `FunctionDef.params` 的参数类型；`validateStatementArgs` 数据源改为 FunctionDef |
| `src/lang/parser.ts` | 删除 `BOOLEAN_OP_NAMES`/split/group/assembly/load 特判（统一按调用形态解析）；`options.schemas` → `options.functions`；void 校验查注册表 |
| `src/lang/compile.ts` | `buildStatementFnBody` 按 `def.outputShapes`/`def.void` 生成（删 add_constraint/do_assemble/group/assembly/split/boolean 特判）；`getStatementRefs` 的 group/assembly members 特判改为通用（compound 函数参数含 members 即可，或保留由 `def.mutatesInput: false` 驱动） |
| `src/cad-runtime/internal-stdlib-adapter.ts` | `createInternalStdlib` 改为从注册表自动装配（`cad[name] = wrap(def)`，wrap 按 `inputShapes` 拼参） |
| `src/lang/allocate-id.ts` | 删除 `isCreatorOp`/`isBooleanOp`/group/assembly/copy 特判；命名规则纯由 `def.inputShapes`/`def.outputShapes`/`def.mutatesInput` 推导 |
| `src/lang/codegen.ts` | boolean/split/group 特判改为按 FunctionDef 推导调用形态 |
| `src/cad-runtime/runtime.ts` | `parseScript(code, { schemas })` → `{ functions }`；`isCompound`/assembly 成员提取特判 → `def.outputKind`/`mutatesInput` |
| `src/stdlib/*.ts`（transform/drill/boolean/split/compound/primitives/…） | 每个库函数改为注册形态：`registerFunction({ name, impl, inputShapes, outputShapes, mutatesInput, params })`；函数实现本身（mesh/brep 双链路）不变 |
| `src/stdlib/copy.ts`（新增，见 restore-dag 方案） | copy 走注册表：`mutatesInput: false` |
| `src/mesh/api.d.ts` | **生成文件**：`gen-api-dts.ts` 从注册表（替代 SCHEMAS）生成；改后必须重跑脚本 |
| `scripts/gen-api-dts.ts` | 数据源从 SCHEMAS 改为函数注册表 |
| `src/lang/parser.test.ts` / `runtime.test.ts` / 各 stdlib 测试 | 断言适配注册表形态；`ParseOptions.schemas` → `functions` |

### 5.2 3d_editor（宿主侧）

| 文件 | 改动 |
|---|---|
| `src/engine/script-engine/executeScript.ts` | 无直接改动（消费 `result.terminals`）；若引用 faijs 的 SCHEMAS/类型，随导出面适配 |
| `src/engine/__tests__/contract-entry.test.ts` | 白名单随 faijs 导出面收敛（`computeTerminalShapes` 删除项 + 新增注册表导出符号） |
| 其余 | 宿主不感知函数化——`ExecutionResult`/`terminals`/`compounds` 结构不变 |

---

## 6. 实施步骤

### 6.1 阶段一：注册表落地（引擎内部，语法不变）

1. 新增 `function-registry.ts`：FunctionDef 类型 + 注册/查询；
2. 把现有 stdlib 函数逐个改为 `registerFunction`（先内置 20+ 函数，保持行为不变）；
3. `internal-stdlib-adapter.ts` 改为从注册表自动装配；
4. 删除 `schemas.ts` 的 SCHEMAS 表，parser/validate 数据源切换为注册表；
5. 全量测试绿（行为零变化验证）。

### 6.2 阶段二：去 op 特判（parser/compile/allocate-id/codegen/runtime）

6. parser：删 `BOOLEAN_OP_NAMES`/split/group/assembly/load 特判，统一按调用形态解析；
7. compile：`buildStatementFnBody` 按 `def.outputShapes`/`def.void` 生成；
8. allocate-id：命名规则纯由 FunctionDef 推导（删 isCreatorOp/isBooleanOp/copy 分支）；
9. codegen：按 FunctionDef 推导调用形态；
10. runtime：`isCompound`/assembly 特判改为 `def.outputKind`/`mutatesInput`；
11. `gen-api-dts.ts` 从注册表生成，重跑 api.d.ts；
12. faijs 全量 vitest + typecheck + parity 绿；`npm run pack`。

### 6.3 阶段三：消费语义（readonly）函数化

13. `mutatesInput` 字段落地：copy `false`、group/assembly `false`、drill/transform 等 `true`；
14. parser 规则 A/B 与 runtime 终端判定改按 `def.mutatesInput`（`NON_CONSUMING_OPS` 集合删除）；
15. 补 copy API 与测试（restore-dag 方案的 copy 需求在此落地）。

### 6.4 阶段四：校验职责回归函数（brepjs 模式，可选）

16. 引入轻量 `Result`/错误码（参考 brepjs `src/core/result.ts`）；
17. 各函数内部几何自校验（零向量/直径>0 等），schema 字段级校验退化为参数级静态校验。

### 6.5 3d_editor 同步

18. 白名单收敛；分层测试绿（lint → tsc → vitest → 组件测试 → 相关 e2e）。

---

## 7. 测试策略

1. **行为零变化回归（阶段一/二的关键闸门）**：注册表落地 + 去特判后，现有全量 vitest/parity/demo e2e 必须全绿——重构不改变任何 .faijs 语义；若某断言因 op 名特判消失而失败，说明该处仍依赖 op 概念，需继续改造而非改断言。
2. **注册表单测**：`registerFunction`/`getFunction`；同名重复注册报错；未知函数调用行为（parser 是否报错、runtime 是否 failedAt——brepjs 模式：函数存在则调用，不存在则错误）。
3. **命名规则推导**：`inputShapes:0`→新名；`inputShapes:1,outputShapes:1,mutatesInput:true`→保名；`inputShapes:1,mutatesInput:false`（copy）→新名且源保活；`outputShapes:2`（split）→双新名——纯由 FunctionDef 推导，无 op 名。
4. **消费语义（readonly）**：`mutatesInput:false` 的函数（copy/group/assembly）不消费源；`true`（drill/transform/boolean）消费源；parser 规则 A/B 与 runtime 终端判定按 `def.mutatesInput` 结果与 restore-dag 方案断言一致。
5. **校验职责回归**：参数级静态校验（字段名/类型/required）从 FunctionDef.params 校验；几何级校验（零向量/直径>0）由函数内部完成——测试各函数错误路径返回错误而非静默。
6. **api.d.ts 生成**：改注册表后重跑 `gen-api-dts.ts`，断言生成文件与注册表一致（`api-dts-sync.test.ts` 已有机制）。
7. **第三方库形态**：模拟一个"第三方函数"（如自定义 clone：`mutatesInput:false`），验证仅靠 `registerFunction` 即可被 parser/compile/runtime/命名/终端全链路识别，无 op 名知识。
8. **stderr 零容忍**、测试纪律不变（先自己测试 → 受影响测试 → CI）。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 去 op 特判是大规模重构（parser/compile/adapter/allocate-id/codegen/runtime 六处），回归面大 | 分阶段实施（§6：注册表→去特判→readonly→校验）；阶段一/二以"行为零变化"为闸门，先跑全量再继续 |
| `BOOLEAN_OP_NAMES`/split/group 特判删除后，调用形态推导错误（如 union 被当普通单入） | FunctionDef 显式声明 `inputShapes`/`outputShapes`；用 parity 测试（boolean/split 全场景）锁定 |
| 第三方函数声明 `mutatesInput:false` 但实现偷偷修改入参（readonly 失信） | 可选运行时验证：dev 模式对 `mutatesInput:false` 函数执行前后快照输入，被改则告警（brepjs 模式函数内自校验为主，此为兜底） |
| `gen-api-dts.ts` 从注册表生成时特殊 op（boolean/split/load）模板漂移 | 保留现有特殊模板逻辑，数据源换注册表；`api-dts-sync.test.ts` 锁生成物 |
| 宿主（3d_editor）依赖 faijs 旧导出面（SCHEMAS/OpSchema） | 导出面收敛先于发版；contract-entry 白名单同步；宿主无直接消费 terminals 之外的行为 |
| schema 删除后"无表不校验"路径（`parseScript` 无注入） | 注册表是引擎内置（stdlib 自注册），parser 默认可用；第三方未注册函数 → 解析期未知函数错误（明确报错优于静默） |

---

## 9. 非目标（本次不做）

- 不改 `.faijs` 语法、不改 `ExecutionResult`/`terminals`/`compounds` 结构（终端判定语义与 restore-dag 方案一致，只是判定依据从 op 名改为函数契约）。
- 不实现 faijs 语言内"定义函数"的语法糖（`function box(...) {}` 写在用户脚本里）——本方案只做**引擎侧函数化**（注册表）；"在 faijs 源码里定义内置函数"是后续语言演进方向，用户原话"faijs的引擎解析这些函数，自然知道其输入、输出的格式"在本方案中落为"引擎从注册表 FunctionDef 推导"，语法层函数定义另立方案。
- 不引入完整 Result 类型体系（brepjs 的 `Result<T,E>` 全面改造）——阶段四可选；当前错误形态（ParseError/failedAt）保持。
- 不做 schema → FunctionDef 的自动化迁移工具（内置 20+ 函数手工迁移，量可控）。
- 不改变 3d_editor 的 UI/场景树行为；copy API 的 UI 入口（如需要）不在本方案。

---

## 10. 待评审决策点

1. **FunctionDef 放哪层**：`src/cad-runtime/`（运行时概念，推荐）还是 `src/lang/`（语言层）？——倾向 cad-runtime，lang 保持零函数知识（与 parser 红线一致）。
2. **`mutatesInput` 缺省值**：默认 `true`（消费，安全）——第三方声明 `false` 才保源；确认。
3. **函数注册时机**：stdlib 模块顶层 `registerFunction`（模块副作用，简单）还是显式 `installFunctions(registry)`（可控）？——倾向显式安装，避免模块加载顺序问题。
4. **boolean 多输入形态**：保留 `cad.union/subtract/intersect` 三个函数名（内部映射 `boolean`）还是收敛为 `cad.boolean(op, a, b)` 单一函数？——保留现名（语法兼容，注册表按名映射）。
5. **阶段四（Result 化）是否纳入本次**：不纳入（独立后续方案），本方案收口阶段一至三。
