# faijs 引擎 ↔ 语言实现（库）契约：重新设计与实施方案

- 日期：2026-08-29
- 状态：设计待裁定（**仅写方案，未改任何代码**）
- 上位文档：`C:\my\Faicad\3d_editor\Faijs语言的思考.md`（语言定位唯一权威）
- 相邻文档：
  - `docs/syntax-design.md`（语法契约，§6.2 统一 ABI 是本文档的主要改造对象）
  - `docs/plans/2026-08-28-faijs-ecosystem-roadmap.md`（生态路线图；本文档推翻其 §3.4 全局锚点与 §4 SDK 两个决策）
  - `docs/plans/2026-08-28-keep-syntax-design.md`（keep 机制；本文档保留其调用点语法，改造其函数体声明机制）
  - `docs/plans/2026-08-29-faijs-platform-api-design.md`（上一版，本文档取代之）
  - `docs/plans/2026-08-29-faijs-normal-js-subset.md`（语言正常化，与本方案并行不悖）
- 参考实现：`C:\git\new\onshape\onshape-std-library-mirror`（Onshape FeatureScript 标准库，265 个 `.fs`）

---

## 0. 需求与约束

### 0.1 用户原话（需求基线，不准删改）

来自 `Faijs语言的思考.md`：

> 4. faijs引擎负责代码的解析与校验，提前杜绝错误和安全风险。但是执行完全交给js虚拟机。
> 5. 几何运算全部交给faijs语言库来实现，faijs引擎不内置。
> 6. faijs不处理UI状态，只处理几何。这是它和freecad宏之类的语言的最大区别。
> 7. faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。

> faijs是通用语言，并不是一个什么op相关的语言。op就是函数，这是长期的方向。未来的第三方库，它就是写代码，实现function。不需要知道什么op这种概念。

> 必需再次强调，faijs必需是正常的语言，必需正常的设计。所有不符合这个要求的设计，都要给我去掉，目前的代码如何实现的不重要。唯一的例外，faijs必需是UI能够自动生成代码，比如AI/UI生成的代码能够和谐共存。

> 先解析后执行， 纯函数链 ， 这两点是过时的说法。

来自本轮澄清（2026-08-29）：

> Faijs与UI的唯一耦合点，是keep语法，也就是指明哪些shape需要保留/显示在UI中。feature特征的定义，绝对不再faijs中，这个在上层的应用中。比如../3d_editor里定义。这是faijs与onshape的最大差别。让你参考onshape的接口定义的时候，不要把feature特征这块抄过来。

### 0.2 由原话推出的硬约束

| # | 约束 | 含义 |
|---|---|---|
| **K1** | **正常语言** | 库函数签名 = 源码里写的样子。禁止隐式注入、禁止全局单例、禁止让库 author 感知"引擎"的存在 |
| **K2** | **几何运算在库** | 引擎不内置任何几何算法。引擎提供的是**调度、记账、资源**，不是 op 实现 |
| **K3** | **keep 是唯一 UI 耦合点** | faijs 不定义 feature、不定义 UI 表单、不定义图标/编辑面板。这些全在 3d_editor |
| **K4** | **纯函数链已过时** | 不能把"op 返回新 Shape、不原地改写"当作推理前提——`compound.ts:222,239` 就在原地改写 |
| **K5** | **引擎零函数知识** | parser/compile/runtime 不得按函数名分支。函数信息只能是**均匀数据** |
| **K6** | **UI/AI 共享一份代码** | 两者收敛到同一 `ScriptIR`，引擎不区分来源 |

> 编号约定：本文档用 **K**（约束）、**S**（从 Onshape 学的原则）、**A/B/C**（接触面）、**F**（禁令）、**P**（分期）、**O**（开放问题）。
> 提到的 **C0/C1/C3/C5** 一律指 `keep-syntax-design.md` 的**消费判定规则**（C0 调用点 keep / C1 函数体 keep / C3 无几何输出推断 / C5 默认消费），与本文档约束编号无关。

---

## 1. 结论速览

| 面 | 现状 | 目标 |
|---|---|---|
| 库函数签名 | `(…args, exec)`，exec 编译期凭空追加 | **`(…args)`**，与源码逐字一致 |
| 平台能力获取 | 运行时从 `exec` 索取 | **装配期依赖注入**（工厂函数 + 闭包） |
| BREP 槽记账 | 库函数手动 `exec.setSolid(...)` | **构造器/包装器登记**，库零记账代码 |
| 双链路分派 | 每个 op 自己调 `resolvePath` | **引擎统一分派**，op 只声明能力 |
| 保留语义 | 运行时 `exec.keep(...)` + WeakMap 反查 | **OpManifest 静态声明** + 调用点 `keep` 语法 |
| 求值型识别 | 运行时推断（C3） | **OpManifest 显式声明** `kind:'query'` |
| 第三方库 | `import { … } from '@faicad/faijs/sdk'` + 全局锚点 | **零依赖，只遵守协议**（协议 ≠ 依赖） |
| 编译产物 | `async (ctx, cad, exec) => {}` | **`async (ctx, ns) => {}`** |
| feature/annotation | —— | **不引入**（K3，用户澄清） |

一句话：**把"库在运行时向引擎索取一切"翻转为"引擎在装配期把依赖交给库"，并把库需要向引擎声明的语义从运行时调用改为静态清单。**

---

## 2. 现状诊断：契约的四层错位

> 判定原则：**声明的契约不是实际契约**。以下每条都附代码证据。

### 2.1 错位一：隐式注入末参（违反 K1）

`compile.ts` 在 4 个发射点机械追加 `, exec`（`:178` `:187` `:192` `:196`），嵌套调用再追加一次（`:84`）。源码 `cad.box({size})` 编译为 `cad.box(ctx.size, exec)`——**调用方没写第三个参数**。

正常语言里没有这种机制：模块导入、全局对象、显式 ctx 参数，exec 三种都不是。

### 2.2 错位二：声明的接口不是实际接口（向下转型）

`ExecContext` 接口（`exec-context.ts:49-90`）有 20 个字段。但库函数实际访问的是**实现类 `ExecContextImpl` 的字段**：

| 位置 | 越权访问 | 是否在接口里 |
|---|---|---|
| `stdlib/drill.ts:143` | `(exec as ExecContextImpl).brepChain.partTransform` | ❌ |
| `stdlib/drill.ts:169` | 同上（mesh 路径） | ❌ |
| `stdlib/compound.ts:263` | `exec.currentStmt?.args?.members` | ⚠️ 在接口里，但 IR 属引擎内部 |
| `exec-context.ts:266` | `setVariable`（`ExecContextImpl` 专有方法） | ❌ |
| `exec-context.ts:141` | `shapeToName` / `:144` `touchedShapes` | ❌ |

**库函数靠 `as ExecContextImpl` 向下转型绕过接口**。这意味着 `ExecContext` 这份"契约文档"是摆设——真正的契约是"整个引擎实现对象都对你开放"。这比隐式注入严重得多：隐式注入至少还是一份有界的 API，这里是**无界**。

### 2.3 错位三：库反向掏引擎内部状态

`compound.ts:257-272` 的 `deriveMemberNames` 在**运行时读 IR**：

```ts
const stmtMembers = (exec.currentStmt?.args?.members as unknown[] | undefined) ?? []
```

函数存在的唯一原因是：**引擎没有把成员变量名传给库，库只能回头去掏语法树**。引擎知道 `args.members` 是 `VarRefIR[]`（`parser.ts` 解析结果），却让库在运行时反解。

同类问题：`exec.currentStmt` 本就是引擎的执行态，库用它只是为了"知道自己在哪条语句"——这是引擎该自己做的事（`BrepUnsupportedError` 带 stmt、`part-brep-lost` 事件带 partName，都应由引擎在调用点补充归属）。

