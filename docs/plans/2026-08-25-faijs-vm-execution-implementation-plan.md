# faijs JS VM 执行 + op 库函数化：实施方案

> ⚠️ **过时修正（2026-08-29）**：本文档为历史方案，正文未改动。§2 红线第 4 条"先解析后执行"表述已过时——faijs 的准确执行模型是**先解析后编译、执行交给 JS 虚拟机**（acorn 解析 → ScriptIR → `compileToModule` 编译零 import ESM → data:/Blob URL 动态 import 执行；用户原文不进 VM）。权威表述见 `docs/syntax-design.md` §6 与 `docs/api-contract.md` R-2。

- 日期：2026-08-25
- 状态：待评审
- 修订记录：
  - 2026-08-25（晚）：① 同步 3d_editor feature v3 重构（`src/engine/features/` 已落地，`feature-registry.tsx` 已删除，`ScriptEngine` 收敛为通用 `recordFeature`）；② group/assembly 从"非 Shape 库对象"改为 **compound Shape**——是终端、在 UI 显示（用户规定，见 §0）。
- 前置文档：`docs/plans/2026-08-25-faijs-execution-v9.md`（需求）、`D:\Faicad\3d_editor\Faijs语言的思考.md`（需求源头）、`D:\Faicad\3d_editor\docs\faijs-contract.md`（宿主契约）
- 说明：本文档的接口设计为独立重新设计，不沿用 v9 文档的接口设计部分。本文档只写方案，不包含实施。

---

## 0. 需求原话（不准删除）

来自 `2026-08-25-faijs-execution-v9.md`：

> 本次的目标是：faijs语言代码的JS VM 执行 + op 即库函数，最好能做到对../3d_editor项目尽量少的修改。
> 如果这个目标太大，可以分两步完成，先让faijs的执行脱离解释执行，让js vm执行。然后让所有的op编写成faijs语言的库函数。

> 语言特性：
> 1. 最终需要在js虚拟机里执行。
> 2. AI生成的代码最好带上类型，也就是生成ts代码。比如，可以用faits的后缀名。经 sucrase 去类型执行。
> 3. UI生成的代码不需要类型，也就是生成js代码。比如，可以用faijs的后缀名。
> 4. faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
> 5. 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
> 6. faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
> 7. faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。

> 1. 所有当前全局活跃的变量，如何类型是shape，那么显示在canvas中。
> 2. 对于所有输入是一个shape，输出是一个shape的方法，默认不改变变量名。如果输入没有shape，输出是shape的方法，需要一个新的变量名。如果输入和输出的shape数量不同，比如split、boolean，也要用新的变量名。这是静态的规则，UI生成代码时可以遵守。
> 3. UI 层是"死"的，必须有一套确定的命名方案才能稳定生成与回放代码，因此约定 UI 生成的代码统一采用 `partN`（N 为整数序号）

> 再次强调StmtId与partName的区别。
> 比如const x = cad.<op>, 这里的x是partName。一个语句可能有0个、1个甚至多个左值，对应多个独立的partName，但是一个语句只有一个StmtId。
> 如果现有代码里和这个描述不一致，要改正。

v9 文档中内联的疑问（本方案必须回答）：

> 明明提到了两个几何内核，且同时存在，为何这里只有一个？（针对 ExecContext 只有一个 `kernel` 字段）

来自 `Faijs语言的思考.md`：

> 规定faijs里不准出现控制流语句，也就是不能有if/for/while之类的语句。
> 如此，上面的两个需求（canvas里如何决定显示哪些几何模型、timeline如何显示）等不会被AI生成的代码破坏。

来自 `faijs-contract.md`（宿主契约，仍然有效）：

> faijs 的职责只有一个：执行 faijs 脚本，生成 3D 模型。宿主的职责也只有两个：① 生成正确的 faijs 脚本；② 调用 faijs 执行该脚本。

> 🔴 所有几何变更必须走 faijs 脚本语句，执行 faijs 脚本来获得。

来自 2026-08-25 补充要求（feature 重构同步 + compound shape）：

> 1. 3d_editor代码有更新，主要是feature重构相关。你的文档相关部分要更新。
> 2. group/assemble应该属于shape，属于compound shape，应该在UI上显示。UI层自己处理这类装配对象该如何显示，应该是每个子对象都显示，同时在场景树里显示层级结构。

---

## 1. 现状基线（事实陈述，2026-08-25 真实代码）

### 1.1 faijs 引擎

| 维度 | 现状 | 来源 |
|---|---|---|
| 解析 | acorn 解析，容器约定 `export default async (cad) => {...}`（扁平代码自动封装）；产出 `PartScript{params, statements[], meta, terminalShapes}` | `src/lang/parser.ts:544-596, 607-797`；`src/lang/types.ts:143-156` |
| 语句 id | **StmtId 与 partName 混同**：几何语句 `id = 变量名`（`asStmtId(varName)`）；仅 group/assembly/add_constraint/do_assemble 走 `allocateStatementId` 得 `grp_N`。这正是 v9 要求改正的不一致 | `src/lang/parser.ts:284, 669, 775` |
| 命名 | UI 录制侧经 `allocateStatementId` 分配 `partN_vM`（SSA，含 `_vM`）；split 用 `allocateSplitIds` 得两个新 part | `src/lang/allocate-id.ts:140-191` |
| 参数校验 | 集中式 `SCHEMAS`（24 个 op）+ `validateStatementArgs`；`returnType` 四类分类（`new_shape`/`same_shape`/`scalar`/`void`，其中 `scalar` 无任何 op 使用）；parser 按 returnType 做赋值校验 | `src/lang/args-schema.ts:38-288, 323-395`；`src/lang/parser.ts:701-705` |
| 执行 | `CadRuntime` 解释器主循环逐语句调 `dispatchStatement`；三入口 `execute/append/update`；`plan()` 按 `statementKey = op\|JSON(args)\|各 input 的 outputContentKey` 判定 stale 并级联；**plan 不感知 params 变化（statementKey 不含参数表，已知缺陷）** | `src/cad-runtime/runtime.ts:235-431, 852-883, 128-139` |
| op 分派 | `dispatcher.ts` 的 `switch(stmt.op)` + 动态 `import()`；`OpContext` 隐式携带 outputCache/brepChain/ports/mode | `src/ops/dispatcher.ts:95-219`；`src/ops/types.ts:36-53` |
| op 副作用 | op 直接写 `brepChain.solidCache`、`faceEvolutionCache`、`outputCache`（split 多输出）、经 `ports.events` 发事件——非纯函数 | `src/ops/primitives.ts:46`、`src/ops/boolean.ts:114`、`src/ops/split.ts:143-146` |
| BREP 链 | 逐 part：`solidCache: Map<PartName, ShapeHandle>`；`BREP_NATIVE_OPS`（19 op）/`MESH_ONLY_OPS = {sdf, knurl}`；`breakBrepChain` 已不存在，断链为隐式语义 | `src/brep/brep-chain.ts:26-47, 96-136` |
| $geom | parser 提取 `GeomRef{of, feature, faceOrdinal?, anchor?}`；执行侧 dispatcher 调 `resolveGeomRef`（faceOrdinal+BREP 优先 → anchor 反查 → 报错） | `src/lang/parser.ts:123-156`；`src/ops/geom-ref.ts:39-114` |
| 拓扑 | 引擎执行时**不自动构建拓扑**；`buildBrepTopology(stmtId)` 需宿主显式调用；假拓扑由宿主构建后经 `setTopology` 注入；`ExecutionResult.topology` 仅浅拷贝注入缓存 | `src/cad-runtime/runtime.ts:923-942, 897-909, 429` |
| 装配 | `executeAssemblyPassForStmt` **只读 assembly 语句 args.constraints**；`add_constraint` 语句的约束在引擎内无任何合并逻辑（已知缺口）；`propagateTransformDownstream` 只传播 mesh 不传播 BREP solid | `src/ops/assemble.ts:412-471, 321-351` |
| 导出面 | `exports` 5 入口（`.`/`./browser`/`./csg`/`./sdf`/`./node`）；`browser.ts` 含 deprecated 区（executeStatement/BREP chain/canUseBrep/resolveGeomRef/OCCT 底层） | `package.json:8-29`；`src/browser.ts:235-264` |

