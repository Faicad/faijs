# faijs 执行架构设计：JS VM 执行 + op 即库函数

- 日期：2026-08-25
- 状态：待评审

---

## 0. 文档目标与阅读约定

本文档只描述 **faijs 执行架构当前正确的目标设计**，不叙述任何历史方案或已废弃设计的来龙去脉。所有结论均可独立成立，不需要读者先了解过往版本。

本次的目标是：faijs语言代码的JS VM 执行 + op 即库函数，最好能做到对../3d_editor项目尽量少的修改。
如果这个目标太大，可以分两步完成，先让faijs的执行脱离解释执行，让js vm执行。然后让所有的op编写成faijs语言的库函数。

---

## 1. 总体定位与长期方向（设计的根）


## 语言特性
1. 最终需要在js虚拟机里执行。
2. AI生成的代码最好带上类型，也就是生成ts代码。比如，可以用faits的后缀名。经 sucrase 去类型执行。
3. UI生成的代码不需要类型，也就是生成js代码。比如，可以用faijs的后缀名。
4. faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
5. 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
6. faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
7. faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。



## 如何实现UI代码录制与回放
### 1. 变量如何命名
目前是partN_vM这种格式，一种SSA的命名方式。
这个方案的最大缺点是：AI不擅长生成这个partN_vM这种格式的代码，从目前faijs项目的例子代码就能看出来，有大量的错误。
AI喜欢重用一个变量名。
如果对用户来说语义上是一个模型，那就使用一个变量名。那么如何实现呢？参考后面的解决方案。

#### 2. canvas里如何决定显示哪些几何模型
目前是通过mesh dag的最终活跃性来自动推导的。是否沿用这个？我决定不用。

如果用js默认的语言特性。那么要么写额外的export来决定哪些对象显示在canvas里，要么UI要能判断如何写变量名。
其实写export更难。
所以我决定还是采用如下的方案：
1. 所有当前全局活跃的变量，如何类型是shape，那么显示在canvas中。
2. 对于所有输入是一个shape，输出是一个shape的方法，默认不改变变量名。如果输入没有shape，输出是shape的方法，需要一个新的变量名。如果输入和输出的shape数量不同，比如split、boolean，也要用新的变量名。这是静态的规则，UI生成代码时可以遵守。
3. UI 层是"死"的，必须有一套确定的命名方案才能稳定生成与回放代码，因此约定 **UI 生成的代码统一采用 `partN`（N 为整数序号）

PS：UI层如何知道op的输入、输出类型？

活跃变量就是所有顶层的变量。如果是UI生成的代码，编码到PartN就有N个。
变量名只要是**合法的 JS 标识符**即可，变量命名规则仅针对 UI 生成的代码。


### 3. timeline如何显示
timeline是一个线性列表，每一个节点对应用户的一次操作。在3d_editor层面对应一个特征feature。
那个一个特征是否可以强制对应一个faijs的函数调用？
未来faijs支持function定义，那么完全可以规定一对一，这样就简单了，feature对应一个faijs的函数名（带包名）。


### 4. AI生成的代码如何保证兼容性
假设faijs是AI、UI会共同编辑的代码；而faits只有AI编写，UI不参与。
那么，规定faijs里不准出现控制流语句，也就是不能有if/for/while之类的语句。至少是顶层词法作用域不能有控制流语句。
如此，上面的两个需求（canvas里如何决定显示哪些几何模型、timeline如何显示）等不会被AI生成的代码破坏。



### 1.2 已确认且仍然有效的设计结论

以下结论为已确认、且经本次重写复核仍然成立的设计常量，不随版本变动：