### 2.4 错位四：执行态与持久对象的生命周期冲突

`compound.ts:310-315` 的注释自陈：

```ts
;(c as CompoundShape & { do_assemble?: (e: ExecContext) => void }).do_assemble = (e: ExecContext) => {
  // 用当前执行上下文求解：分次 append（3d_editor appendAndCommit）时
  // 每次 runtime.append 新建 exec，touch/变更声明必须落在当前 exec 上
  behavior.solve(e)
}
```

`assembly()` 闭包捕获了 `exec`（`:307`），但 exec 是**逐次新建**的 → compound 是持久对象、exec 是短命对象 → 只能用"每次显式再传一个 exec"补救。**生命周期不匹配，靠打补丁**。

### 2.5 附：签名无形 + 库干引擎的活

- **签名无形**：`geom.ts:73-79` `faceCenter(...rest)` 用 `rest.pop()` 取 exec——类型系统彻底失效，参数顺序只能靠约定。
- **库干引擎的活**：`compound.ts:237` `exec.dependentsOf(shape)` 是**图算法**（依赖整张 `ScriptIR` + `outputCache`）；`:239` `Object.assign(downstream, applyTransform(...))` 是**手工下游传播**。这两件事都属于引擎（DAG 所有者），却由库实现。

### 2.6 一个被推翻的前提：C3 推断

`keep-syntax-design.md` §3.2 为 C3（"无几何输出 → 不消费输入"）写的论证是：

> faijs 的执行模型是**纯函数链**（op 返回新 Shape，不原地改写……）。在此模型下「返回非几何的函数不可能把几何吞进结果」是必然推论。

用户已明确裁定：**"纯函数链"是过时的说法**（§0.1）。而 `compound.ts:222,239` 的 `Object.assign` 就是原地改写的现实例子。

→ **C3 的推理前提不成立，C3 必须从"运行时推断"升级为"静态声明"**。见 §8.5。

---

## 3. 为什么上一版方案（platform-api）不够

`2026-08-29-faijs-platform-api-design.md` 提出：全局锚点 `globalThis.__FAICAD_FAIJS_RUNTIME__` + `import { keep } from '@faicad/faijs/sdk'`。方向对了一半（取消 exec），但**没有解决根本问题**：

| # | 问题 | 说明 |
|---|---|---|
| **P1** | **隐式注入 → 隐式全局，机制没变** | 把"引擎凭空加的参数"换成"库凭空读的全局变量"，耦合面一点没减，只是藏得更深。且多实例（多个 `CadRuntime`、测试并发、Worker）会互相污染——全局单例比逐调用参数**更危险** |
| **P2** | **三类职责没做分类，一股脑搬走** | exec 里混着三种性质完全不同的东西：①**资源**（kernels/fonts/assets）②**记账**（getSolid/setSolid，引擎代管的资源表）③**意图声明**（keep/touch）。前方案把它们全变成"SDK 导出的函数"，等于承认"库必须在运行时向引擎索取并报告一切" |
| **P3** | **记账与意图本不该由库承担** | `setSolid` 是引擎把资源表的维护工作外包给了库；`keep` 是关于函数的**静态事实**，却用运行时调用表达。搬家不改职责，只是换个地方犯错 |
| **P4** | **库仍需依赖 faijs 包** | SDK import 意味着第三方库有运行时依赖。但真正"正常语言"的第三方库（如 `gear-lib`）不该依赖宿主运行时 |
| **P5** | **没触及真正的病灶** | §2.2 向下转型、§2.3 反向掏 IR、§2.4 生命周期冲突，这三条它一条都没治 |

**根本分歧**：前方案问的是"平台能力该从哪拿"，本方案问的是"**这些能力该不该由引擎提供、该不该在运行时提供**"。

---

## 4. Onshape 参照：学什么 / 不学什么

### 4.1 不抄（明确排除）

| Onshape 机制 | 证据 | 为什么不抄 |
|---|---|---|
| `defineFeature` / `annotation` / `precondition` / `UIHint` / `"Feature Type Name"` | `feature.fs:47`、`primitives.fs:30-42`、`uihint.gen.fs`（49 个 UIHint 值） | **用户本轮明确裁定**：feature 定义绝不在 faijs，在上层应用 3d_editor。这是 faijs 与 Onshape 的最大差别。抄它等于把 UI 表单塞进引擎，违反 K3 / 用户原话 6 |
| `op*` 引擎原生原语（`opExtrude`/`opBoolean`/… 约 90 个） | `primitives.fs:110-120`、`geomOperations.fs` | Onshape 的 op 是 C++ 引擎实现。faijs **几何运算全部在库**（用户原话 5），且要支持后端切换（occt/manifold 未来可换）。内置 op 原语与这两条直接冲突 |
| `Query` 惰性拓扑查询体系 | `query.fs:9-36`（"Queries in general do not contain a list of entities… they contain criteria"） | Query 服务于 Onshape 的**历史型增量建模**（实体跨特征存活、需按历史路径重新定位）。faijs 是**全量重放 + 变量引用**：改参数 → 整条下游链重算，引用（`PartName`）在重放时天然重新求值。Query 解决的拓扑命名问题，faijs 由"重放 + faceEvolution 面演化映射"覆盖（现状 `exec.getFaceEvolution`）。引入 Query 是给不存在的问题加一层 |
| `Context` 全局模型数据库（持有所有 bodies + 拓扑） | `context.fs:12-30` | faijs 的"context"是**持久 `ctx` 变量容器**（`module-executor.ts:67`，跨增量执行存活），几何由库产出并交给变量。不设全局模型库 |

### 4.2 学（可迁移原则，均不含 feature）

| # | Onshape 做法（证据） | faijs 迁移 |
|---|---|---|
| **S1** | **几何归属单一**：特征不持有 body，往 `context` 提交（`primitives.fs:110` `opExtrude(context, id+"extrude", {...})`） | **Shape 身份与 BREP 槽由引擎侧持有**，库只产出几何数据。库不维护"谁在 BREP 链上"这张表（§7） |
| **S2** | **Id 分层路径反映创建历史**（`context.fs:88-140`，"The full id hierarchy must reflect creation history"） | faijs 已有 `StmtId`/`PartName` 两个命名空间（`syntax-design.md` §1.2）。**保持**，且错误/事件归属由引擎按 StmtId 补充（§10.3） |
| **S3** | **求值型与构造型显式分野**：`ev*` 只读（`evaluate.fs`，60+ 个 `ev*` 函数）vs `op*` 修改 | C3 的运行时推断 → **OpManifest `kind:'query'` 静态声明**（§8.5）。前提被推翻时，声明比推断可靠 |
| **S4** | **错误携带归属**：`throw regenError(error)` + `id` 定位（`feature.fs:66-84`） | 库只 `throw`；**引擎在调用点挂 stmt 归属**，填 `failedAt`（§10.3）。消灭 `exec.currentStmt` |
| **S5** | **版本协商**：`isAtVersionOrLater(context, FeatureScriptVersionNumber.V406_SPHERE_PRIMITIVE)`（`primitives.fs:96`）+ import 带 version | 装配期校验 `CONTRACT_VERSION`（§11.3）。不兼容即报错，不静默降级 |
| **S6** | **能力/参数声明与实现分离**：`precondition` 块声明参数契约，函数体实现行为 | OpManifest 声明保留语义与后端能力，op 函数只实现行为（§8） |

---

## 5. 目标契约：三个接触面 + 两条禁令