### 1.2 3d_editor（宿主）

| 维度 | 现状 | 来源 |
|---|---|---|
| 消费入口 | 生产代码统一 `@faicad/faijs/browser`，`contract-entry.test.ts` 符号级白名单锁定（含 E10/E12/E13 临时放行段） | `src/engine/__tests__/contract-entry.test.ts:243-346` |
| 执行主路径 | `ScriptEngine`（1534 行，feature v3 重构后）：`getRuntime()` 单例 `new CadRuntime(ports,'auto')`；**已收敛为通用编排**——`recordFeature(op, scopedId, params)` 经 lazy import 的 `getFeatureByOp` 调 Feature 模块 `buildStatement` 构建语句，**不再有任何按 op 命名的 build*/record* 分支**；`commitAndRecord` 由 commandType 反查 op 名；`executePart/appendStatement/editStatement/executeScene` 全部经 `runtime.execute/append/update` | `src/engine/script-engine/ScriptEngine.ts:299-375, 685-688` |
| 脚本真源 | `sceneScript: PartScript` 单一 DAG + `terminalToScopedId: Record<PartName, ScopedId>`（只增不删，反查取最后匹配） | `src/stores/core/script-store.ts:26-31`；`ScriptEngine.ts:413-445` |
| 手工执行循环 | `executeScript.ts` / `executeScriptDiff` / `execute-validator.ts` 三条**绕过 CadRuntime** 的手工循环，直接 import 已 deprecated 的 `executeStatement/initBrepChainState/releaseBrepChainState/executeAssemblyPassForStmt`；`execute-validator.ts:120` 的 `initBrepChainState()` 无配对 release | `src/engine/script-engine/executeScript.ts:19-20, 210, 244, 250-253, 827`；`execute-validator.ts:27-28, 120` |
| 直调 cad.* | 活代码两处：`LiveDrillPreview.tsx:198`（`cad.drill` dry-run 预览）、`EngravingCore.ts:168`（`cad.engrave` 直算）；~~死代码 `_computePrimitiveShape`~~ 已在 feature v3 重构中删除 | 同左 |
| Feature 层 | **feature v3 重构已落地**（设计：`docs/plans/2026-08-25-feature-op-decoupling-design-v3.md`）：`src/engine/features/` 17 个自包含模块（约 2032 行），每 Feature 一个文件（`type/ops/commandType/buildStatement/buildArgs/afterRecord/terminalMapping` + 展示编辑协议）；注册表 `features/index.ts` 为 **byType/byOp/byCommandType 三 Map**；`getFeatureForStatement = byOp.get(stmt.op)`；旧 `feature-registry.tsx` 已删除；概念模型"一个 Feature 对应一个 op（未来：一个 function），op 未注册 → Timeline 不显示，解析/执行/导出无损" | `src/engine/features/types.ts:86-136`；`features/index.ts:25-149` |
| Timeline | 直接映射 `sceneScript.statements` 按 `seq` 排序；单击节点 → `editor.backfill()` 回填工具 store → 确认后 `editStatement` | `src/engine/components/panels/TimelinePanel.tsx:68-99, 221-241` |
| Undo | 意图快照（Tier A 含 sceneScript）+ VersionStore 版本指针；与执行引擎解耦，恢复后靠 `runtime.update` 重算 | `src/stores/serialization/undo-store.ts:236-339` |
| 拓扑消费 | 四张物理隔离 Map（stepRuntimes/glbRuntimes/primitiveRuntimes/meshRuntimes）+ `topologySources` 静态定位，无优先级回退；BREP 真拓扑由 ScriptEngine 调 `runtime.buildBrepTopology` 写入 | `src/stores/core/topology-store.ts:72-93, 235-275`；`ScriptEngine.ts:596-630` |
| STEP 导出 | `exportMeshesToStepBrepAware` 逐 mesh 查 `ScriptEngine.exportSolidCache`（scopedId 键，纯读） | `src/engine/exporters/index.ts:687-716` |
| 装配/分组 | 预览调 faijs `previewAssembly`；确认后 transform flush 成 rotate/translate 语句 + assembly/do_assemble 语句入 DAG；**语句构建已走 features 模块**（`buildAssemblyStatement/buildDoAssembleStatement/buildGroupStatement`），model-store 只保留占位/成环校验、undo、选中与树重建编排；**场景树层级由 `buildCombinedTree` 从 DAG 的 group/assembly 语句重建，成员 mesh 在 canvas 各自独立显示**——与"compound shape 每个子对象都显示 + 场景树层级"的要求同构 | `src/stores/tools/assemble-store.ts`；`model-store.ts:1179-1254, 1401-1492`；`features/assembly.ts`、`features/group.ts` |
| 命名分配 | partN_vM/grp_N 完全委托 faijs `allocateStatementId`，3d_editor 无本地命名逻辑（调用点已内聚到 `features/*.ts` 的 buildStatement 与 `ScriptEngine.recordShape`） | `features/*.ts`；`ScriptEngine.ts:359-375`；`model-store.ts:1445-1453` |

### 1.3 现状的关键含义（方案设计约束）

1. **3d_editor 的 ScriptEngine 主路径已经完全走 `CadRuntime.execute/append/update`**——只要保持这三个入口的签名与 `ExecutionResult` 结构稳定，执行内核怎么换，宿主主路径零改动。这是"尽量少改 3d_editor"的最大杠杆。
2. **deprecated 消费集中在三条手工执行循环**（executeScript/executeScriptDiff/execute-validator），与 ScriptEngine 主路径无关，可独立歼灭。
3. **StmtId 与 partName 的混同是现状事实**（`parser.ts:284`），v9 要求分离——这会触及 `terminalToScopedId` 的键语义，是宿主侧最大的适配点，必须单独成阶段。
4. **`_vM` 版本号只存在于 `allocate-id.ts` 一个文件**（parser/codegen 对 id 无格式假设，只当是标识符），改命名规则的成本集中在 allocate-id + 宿主录制侧调用点。
5. **plan() 不感知 params 变化**是现有缺陷；VM 方案里参数即变量，可顺带根治。
6. **`add_constraint` 不生效**是现有缺口；装配对象化（compound Shape 的身份槽持有约束列表）可顺带根治。
7. **feature v3 重构已落地**（2026-08-25 晚）：Feature 层已是"每 op 一个自包含模块 + byType/byOp/byCommandType 三 Map 注册表"，`ScriptEngine` 无 op 名分支，model-store 的装配/分组语句构建也已走 features 模块。这与 stdlib 化方向天然契合——stdlib 函数名即 op 名，Feature 注册表按函数名识别，"一个 Feature 对应一个 op（未来：一个 function）"正是本方案 Phase 4 的形态。本方案对宿主的适配点相应从旧"feature-registry.tsx"转移到 `features/*.ts` 各模块。
8. **场景树的 group/assembly 层级已经是"成员各自显示 + 树内层级"**（`buildCombinedTree` 从 DAG 语句重建）——用户规定的 compound shape 显示语义在宿主侧已有同构实现，引擎侧只需把 compound 结构随执行结果输出，宿主从"读 DAG 语句 args.members"演进为"读执行结果的 compound 结构"，显示链路不变。

