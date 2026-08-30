# faijs 执行架构 v9（JS VM 执行 + op 即库函数 + 无注册表）

- 日期：2026-08-23
- 类型：架构设计方案
- 状态：**已废弃**
- 替代：`2026-08-19-faijs-execution-v8.md`（v8 的 `registerOp` 能力声明协议**取消**，见 §1.2）
- ⚠️ 本方案已被 2026-08-25 版取代，见 [2026-08-25-faijs-execution-v9.md](2026-08-25-faijs-execution-v9.md)
- 配套：3d_editor 侧 Feature 层方案 `3d_editor/docs/plans/2026-08-23-feature-op-decoupling-design-v2.md`

---

## 0. 用户规定（原话驱动，2026-08-23）

> "所谓op，本质就是调用库函数。"
> "我规定所有op必须实现mesh路径，brep的支持可选。把这个模式作为一个参数，或者作为全局context的一部分传递给op，也就是要定义op的函数接口。"
> "所有op都必须是faijs语言实现，不能在faijs引擎里实现。也完全不需要集中式的op特征注册。"
> "区分特征和操作op以后，v8 方案里的 registerOp 之类的是否就可以不需要了，或者要重新设计。"

**结论（本文档全部设计由这三条推出）**：

1. **op = 库函数调用**。引擎不认识任何 op 名；`cad.drill(box, {depth:3})` 就是对库函数的普通 JS 调用。
2. **op 函数接口 = 唯一的引擎 ↔ 库契约**（§2）：所有库函数最后一个参数是 `exec`（执行上下文），`exec.mode` 携带 auto/brep/mesh 模式。
3. **mesh 必须、brep 可选**：路径决策在**库代码**内完成（stdlib 提供共享 helper），引擎只提供模式与链状态查询。
4. **无注册表**：`registerOp`/`OpDeclaration`/能力表全部取消。v8 需要能力表的两个消费方都有更优解——建模路径决策移入库内（§3）；UI 操作列表由 3d_editor 的 Feature 注册表承担（配套文档），引擎不需要知道"有哪些 op"。

---

## 1. 与 v8 的差异

### 1.1 保留的 v8 结论（仍然有效）

- parser 只解析（静态提取），执行在 JS VM（v8 §0.6）。
- `.faijs`（UI 生成、无控制流顺序语句）与 `.js`（任意 JS 库代码）严格分开（v8 §0.7-1）。
- 终端 = 全局作用域中的 Shape 变量；删除 returnType 四类及赋值校验（v8 §0.3、§0.7-2）。
- 取消 partN_vM 命名，变量规则与 JS 一致（v8 §0.2）。
- 三入口增量：execute / append / update（v8 §0.5、§1.4）。
- op 实现全部迁出引擎为库（v8 §0.7-3）——v9 强化为"引擎内**禁止**任何 op 实现"。

### 1.2 取消 / 重设计的 v8 内容

| v8 设计 | v9 处置 | 理由 |
|---|---|---|
| `registerOp(decl)` + `OpDeclaration`（name/kind/mesh/brep/schema）+ 引擎能力表 | **全部取消** | 用户规定"完全不需要集中式的 op 特征注册"。op 是库函数，引擎无需知道它存在 |
| 引擎侧 `decidePath`（能力表 + mode + 链状态 → exec.path，v8 §3.5） | **移入库代码**：stdlib 共享 helper `resolvePath(exec, inputs, brepImpl?)`（§3.2） | 决策所需的全部信息（mode、链状态、op 是否支持 brep）在调用现场都可得，无需引擎预知能力表 |
| parser 的 callee 能力校验（查能力表） | 降为**绑定校验**：callee 必须是 import 绑定（命名空间或具名），不查任何能力表 | 引擎不认识 op 名 |
| `args-schema.ts` 集中 SCHEMAS + `validateStatementArgs` | **删除**。参数校验由库函数在调用时自校验（不合法即抛错） | schema 是 op 自己的知识；集中表正是要消除的耦合 |
| codegen `buildArgsParts` 按 op switch | **通用规范形式**（§5.2），无 op 名分支 | 文本生成不需要 op 知识 |
| parser `opToFeatureKind` 打 feature 标 | **删除**。feature 元数据只由宿主 UI 操作写入（配套文档 §3） | feature 是宿主概念；parse 进来的代码不对应 UI 操作，不进 Timeline |
| `BREP_NATIVE_OPS`/`MESH_ONLY_OPS` Set、runtime 主循环 `do_assemble` 特判 | **删除**（随执行模型换血自然消失） | 链状态 = `exec.getSolid(shape)` 查询；装配见 §4.3 |