```
┌─ 装配期（一次性，createRuntime 时）────────────────────────────┐
│  引擎 ──Backends──> createStdlib(deps) ──> StdlibNamespace      │
│       ──Backends──> createMech(deps)   ──> mech 命名空间        │
│  库同时交回：OpManifest（静态清单）                              │
└─────────────────────────────────────────────────────────────────┘
                          │
┌─ 运行期（逐语句）──────────────────────────────────────────────┐
│  编译产物 async (ctx, ns) => { ctx.part0 = await ns.cad.box({…}) }│
│  库函数签名 = 源码形态，零隐式参数                                │
│  几何产出经过 Shape 构造器/包装器 → 引擎登记身份槽                │
└─────────────────────────────────────────────────────────────────┘
```

**三个接触面**：

| # | 接触面 | 取代 exec 的什么 | 何时发生 |
|---|---|---|---|
| **A** | **装配期依赖注入**（§6） | `kernels` / `fonts` / `texture` / `assets` / `events` / `mode` / `cad` | 一次性 |
| **B** | **Shape 契约与 BREP 槽**（§7） | `getSolid` / `setSolid` / `getFaceEvolution` / `setFaceEvolution` | 每次产出 |
| **C** | **OpManifest 静态清单**（§8） | `keep` / `keepHidden` / `resolvePath` / C3 推断 / 符号表 | 一次性 |

**两条禁令**（契约红线，由测试守护）：

| # | 禁令 | 理由 | 现状违反处 |
|---|---|---|---|
| **F1** | **库不得读取引擎内部状态** | 无 `currentStmt`、无 `script`（ScriptIR）、无 `outputCache` | `compound.ts:263`、`exec-context.ts:208-232`（`dependentsOf` 读 `this.script`） |
| **F2** | **库不得查询或修改 DAG** | 无 `dependentsOf`、无 `touch`、禁止原地改写已发布的 Shape | `compound.ts:237,239,242,246` |

被消灭的 exec 成员完全清点：

| exec 成员 | 处置 |
|---|---|
| `mode` | → A（装配期注入，可变引用） |
| `kernels.occt/csg/sdf` | → A |
| `fonts` / `texture` / `assets` / `events` | → A |
| `getSolid` / `setSolid` / `getFaceEvolution` / `setFaceEvolution` | → B（构造器登记，库不再调用） |
| `keep` / `keepHidden` | → C（OpManifest 声明） |
| `dependentsOf` / `touch` | → **收归引擎**（F2，见 §10） |
| `currentStmt` | → **删除**（F1，见 §10.3） |
| `shapeToName` / `touchedShapes` / `setVariable` / `brepChain` / `outputCache` | → **删除**（越权访问，见 §2.2） |
| `resolvePath` | → **收归引擎**（§7.3） |

---

## 6. 接触面 A：装配期依赖注入

### 6.1 Backends 接口（引擎 → 库的唯一入参）

```ts
// faijs 侧定义；库 author 面向它编程，不 import 任何 faijs 模块
export interface Backends {
  /** 契约版本（S5）：装配期校验，不兼容即抛错 */
  readonly contractVersion: number

  /** 执行模式（可变引用：宿主可在运行期切换 auto/brep/mesh） */
  readonly config: { mode: ExecutionMode; partTransform?: PartTransform }

  /** 几何后端。occt 异步初始化 → 用 getter 而非裸值 */
  readonly kernel: {
    /** 可能为 null（mesh 模式 / 未初始化）。库在使用前判空 */
    readonly occt: OcctKernel | null
    readonly csg: CsgBackend | undefined
    readonly sdf: SdfBackend | undefined
  }

  /** Shape 构造器与身份（接触面 B 的入口） */
  readonly shape: ShapeFactory

  /** 宿主端口（透传 HostPorts） */
  readonly fonts: FontProvider | undefined
  readonly texture: TextureSampler | undefined
  readonly assets: AssetResolver | undefined
  readonly events: EventSink

  /** 内置命名空间（库要调内置 op 时用；第三方库同理） */
  readonly cad: StdlibNamespace
}
```

**要点**：
- `config` 与 `kernel` 是**可变引用**（对象/getter），因此"运行期切换模式""occt 异步就绪"都不需要重新装配——闭包读的是引用，不是快照。这是装配期注入能覆盖运行期变化的唯一技巧点。
- `events` 必填（与现有 `HostPorts.events` 一致，`ports.ts:188`）。

### 6.2 库的形态（工厂函数）

```ts
// src/stdlib/index.ts（目标形态）
export function createStdlib(deps: Backends): StdlibNamespace
export const manifest: OpManifest          // 静态清单，见 §8
```

```ts
// 内置库内部：闭包捕获 deps，op 签名 = 源码形态
export function createStdlib(deps: Backends): StdlibNamespace {
  const { kernel, config, shape, assets, events, cad } = deps

  function box(params: BoxParams): Shape { … }        // 无 exec
  function drill(input: Shape, params: DrillParams): Shape | Promise<Shape> { … }
  function faceCenter(of: Shape, anchor?: Vec3, ordinal?: number): Vec3 { … }

  return { box, drill, faceCenter, /* … */ }
}
```

**为什么这是"正常语言"**：

| 判据 | 说明 |
|---|---|
| 零隐式 | `cad.box({size})` 编译为 `ns.cad.box({size})`，参数一个不多一个不少 |
| 零依赖 | 库不 `import` faijs、不读 `globalThis`。工厂函数是标准 DI，TS/JS 生态通行写法 |
| 多实例安全 | 每个 runtime 装配一份闭包，天然隔离（对比全局锚点：单进程只能有一份状态） |
| 可测 | `createStdlib({ kernel: fakeKernel, … } as Backends)` 即可单测，无需全局初始化 |
| 传递依赖 | 库 A 要用库 B：把 `deps` 传给 B 的工厂。普通 DI 的传递，无魔法 |

### 6.3 编译产物形态

| | 现状 | 目标 |
|---|---|---|
| 语句 fn | `async (ctx, cad, exec) => {}`（`compile.ts:250`） | **`async (ctx, ns) => {}`** |
| 赋值语句 | `ctx.part0 = await cad.box(ctx.size, exec)` | `ctx.part0 = await ns.cad.box(ctx.size)` |
| 成员调用 | `await ctx.asm1.do_assemble(exec)`（`compile.ts:187`） | `await ctx.asm1.do_assemble()` |
| 嵌套调用 | `await cad.union(ctx.a, ctx.b, exec)`（`compile.ts:84`） | `await ns.cad.union(ctx.a, ctx.b)` |
| 第三方 | `exec.libs.mech.makeHeadstock(...)`（roadmap 规划） | **`ns.mech.makeHeadstock(...)`** |

`ns` 是**已装配命名空间的集合**（`{ cad, mech, … }`），内置与第三方**同形态**——roadmap §6.2 的 `exec.libs` 特殊通道不再需要，第三方库不再是被区别对待的二等公民。

---

## 7. 接触面 B：Shape 契约与 BREP 槽

### 7.1 问题：记账是引擎外包给库的活

现状每个双链路 op 都有 3–5 行记账样板：

```ts
// drill.ts:160-162
const shape = solid(solidToShape(kernel, resultSolid))
exec.setSolid(shape, resultSolid)      // ← 库在维护引擎的资源表
return shape
```

库之所以要手动记账，是因为 Shape 是库造的裸对象，引擎拿不到里面的 OCCT 句柄。**这是资源托管的缺位**：引擎负责释放句柄（`module-executor.ts:58,149-151` 的顶替释放），却让库负责登记。

### 7.2 目标：构造器登记，库零记账