---

## 2. 目标架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 语言层   .faijs（UI/AI 共同编辑：无类型、顶层无控制流）             │
│          .faits（AI 专用：带类型，sucrase 去类型后同管道）          │
├─────────────────────────────────────────────────────────────────┤
│ 引擎 @faicad/faijs                                               │
│   L0 parser / codegen / compileToModule（零 op 知识）              │
│   L2 ModuleExecutor（JS VM 加载与增量调度）                        │
│        CadRuntime 三入口（对外契约不变）                            │
│        ExecContext 实现 + Shape 身份槽记账（WeakMap）               │
│   L1 内核平台（不含任何 op 名知识）：                                │
│        occt-kernel 封装 / manifold loader / csg·sdf backend /     │
│        brep 底层算子 / topology 构建算法                            │
├─────────────────────────────────────────────────────────────────┤
│ 标准库 @faicad/faijs/stdlib                                      │
│   全部官方 op 的库函数（自 src/ops/** 迁出）                        │
│   每个 op 一个文件：参数自校验 + resolvePath + mesh/brep 双实现      │
│   共享 internal：resolvePath / geom 查询 / compound（group·装配）  │
├─────────────────────────────────────────────────────────────────┤
│ 第三方库  任意 .js/.faits 模块，遵守"末参 exec"约定（后续阶段）      │
└─────────────────────────────────────────────────────────────────┘
```

**红线（与 v9 一致，本方案继承）**：

1. 引擎 `src/` 下不存在任何以 op 名命名的分派/校验/能力代码；`src/ops/` 整目录迁出。
2. 内核平台（`src/occt-kernel/`、`src/mesh/` 内核封装、`src/brep/` 底层算子、`src/topology/` 构建算法）保留在引擎侧，是库函数调用的底料，**不含 op 名知识**。
3. BREP/mesh 路径由静态规则在执行前判定，禁止运行时 try-catch 回退（继承两项目既有红线；stdlib 的 `resolvePath` 在**调用前**抛错）。
4. 先解析后执行。`.faijs` 文本永远先过 parser 校验；VM 执行的文本是**从校验过的 IR 生成的**，不是用户原文。

---

## 3. 核心设计（接口设计，本文档独立重新设计）

### 3.1 编译产物：零 import 的 ESM 模块

`compileToModule(script: PartScript): string`（`src/lang/compile.ts` 新增）把 PartScript 编译为**不含任何 import 语句**的 ESM 文本：

```js
// 编译产物示例（由 IR 生成，非用户原文）
export const statements = [
  { id: 's1', deps: [],
    fn: async (ctx, cad, exec) => {
      ctx.r = 20
    } },
  { id: 's2', deps: ['s1'],
    fn: async (ctx, cad, exec) => {
      ctx.part0 = await cad.box({ size: [10, 2 * ctx.r, 5] }, exec)
    } },
  { id: 's3', deps: ['s2'],
    fn: async (ctx, cad, exec) => {
      ctx.part0 = await cad.drill(ctx.part0, {
        depth: 3,
        position: cad.faceCenter(ctx.part0, [5, 20, 2.5], 2, exec),
      }, exec)
    } },
  { id: 's4', deps: ['s2'],
    fn: async (ctx, cad, exec) => {
      const { front, back } = await cad.split(ctx.part0, { /* ... */ }, exec)
      ctx.part1 = front; ctx.part2 = back
    } },
]
```

设计要点：

1. **三参签名 `(ctx, cad, exec)`**：`ctx` 是持久变量容器（跨增量执行存活）；`cad` 是 stdlib 命名空间对象（引擎在加载后注入，见 3.2）；`exec` 是 ExecContext（见 3.3）。**编译产物零 import 是关键决策**——Node 的 `data:` URL 与浏览器的 Blob URL 动态 import 都无法解析裸说明符（bare specifier），零 import 使模块在两个平台都能直接 `import()`，无需 import map、无需打包器配合、无需文件系统。
2. **每条语句一个 fn + 显式 `deps`**：deps 由 parser 提取的 inputs（shape 引用）+ args 中的 `$param` 引用共同计算（见 3.5）。增量调度按 deps 图，不再靠文本顺序隐式推断。
3. **参数即变量**：`const r = 20` 编译为一条普通语句（`ctx.r = 20`）。表达式原样保留为 JS 表达式，由 JS VM 求值——这天然获得 v9 §5.4 要求的表达式能力。
4. **变量引用编译为 `ctx.x`**：fn 体内所有对脚本变量的引用编译为 `ctx.` 属性访问。这让"重新赋值同一变量"（原地语义）成为合法的 JS，且终端判定只需遍历 ctx（见 3.6）。
5. **赋值给 ctx 而非模块级 const**：模块级 `const` 无法跨模块重载存活，也无法支持原地重赋值；ctx 容器是增量执行（append/update）的必要结构（此点与 v9 一致）。
6. `id`（StmtId）与 ctx 键（partName）**彻底分离**：`id: 's3'` 是语句唯一标识；`ctx.part0` 的 `part0` 是变量名。一条语句的左值数量 = 写入 ctx 的键数量（0 个、1 个、split 的 2 个）。

### 3.2 ModuleExecutor：加载与调度

`src/cad-runtime/module-executor.ts`（新增）：

```ts
export interface CompiledStatement {
  id: StmtId
  deps: StmtId[]
  fn: (ctx: Record<string, unknown>, cad: StdlibNamespace, exec: ExecContext) => Promise<void>
}

export class ModuleExecutor {
  readonly ctx: Record<string, unknown>          // 持久变量容器
  private stmts = new Map<StmtId, CompiledStatement>()
  private cache = new Map<StmtId, { key: string }>()  // statementKey 缓存（增量判定）

  /** 加载编译产物：Node 用 data: URL，浏览器用 Blob URL（产物零 import，两平台同构） */
  async load(code: string): Promise<void>
  /** 全量执行（按 deps 拓扑序 = 语句表顺序） */
  async executeAll(exec: ExecContext): Promise<void>
  /** 只执行指定语句（append：前缀已在持久 ctx） */
  async executeIds(ids: StmtId[], exec: ExecContext): Promise<void>
  /** 从变更点起重执行（update：plan 得出 stale 集） */
  async executeFrom(staleIds: Set<StmtId>, exec: ExecContext): Promise<void>
  /** ctx 回收：删除"定义语句已不在脚本中"的变量并释放其占用的内核资源（undo 删除语句后的必需动作） */
  reconcileCtx(activeStmtIds: Set<StmtId>, writeSets: Map<StmtId, PartName[]>): void
}
```

**CadRuntime 三入口保持不变**（`src/cad-runtime/runtime.ts` 重写内部，签名与 `ExecutionResult` 结构不变）：

| API | 内部行为 |
|---|---|
| `execute(script)` | compileToModule → executor.load → executeAll → collectResult |
| `append(script, newIds)` | compile → load → executeIds(newIds) → collectResult |
| `update(script)` | compile → load → plan() 得 stale 集 → reconcileCtx → executeFrom → collectResult（兜底全量） |

`plan()` 逻辑（statementKey + stale 级联）从 IR 计算，与执行方式无关，原样保留并扩展（见 3.5）。

### 3.3 ExecContext：双内核（回答 v9 内联疑问）

v9 文档中用户批注："明明提到了两个几何内核，且同时存在，为何这里只有一个？"——v9 的 `ExecContext.kernel` 只暴露 OCCT。本设计的答案：**两个内核都暴露，且地位对称**。

```ts
// @faicad/faijs 导出（引擎侧平台 API，op 无关）
export interface ExecContext {
  /** 用户全局模式设置 */
  readonly mode: 'auto' | 'brep' | 'mesh'