---

## 2. op 函数接口（引擎 ↔ 库的唯一契约）

### 2.1 签名约定

**每个 op 库函数的最后一个参数是 `exec`**（执行上下文，由编译产物注入）。其余参数形态由库函数自定（inputs 在前、params 对象在后，与现状一致）：

```ts
// 创建类：无输入
box({ size, center? }, exec): Shape
// 特征类：单输入 + 参数
drill(input: Shape, { depth, ... }, exec): Shape
// 多输出：返回具名对象
split(input: Shape, { ... }, exec): { front: Shape; back: Shape }
// 多输入
boolean(a: Shape, b: Shape, { operation }, exec): Shape
// 结构型：返回库自定义对象（非 Shape）
assembly({ name, members, constraints }, exec): Assembly
// 任意第三方库函数同样遵守"末参 exec"
createGear({ teeth, module }, exec): Shape
```

### 2.2 ExecContext（引擎提供，op 无关）

```ts
// @faicad/faijs 导出（引擎侧平台 API）
export interface ExecContext {
  /** 用户全局模式设置 */
  readonly mode: 'auto' | 'brep' | 'mesh'
  /** BREP 内核（mesh 模式或未初始化时为 null；库函数 brep 路径自取） */
  readonly kernel: OcctKernel | null
  /** 查询输入几何的 BREP 链状态（有 = 该值仍持有精确实体） */
  getSolid(shape: Shape): SolidHandle | undefined
  /** brep 路径的库函数把输出实体写链（mesh 路径不调 → 自动断链，逐 part 语义不变） */
  setSolid(shape: Shape, solid: SolidHandle): void
  /** 变更型库调用（do_assemble）：查询某值的传递下游当前值（引擎按语句 inputs 图计算） */
  dependentsOf(shape: Shape): Shape[]
  /** 变更型库调用：声明该值被原地修改（引擎据此失效缓存/通知宿主刷新） */
  touch(shape: Shape): void
  /** 平台能力（资源/字体/CSG/SDF 后端……），自现 HostPorts 演进，与具体 op 无关 */
  readonly assets: AssetAccess
  readonly fonts: FontAccess
}
```

**链状态的存储**：引擎内部用 `WeakMap<Shape, SolidHandle>` 实现 `getSolid/setSolid`（替代现状按 statementId 键控的 `solidCache`，runtime.ts:179）。变量名与实体的解耦由引擎在每条语句函数执行后自动记账（ctx 新赋值 → 若有 solid 则记 statementId→solid 派生表，供拓扑/导出查询），**库函数只面对 Shape 值**。

### 2.3 类型化构造器（引擎平台 API，保留 v8 §4.5）

```ts
export function solid(meshData): Shape      // kind: 'solid'
export function shape2d(data): Shape        // kind: 'shape2d'
export function curve(data): Shape          // kind: 'curve'
```

库函数的产物必须经构造器创建 → 终端判定（`isShape`）只认构造器产物。非 Shape 返回值（数字、undefined、Assembly 等库对象）不显示。

---

## 3. brep / mesh / auto 模式处理（用户规定的具体化）

### 3.1 规则