1. **parser 只解析（静态提取），执行在 JS 虚拟机**：解析得到结构化中间表示（PartScript），执行完全交给 JS VM，引擎不解释语句语义。
2. **语言源文件严格分层**：`.faijs`（UI 录制脚本：无类型、无控制流）与 `.js`/`.faits`（库代码 / AI 脚本）严格分开；脚本可被解析与校验，库代码为任意 JS。
3. **终端 = 全局作用域中的 Shape 变量**：删除 `returnType` 四类分类及基于它的赋值校验；显示判定在执行后遍历全局活跃变量、凡 `isShape`（构造器产物）即终端（见 §5.5）。
4. **变量名只需是合法 JS 标识符（符合 JS 语言对标识符的语法要求）**；"与 JS 命名一致"即此意。`partN`/`shapeN` 是**专供 UI 生成代码**的命名规则（UI 层是死的，需确定方案），N 按 §5.5 静态规则递增；`faits`/AI 不受此约束。旧 `partN_vM` 才是 SSA 命名（含 `_vM` 后缀），新方案废弃 `_vM`。
5. **三入口增量执行**：`execute` / `append` / `update` 三入口语义保持不变（见 §5.2）。
6. **op 实现全部迁出引擎为库，引擎内禁止任何 op 实现**：强化为硬红线——`src/` 下不得出现以 op 名命名的分派/校验/能力代码（见 §3、§6.3）。


再次强调StmtId与partName的区别。
比如const x = cad.<op>, 这里的x是partName。一个语句可能有0个、1个甚至多个左值，对应多个独立的partName，但是一个语句只有一个StmtId。
如果现有代码里和这个描述不一致，要改正。

---

## 2. 两项目现状基线（设计演进起点）

> 本节是**事实陈述**，用于让设计落地时有据可依。措辞为"现状 / 设计目标"，不评价现状。

### 2.1 faijs 引擎（`C:\my\Faicad\faijs`）现状

| 维度 | 现状（2026-08-25 真实代码） | 来源 |
|---|---|---|
| 解析 | acorn 解析 `.faijs`（合法 JS 子集），先解析后执行，**绝不 eval**；要求容器为 `export default async (cad) => {...}`（`parseScript` 自动封装） | `src/lang/parser.ts:1-21, 544-590` |
| 语句 id / 命名 | 语句 id = 变量名，规范格式 `partN_vM`（SSA，含 `_vM` 版本后缀）；`allocateIdContext` 另生成 `grp_N`（分组上下文命名，非 SSA） | `src/lang/parser.ts:283`；`src/lang/allocate-id.ts:140-172` |
| 参数校验 | 集中 `args-schema.ts`（`SCHEMAS` :38-288、`validateStatementArgs` :323、`getOpReturnType` :421）；有 `returnType` 四类分类 | `src/lang/args-schema.ts`；`src/lang/parser.ts:286` |
| 执行主循环 | `CadRuntime`（`runtime.ts:165`）解释器：`execute` 顺序语句循环（`runtime.ts:235, 271`），三入口 `execute/append/update` | `src/cad-runtime/runtime.ts` |
| op 分派 | 独立 `src/ops/dispatcher.ts`：`switch(stmt.op)`（`:117-218`）+ 动态 `import()`；**无 registerOp/OpDeclaration** | `src/ops/dispatcher.ts:95-219` |
| op 实现位置 | **全部内置引擎**：`src/ops/{primitives,transform,drill,split,extrude,boolean,engrave,knurl,text,screw,svgExtrude,load,sdf,assemble}.ts`，每 op 内部 `canUseBrep(ctx)` 双路径 | `src/ops/*`；`src/ops/types.ts:66-72` |
| BREP 链状态 | 逐 part：`solidCache: Map<PartName, ShapeHandle>`（有句柄=仍 BREP，缺失=降级 mesh）；**无全局 `brepActive`**；`BREP_NATIVE_OPS`/`MESH_ONLY_OPS` 两个 Set | `src/brep/brep-chain.ts:26-47, 87-136`；`src/cad-runtime/runtime.ts:301-320` |
| 包导出 | `exports` 仅 `.` / `./browser` / `./csg` / `./sdf` / `./node`；**无 `./stdlib`**；`index.ts` 仍导出 `executeStatement`/`canUseBrep` | `package.json:8-29`；`src/index.ts:55-56` |
| 浏览器入口 | `src/browser.ts` 把 `executeStatement`/`canUseBrep`/`BrepChainState`/`initOcctWasm` 标 `@deprecated`，红线"宿主用 `CadRuntime.execute()`" | `src/browser.ts:235-264` |
| 测试 | vitest（node）；`.faijs` fixture 在 `test/faijs/`；专门 BREP↔mesh parity 对拍测试；`beforeAll` 里 `initOcctWasm()` | `vitest.config.ts`；`test/faijs/parity/parity.test.ts` |