  /** 几何内核（两个，同时存在，地位对称） */
  readonly kernels: {
    /** BREP 内核：OCCT。mesh 模式或未初始化时为 null；库函数 brep 路径自取 */
    readonly occt: OcctKernel | null
    /** mesh/CSG 内核：manifold-3d 后端（浏览器可在 Worker，宿主经 createBrowserPorts 的 useWorker 选项决定位置） */
    readonly csg: CsgBackend
    /** SDF 内核 */
    readonly sdf: SdfBackend
  }

  /** BREP 链记账（按 Shape 身份，不按变量名，见 3.4） */
  getSolid(shape: Shape): SolidHandle | undefined
  setSolid(shape: Shape, solid: SolidHandle): void

  /** 面演化映射（布尔/变换的 *WithHistory 产物，供 $geom faceOrdinal 稳定性） */
  getFaceEvolution(shape: Shape): Map<number, number[]> | undefined
  setFaceEvolution(shape: Shape, evo: Map<number, number[]>): void

  /** 变更型库调用（装配）：查询某 Shape 的传递下游当前值（引擎按 deps 图计算） */
  dependentsOf(shape: Shape): Shape[]
  /** 变更型库调用：声明该 Shape 被原地修改（引擎据此把持有它的变量列入 changed，通知宿主刷新） */
  touch(shape: Shape): void