1. **所有 op 必须实现 mesh 路径**（用户规定）。`mode='mesh'` 时任何 op 可用。
2. **brep 可选**：库函数自己知道自己有没有 brep 实现（`brepImpl` 存在与否即声明，无需注册）。
3. **模式经 `exec.mode` 传入**（全局 context 的一部分，用户规定）。
4. **决策在库代码内、调用现场完成**；mesh 兜底不存在"运行时回退"问题——因为 mesh 是必须实现的正经路径，不是 fallback。

### 3.2 stdlib 共享 helper（库代码，不在引擎）

```ts
// src/stdlib/internal/path.ts（stdlib 内部共享；第三方库可 import 或自行实现同规则）
import type { ExecContext, Shape } from '@faicad/faijs'

/**
 * 路径决策（auto/brep/mesh × op 是否实现 brep）：
 * - mesh 模式 → 'mesh'（所有 op 必实现）
 * - brep 模式 → 有 brepImpl 则 'brep'，否则调用前抛错（静态判定，不偷偷降级）
 * - auto → 有 brepImpl 且全部输入在 BREP 链上 → 'brep'；否则 'mesh'
 */
export function resolvePath(
  exec: ExecContext,
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh' {
  if (exec.mode === 'mesh') return 'mesh'
  if (exec.mode === 'brep') {
    if (!brepImpl) throw new Error('[stdlib] this op does not support brep mode')
    if (!inputs.every((s) => exec.getSolid(s))) {
      throw new Error('[stdlib] brep mode requires all inputs to hold brep solids')
    }
    return 'brep'
  }
  // auto
  if (brepImpl && inputs.every((s) => exec.getSolid(s))) return 'brep'
  return 'mesh'
}
```

> auto + 空输入（box 等创建类）：`[].every()` 为 true → 有 brepImpl 即走 brep，与现状（canUseBrep，`src/ops/types.ts:65-71`）语义一致。

### 3.3 库函数的典型形态（以 drill 为例）

```ts
// src/stdlib/drill.ts —— op 即库函数，faijs 语言实现
import { solid, type ExecContext, type Shape } from '@faicad/faijs'
import { resolvePath } from './internal/path'

export function drill(input: Shape, params: DrillParams, exec: ExecContext): Shape {
  // 参数自校验（无集中 schema；不合法即抛错）
  if (typeof params.diameter !== 'number') throw new Error('[drill] diameter must be a number')

  const path = resolvePath(exec, [input], drillBrepImpl)   // brepImpl 不存在 → 自动等价 mesh-only
  if (path === 'brep') {
    const out = drillBrepImpl!(exec.kernel!, exec.getSolid(input)!, params)
    const shape = solid(out.mesh)
    exec.setSolid(shape, out.solid)      // 写链
    return shape
  }
  return solid(drillMeshImpl(input, params, exec))  // mesh 路径（必实现）
}
```

mesh-only op（knurl/sdf）= 不传 `brepImpl` 的退化形态，brep 模式下经 `resolvePath` 在**调用前**抛错——替代 `MESH_ONLY_OPS` 集合与 runtime 的特判（runtime.ts:298/535）。

---

## 4. 执行模型

### 4.1 四层分离（引擎零几何、零 op 名）

| 层 | 内容 |
|---|---|
| **引擎**（`@faicad/faijs`） | parser、codegen（`compileToModule`）、`ModuleExecutor`、ctx、增量调度、`ExecContext` 与链状态记账、`solid()/shape2d()/curve()` 构造器、OCCT/manifold **内核平台**（`src/occt-kernel/`、`src/mesh/` 内核封装、`src/brep/` 底层算子——这些是库要调用的**底料平台**，不是 op 实现） |
| **语言** | `.faijs`（UI 生成、无控制流）/ `.js`（任意 JS） |
| **stdlib**（`@faicad/faijs/stdlib`） | 全部官方 op 的**库函数实现**（自 `src/ops/**` 迁出），各自为独立文件，`resolvePath` 共享 |
| **第三方库** | 任意 `.js` 模块，遵守"末参 exec"约定即可被 `.faijs` 调用 |