```ts
export interface ShapeFactory {
  /** mesh-only 产物 */
  solid(mesh: MeshData): SolidShape
  /** BREP 产物：mesh（三角化结果）+ OCCT 句柄 + 面演化，一次登记 */
  fromBrep(mesh: MeshData, h: BrepHolder): SolidShape
  /** compound：结构，不复制几何 */
  compound(children: Shape[]): CompoundShape
  /** 查询（引擎侧判定 BREP 链用） */
  hasBrep(shape: Shape): boolean
}

export interface BrepHolder {
  solid: ShapeHandle
  faceEvolution?: Map<number, number[]>
}
```

改造后的 op：

```ts
function drillBrepPath(input: Shape, params: DrillParams): Shape {
  const kernel = deps.kernel.occt!
  const upstream = deps.shape.brepOf(input)          // 引擎查槽，不是库记账
  const resultSolid = drillBrep(kernel, upstream, …)
  return deps.shape.fromBrep(solidToShape(kernel, resultSolid), {
    solid: resultSolid,
    faceEvolution: identityEvolution(kernel, resultSolid),
  })
}
```

**收益**：

| 现现状 | 改造后 |
|---|---|
| 每个 op 3–5 行 `setSolid`/`setFaceEvolution` | 0 行 |
| "某 Shape 是否在 BREP 链上"由库记账的正确性决定 | 由槽决定，**引擎可查**（`hasBrep`） |
| 库需向下转型拿 `brepChain.partTransform`（`drill.ts:143`） | `deps.config.partTransform`，正当渠道 |
| 跨 realm / 多份 faijs 的身份互通问题（roadmap §3.4） | **消失**——只有引擎持有构造器，所有库共用注入的那一套 |

> ★ 关键推论：roadmap 的**全局锚点（V2.1）与 SDK（V2.2）两个大工程被本方案根治**。它们要解决的"两份 faijs 代码 → 两份 WeakSet → Shape 身份不通"，前提是"库自己 import faijs 造 Shape"。库不再造 Shape（只造数据，由注入的构造器包装），这个问题根本不存在。**没有需要共享的模块状态，就没有锚点的用武之地。**

### 7.3 双链路分派收归引擎

现状：`resolvePath(exec, inputs, brepImpl)` 由**每个 op 自己调**（`copy.ts:57`、`primitives.ts:69,76,83,90,97`、`drill.ts:196`…），`brepImpl` 是 op 的自述标记（`copy.ts:24`、`primitives.ts:54`、`drill.ts:27`）。

目标：op **只声明能力**（§8.2 的 `backends` 字段），分派由引擎统一做：

```ts
// 引擎侧（cad-runtime/backend-dispatch.ts）
function dispatch(op: OpEntry, inputs: Shape[]): 'brep' | 'mesh' {
  if (deps.config.mode === 'mesh') return 'mesh'
  const canBrep = op.manifest.backends.includes('brep')
  if (deps.config.mode === 'brep') {
    if (!canBrep) throw new BrepUnsupportedError(`op has no BREP implementation`)
    if (!inputs.every(deps.shape.hasBrep)) throw new BrepUnsupportedError(`input is not BREP`)
    return 'brep'
  }
  return canBrep && inputs.every(deps.shape.hasBrep) ? 'brep' : 'mesh'
}
```

红线不变：**静态判定，禁止运行时 try-catch 回退**（`AGENTS.md` ⚠️ BREP/mesh 路径判定红线）。`BrepUnsupportedError` 的 `stmt` 由引擎在调用点补充（§10.3），库不再传。

**op 的两条实现如何暴露**：由 OpEntry 的 `brep` / `mesh` 字段各指向一个实现函数，引擎按分派结果调用其中之一（定义见 §8.2）。

---

## 8. 接触面 C：OpManifest（静态清单）

### 8.1 动机：把"关于函数的静态事实"从运行时搬到装配期

exec 里有两样东西**本质上是静态事实**，却用运行时调用表达：

| 事实 | 现状表达 | 问题 |
|---|---|---|
| 这个函数保留哪些入参 | `exec.keep(...)`，运行时逐次调用 | 需要 `shapeToName` WeakMap 反查（`exec-context.ts:141,252-263`）、需要"缓存命中时保留上一轮记录"（`module-executor.ts:141,194-197`）、需要 `internalKeep` 持久化——**整套机制只为在运行时重述一句静态事实** |
| 这个函数支持哪些后端 | `const brepImpl = true` + 每个 op 自调 `resolvePath` | 样板，且引擎无法在调用前知道 |

### 8.2 OpManifest 契约

```ts
/** 保留声明：指明本函数的哪些入参不被消费 */
export interface RetainSpec {
  /** 位置入参下标（0-based）；`'*'` = 全部位置入参。空/缺省 = 不保留位置入参 */
  positions?: number[] | '*'
  /** args 对象里的属性名（如 group 的 members） */
  paths?: string[]
  /** 保留但 canvas 不渲染（union/subtract/intersect 的源） */
  hidden?: boolean
}

export type OpKind =
  | 'create'   // 0 入 1 出：box/sphere/cylinder/…
  | 'modify'   // n 入 n 出：drill/fillet/transform/knurl（默认消费入参）
  | 'combine'  // n 入 1 出：union/subtract/intersect（默认保留入参且隐藏）
  | 'compound' // 产出结构：group/assembly（默认保留成员且可见）
  | 'query'    // 求值型，不产出几何，不消费入参：faceCenter/bboxMin/…
  | 'void'     // 无输出，原地动作：do_assemble/add_constraint

export interface OpEntry {
  kind: OpKind
  /** 支持的实现路径；缺省 ['mesh']。引擎据此分派（§7.3） */
  backends?: Array<'brep' | 'mesh'>
  /** BREP 实现；缺省 = backends 不含 'brep' 时的唯一实现 */
  brep?: OpImpl
  /** mesh 实现 */
  mesh: OpImpl
  /** 保留语义；缺省 = 默认消费（C5）。覆盖 kind 的默认值 */
  retain?: RetainSpec
  /** 参数校验（可选；库可自行在函数体 assert） */
  assert?: (params: Record<string, unknown>) => void
}

export type OpImpl = (...args: any[]) => unknown | Promise<unknown>

export type OpManifest = Record<string, OpEntry>
```

**引擎零函数知识（K5）仍然成立**：manifest 是均匀的查表数据，引擎按字段名机械读取，无任何按函数名的分支代码。

### 8.3 内置库清单样例

```ts
export const manifest: OpManifest = {
  box:      { kind: 'create',  mesh: boxMesh,  brep: boxBrep,  backends: ['brep','mesh'] },
  copy:     { kind: 'create',  mesh: copyMesh, brep: copyBrep, backends: ['brep','mesh'],
              retain: { positions: [0] } },                        // 源保留且可见
  group:    { kind: 'compound', mesh: group,  retain: { paths: ['members'] } },
  assembly: { kind: 'compound', mesh: assembly, retain: { paths: ['members'] } },
  union:    { kind: 'combine',  mesh: unionMesh, brep: unionBrep, backends: ['brep','mesh'],
              retain: { positions: '*', hidden: true } },           // 全部源保留且隐藏
  drill:    { kind: 'modify',   mesh: drillMesh, brep: drillBrep, backends: ['brep','mesh'] },
  knurl:    { kind: 'modify',   mesh: knurl },                      // mesh-only，无 brep
  faceCenter: { kind: 'query',  mesh: faceCenter },
  bboxMin:  { kind: 'query',    mesh: bboxMin },
}
```

默认值由 `kind` 给出，与 `keep-syntax-design.md` §2.5 的表**逐条对应**：