### 2.2 3d_editor（`C:\my\Faicad\3d_editor`）现状

| 维度 | 现状（2026-08-25 真实代码） | 来源 |
|---|---|---|
| 消费入口 | 生产代码统一从 `@faicad/faijs/browser` 导入（契约测试 `contract-entry.test.ts` 强制）；包经 `file:../faijs/faicad-faijs-0.1.1.tgz` 引入 | `package.json:24`；`contract-entry.test.ts` |
| 执行主路径 | `CadRuntime.execute()`（解释器逐语句循环，非编译模块）；`getRuntime()` 惰性单例 | `ScriptEngine.ts:90-102, 1042, 1191` |
| 脚本真源 | `sceneScript: PartScript`（场景级单 DAG，跨 part 语句按全局 `seq` 排列）；UI 操作经 `recordFeature/recordShape` 追加 `CadStatement` | `script-store.ts:28`；`ScriptEngine.ts:330-390` |
| Feature 注册 | 单一注册表 `features/index.ts`：`byType/byOp/byCommandType` 三 Map；识别 `getFeatureForStatement = byOp.get(stmt.op)`；**无 `primaryOp`/`brepCapable` 字段** | `features/index.ts:25-113`；`features/types.ts:86-136` |
| Timeline | 工程级线性操作队列：直接映射 `sceneScript.statements`，按 `seq` 排序；工具模式会话天然坍缩为单节点；`do_assemble` 无 Feature → 不渲染 | `TimelinePanel.tsx:61-99, 221-241` |
| Undo | **独立流**：`undo-store.ts` 的 `undoStack/redoStack`，执行时在语句边界压快照；不依赖 sceneScript | `undo-store.ts` |
| BREP 链交互 | 只读 `ExecutionResult.brepSolids`（`Map<PartName,{solid,kernel}>`），映射到宿主 `_exportSolidCache`；**不调用 `setBrepSolid`/`releaseBrepChainState`**（避免清空持久 solidCache） | `ScriptEngine.ts:1082-1095, 1275-1286` |
| 事件 | 真实事件为 `part-brep-lost`（某 part 失去 BREP 链）；`HotkeyManager` 监听弹 toast"转为 mesh 计算 / 三角化 STEP 导出" | `runtime.ts:315,553`；`HotkeyManager.tsx:23-45` |
| STEP 导出 | `exportMeshesToStepBrepAware`：逐 mesh 判 `exportSolidCache` 有无 solid → 有则精确 BREP STEP，无则 bake 世界变换后 faceted STEP | `exporters/index.ts:687-715` |
| 待消除耦合 | `executeScript.ts` / `execute-validator.ts` 仍直接调 faijs **已 deprecated** 的 `executeStatement`/`initBrepChainState`/`releaseBrepChainState`/`BrepChainState`（load 代码路径与校验器） | `executeScript.ts:19,208,251`；`execute-validator.ts:24,27,28` |

### 2.3 现状 → 设计目标的演进方向（非"错误"陈述）

| 主题 | 现状 | 设计目标（本文 §3–§8） |
|---|---|---|
| 执行方式 | 引擎内解释器循环 + `dispatcher.ts` switch | JS VM 编译模块执行（`compileToModule` + `ModuleExecutor`） |
| op 实现位置 | 内置 `src/ops/*` | 迁出为 `src/stdlib/**` 库函数（末参 exec + `resolvePath`） |
| op 知识 | 引擎内 `SCHEMAS`/`canUseBrep`/两个 OPS Set | 引擎零 op 知识；校验/路径决策移入库函数 |
| 命名 | `partN_vM` 规范（SSA，含 `_vM` 后缀）；`grp_N` 分组上下文 | 语句 id=变量名；采用 `partN`/`shapeN` 形式（去掉 `_vM` 版本后缀），N 按 §5.5 静态规则递增；`grp_N`可保留也可取消 |
| 包结构 | 无 `./stdlib` | 增加 `@faicad/faijs/stdlib` 子路径 |


---

## 3. op 函数接口（引擎 ↔ 库的唯一契约）