  /** 平台能力（自现 HostPorts 演进，与具体 op 无关） */
  readonly fonts: FontProvider
  readonly texture: TextureSampler
  readonly assets: AssetResolver
  readonly events: EventSink
}
```

要点：

1. **csg/sdf 后端不是"内部细节"而是平台能力**——现状 `HostPorts.csg/sdf` 本来就是注入点（`src/cad-runtime/ports.ts:182-189`），Worker/Inline 的选择由 `createBrowserPorts({useWorker})` 在组装时决定，库函数不感知位置。这同时回答了契约文档"host 可以要求几何计算是 inline 还是 worker"的需求。
2. **链记账全部按 Shape 身份**（`getSolid(shape)` 而非 `solidCache.get(partName)`）——这是与现状 `Map<PartName, ShapeHandle>` 的本质区别，使库函数完全不需要知道变量名，也让命名规则（3.8）可以独立演化。
3. `dependentsOf/touch` 替代现状 `propagateTransformDownstream`（`src/ops/assemble.ts:321-351`），且**同时覆盖 mesh 与 BREP solid**（现状只传播 mesh，是已知缺陷——装配变换后下游 solid 未同步变换）。

### 3.4 Shape：类型化构造器 + 身份槽（WeakMap 记账）

```ts
// @faicad/faijs 导出（引擎平台 API）
export function solid(mesh: MeshData): Shape        // kind: 'solid'
export function shape2d(data: Shape2DData): Shape   // kind: 'shape2d'
export function curve(data: CurveData): Shape       // kind: 'curve'
export function compound(children: Shape[]): Shape  // kind: 'compound'（group/assembly 的产物，见 3.10）
export function isShape(v: unknown): v is Shape
```

1. **库函数的产物必须经构造器创建**。`isShape` 只认构造器产物（内部以 WeakSet 登记），这是终端判定（3.6）的唯一依据。数字、undefined 等非 Shape 值不显示。
2. **compound 是 Shape 的一种**（用户规定）：`kind: 'compound'`，持有 `children: Shape[]`（成员 Shape 的引用，不复制几何）。它自身**没有独立 mesh**——几何由 children 承载；它的意义是结构（层级）而非新几何。compound 可以嵌套（group 的成员是另一个 group）。
3. **引擎用 `WeakMap<Shape, Slot>` 挂身份槽**：`Slot = { solid?: SolidHandle; faceEvolution?: ...; meshShape?: WasmMesh; behavior?: AssemblyBehavior }`。现状按 PartName 键控的 `solidCache`/`faceEvolutionCache`/`meshShapeCache`（`brep-chain.ts:102-136`）全部迁移为身份槽；`behavior` 槽是装配 compound 专有（约束列表 + 求解方法，见 3.10）。
   - 收益一：库函数签名里没有变量名，op 实现与命名体系解耦。
   - 收益二：`ExecutionResult.brepSolids`（宿主 STEP 导出依赖）在执行收尾时**从 ctx 派生**：遍历活跃变量 → isShape → 读槽 → 按 partName 组装，对外结构不变。
   - 收益三：同一 Shape 被多个变量引用（`ctx.a = ctx.b`）时天然共享实体，不再有按名复制的歧义。
4. **资源释放（顶替语义保持）**：语句 fn 执行成功后，对该语句重赋值的变量，若旧 Shape 不再被任何 ctx 变量引用且非终端，释放其 OCCT 句柄；fn 抛错则不释放（失败天然回滚）。与现状"顶替释放预捕获"（`runtime.ts:334-369`）语义等价。引用计数在引擎侧按 ctx 扫描计算（变量数 << 几何数据量，成本可忽略）。**compound 引用成员不计入"占用"**——成员 Shape 的生命周期由它自己的变量决定，compound 只是结构引用；成员变量被回收时，引用它的 compound 一并失效（reconcileCtx 按写集级联）。
5. 宿主持有的 `_exportSolidCache` 语义不变（终端 solid 只读映射）；宿主在重新执行某 part 前 delete 旧键的现有做法继续成立。

### 3.5 依赖图与增量执行（顺带根治 plan 不感知 params 的缺陷）

1. **deps 的构成**：parser 在提取每条语句时，除了 inputs（shape 引用），同时收集 args 中的全部 `$param` 引用。编译期把"被引用的变量名"翻译为"定义该变量的语句 id"，写入 `deps`。`$geom` 的 `of` 同样计入（现状已如此，runtime.ts:1450-1515 的 GeomRef 扫描逻辑上移到 parser/编译期）。
2. **plan() 扩展**：`statementKey` 维持 `op | JSON(args) | 各依赖的 outputContentKey`；由于参数声明本身是语句（3.1 要点 3），**改参数 = 参数语句的 key 变化 → 经 deps 级联使全部引用语句 stale**。现状"plan 不感知 params 变化"（`runtime.ts:128-139` 只含 shape inputs 的 contentKey）的缺陷随之根治——Timeline 改参数触发 `editStatement → update` 的路径行为更正确。
3. **ctx 回收（reconcileCtx）**：`update` 前先计算"脚本中每条语句的写变量集合"，ctx 中不属于任何存活语句写集的变量被删除并释放资源。这是 undo 删除语句后重算的正确性前提（现状解释器每次 execute 建局部 outputCache 规避了此问题；VM 持久 ctx 必须显式回收）。

### 3.6 终端判定（canvas 显示什么）

**规则（继承 v9/思考.md，作为静态约定）**：执行完成后，遍历 ctx 中所有活跃变量，凡 `isShape(value)` 即为终端，显示在 canvas。

- "活跃"= 当前 ctx 中存在的顶层变量（reconcileCtx 之后）。
- 非 Shape 值（参数、数字、undefined）不显示。
- **compound Shape（group/assembly 的产物）是 Shape → 是终端 → 在 UI 显示**（用户规定）。显示方式由 UI 层自己决定：**每个子对象都显示**（成员 mesh 本来就在 canvas——成员变量自身也是活跃 Shape、也是终端），**场景树显示层级结构**。compound 不产生任何新 mesh，它只带来结构信息；canvas 渲染集合不变，场景树多一个层级节点。
- **执行结果携带 compound 结构**：`ExecutionResult` 增加 `compounds: Map<PartName, PartName[]>`（compound 变量名 → 成员变量名列表，由引擎收尾时从 compound 的 children 反查 ctx 变量名生成）。宿主据此建场景树层级——替代现状"从 DAG 语句 args.members 重建"（`buildCombinedTree`），层级数据来源从文本层移到执行结果层，与几何提交链路（`commitSceneResult` 只提交叶子）自然对齐：**compound 终端本身不做几何 commit**（无独立 mesh），只驱动场景树结构。
- 裸调用（无赋值的 `asm1.doAssemble(exec)` 式语句）不产生终端——Timeline 不显示（与现状"do_assemble 的 op 未注册 Feature → 不显示"一致，见 §1.2 Feature 层）。
- 删除现状 `computeTerminalShapes` 的 DAG 活跃性推导（`parser.ts:829-876`）与 `returnType` 四类分类。`.faijs` 顶层禁止控制流（语言约束不变），保证该静态规则不被 AI 代码破坏。
- **3d_editor 的 `commitSceneResult` 目前只提交 DAG 叶子**，与"活跃 Shape 变量即终端"在 UI 生成代码（partN 命名规则）下等价；ExecutionResult.terminals 改由本规则产出，宿主消费方式不变。

### 3.7 StmtId 与 partName 分离（改正 v9 指出的不一致）

1. **StmtId**：编译期按语句顺序分配 `s1, s2, ...`（稳定规则：同一份 PartScript 编译结果相同）。它是语句的唯一标识，供 Timeline、增量调度、plan 缓存键使用。PartScript 持久化时 StmtId 可写回 CadStatement.id。
2. **partName**：变量名，0 到多个/语句。split 一条语句有 front/back 两个 partName；`do_assemble` 零个。
3. **改正点**：现状 `parser.ts:284` 的 `asStmtId(varName)`（id=变量名）废弃；`varToId` 恒等映射（parser.ts:708）废弃。parser 改为：变量名记入 `stmt.outputs`（赋值目标列表），StmtId 独立分配。
4. **宿主映射表调整**（Phase 3）：`terminalToScopedId` 的键从"stmtId（今天恰好=partName）"改为**显式的 partName**；Timeline 节点键用 StmtId；`findTerminalStatementId(scopedId)` 改为"反查 partName → 找最后一次写该变量的语句"。

### 3.8 变量命名规则（UI 代码生成遵守的静态规则）

1. **语言层**：变量名只需是合法 JS 标识符。引擎与解析层不附加任何格式约束。
2. **UI 生成代码**：统一 `partN`（N 为整数序号），废弃 `_vM` 后缀。规则：
   - 输入 1 shape、输出 1 shape（translate/rotate/scale/drill/extrude/engrave/knurl）：**不改变变量名**，UI 生成 `part0 = cad.drill(part0, {...})`。
   - 输入无 shape、输出 1 shape（box/sphere/cylinder/...）：**新变量名**，N = 当前最大序号 + 1。
   - 输入输出 shape 数量不同（split 1→2、boolean 2→1）：**新变量名**，按输出数量分配新序号。
3. **`allocate-id.ts` 重写**为上述三条规则（删除版本号递增逻辑）；`allocateSplitIds` 语义不变（两个新 partN）。
4. **存量 .faijs 文件兼容**：`part0_v1` 是合法 JS 标识符，旧文件原样可解析、可执行——变量名只是字符串，引擎不解释格式。旧文件加载后继续以旧名演化（新语句沿用"同变量重赋值"规则），无需迁移工具。
5. `faits`/AI 代码不受 partN 约束（语言层只要求合法标识符）。
6. `grp_N` 取消：group/assembly 返回 compound Shape（见 3.10），是有赋值、有终端的普通语句；输入是 n 个成员 shape、输出是 1 个 compound shape——按"输入输出 shape 数量不同"规则**分配新 `partN`**，与其它语句同规则，不再有独立的 grp 命名族。

### 3.9 参数与表达式：$param / $geom / $asset 的编译翻译

| 现状 IR | 编译产物 | 说明 |
|---|---|---|
| `const r = 20` → ParamDef | 参数语句 `ctx.r = 20` | 参数即变量（3.1） |
| `{ $param: 'r' }` | `ctx.r` | 依赖计入 deps（3.5） |
| `{ $geom: {of, feature, anchor?, faceOrdinal?} }` | `cad.faceCenter(ctx.part0, [x,y,z], 2, exec)` 等 | **$geom 从引擎魔法变为 stdlib 查询函数**（`src/stdlib/geom.ts`），末参 exec；内部保留现状解析链：faceOrdinal+BREP 优先 → anchor 反查 → 报错（`geom-ref.ts:39-114` 逻辑迁移） |
| `{ $asset: 'key' }` | `await cad.asset('key', exec)` | stdlib 查询函数，经 `exec.assets` 解析；因 fn 是 async，实参位置可 await |
| 算术/数组/对象表达式 | 原样保留 | JS VM 求值 |

parser 的提取职责不变（依赖分析需要），但**引擎执行期不再知道 $param/$geom/$asset 的存在**——dispatcher 的 `resolveArgs`（`dispatcher.ts:34-76`）整体删除。

### 3.10 结构型与变更型：group / assembly / add_constraint / do_assemble（compound Shape）

group 与 assembly 的产物是 **compound Shape**（用户规定：属于 shape，在 UI 显示）。引擎只提供 `compound()` 构造器与身份槽；行为（约束、求解）全部在 stdlib。脚本语法保持契约文档 §10.2 规定的链式形态不变：

```js
// 编译产物
{ id: 's7', deps: ['s2','s5'], fn: async (ctx, cad, exec) => {
    ctx.part4 = cad.assembly({ name: 'A', members: [ctx.part0, ctx.part3] }, exec)
    // 返回 compound Shape：kind='compound'，children=[part0 的 Shape, part3 的 Shape]
    // 身份槽挂 AssemblyBehavior { constraints: [] }；
    // stdlib 在 Shape 上附加 add_constraint/do_assemble 方法（闭包持有 behavior）
} },
{ id: 's8', deps: ['s7'], fn: async (ctx, cad, exec) => {
    ctx.part4.add_constraint({ type: 'face_mate', /* ... */ })
    // 方法把约束写入 part4 身份槽中的 behavior.constraints
} },
{ id: 's9', deps: ['s8'], fn: async (ctx, cad, exec) => {
    await ctx.part4.do_assemble(exec)
    // 方法：求解 + 变换成员 + 下游传播 + touch
} },
```

1. **`cad.assembly({name, members}, exec)` 返回 compound Shape**：经 `compound(children)` 构造器创建（`isShape` 为 true → 是终端、在 UI 显示，3.6）；随后 stdlib 在其身份槽挂 `AssemblyBehavior`（约束列表等），并把 `add_constraint`/`do_assemble` 作为方法附加到该 Shape 对象上（闭包持有 behavior 与 shape 引用）。引擎只看见一个 Shape，不感知 behavior 内容。
2. **`add_constraint` 直接写身份槽的约束表**——**根治现状"add_constraint 语句的约束无合并逻辑、do_assemble 变 no-op"的缺口**（`assemble.ts:426-427`）。重放时语句按序执行，compound 被确定性重建，约束积累过程可重放。parser 对方法调用形态的既有支持（`parser.ts:744-785`）保留，方法名白名单从硬编码的 `add_constraint/do_assemble` 放宽为"接收者是已声明变量即可"（行为由 stdlib 对象决定，引擎不校验方法名）。
3. **`do_assemble`**：stdlib 内部求解（现状 `solveFaceMate` 逻辑迁入），对成员 Shape 施加刚体变换（mesh 顶点烘焙 + 在链 solid 经 `exec.getSolid/setSolid` 同步变换），再经 `exec.dependentsOf(member)` 取传递下游施加同一变换（**mesh 与 solid 都覆盖**，根治现状只传播 mesh 的缺陷），最后 `exec.touch(shape)` 声明变更。引擎在执行该语句 fn 后按 touched 集合把持有这些 Shape 的变量列入 `ExecutionResult.changed`，宿主据此刷新/commit。
4. **`group` 同理但更简单**：`cad.group({name, members}, exec)` 返回 compound Shape，无 behavior 槽、无附加方法、无几何副作用，纯粹是层级结构。
5. **members 计入 deps**：group/assembly 语句的成员引用与普通 inputs 一样进入依赖图（编译期从 args.members 提取），成员重算 → compound 随之 stale 重建；`dependentsOf` 的下游查询也覆盖经 compound 的传递链。
6. **UI 显示**：compound 终端在 canvas 的呈现 = 每个子对象各自显示（成员本来就是独立终端）；场景树的层级结构由宿主从 `ExecutionResult.compounds` 构建（3.6），与现状 `buildCombinedTree` 产出的树形同构。
7. 约束求解器的多约束联合求解（契约 §10.1 的长期方向）是 stdlib 内部演进，不影响引擎接口。

### 3.11 brep / mesh / auto：resolvePath（静态判定红线保持）

`src/stdlib/internal/resolve-path.ts`（stdlib 内部共享，第三方库可 import 或自行实现同规则）：

```ts
export function resolvePath(
  exec: ExecContext,
  inputs: Shape[],
  brepImpl: unknown | undefined,
): 'brep' | 'mesh'
```

规则（与 v9 §4.1 一致，语义对照现状 `canUseBrep`，`src/ops/types.ts:66-72`）：

1. `mode='mesh'` → mesh（所有 op 必须实现 mesh 路径）。
2. `mode='brep'` → 无 brepImpl 则**调用前抛错**；有 brepImpl 但输入不全在链（`exec.getSolid`）也**调用前抛错**——替代现状 `MESH_ONLY_OPS` 集合与 runtime 特判（`runtime.ts:301-330`），判定位置从引擎移到库内，时序仍是"执行前"。
3. `mode='auto'` → 有 brepImpl 且全部输入在链 → brep；否则 mesh（空输入的创建类 `[].every()===true`，与现状一致）。
4. **禁止运行时回退**：brep 路径执行抛异常 = bug，直接报错暴露（两项目既有红线，不变）。

库函数典型形态（以 drill 为例，`src/stdlib/drill.ts`）：

```ts
import { solid, type ExecContext, type Shape } from '@faicad/faijs'
import { resolvePath } from './internal/resolve-path'