| 函数 | 现状（函数体 `exec.keep`） | 目标（manifest） |
|---|---|---|
| `group` / `assembly` | `exec.keep(...members)` | `kind:'compound'` → `retain:{paths:['members']}` |
| `copy` | `exec.keep(input)` | `retain:{positions:[0]}` |
| `union` / `subtract` / `intersect` | `exec.keepHidden(...inputs)` | `kind:'combine'` → `retain:{positions:'*', hidden:true}` |
| `drill` / `extrude` / `transform` / `split` | 不声明 | `kind:'modify'` → 无 retain（默认消费） |

### 8.4 参数形态与调用发射

引擎按 manifest 的 `retain` 与调用点的 `keep` 合并出保留集合，逻辑复用既有 `resolveKeep`（`lang/keep.ts`），**优先级不变：调用点 > 函数体**（`keep-syntax-design.md` §2.4）。

`retain.positions` 用 `'*'` 表示全部位置入参（布尔系 n 入）。

### 8.5 C3 → `kind:'query'`（修掉被推翻的前提）

现状 C3 在**运行时**推断"本语句无几何输出 → 不消费"（`terminal-dag.ts:70-79`），依据是已被推翻的"纯函数链"假设（§2.6）。

改造：C3 删除，改为查 manifest：

```ts
// terminal-dag（目标）
if (manifest[stmt.callee]?.kind === 'query') return false   // 求值型，显式不消费
```

**为什么显式优于推断**：

| | C3 推断 | `kind:'query'` 声明 |
|---|---|---|
| 前提 | 依赖"纯函数链"（已被用户推翻） | 无前提，库自述 |
| 第三方 | 靠"运行时输出不是 Shape"猜 | 库在清单里写明，装配期可读 |
| 违反时 | 静默误判（`keep-syntax` E1 风险：第三方原地改写入参返回状态会被误判为不消费） | 库作者声明错了就是错的，可测、可校验 |
| 时机 | 执行后才可判定 → 必须保留运行时登记机制 | 装配期即可判定 → 终端判定可完全静态化 |

### 8.6 连带消灭：符号表生成魔法

现状"保留语义"的真正静态载体是**符号表**（`src/lang/symbol-table.generated.ts`），由 `scripts/gen-symbol-table.ts` **解析 stdlib 的 TS 类型节点**生成（提取 `ReadonlyShape` 形参位置）。三个消费方：`derivePartName`、`consumes`、`check`。

manifest 落地后：
- 保留语义的载体换成 **OpManifest**（库自述的普通数据），符号表的 `readonlyPositions`/`readonlyPaths` 字段删除；
- 符号表退化为**纯存在性检查**（`check` 的"函数是否存在"，`runtime.ts:967-979` 的 `knownCallee`）；
- 第三方库**同样提供 manifest**，与内置库完全同构——不再有"第三方永为空"（`keep-syntax` §附录 B）的问题。

> 这同时解决了 `keep-syntax-design.md` §10 的 **E2 风险**（"第三方返回未注册 compound 且未声明 keep → 成员按 C5 默认消费，SDK 文档须明示"）：从"靠文档约束作者记得写"变成"装配期清单校验"。

---

## 9. keep：唯一的 UI 耦合点（K3）

**本节是 faijs 与 UI 的全部接口，不多不少。**

| 面 | 归属 | 形态 |
|---|---|---|
| **调用点 keep 语法** | **语言层**（faijs） | `{ keep: [a, b], keepHidden: true }`，UI/AI/用户显式意图，**优先级最高**。语法与语义**完全不变**（`keep-syntax-design.md` §2.3） |
| **函数体默认保留** | **库层** | OpManifest `retain` 静态声明（§8.3），不再是运行时 `exec.keep()` |
| **终端/显示集合推导** | **引擎层** | `computeLeafTerminals`：最后写者 + 下游无消费 + keep 声明。纯静态 |
| **feature / 图标 / 编辑面板 / timeline 展示** | **上层应用（3d_editor）** | **不在 faijs**。faijs 只产出 `TerminalShape[]`（含 `hidden`） |

**被删掉的整套运行时机制**（这是本方案最大的净减项）：

| 删除项 | 位置 |
|---|---|
| `exec.keep` / `exec.keepHidden` / `registerKeep` | `exec-context.ts:242-263` |
| `shapeToName` WeakMap 反查（Shape → PartName） | `exec-context.ts:141`；写入 `module-executor.ts:275`；预填 `runtime.ts:525-533` |
| `internalKeep` 记账表 + "缓存命中保留上一轮" | `module-executor.ts:77,141-142,194-197,222-238` |
| `onKeep` 回调链 | `exec-context.ts:128,150`、`runtime.ts` 装配处 |
| `DagRuntimeView.internalKeep` 运行时视图 | `terminal-dag.ts:38-42,52,66` |
| C3 运行时推断 | `terminal-dag.ts:70-79` |

`computeLeafTerminals` 因此退化为**纯静态函数**（不再需要 `view` 参数），与 `keep-syntax-design.md` §6 的"省略 → 纯静态"分支合并成唯一路径。

**宿主契约不变**：`ExecutionResult.terminals: TerminalShape[]`（`id` + `hidden`），3d_editor `commitSceneResult` 的消费方式不变（`keep-syntax-design.md` §11.1）。

---

## 10. 收归引擎的三件事

§5 的 F1/F2 两条禁令把三件"库在替引擎干的活"收回来。

### 10.1 装配：求解 ≠ 传播

**现状病灶**（`compound.ts:200-248`）四步耦合在一个 `solveAssembly` 里：

1. `Object.assign(movingShape, applyTransform(...))`（`:222`）—— **原地改写**已发布的 Shape；
2. `exec.getSolid` / `exec.setSolid`（`:227,233`）—— 库操作 BREP 槽；
3. `exec.dependentsOf(movingShape)` + 逐个 `Object.assign`（`:237-241`）—— **库手工把变换重放到每个下游**；
4. `exec.touch(...)`（`:242,246`）—— 库向引擎报告变更。

第 3 步是核心问题：每个下游 Shape 是独立对象，装配变换必须手动重放——**这是"纯函数链"与"原地改写"混用的直接后果**。库在做 DAG 遍历，而 DAG 归引擎所有（F2）。

**目标形态：求解与传播分离**

| 职责 | 归属 | 机制 |
|---|---|---|
| 求解约束（纯计算：给定位姿 → 变换矩阵） | **库** | `solveFaceMate` 已是纯函数（`compound.ts:136-153`），保持 |
| 应用变换到成员几何 | **库** | 产出**新 Shape**，不再 `Object.assign` 原地改写（F2） |
| 找出下游并让其反映新变换 | **引擎** | 按 DAG 把下游标记为 stale → 重算。`ModuleExecutor.executeFrom(staleIds)`（`module-executor.ts:159-175`）**本就是这个能力** |
| 变更声明（`ExecutionResult.changed`） | **引擎** | 引擎知道哪些变量的值被替换，自行填 `changed` |

**为什么引擎重放优于手工传播**：

- 手工传播只改 mesh，不改 BREP——下游若在 BREP 链上，其 solid 句柄与 mesh 会**失配**（现状 `compound.ts:236` 的注释只说"下游 solid 由 setSolid 身份槽保留"，并未变换它）；
- 引擎重放走的是既有增量路径，下游的 BREP/mesh 双链路各自正确重算；
- 库的 `solve` 变成纯函数 → 可单测、可重复执行（现在重复 `do_assemble` 会把变换叠加两次）。

> ⚠️ 这是本方案**语义变化最大**的一项：`do_assemble` 从"原地改写整条下游链"变为"让下游失效并重算"。行为差异需在 P6 用专项 e2e 验证（装配 + 下游钻孔 + BREP 导出），不可与本方案的机械改造混在一起做。

### 10.2 变更传播（`touch`）收归引擎