**红线**：引擎 `src/` 下不存在任何以 op 名命名的分派/校验/能力代码。`src/ops/`（dispatcher.ts 等）整个目录迁出或删除。

### 4.2 编译与执行（承袭 v8 §1.3/§3，无注册表版）

```ts
// codegen 新增（替代 v8 同名设计；无能力表校验）
export function compileToModule(script: PartScript): string
```

编译产物（每条语句一个函数；import 提升为真 ESM import；`exec` 由引擎注入为末参）：

```js
import * as cad from '@faicad/faijs/stdlib'
import { createGear } from './lib/gears.js'

export const statements = [
  { id: 'box',   fn: (ctx, exec) => { ctx.box = cad.box({ size: [10,20,5] }, exec) } },
  { id: 'box2',  fn: (ctx, exec) => { ctx.box2 = cad.drill(ctx.box, { depth: 3 }, exec) } },
  { id: 'gear1', fn: (ctx, exec) => { ctx.gear1 = createGear({ teeth: 20 }, exec) } },
  { id: 'asm1',  fn: (ctx, exec) => { ctx.asm1 = cad.assembly({ members: [ctx.box, ctx.gear1], constraints: [...] }, exec) } },
  { id: 'asm1_do', fn: (ctx, exec) => { ctx.asm1.do_assemble(exec) } },   // 变更型调用（§4.3）
]
```

**ModuleExecutor**（`src/cad-runtime/executor.ts` 新增）：`ctx` 持久容器 + `load`（Node: `import()` 数据 URL；浏览器：Blob URL）+ `executeAll/executeIds/executeFrom`。

**CadRuntime 三入口**（替代现 `execute` runtime.ts:233 / `append` :470 / `update` :453 的解释循环）：

| API | 行为 |
|---|---|
| `execute(script)` | 全量：load 模块 → 逐条调语句函数 |
| `append(script, newIds)` | **只调新增语句的 fn**（前缀依赖已在持久 ctx） |
| `update(script)` | plan() 得变更点 → 从变更点起重调（兜底全量） |

**终端判定**：执行完成后遍历 ctx，`isShape(value)`（构造器产物）即终端。裸调用/非 Shape 赋值不显示（v8 §0.3 案例不变）。

### 4.3 结构型与变更型库调用（assembly / group / do_assemble）

v8 把装配当"结构型语句 + runtime 特判 pass"；v9 中它们是**纯库对象方法**，引擎零感知：

- `cad.assembly({...}, exec)` 返回库自定义的 `Assembly` 对象（非 Shape → 不是终端、不显示），持有 members/constraints 与 exec 引用。
- `asm1.do_assemble(exec)` 是**库对象上的普通方法**：对 member Shape 施加刚体变换（brep 在链则同步变换实体），再经 `exec.dependentsOf(member)` 取传递下游并施加同一变换（替代现状 `propagateTransformDownstream`），最后 `exec.touch(shape)` 声明变更。引擎在执行该语句 fn 后按 touched 集合失效缓存/通知宿主。
- 依赖图来自 parser 提取的 `inputs`（引擎持有），`dependentsOf` 是引擎提供的 op 无关查询。
- `group` 同理：返回库对象，无几何副作用。
- `asm1_do` 这类语句没有赋值（ExpressionStatement），不产生终端——Timeline 不显示（配套文档 §3）。

### 4.4 参数与表达式

`.faijs` 无控制流但允许**表达式**（`cad.box({ size: [10, 20 * r, 5] })`）：编译产物里表达式原样保留，由 JS 引擎求值（v8 §3.1 不变）。`$param`/`$geom`/`$asset` 引用形式保留现状解析（parser 既有能力），编译时翻译为对应取值表达式。

---

## 5. parser 与 codegen 的收口

### 5.1 parser（`src/lang/parser.ts`）

保留：acorn 解析 → PartScript（语句 id/op/args/inputs/outputs/assemblyTarget）、import 记录、`ParseError`。
**删除/修改**：