### 3.1 签名约定

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

引擎不校验 op 名、不查能力表、不按 op 分流——编译产物直接 `cad.box(..., exec)` 这样的普通函数调用。

### 3.2 ExecContext（引擎提供，op 无关）

```ts
// @faicad/faijs 导出（引擎侧平台 API）
export interface ExecContext {
  /** 用户全局模式设置 */
  readonly mode: 'auto' | 'brep' | 'mesh'
  /** BREP 内核（mesh 模式或未初始化时为 null；库函数 brep 路径自取） */
  readonly kernel: OcctKernel | null
 明明提到了两个几何内核，且同时存在，为何这里只有一个？

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


### 3.3 类型化构造器（引擎平台 API）

```ts
export function solid(meshData): Shape      // kind: 'solid'
export function shape2d(data): Shape        // kind: 'shape2d'
export function curve(data): Shape          // kind: 'curve'
```

库函数的产物必须经构造器创建 → 终端判定（`isShape`）只认构造器产物（见 §6.4）。非 Shape 返回值（数字、undefined、Assembly 等库对象）不显示。

---

## 4. brep / mesh / auto 模式处理

### 4.1 规则

1. **所有 op 必须实现 mesh 路径**（用户规定）。`mode='mesh'` 时任何 op 可用。
2. **brep 可选**：库函数自己知道自己有没有 brep 实现（`brepImpl` 存在与否即声明，无需注册）。
3. **模式经 `exec.mode` 传入**（全局 context 的一部分，用户规定）。
4. **决策在库代码内、调用现场完成**；

### 4.2 stdlib 共享 helper（库代码，不在引擎）

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

> auto + 空输入（box 等创建类）：`[].every()` 为 true → 有 brepImpl 即走 brep，与现状（`canUseBrep`，`src/ops/types.ts:66-72`）语义一致。

### 4.3 库函数的典型形态（以 drill 为例）

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

mesh-only op（knurl/sdf）= 不传 `brepImpl` 的退化形态，brep 模式下经 `resolvePath` 在**调用前**抛错——替代现状 `MESH_ONLY_OPS` 集合与 runtime 特判（`runtime.ts:301-320`）。

---

## 5. 执行模型（JS VM）

### 5.1 四层分离（引擎零几何、零 op 名）

| 层 | 内容 |
|---|---|
| **引擎**（`@faicad/faijs`） | parser、codegen（`compileToModule`）、`ModuleExecutor`、`ctx`、增量调度、`ExecContext` 与链状态记账、`solid()/shape2d()/curve()` 构造器、OCCT/manifold **内核平台**（`src/occt-kernel/`、`src/mesh/` 内核封装、`src/brep/` 底层算子——这些是库要调用的**底料平台**，不是 op 实现） |
| **语言** | `.faijs`（UI 生成、无控制流）/ `.faits`（AI 生成、带类型，sucrase 去类型后同管道） |
| **stdlib**（`@faicad/faijs/stdlib`） | 全部官方 op 的**库函数实现**（自 `src/ops/**` 迁出），各自为独立文件，`resolvePath` 共享 |
| **第三方库** | 任意 `.js`/`.faits` 模块，遵守"末参 exec"约定即可被 `.faijs` 调用（动态加载，参考 brepjs） |

**红线**：引擎 `src/` 下不存在任何以 op 名命名的分派/校验/能力代码。`src/ops/`（dispatcher.ts 等）整个目录迁出或删除。内核平台（`src/brep/`、`src/occt-kernel/`、`src/mesh/` 封装）保留在引擎侧作为 op 调用的底料，但**不含任何 op 名知识**。

### 5.2 编译与执行

```ts
// codegen 新增
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
  { id: 'asm1_do', fn: (ctx, exec) => { ctx.asm1.do_assemble(exec) } },   // 变更型调用（§5.3）
]
```

**ModuleExecutor**（`src/cad-runtime/executor.ts` 新增）：`ctx` 持久容器 + `load`（Node: `import()` 数据 URL；浏览器：Blob URL）+ `executeAll/executeIds/executeFrom`。

**CadRuntime 三入口**（保留现状三入口语义，底层由解释循环改为模块执行）：

| API | 行为 |
|---|---|
| `execute(script)` | 全量：load 模块 → 逐条调语句函数 |
| `append(script, newIds)` | **只调新增语句的 fn**（前缀依赖已在持久 ctx） |
| `update(script)` | plan() 得变更点 → 从变更点起重调（兜底全量） |

**终端判定**：执行完成后遍历 ctx 全局活跃变量，`isShape(value)`（构造器产物）即终端显示；裸调用/非 Shape 赋值不显示（见 §5.5 终端显示规则：所有当前全局活跃的 Shape 变量显示在 canvas 中）。

### 5.3 结构型与变更型库调用（assembly / group / do_assemble）

它们是**纯库对象方法**，引擎零感知：

- `cad.assembly({...}, exec)` 返回库自定义的 `Assembly` 对象（非 Shape → 不是终端、不显示），持有 members/constraints 与 exec 引用。
- `asm1.do_assemble(exec)` 是**库对象上的普通方法**：对 member Shape 施加刚体变换（brep 在链则同步变换实体），再经 `exec.dependentsOf(member)` 取传递下游并施加同一变换（替代现状 `propagateTransformDownstream`），最后 `exec.touch(shape)` 声明变更。引擎在执行该语句 fn 后按 touched 集合失效缓存/通知宿主。
- 依赖图来自 parser 提取的 `inputs`（引擎持有），`dependentsOf` 是引擎提供的 op 无关查询。
- `group` 同理：返回库对象，无几何副作用。
- `asm1_do` 这类语句没有赋值（ExpressionStatement），不产生终端——Timeline 不显示。

### 5.4 参数与表达式

`.faijs` 无控制流但允许**表达式**（`cad.box({ size: [10, 20 * r, 5] })`）：编译产物里表达式原样保留，由 JS 引擎求值。`$param`/`$geom`/`$asset` 引用形式保留现状解析（parser 既有能力），编译时翻译为对应取值表达式。

### 5.5 变量命名与终端显示（静态规则）

终端显示规则与变量命名规则是一组互相自洽的静态约定，使"无需显式 export 语句即可决定 canvas 显示内容"，且 UI 代码生成时可机械遵守（源自 `思考.md` §2）。

**终端显示规则（canvas 显示什么）**：所有当前全局作用域中、类型为 Shape（即经 `solid()/shape2d()/curve()` 构造器创建）的**活跃变量**，都显示在 canvas 中。非 Shape 返回值（数字、undefined、Assembly 等库对象）不显示。

**语言层约束（"与 JS 命名一致"的含义）**：变量名只要是**合法的 JS 标识符**即可——"与 JS 命名一致"指的就是符合 JS 语言对标识符的语法要求（非关键字、由字母/`_`/`$`/数字组成等）。引擎与解析层**不附加** SSA 版本后缀或 schema 校验之类的额外约束。

**变量命名规则（仅针对 UI 生成的代码）**：UI 层是"死"的，必须有一套确定的命名方案才能稳定生成与回放代码，因此约定 **UI 生成的代码统一采用 `partN` 或 `shapeN` 形式**（N 为整数序号）。旧 `partN_vM` 才是 SSA 命名（含 `_vM` 版本后缀），新方案废弃 `_vM` 后缀；`grp_N` 属分组上下文命名、并非 shape 变量命名，不在此规则内。`faits`/AI 生成的代码**不受** `partN`/`shapeN` 约束，只需是合法 JS 标识符。

**变量命名规则（UI 代码生成遵守的静态规则）**：

1. 输入 1 个 shape、输出 1 个 shape 的方法（如 translate / rotate / scale / drill / extrude）：**默认不改变变量名**（原地语义，变量仍为同一 shape，N 不变）。
2. 输入无 shape、输出 1 个 shape 的方法（如 box / sphere / cylinder）：**需要一个新的变量名**——新变量取 `partN`/`shapeN`，N 在前一个最大序号基础上 +1。
3. 输入与输出 shape 数量不同的方法（如 split：1→2、boolean：2→1）：**需要新的变量名**——输出按数量分配新序号（如 split 得到 `partK`、`partK+1`）。

活跃变量就是所有顶层的变量。如果是UI生成的代码，编码到PartN就有N个。