`touch` 的唯一用途是填 `ExecutionResult.changed`（`exec-context.ts:144,237-239`）。引擎在 `afterStatement`（`module-executor.ts:267-287`）已遍历本语句的写入变量——**顺手比对旧值即可得出 changed，无需库声明**。

### 10.3 错误与事件归属（消灭 `currentStmt`）

库不再知道"当前是哪条语句"。归属由引擎在调用点补充：

| 场景 | 现状 | 目标 |
|---|---|---|
| `BrepUnsupportedError` 带 stmt | 库构造时传 `exec.currentStmt`（`resolve-path.ts:38,42,48`） | 引擎 catch 后挂 `stmt` |
| 库函数抛错 → `failedAt` | 引擎已有捕获 | 不变，归属信息更完整 |
| `part-brep-lost` 事件 | 部分由库 `exec.events.emit`（`platform-api` §3.6 指出） | **引擎统一发**：分派结果为 mesh 且上游在 BREP 链 → 发事件，`partName` 由引擎从当前语句 `outputs` 取 |
| 警告/诊断 | 库 `throw` | 不变 |

禁用 `exec.currentStmt` 后，`compound.ts:257` 的 `deriveMemberNames` 也失去数据来源 → 成员变量名必须由**引擎显式传给库**。

**成员名怎么传**：这是"引擎知道、库需要"的信息。正当渠道是**调用参数**，不是 IR。约定：`group`/`assembly` 的 `members` 由引擎在装配期传入**带名字的引用包装**：

```ts
// 引擎侧：VarRefIR[] → NamedRef[]（编译产物）
ns.cad.group({ members: [ { shape: ctx.part0, name: 'part0' }, { shape: ctx.part1, name: 'part1' } ] })
```

库拿到的 `members` 既含 Shape 又含名字，`deriveMemberNames` 整段删除，运行时读 IR 的行为消失（F1）。

---

## 11. 第三方库：协议 ≠ 依赖

### 11.1 核心判断

roadmap §3.2 要求第三方库 `import { solid, type Shape, type ExecContext } from '@faicad/faijs/sdk'`（`:186,190`），并配 `peerDependencies`。本方案认为**这是把协议误当成依赖**。

库要成为 faijs 库，只需满足一个**协议**：导出一个装配函数。协议是形状约定，不需要 import 任何东西。

```ts
// mech-lib/src/index.ts —— 普通 npm 包，零 faijs 依赖
import { helicalGear } from 'gear-lib'          // 传递依赖（普通 npm）
import { GB_BEARINGS } from 'bearing-db'        // 纯数据（普通 npm）

export function install(deps) {                  // deps: Backends —— 参数传入，不 import
  function makeHeadstock(opts) {
    const body = deps.cad.box({ size: [400, 300, 350] })
    const gear = deps.shape.solid(helicalGear({ teeth: opts.gearTeeth, moduleSize: 2 }))
    return deps.cad.union(body, gear)
  }
  return {
    namespace: { makeHeadstock, makeGearTrain },
    manifest: {
      makeHeadstock: { kind: 'create', mesh: makeHeadstock },
      makeGearTrain: { kind: 'create', mesh: makeGearTrain },
    },
    contractVersion: 1,
  }
}
```

**依赖图各层的实际负担**（对应 roadmap §0.3 的车床场景）：

| 层 | 包 | 是否依赖 faijs | 如何参与 |
|---|---|---|---|
| L4 | `mech-lib` | **否**（只遵守 `install` 协议） | 宿主 `install(deps)` 装配，产物注册为 `ns.mech` |
| L3 | —— | —— | **roadmap 的 `@faicad/faijs/sdk` 入口不再需要** |
| L2 | `gear-lib` | **否**（纯几何计算，返回 `{positions,indices}`） | mech-lib 用 `deps.shape.solid()` 包装后成为 Shape |
| L1 | `bearing-db` | **否**（纯数据） | faijs 全程不感知 |

> **净收益**：roadmap 的 V2.1（全局锚点）、V2.2（SDK 入口）、V2.3（`exec.cad`）、V2.6（`markShape`）、§5.5（importmap 加 SDK）**全部不再需要**。保留的只有 V3.1/V3.2 的 `ModuleResolver` 与宿主加载器（它们做的是 specifier → URL，与本方案正交）。

### 11.2 装配协议

```ts
export interface LibraryInstallation {
  /** 命名空间对象（编译产物 ns.<binding>.<callee> 的来源） */
  namespace: Record<string, OpImpl>
  /** 静态清单（§8），键必须与 namespace 的键一致 */
  manifest: OpManifest
  /** 契约版本（S5） */
  contractVersion: number
}

/** 库包必须导出的装配函数（协议的全部内容） */
export type LibraryInstaller = (deps: Backends) => LibraryInstallation
```

宿主侧装配：

```
ModuleResolver: 'mech-lib' → https://static/…/mech-lib@1.4.0-<hash>.js
  → import(url) → mod.install(deps) → 校验 contractVersion → ns.mech = inst.namespace
  → 合并 inst.manifest 进引擎 manifest（键前缀 'mech.' 避免与内置冲突）
```

**manifest 键前缀**：多命名空间下 `statementKey` 必须含包名（既有修正 C2：`cad.chamfer` ≠ `mech-lib.chamfer`，`normal-js-subset.md` §3 P3）。同理 manifest 查表键为 `${packageName}.${callee}`。

### 11.3 版本协商（S5）

`Backends.contractVersion` 与 `LibraryInstallation.contractVersion` 必须相等，否则**抛错，不静默降级**（对齐 `AGENTS.md`「不准写各种回退」与 roadmap §12 O8 的裁定）。装配时校验，错误信息含双方版本与包名。

---

## 12. 编译与执行层改动

| 文件 | 现状 | 改动 |
|---|---|---|
| `src/lang/compile.ts` | 4 处发射 `, exec`（`:178,187,192,196`）+ 嵌套 `:84`；fn 签名 `:250` | fn `async (ctx, ns) => {}`；发射 `ns.<binding>.<callee>(…)`；删除全部 `, exec` |
| `src/cad-runtime/module-executor.ts` | `fn(ctx, cad, exec)`（`:31,146`）；`internalKeep`（`:77,141,194,222-238`） | `fn(ctx, ns)`；删 `internalKeep` 全套；`afterStatement` 补 `changed` 推导（§10.2） |
| `src/cad-runtime/exec-context.ts` | 整个文件（269 行） | **删除**。能力拆到 `Backends`（A）、`ShapeFactory`（B）、`OpManifest`（C） |
| `src/cad-runtime/internal-stdlib.ts` | 对象字面量装配（`:32-43`） | 改为 `createStdlib(deps)` 工厂 + `manifest` 导出 |
| `src/stdlib/**`（18 文件） | 全部收 exec；`resolvePath` 样板；`exec.setSolid` | 去 exec；双链路拆为 `xMesh`/`xBrep` 两个函数进 manifest；去记账 |
| `src/stdlib/shape.ts` | 模块级 `WeakSet`/`WeakMap`（`:37,94`） | 改为 `createShapeFactory()` 工厂（每个 runtime 一份） |
| `src/stdlib/internal/resolve-path.ts` | 库函数自调 | **删除**，逻辑移到 `cad-runtime/backend-dispatch.ts` |
| `src/cad-runtime/terminal-dag.ts` | `DagRuntimeView` + C3 推断（`:38-42,70-79`） | 纯静态：查 manifest `kind:'query'` + `retain`；删 view 参数 |
| `src/lang/symbol-table.ts` + `scripts/gen-symbol-table.ts` | 从 TS 类型节点提取 readonly | 退化为函数存在性集合；删 `readonlyPositions`/`readonlyPaths` |
| `src/lang/allocate-id.ts` | 查符号表（`derivePartName`） | 不变（R0/R4 + 总是新名，由 `keep-syntax` D7 裁定） |
| `src/cad-runtime/runtime.ts` | 装配 exec；`collectResult` | 装配 `Backends` + 调用工厂；`failedAt`/事件挂 stmt 归属（§10.3） |
| `src/index.ts` | 导出面 | 新增 `Backends`/`ShapeFactory`/`OpManifest`/`LibraryInstaller` 类型导出；`cad-runtime/ports.ts` 不变 |