export async function drill(input: Shape, params: DrillParams, exec: ExecContext): Promise<Shape> {
  // 参数自校验（无集中 schema；不合法即抛错）
  assertDrillParams(params)
  const path = resolvePath(exec, [input], drillBrep)
  if (path === 'brep') {
    const out = await drillBrep(exec.kernels.occt!, exec.getSolid(input)!, params)
    const shape = solid(out.mesh)
    exec.setSolid(shape, out.solid)
    exec.setFaceEvolution(shape, out.faceEvolution)
    return shape
  }
  return solid(await drillMesh(exec.kernels.csg, input, params))
}
```

### 3.12 拓扑：执行结果直接携带（补契约缺口 E13）

1. **BREP 真拓扑**：`ModuleExecutor` 收尾时，对"本次执行发生变化且仍在 BREP 链上"的终端，自动调引擎内部 `buildBrepTopology`（现状逻辑 `runtime.ts:923-942` 保留，复用身份槽中的 `meshShape` 三角化缓存，保证拓扑 mesh = 显示 mesh）填入 `ExecutionResult.topology`。增加 `ExecuteOptions.topology?: 'auto' | 'none'`（默认 `'auto'`），不需要拓扑的调用方（如纯几何测试）可关闭。
2. **假拓扑**（primitive 参数拼凑 / STL·3MF 特征检测）：维持现状——宿主在加载/创建时刻构建（这两个时刻的输入不在引擎执行流程内），经 `runtime.setTopology` 注入；引擎透传。**假拓扑不重新生成**的契约规则不变。
3. **宿主收敛**（Phase 2）：3d_editor 的 `_rebuildBrepTopology`（ScriptEngine.ts:596-630）从"调 buildBrepTopology + setStepRuntime"改为"读 `ExecutionResult.topology` + setStepRuntime"；`buildSelectorRuntime`/`buildSelectorRuntimeData`/`buildFaceIdsForPart` 继续仅用于 GLB/primitive/mesh 假拓扑路径（E13 临时放行段相应缩小）。

---

## 4. 分阶段实施

原则：**每个阶段结束后两项目 CI 全绿**；faijs 先发版（npm pack + 3d_editor 更新 tgz 引用），再改 3d_editor（契约文档 §开发流程）。

### Phase 1：JS VM 执行（op 仍内置，宿主零改动）

**目标**：`CadRuntime` 内部从"解释器主循环 + dispatcher switch"换成"compileToModule + ModuleExecutor"，对外签名、`ExecutionResult`、`PartScript`、`partN_vM` 命名、`returnType` 全部不变。

**faijs 任务**：

| # | 任务 | 文件 |
|---|---|---|
| 1.1 | 新增 `compileToModule(script): string`：从 PartScript IR 生成 3.1 格式的零 import ESM 文本。$param/$geom/$asset 按 3.9 翻译；**翻译目标暂时是内部适配命名空间**（见 1.4） | `src/lang/compile.ts`（新增） |
| 1.2 | 新增 `ModuleExecutor`（ctx 持久容器、data:/Blob URL 加载、executeAll/executeIds/executeFrom、reconcileCtx） | `src/cad-runtime/module-executor.ts`（新增） |
| 1.3 | 新增 `ExecContext` 实现：双内核 + WeakMap 身份槽记账 + dependentsOf/touch；底层复用现有 brepChain 数据结构（Phase 1 不动 `BrepChainState`，身份槽作为其上的薄适配） | `src/cad-runtime/exec-context.ts`（新增） |
| 1.4 | **内部适配命名空间**：把现有 dispatcher 的每个 case 包装成 `(inputs..., params, exec) => Promise<Shape>` 形态的函数对象，作为 `cad` 注入。此层是临时的（Phase 2 删除），但让 VM 执行先行落地 | `src/cad-runtime/internal-stdlib-adapter.ts`（新增） |
| 1.5 | `CadRuntime.execute/append/update` 重写到 ModuleExecutor；plan() 扩展 deps（参数语句化）；`ExecutionResult` 结构不变 | `src/cad-runtime/runtime.ts`（改内部） |
| 1.6 | parser 扩展：StmtId 独立于变量名分配（写入新字段，暂保持 id=变量名的兼容填充）；收集 $param 依赖 | `src/lang/parser.ts` |
| 1.7 | deps 级联的 plan 单测：改参数语句 → 下游 stale | `src/cad-runtime/*.test.ts` |

**3d_editor 任务**：无（仅更新 tgz 引用）。

**验收**：
- faijs 全量 vitest 绿（含 BREP↔mesh parity 对拍）；`scripts/ci.ps1` 绿。
- 3d_editor 分层测试绿（lint → tsc → vitest → 组件测试 → 相关 e2e），证明 VM 执行与解释执行行为等价。
- 性能基准：execute/append/update 与现状同数量级（编译产物缓存，同 script 重编译跳过）。

### Phase 2：op 迁出为 stdlib + deprecated 面歼灭

**目标**：`src/ops/` 整目录迁出为 `src/stdlib/`；包新增 `./stdlib` 子路径；引擎零 op 知识；3d_editor 的三条手工执行循环与 deprecated import 全部歼灭。

**faijs 任务**：

| # | 任务 | 文件 |
|---|---|---|
| 2.1 | `src/ops/*.ts` → `src/stdlib/*.ts`，每 op 改写为 3.11 形态（参数自校验 + resolvePath + 末参 exec）；op 内的 `outputCache` 多输出写入（split）改为返回具名对象 | `src/stdlib/`（新目录） |
| 2.2 | `resolvePath` + `assertXxxParams` 模式落地；`SCHEMAS` 从 `src/lang/args-schema.ts` 迁到 `src/stdlib/schemas.ts`（每 op 文件导出自己的 schema，stdlib 聚合）；`validateStatementArgs` 框架保留在 lang 层但改为"对给定 schema 表校验"的纯函数；`CadRuntime.check()` 接受 stdlib schema 表注入 | `src/stdlib/internal/`、`src/lang/args-schema.ts` |
| 2.3 | `resolveGeomRef` → `src/stdlib/geom.ts` 查询函数族（faceCenter/faceNormal/bboxCenter/bboxMin/bboxMax，末参 exec） | `src/stdlib/geom.ts` |
| 2.4 | group/assembly 迁入 `src/stdlib/compound.ts`：`group`/`assembly` 返回 compound Shape（3.10）；装配三件套（solveFaceMate/executeDoAssemble/previewAssembly）迁入并挂到 AssemblyBehavior；`ExecutionResult.compounds` 结构输出 | `src/stdlib/compound.ts`、`src/cad-runtime/` |
| 2.5 | 删除 `src/ops/`（dispatcher、types、内部适配命名空间 1.4）；`brep-chain.ts` 的 `BREP_NATIVE_OPS`/`MESH_ONLY_OPS` 两个 Set 删除（能力声明内化到各库函数的 brepImpl 存在性） | `src/ops/`、`src/brep/brep-chain.ts` |
| 2.6 | `ExecutionResult.topology` 自动携带 BREP 真拓扑（3.12），`ExecuteOptions.topology` 开关 | `src/cad-runtime/` |
| 2.7 | 包结构：`exports` 新增 `./stdlib`；`browser.ts` 导出面按 A/B/C/D 收敛（删除 deprecated 区）；`gen-api-dts.ts` 改为从 stdlib schemas 生成；`api-dts-sync.test.ts` 同步守卫落地（补 docs/plans/2026-08-16 记录的漂移风险） | `package.json`、`src/browser.ts`、`scripts/gen-api-dts.ts` |
| 2.8 | `returnType` 四类分类删除；parser 的赋值校验改为基于 stdlib schema 表的可选校验（无表不校验） | `src/lang/types.ts`、`parser.ts`、`args-schema.ts` |

**3d_editor 任务**（E10/E12/E13 歼灭，与 faijs 发版同步进行）：

| # | 任务 | 文件 |
|---|---|---|
| 2.9 | `executeScript.ts`/`executeScriptDiff`/`execute-validator.ts` 三条手工执行循环改用 `CadRuntime.execute/append/update`；删除 `executeStatement/initBrepChainState/releaseBrepChainState/executeAssemblyPassForStmt/resolveGeomRef` import；statement 粒度 undo 保持（每条语句对应一次 append 调用，快照时序不变） | `src/engine/script-engine/executeScript.ts`、`execute-validator.ts` |
| 2.10 | ~~删除死代码 `_computePrimitiveShape`~~（已在 feature v3 重构中删除，本项关闭）；改为：场景树层级构建 `buildCombinedTree` 从"读 DAG 语句 args.members"演进为"优先读 `ExecutionResult.compounds`"，canvas 成员各自显示的链路不变 | `model-store.ts`、`ScriptEngine.ts` |
| 2.11 | `LiveDrillPreview` 的 `cad.drill` dry-run、`EngravingCore` 的 `cad.engrave` 直算：改为从 `@faicad/faijs/stdlib` 显式 import `drill`/`engrave` + 引擎提供的 preview exec（`CadRuntime.createPreviewExec()`，B 类新增）。预览走"明确导出的 stdlib 函数"正路径，符合契约路径 B | `LiveDrillPreview.tsx`、`EngravingCore.ts` |
| 2.12 | `step-converter/index.ts` 的 18 个 OCCT 底层 re-export：改用 `/browser` 已有的高层 `importStep/exportStep` API（browser.ts:97-98 已有），白名单 E12.2 临时段删除 | `src/renderer/lib/step-converter/` |
| 2.13 | BREP 真拓扑改从 `ExecutionResult.topology` 消费；`_rebuildBrepTopology` 简化；白名单 E13 临时段缩小到 GLB/primitive/mesh 假拓扑构建函数 | `ScriptEngine.ts:596-630` |
| 2.14 | `contract-entry.test.ts` 白名单收敛：删除 E10/E12 临时放行段；新增"几何变更走脚本锁定"断言（契约 §11 未建项） | `contract-entry.test.ts` |

**验收**：
- 两项目 CI 全绿；`contract-entry.test.ts` 白名单无临时段。
- grep 验证：3d_editor 生产代码不再 import 任何 deprecated 符号；faijs `src/` 下无 op 名命名的分派/校验代码。
- 装配行为回归：add_constraint 链式约束真实生效（新测试）。

### Phase 3：命名规则与 StmtId/partName 分离

**目标**：UI 生成代码采用 `partN`（废 `_vM`）；StmtId 独立；终端 = 活跃 Shape 变量。

**faijs 任务**：

| # | 任务 | 文件 |
|---|---|---|
| 3.1 | parser/codegen：StmtId 按 `s1..sN` 分配并写回 `CadStatement.id`；变量名记入 `stmt.outputs`；`asStmtId(varName)`/`varToId` 恒等映射删除 | `src/lang/parser.ts`、`types.ts` |
| 3.2 | `allocate-id.ts` 重写为 3.8 三条规则（创建/多输出新名、单入单出复用名） | `src/lang/allocate-id.ts` |
| 3.3 | `computeTerminalShapes` 的 DAG 推导删除，终端判定移入执行收尾（isShape 遍历 ctx）；`ExecutionResult.terminals` 由新规则产出 | `src/lang/parser.ts:829-876`、`src/cad-runtime/` |
| 3.4 | `scriptToCode` 输出原地重赋值形式（`part0 = cad.drill(part0, ...)`，用 `let` 声明） | `src/lang/codegen.ts` |

**3d_editor 任务**：

| # | 任务 | 文件 |
|---|---|---|
| 3.5 | `terminalToScopedId` 键语义从 stmtId 改为 partName（含写入点 `updateTerminalMapping`/split 的 afterRecord/recordTransform/executeScript 整表建立的全部适配）；`findTerminalStatementId` 改为"partName → 最后写入语句" | `script-store.ts`、`ScriptEngine.ts:167-200` |
| 3.6 | Timeline 节点键改 StmtId；backfill 经"scopedId → partName → 当前语句"两段反查 | `TimelinePanel.tsx`、`features/types.ts`（FeatureEditor 协议注释）、各 `features/*.ts` 的 backfill |
| 3.7 | 命名适配：`features/*.ts` 各模块 `buildStatement` 与 `ScriptEngine.recordShape` 的 `allocateStatementId` 调用适配新规则（单入单出 op 复用输入变量名；group/assembly 按数量不同规则分配新 partN，grp_N 取消）；`getLastStatementId` 语义改为"取该 scopedId 当前 partName" | `features/*.ts`、`ScriptEngine.ts:299-375` |
| 3.8 | `executeScriptDiff` 的按 stmtId diff 适配新 id 体系 | `executeScript.ts` |

**验收**：
- 两项目 CI 全绿；旧 `partN_vM` 格式的存量 .faijs fixture 原样通过（兼容性测试）。
- UI 录制-回放-导出-导入全链路 e2e（既有 spec）绿。
- AI 生成代码友好性验证：同模型多特征脚本中变量名稳定（part0 始终是同一模型）。

### Phase 4（展望，不属于本次实施）：.faits 与第三方库

- sucrase 去类型管道（.faits → 同 compileToModule）。
- 编译产物允许 `import` 语句（第三方库），加载机制参考 brepjs 动态加载方案（`C:\git\OpenCascade\brepjs\docs\dynamic-third-party-library-loading_cn.md`）；Node 走文件 URL，浏览器走宿主提供的模块解析回调。
- feature ↔ faijs 函数（带包名）一对一约定，Timeline 直接映射函数调用。

---

## 5. 3d_editor 影响面汇总（按文件）

| 文件 | Phase | 改动 |
|---|---|---|
| `package.json` | 1/2/3 | 更新 tgz 引用 |
| `executeScript.ts` / `execute-validator.ts` | 2 | 手工循环 → CadRuntime 三入口；deprecated import 清零（Phase 3 再适配 stmtId diff） |
| `ScriptEngine.ts` | 2/3 | 拓扑消费改 ExecutionResult；`recordFeature`/`recordShape`/terminal 映射适配命名与 id 分离 |
| `LiveDrillPreview.tsx` / `EngravingCore.ts` | 2 | 直调 cad.* → stdlib 显式 import + preview exec |
| `step-converter/index.ts` | 2 | OCCT 底层 re-export → 高层 importStep/exportStep |
| `ViewportContainer.tsx` / `build-mesh-topology*.ts` / `ModelGroup.tsx` | 2 | 仅假拓扑路径保留 buildSelectorRuntime*（白名单缩小） |
| `script-store.ts` / `TimelinePanel.tsx` / `features/*.ts` | 3 | partName/StmtId 键语义适配（feature 注册表三 Map 结构不变） |
| `assemble-store.ts` / `model-store.ts` | 2/3 | previewAssembly 改从 stdlib import；场景树层级改从 `ExecutionResult.compounds` 构建；createAssembly/createGroup 命名适配（grp_N → partN） |
| `contract-entry.test.ts` | 2 | 白名单收敛 + 几何变更走脚本锁定 |

**明确不改的部分**：undo-store（快照机制与执行内核解耦）、VersionStore/GeometryBinding/CommandPipeline（几何提交链路）、sceneTree 契约（场景树节点 ↔ canvas 对象一一对应）、`features/` 注册表的三 Map 结构与 FeatureDef 协议、WASM 注入时序、`createBrowserPorts` 组装方式。

---

## 6. 测试策略

1. **等价性对拍（Phase 1 核心）**：同一 PartScript 分别经"旧解释器"与"新 VM 执行"跑全量 fixture（`test/faijs/**`），断言 `ExecutionResult.outputs` 逐 part mesh 一致 + brepSolids 键集一致。旧解释器在 Phase 1 期间保留为测试基准，Phase 2 删除。
2. **增量正确性**：append/update/reconcileCtx 的单测（含 undo 删除语句后的 ctx 回收、参数修改级联 stale）。
3. **BREP↔mesh parity**：既有 parity 测试不变，继续在 `beforeAll initOcctWasm()` 下跑；stdlib 化后补"resolvePath 在 brep 模式对 mesh-only op 调用前抛错"的断言。
4. **装配/分组**：add_constraint 链式约束生效测试（现缺口的新覆盖）；dependentsOf/touch 的下游传播（mesh+solid 双覆盖）测试；**compound Shape 终端测试**：group/assembly 语句产物的 `isShape` 为 true、进入 `ExecutionResult.terminals` 与 `compounds` 映射、children 引用与成员变量一致；round-trip（导出→再导入）后 compound 结构与场景树层级一致。
5. **契约测试**：`contract-entry.test.ts` 白名单随 Phase 2 收敛；新增"几何变更走脚本锁定"。
6. **兼容性**：`partN_vM` 存量 fixture 原样通过；`export default async (cad) => {}` 容器与扁平格式均可解析。
7. **测试纪律**：遵守两项目"先跑自己写的测试 → 受影响测试 → CI"的分层流程，严禁跑 CI 找 bug；stderr 零容忍。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| Blob/data URL 动态 import 在某些嵌入 CSP 下被禁（`script-src` 无 blob:/data:） | ModuleExecutor 提供 `new Function` 回退加载器（同等 VM 语义；选择器在 createRuntime 选项）。3d_editor 当前 CSP 无此限制 |
| OCCT 句柄泄漏（身份槽 + 引用计数新路径） | 释放语义与现状"顶替释放预捕获"逐条对拍；CI 的 stderr 检查 + 既有的句柄释放测试覆盖；parity 测试后断言内核对象计数 |
| Phase 3 的键语义切换击穿持久化 .faicad 快照 | terminalToScopedId 随快照序列化，Phase 3 加载旧快照时按"stmtId 即 partName"旧语义解释（旧数据中两者本就相等），无需迁移逻辑 |
| 表达式能力扩大攻击面（编译产物是真 JS） | .faijs 仍先过 parser 白名单语法（无控制流、仅表达式）；编译输入只有 IR，用户原文不进 VM |
| 3d_editor 三条手工循环的行为差异（自管 brepChain vs CadRuntime 持久链） | Phase 2 迁移时以 ScriptEngine 主路径语义为准（不调 releaseBrepChainState）；execute-validator 的无配对 release 直接随删除修复 |
| Worker 中 csg backend 与 stdlib 的异步边界 | 库函数全部 async；parity 测试覆盖 Worker/Inline 两种 ports 组装 |

---

## 8. 非目标（本次不做）

- 约束求解器（多约束联合求解）——stdlib 内部演进，引擎接口已为其留位（compound Shape 的 AssemblyBehavior 身份槽）。
- .faits / sucrase / 第三方库动态加载——Phase 4。
- 3d_editor 的 FeatureScript 风格声明式 UI——`Faijs语言的思考.md` §其他.2 的上层抽象，待执行架构落地后单独立项。
- GLB 只读预览路径的移除（契约既定方向，与本方案无关）。