- **删除 feature 打标**（`opToFeatureKind` :69-86 及 :304/:428/:705/:810 的 feature 赋值）。feature 是宿主概念；Timeline 的 Feature 识别由宿主按语句内容（op 匹配注册表）完成，保证导出→导入 round-trip 显示不变（配套文档 §3.0 铁律）。`FeatureMeta` 类型保留在 lang/types.ts（宿主写入 `createdBy`/`alternateParams` 等会话内信息用）。
- **删除 returnType 四类**：`CadStatement.hasAssignment/returnType`（types.ts:104/128-132）、`getOpReturnType`、赋值校验（:733-739 等）。
- **删除 schema 校验**：`args-schema.ts` 整文件删除（SCHEMAS :38-288、validateStatementArgs、load 互斥特判——校验责任移给库函数）。
- **callee 校验降为绑定校验**：`ns.<name>` 中 `ns` 必须是命名空间 import 绑定；裸标识符必须是具名 import 绑定。不查任何 op 清单。
- 结构识别保留：多输出解构（`const {front, back} = ...` → `outputs`）、member 调用（`asm1.do_assemble()` → `assemblyTarget`）——这是**语法结构**识别，不含 op 语义。

### 5.2 codegen（`src/lang/codegen.ts`）

- 新增 `compileToModule`（§4.2）。
- `statementToLine`/`scriptToCode`（Timeline「查看代码」/导出用）改为**通用规范形式**，删除 `buildArgsParts` 的 op switch（:99-332）：
  - 赋值语句：`const <var> = <callee>(<inputs...>, { <args 按插入序序列化> })`
  - 多输出（`outputs.length >= 2`）：`const { k0: out0, k1: out1 } = ...`（解构键名见 §8 开放决策——建议 args 增 `outputNames` 或固定 front/back 由 split 语句数据自带）
  - member 调用（有 `assemblyTarget`）：`<target>.<method>(<args?>)`
  - boolean 别名（`cad.union(a,b)`）等历史形式：**导出统一规范为** `cad.boolean(a, b, { operation: 'union' })`；parser 读取时兼容两种写法（`BOOLEAN_OP_NAMES` 映射保留在 parser 作向后兼容，导出不再产出别名）。

### 5.3 引擎删除清单（汇总）

| 文件 | 处置 |
|---|---|
| `src/ops/dispatcher.ts` | **删除**（编译产物直接调库函数，无分派） |
| `src/ops/*.ts` 各 op 实现 | **迁出**至 `src/stdlib/**`，改造为库函数（末参 exec + resolvePath + 自校验） |
| `src/ops/types.ts` `OpContext`/`canUseBrep` | 删除（由 ExecContext/resolvePath 取代） |
| `src/lang/args-schema.ts` | 删除（§5.1） |
| `src/lang/parser.ts` 的 feature/returnType/能力校验 | 删除（§5.1） |
| `src/lang/codegen.ts` `buildArgsParts` switch | 删除，改通用规范形式（§5.2） |
| `src/brep/brep-chain.ts` 的 `BREP_NATIVE_OPS`/`MESH_ONLY_OPS` | 删除（§3.3）；`BrepChainState` 的按语句键控 solidCache 由引擎内部 WeakMap + 派生表取代 |
| `src/cad-runtime/runtime.ts` 解释执行循环、`do_assemble` 特判（:275）、MESH_ONLY 判断（:298/:535） | 删除，改三入口 + ModuleExecutor |
| `src/ops/assemble.ts` `executeAssemblyPassForStmt`/`executeDoAssemble` | 迁入库（`Assembly` 对象方法，`dependentsOf/touch` 驱动） |

`src/brep/`（brep-ops/brep-topology 等底层算子）、`src/occt-kernel/`、`src/mesh/` 内核封装：**保留在引擎侧作为平台**（库调用的底料），但它们不含任何 op 名知识。

---

## 6. 包结构与导出