**不变的部分**（零回归面）：`ScriptIR`/`StatementIR` 结构、`parseScript`、codegen 往返、statementKey 公式（除包名前缀）、`ExecutionResult` 字段集合、`HostPorts`、`derivePartName`。

---

## 13. 分期实施

> 纪律：每期独立验证通过再进下一期；e2e 一次一个 spec；不跑全量，不跑 CI（用户既定纪律）。

| 期 | 内容 | 涉及文件 | 风险 |
|---|---|---|---|
| **P0** | 契约类型落地：`Backends` / `ShapeFactory` / `OpEntry` / `LibraryInstaller` / `backend-dispatch`；守卫测试（无实现） | 新增 `src/contract/*.ts` | 无 |
| **P1** | `createShapeFactory()`；`shape.ts` 模块级 WeakSet/WeakMap → 工厂实例 | `stdlib/shape.ts`、调用点 | 低（行为等价） |
| **P2** | stdlib 改造为工厂：18 个文件去 exec，签名 = 源码形态；双链路拆 `xMesh`/`xBrep` | `stdlib/**` | **高**（面积最大，逐 op 验证） |
| **P3** | OpManifest 落地 + `terminal-dag` 静态化：删 `internalKeep`/`shapeToName`/`onKeep`/C3 | `lang/keep.ts`、`terminal-dag.ts`、`module-executor.ts` | 中（删机制需回归 keep 全部锚点） |
| **P4** | 分派收归引擎：删 `resolve-path.ts`，`backend-dispatch` 统一分派；错误/事件归属挂 stmt | `cad-runtime/*` | 中（BREP/mesh 红线相关） |
| **P5** | compile + module-executor 去 exec：`async (ctx, ns)`；删 `exec-context.ts` | `lang/compile.ts`、`cad-runtime/*` | 中 |
| **P6** | **装配重做**：求解 ≠ 传播；成员名经参数传递；删 `deriveMemberNames`/`dependentsOf`/`touch` | `stdlib/compound.ts` | **高**（语义变化，需专项 e2e，见 §10.1 ⚠️） |
| **P7** | 第三方库通道：`install` 协议 + 宿主 `ModuleResolver` + 版本校验 | 新增 + 宿主侧 | 中 |
| **P8** | 文档同步（§16）+ 3d_editor 回归 | docs、3d_editor | 中 |

依赖顺序：P0 → P1 → P2 → P3 → P4 → P5；**P6 与 P5 之后独立做**（语义变化不与机械改造混合）；P7 依赖 P0 + P5。

---

## 14. 验收标准（测试提纲，分层）

**契约形态（P0/P5）**
- 编译产物逐字断言：`ctx.part0 = await ns.cad.box(ctx.size)`——**无 `, exec`**，覆盖 4 种语句形态 + 嵌套调用 + 成员调用
- `src/` 下 `ExecContext` / `exec-context.ts` 零残留；stdlib 全部导出函数签名中无 `exec` 参数
- 无 `as ExecContextImpl` 向下转型（`grep` 断言）
- 无 `globalThis.__FAICAD_FAIJS_RUNTIME__`（锚点方案已废弃）

**依赖注入（P1/P2）**
- `createStdlib(fakeBackends)` 可构造；两个独立 runtime 的 Shape 互不干扰（多实例隔离）
- mesh 模式（`kernel.occt === null`）下全部 op 走 mesh 路径，不抛"no OCCT kernel"
- `config.mode` 运行期从 `auto` 切 `mesh` 后，同一份闭包读到新值（可变引用验证）

**Shape 槽（P1/P2）**
- BREP 路径产物 `deps.shape.hasBrep(shape) === true`；mesh 路径为 `false`
- stdlib 源码中 `setSolid` / `setFaceEvolution` 零残留
- 句柄释放仍单次（顶替释放回归：`module-executor.ts:137-151`）

**OpManifest（P3，回归锚点全部来自 `keep-syntax` §9）**
- `cad.drill(a, {diameter:8})`（无声明）→ a 被消费，与现状逐位相同
- `cad.union(a,b)` → a、b 终端且 `hidden:true`
- `cad.group({members:[a,b]})` → a、b 终端且可见
- `cad.copy(a)` → a 终端且可见
- `cad.drill(c, {keep:['c']})` / `{keep:['c'],keepHidden:true}` → 调用点覆盖 manifest 默认值
- `mech.measure(a)`（manifest `kind:'query'`）→ a 不被消费
- `mech.makeGroup({members:[a,b]})` 声明 retain → 成员保留；未声明 → 消费（**不再是"靠文档约束"**）
- 缓存命中（语句未重跑）时保留结论与重跑一致——**不再依赖"保留上一轮记录"**
- `computeKey` 仅 keep 变化时不改变（零重算）

**分派与归属（P4）**
- `mode:'brep'` + mesh-only op → `BrepUnsupportedError`，`failedAt` 带 stmt 归属（库不再传 stmt）
- `part-brep-lost` 事件由引擎发出，`partName` 正确
- 库函数内无 `currentStmt` 访问（`grep` 断言）

**装配（P6，专项）**
- `assembly` + `do_assemble` 后：成员与下游 mesh 一致、BREP 句柄与 mesh 同步（不再失配）
- `do_assemble` 执行两次 → 结果与一次相同（幂等，不再叠加变换）
- `ExecutionResult.changed` 由引擎填出，值域与现状一致
- 装配 + 下游 drill + STEP 导出 e2e 通过

**第三方库（P7）**
- `mech-lib`（零 faijs 依赖）`install(deps)` → `mech.makeHeadstock(opts)` 端到端跑通
- `gear-lib` 产出的几何经 `deps.shape.solid()` 包装后可与内置 op 产物混合 `union`
- `contractVersion` 不匹配 → 抛错（不静默）
- `statementKey`：`cad.chamfer` ≠ `mech-lib.chamfer`

---

## 15. 风险与开放问题

| # | 风险/问题 | 处置 |
|---|---|---|
| **O1** | `Backends` 里的 `kernel.occt` 异步就绪：装配时可能为 null | 用 getter（可变引用），库在使用处判空并抛明确错误。与现状 `exec.kernels.occt` 是 getter（`exec-context.ts:164-170`）同构，行为不变 |
| **O2** | 第三方库不提供 manifest 或键不匹配 | 装配期校验：`namespace` 与 `manifest` 键集必须一致，否则抛错。缺失键 → 默认消费（与现状 C5 一致） |
| **O3** | P6 装配语义变化（原地改写 → 失效重算）的行为差异 | 独立一期 + 专项 e2e；**不与 P2–P5 的机械改造混做** |
| **O4** | `kind:'query'` 由库自述，声明错误怎么办 | 声明错误 = 库 bug，可测可修；优于推断的静默误判。宿主可在 dev 模式对"声明 query 但返回 Shape"给 warning |
| **O5** | 成员名经参数传递后，`members` 元素形态从 `Shape` 变为 `{shape,name}` | 影响 `group`/`assembly` 的实现与 `memberNames` 推导；codegen 往返需同步（编译产物形态进不了往返测试，往返的是 `.faijs` 文本——**文本不变**） |
| **O6** | 与 `keep-syntax-design.md` 的冲突（§2.2/§2.5/§3.2/§9） | 见 §16 冲突清单，需按本方案修订 |
| **O7** | 与 roadmap 的冲突（§3.4 锚点 / §4 SDK / §10 V2） | 见 §16；V2.1/V2.2/V2.3/V2.6 作废，V3.1/V3.2 保留 |
| **O8** | 是否仍需要 `@faicad/faijs/stdlib` 子路径导出 | 保留（供宿主直接 import 工厂与 manifest），但第三方库不需要它 |
| **O9** | 专利考量（`Faijs语言的思考.md` §8.1：核心思想不放入 faijs 仓库） | 本方案的 DI / manifest 属常规工程手法；"UI 录制 + 增量重放 + 自动终端推导"的语言核心思想另行管理 |

---

## 16. 与相邻文档的冲突清单（需同步修订）

| 文档 | 章节 | 现状 | 应改为 |
|---|---|---|---|
| `docs/syntax-design.md` | §1.1 四层分离 / §6.2 统一 ABI | "第三方库遵守末参 exec 约定"、"`(…args, exec) => Result`" | 库 = 普通模块 + `install(deps)` 协议；ABI = 源码形态 + manifest |
| `docs/syntax-design.md` | §5.2/§5.3 符号表驱动消费判定 | `readonlyPositions`/`readonlyPaths` | 保留语义改由 OpManifest `retain` 承载；符号表退化为存在性集合 |
| `docs/syntax-design.md` | §10 远期（第三方库） | "遵守末参 exec 约定" | 同 §16 第一行 |
| `docs/plans/2026-08-28-keep-syntax-design.md` | §2.2 函数体 `exec.keep` | 运行时登记 + `shapeToName` 反查 + 缓存命中保留 | **改为 OpManifest `retain` 静态声明**；调用点 keep 语法与优先级不变（§2.3/§2.4 不变） |
| 同上 | §3.2 C3 推断 + "C3 为什么成立" | 依赖"纯函数链"前提 | **删除 C3**，改 `kind:'query'` 显式声明（前提已被用户推翻，§2.6） |
| 同上 | §6 `DagRuntimeView.internalKeep` | 运行时视图 | 删除；`computeLeafTerminals` 纯静态化 |
| 同上 | §10 E2 风险（第三方未声明 keep） | "SDK 文档须明示" | 装配期清单校验，契约化 |
| `docs/plans/2026-08-28-faijs-ecosystem-roadmap.md` | §3.4 全局锚点 / §4 SDK / §10 V2.1–V2.3、V2.6 | 需要 | **作废**（§11.1 论证）；V3.1/V3.2/V3.3 保留（模块解析与本方案正交） |
| 同上 | §4.1 SDK 导出面（含 `ExecContext`） | 需要 | SDK 入口不再需要；`Backends`/`ShapeFactory`/`OpManifest` 类型由根入口导出 |
| `docs/plans/2026-08-29-faijs-platform-api-design.md` | 全文 | 锚点 + SDK import | **被本文档取代**；保留其 §1 对 exec 的批判（本方案 §2 继承并深化） |
| `docs/plans/2026-08-29-faijs-normal-js-subset.md` | §3 P3（`exec.libs`） | 第三方走 `exec.libs` | 改 `ns.<binding>`；P2 顶层 import 不受影响 |

---

## 附录 A：证据索引

**faijs（现状）**

| 事实 | 位置 |
|---|---|
| 编译期 4 处追加 `, exec` + 嵌套 1 处 | `src/lang/compile.ts:84,178,187,192,196` |
| 语句 fn 签名 `async (ctx, cad, exec) =>` | `src/lang/compile.ts:250` |
| `ExecContext` 接口（20 字段） | `src/cad-runtime/exec-context.ts:49-90` |
| 库**向下转型**访问 `ExecContextImpl.brepChain` | `src/stdlib/drill.ts:143,169` |
| 库运行时读 IR（`exec.currentStmt.args`） | `src/stdlib/compound.ts:257-272` |
| 持久对象捕获短命 exec，靠每次再传补救 | `src/stdlib/compound.ts:307,310-315` |
| 库调图算法 + 手工下游传播 + 原地改写 | `src/stdlib/compound.ts:222,237-243,246` |
| 签名无形：`rest.pop()` 取 exec | `src/stdlib/geom.ts:73-79,82-88,91-108` |
| 每个 op 自调 `resolvePath` + `brepImpl` 自述 | `src/stdlib/copy.ts:24,57`；`primitives.ts:54,69,76,83,90,97`；`drill.ts:27,196` |
| `exec.setSolid` 记账样板 | `src/stdlib/drill.ts:160-162`；`copy.ts:33-38`；`primitives.ts:62-64` |
| `internalKeep` + shapeToName + 缓存命中保留 | `src/cad-runtime/module-executor.ts:77,141-142,194-197,222-238,275` |
| C3 运行时推断 + `DagRuntimeView` | `src/cad-runtime/terminal-dag.ts:38-42,70-79` |
| Shape 身份模块级 WeakSet/WeakMap（工厂化对象） | `src/stdlib/shape.ts:37,94` |
| 符号表从 TS 类型节点生成 | `scripts/gen-symbol-table.ts`；`src/lang/symbol-table.generated.ts` |
| `ExecutionResult`（宿主消费面，不变） | `src/cad-runtime/runtime.ts:93-135` |
| `HostPorts`（注入面，不变） | `src/cad-runtime/ports.ts:182-189` |
| BREP/mesh 静态判定红线 | `AGENTS.md` ⚠️；`src/stdlib/internal/resolve-path.ts:1-49` |

**Onshape（参照）**

| 事实 | 位置 |
|---|---|
| 特征签名 `(context, id, definition)` + `defineFeature` 包装 | `feature.fs:47-85,120` |
| annotation / precondition / UIHint（**不抄**） | `primitives.fs:30-42`；`tool.fs:9-80`；`uihint.gen.fs`（49 值） |
| op 提交式副作用（**不抄机制**） | `primitives.fs:110-120`（`opExtrude(context, id+"extrude", {...})`） |
| Query 惰性求值（**不抄**） | `query.fs:9-36`；`primitives.fs:112`（`qCreatedBy`） |
| Context 持有全部建模数据（**不抄**） | `context.fs:12-30` |
| Id 分层反映创建历史（学 S2） | `context.fs:88-140` |
| 错误归属 + `regenError`（学 S4） | `feature.fs:66-84` |
| 版本协商 `isAtVersionOrLater`（学 S5） | `primitives.fs:96`；`context.fs:59-62` |
| 求值族 `ev*`（学 S3） | `evaluate.fs`（60+ 个 `ev*` 函数） |

## 附录 B：用户约束与本方案的对应

| 用户约束 | 本方案落实 |
|---|---|
| "faijs 必需是正常的语言"（K1） | §6 装配期 DI：库函数签名 = 源码形态；无隐式注入、无全局单例 |
| "几何运算全部交给 faijs 语言库"（K2） | §4.1 明确不抄 Onshape 的 `op*` 引擎原语 |
| "keep 是与 UI 的唯一耦合点"（K3） | §9 划界：调用点 keep 属语言层，feature/表单全在 3d_editor |
| "纯函数链是过时的说法"（K4） | §2.6 + §8.5：C3 推断 → `kind:'query'` 显式声明 |
| "引擎零函数知识"（K5） | §8.2：manifest 是均匀数据，引擎按字段机械查表 |
| "不要把 feature 特征这块抄过来" | §4.1 首行列为不抄项，全文未引入任何 feature 概念 |