```
@faicad/faijs            # 引擎：parser/codegen/executor/runtime/ExecContext/构造器/平台内核
@faicad/faijs/stdlib     # 官方 op 库：box/drill/split/...（src/stdlib/**）
```

引擎导出（`index.ts`/`browser.ts`）：`CadRuntime/createRuntime`、`compileToModule`、`ModuleExecutor`、`ExecContext` 类型、`solid/shape2d/curve`、`isShape`、parse/codegen 文本函数、平台 ports。**不导出任何 op 清单/注册/能力 API**（没有这些东西）。`package.json` exports 增加 `./stdlib`。

## 7. 3d_editor 适配要点（详见配套文档）

- UI 操作列表 = 3d_editor 的 **Feature 注册表**（不需要引擎能力表）。Feature 声明自己的 `primaryOp` 与 `brepCapable`（UI 徽标用，宿主数据）。
- append/edit 对接 `runtime.append(script, [id])` / `runtime.update(script)`；`replayPart` 删除每次 releaseBrepChainState。
- Timeline：Feature 识别在宿主侧**按语句内容匹配**（op 命中已注册 Feature 即显示），**导出 → 再导入显示不变**（round-trip 铁律；识别不依赖 feature 元数据是否随文本持久化）；不命中已注册 Feature 的内容（第三方库调用/赋值/表达式）不显示但解析/执行/导出完全兼容（配套文档 §3）。
- `executeScript.ts` 整脚本执行路径的 commit 类型：feature 元数据不再可从 parse 获得，改用宿主侧 `op → CommandType` 纯数据表（version-store 概念，一张 Record，非 switch）。

## 8. 开放决策

1. 多输出解构键名（front/back）的携带方式：`CadStatement.outputs` 只存 id，键名建议在语句数据上增 `outputNames?: string[]`（split 录制时写 `['front','back']`），parser 读解构语法时填充。
2. 编译产物缓存：脚本文本 hash → 模块缓存；append 场景的增量拼接留作增强。
3. `Assembly.do_assemble` 的下游传播是"刚体变换传播"（现状语义）还是"下游语句重算"：本文档取**刚体变换传播**（与现状一致、确定性）；重算语义留待参数化装配需求出现时再评。
4. stdlib 拆独立 npm 包的时机（先同仓多入口）。
5. `exec.assets/fonts` 的精确形状：自现 HostPorts（cad-runtime/ports.ts）裁剪演进，实施时定稿。

## 9. 测试计划（提纲式）

- **编译/执行**：compileToModule 产物形态；append 只调新增 fn（spy 断言前缀未调）；update 变更点起重算；表达式求值。
- **终端**：混合 Shape/非 Shape/undefined 变量 → 只有构造器产物显示。
- **模式矩阵**（核心）：每 op × {mesh 必通；brep 模式 + mesh-only op → 调用前抛错；auto + 断链（knurl 后接 drill）→ 自动 mesh；auto + 全链 → brep}。brep/mesh 结果等价性对拍（现 brep-mesh-equivalence 测试改造）。
- **库化**：第三方 `.js` 库（createGear）import 即可用，引擎零改动；未遵守末参 exec 约定的库函数报错信息清晰。
- **变更型调用**：assembly/do_assemble 端到端（transform 传播 + touch 失效）；`dependentsOf` 图查询正确性。
- **回归**：现有功能测试改造后全绿（stdlib 迁移等价性）；parser 兼容读取 legacy 别名形式。

## 10. 一句话总结

> **引擎只做解析、编译、调度、增量与平台（内核/构造器/链状态）；op 全部是库函数**——签名约定"末参 exec"，`exec.mode` 携带用户模式，所有 op 必实现 mesh 路径、brep 可选，路径决策在库内 `resolvePath` 完成。**没有任何 op 注册表、能力表、分派器**；引擎不认识任何 op 名。结构型操作（装配/分组）是库自定义对象的方法调用，经 `dependentsOf/touch` 与引擎的依赖图交互。
