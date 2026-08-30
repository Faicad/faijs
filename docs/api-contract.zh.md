# faijs 接口契约（当前设计意图）

> 定位：本文档记录 faijs 引擎**当前**的设计意图与接口契约——分层职责、命名规则、语句模型、语法、终端判定、执行、双链路几何、宿主注入与消费面。
>
> **本文档不写开发计划、不记录缺陷**（历史阶段与已知问题见 `docs/plans/` 下各设计文档）。
>
> 关联文档：
> - `docs/syntax-design.md` —— `.faijs` 语法与增量执行契约
> - `docs/ops-api-inventory.md` —— 写 `.faijs` 代码的 API 手册（AI/用户侧）
> - `docs/plans/2026-08-27-restore-dag-terminal-detection.md` —— DAG 终端判定设计（已落地）
> - `docs/plans/2026-08-27-faijs-language-refactor.md` —— 函数化长期方向（待评审）
> - `docs/plans/2026-08-26-phase3-implementation-plan.md` —— 命名规则与 StmtId/partName 分离（已落地）
> - `docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md` —— JS VM 执行 + stdlib 化（已落地）

---

## 1. 架构分层（L0–L3）

```
┌────────────────────────────────────────────────────────────┐
│ L0 文本层  src/lang/                                       │
│   parser（acorn 白名单语法闸门，先解析后编译）               │
│   codegen（scriptToCode / statementToLine，双向同构）        │
│   compile（compileToModule → 零 import 的 ESM 编译产物）      │
│   args-schema（OpSchema 类型 + 纯函数校验框架）               │
│   allocate-id（partN 命名规则分配器）                        │
│   types（CadStatement / PartScript / TerminalShape / Arg…）  │
├────────────────────────────────────────────────────────────┤
│ L1 几何层                                                   │
│   brep/    —— OCCT BREP 链（brep-chain、brep-ops、拓扑）      │
│   mesh/    —— manifold-3d mesh 路径 + cad API（api.d.ts 生成）│
│   stdlib/  —— 库函数（box/translate/drill/boolean/split/      │
│               group/assembly/copy/…），每 op 双链路分派        │
│   boolean/ primitives/ sdf/ topology/                        │
├────────────────────────────────────────────────────────────┤
│ L2 编排  src/cad-runtime/                                   │
│   CadRuntime（execute / append / update / plan / check）     │
│   ModuleExecutor（编译产物加载 + 增量调度 + 持久 ctx）         │
│   ExecContext（双内核 + 身份槽 + dependentsOf/touch）         │
│   terminal-dag（DAG 叶子终端判定，纯函数）                    │
│   ports（HostPorts 注入接口）                                │
├────────────────────────────────────────────────────────────┤
│ L3 Host                                                     │
│   node-host/（fs / CLI）  browser-host/（worker / fetch）     │
└────────────────────────────────────────────────────────────┘
```

### 1.1 入口导出面

| 入口 | 内容 | 说明 |
|---|---|---|
| `@faicad/faijs`（`src/index.ts`） | 全量导出（含 Node 侧 OCCT 底层） | 生产代码优先走 `/browser` |
| `@faicad/faijs/browser`（`src/browser.ts`） | 浏览器安全面：**不含 node-host**；A/B/C/D 四类导出收敛 | 宿主（3d_editor）统一从此入口导入 |
| `@faicad/faijs/node`（`src/node.ts`） | Node 专用：`createNodePorts` / CLI / FsAssetResolver 等 | Node 专用代码不得静态 import 进浏览器构建 |
| `@faicad/faijs/csg`（`src/csg.ts`） | CSG/Boolean 底层辅助（manifold 数据交换） | 浏览器安全 |
| `@faicad/faijs/sdf`（`src/sdf.ts`） | SDF 运行模板与类型 | 浏览器安全 |

**规则**：浏览器构建里静态 import node-host 会 404——Node 专用代码一律从 `@faicad/faijs/node` 导入；`src/browser.ts` / `src/csg.ts` / `src/sdf.ts` 是浏览器安全面，不得依赖 `node:fs` / `node:path`。

### 1.2 职责边界（宿主契约）

- **faijs 的职责只有一个**：执行 faijs 脚本，生成 3D 模型（`ExecutionResult`）。
- **宿主的职责只有两个**：① 生成正确的 faijs 脚本；② 调用 faijs 执行该脚本。
- 🔴 **所有几何变更必须走 faijs 脚本语句，执行 faijs 脚本来获得**。
- 宿主只消费 `ExecutionResult`，**不得重复推导**终端判定、不得自行实现 DAG 叶子过滤（终端语义是引擎产物）。

---

## 2. 铁律（写进契约，后续任何实现都不得违反）

- **R-1 单一几何实现**：语句 op 与几何核心函数一一映射，参数编排只发生在几何核心内。禁止「UI 一份、重放一份」两份实现。每个 op 内置 BREP 与 Mesh 两条执行路径，切换由**静态规则**判定，**严禁运行时 try-catch BREP 异常后回退 Mesh**（BREP 路径执行抛异常 = 设计缺陷或 bug，直接报错暴露）。
- **R-2 用户原文不直接执行（先解析后编译，JS VM 执行）**：`.faijs` 是合法 JS 子集，加载时先经 acorn 解析还原为结构化语句（语法闸门：拒绝控制流等禁止形态），再由 `compileToModule` 编译为 ESM 产物，经 JS VM 动态 import 执行。安全边界 = parser 语法闸门 + 编译产物由引擎生成（用户原文不进 VM）——**不直接 eval 用户文本**（`sdf-core.ts` 的 `new Function` 是对 SDF 用户传入的函数体求值，属 sdf 后端固有行为，不在主脚本路径）。**当前实现的产物是零 import ESM**（`data:`/Blob URL 加载）——这是**实现取舍而非规范要求**，见 `docs/syntax-design.md` §6.1。
- **R-3 命名与终端语义由引擎统一**：`partN` 命名规则、DAG 叶子终端判定、消费合法性静态校验全部封装在 faijs（`allocate-id.ts` / `terminal-dag.ts` / `parser.ts`），宿主不重复实现。
- **R-4 坐标空间约定**：毫米（mm）、+Z 向上、角度用度。所有 `cad.*` 输入/输出均为世界空间 `Shape`；局部↔世界变换由宿主/执行器负责，几何核心不读网格的世界矩阵。
- **R-5 BREP 链是逐 part 的**：一个 part 是否仍为 BREP，由 `solidCache` 中是否有它的句柄唯一决定；不存在全局 `brepActive` 标志，兄弟 part 互不污染。

---

## 3. 命名契约（Phase 3：StmtId 与 PartName 分离）

每个 part 在一个 PartScript 内有两个**正交标识**：

| 键 | 含义 | 分配规则 | 用途 |
|---|---|---|---|
| **StmtId（`sN`）** | 一条语句的身份，顺序稳定 | 编译/解析期按语句顺序 `s1, s2, …`（参数语句占前段 `s1..sK`，K = params 数） | Timeline 节点键、增量调度 plan 缓存键、`executeScriptDiff` 的 diff 键 |
| **PartName（`partN`）** | 变量名，一条语句可有 0~多个 | `allocateStatementId` / `allocateSplitIds`（见 §3.1） | `ExecutionResult.outputs/terminals/compounds` 键、执行 ctx 变量键、宿主 `terminalToScopedId` 键 |

**不变量**：
- `CadStatement.id` 永远是 StmtId（`sN`），**不再是变量名**；变量名只存在于 `outputs: PartName[]`。
- `outputs` 始终显式存在：单输出 op = `[partName]`；split = `[front, back]`；void op（add_constraint/do_assemble）= `[]`。
- `TerminalShape.id` 类型为 StmtId，但**语义是 PartName**（`collectResult` 用 `asStmtId(partName)` 收口）——宿主消费 `terminals[].id` 时应按 PartName 处理。
- 存量 `partN_vM` fixture 仍可解析执行（`isPartVmId`/`getModelNum`/`getVersionNum` 保留解析旧名），但新分配只产生 `partN`；`grp_N` 同理（旧名可解析，新分配取消）。

### 3.1 `allocateStatementId` 命名规则（静态，UI 生成代码遵守）

| 情形 | 变量名 | 示例 |
|---|---|---|
| 单入单出（translate/rotate/scale/drill/extrude/engrave/knurl 等） | **复用输入名** | `part0 = cad.drill(part0, …)` |
| 无输入/单输出（box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load） | **新名** `partN`（N = 当前最大模型号 + 1） | `let part3 = cad.box(…)` |
| 布尔（union/subtract/intersect → op `boolean`） | 新名 `partN`（多输入 2→1） | `let part5 = cad.union(part1, part3)` |
| split（1→2） | `allocateSplitIds` → `partN` / `part(N+1)` | `const { front: part1, back: part2 } = cad.split(part0, …)` |
| group/assembly | 新名 `partN`（取消 `grp_N`） | `let part4 = cad.group({ members: [part0, part1] })` |
| **copy**（克隆型） | **新名** `partN`（输出独立新对象，不保名） | `let part2 = cad.copy(part1)` |
| void op（add_constraint/do_assemble） | 无输出（`outputs: []`），不调用分配器 | `assem4.add_constraint(…)` |

模型号 N 在单次脚本内单调递增（`getMaxModelNum` 从既有语句的 `outputs` 扫描）。

---

## 4. 语句与脚本模型（`src/lang/types.ts`）

### 4.1 基础值类型

```ts
export type Vec3 = [number, number, number]      // 毫米，右手系 +Z 向上

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[] | { [k: string]: JsonValue }

export type Arg = JsonValue | ParamRef | GeomRef | AssetRef
/** 语句输入引用的左值变量名（PartName） */
export type ShapeRef = PartName
```

`Shape`（`src/mesh/types.ts`）是几何核心的核心几何类型：`{ positions: Float32Array; indices: Uint32Array }`（三角网格，世界空间）。

### 4.2 引用类型（区别于字面量）

```ts
/** 参数引用：执行前从参数表求值 */
export interface ParamRef { $param: string }

/** 语义引用：对上游几何的派生位置，重算时自动跟随 */
export interface GeomRef {
  $geom: {
    of: PartName                        // 上游左值变量名
    feature: 'bboxCenter' | 'faceCenter' | 'faceNormal' | 'bboxMin' | 'bboxMax'
    faceOrdinal?: number                // 拓扑面序号（getSubShapes(shape,'face') 索引），优先于 anchor
    anchor?: { point: Vec3; normal?: Vec3 }   // 拾取时记录的 point+normal（降级路径）
  }
}

/** 资产引用：SVG/XML 等大段文本不进 faijs 文本，由 AssetResolver 按 key 解析 */
export interface AssetRef { $asset: string }
```

`GeomRef` 求值语义：用 `of` 取上游几何 → 按 `feature` 求位置；`faceCenter/faceNormal` 优先按 `faceOrdinal` 直接取面，失败或无 ordinal 时用 `anchor` 找回最近面，最终降级 `bboxCenter`。

### 4.3 `CadStatement`（核心契约）

```ts
export interface CadStatement {
  id: StmtId                    // 语句 id（sN）——顺序稳定的语句身份；不再是变量名
  op: string                    // 函数名（见 §10 目录），必须命中白名单/注册函数
  args: Record<string, Arg>     // 该 op 的完备参数集
  inputs: ShapeRef[]            // 上游变量名（PartName，顺序敏感）
  name?: string                 // 语句显示名（Timeline 用），不进 args
  refs?: string[]               // 引用的变量名集合（inputs + args 中的 $param/$geom.of + group/assembly members）；parser 收集，编译期据此翻译为 deps
  outputs: PartName[]           // 本语句产出的变量名列表（单输出 [partName]；split [front,back]；void []）
  seq?: number                  // 全局序列号，timeline 跨 part 线性排序用（宿主 script-store 赋值）
  assemblyTarget?: PartName     // 装配链式调用专属：assem1.add_constraint(...) 的目标变量名
  hasAssignment?: boolean       // 是否有左值赋值（声明/裸重赋值/group-assembly 赋值 → true；add_constraint/do_assemble 方法链调用（无输出）→ false）
}
```

### 4.4 `PartScript` 与终端

```ts
export interface PartScriptMeta {
  name?: string
  appearance?: { color?: string; metalness?: number; roughness?: number }
}

/** 终端：return 数组中列出的最终输出；id 类型为 StmtId，语义为 PartName */
export interface TerminalShape {
  id: StmtId
  meta?: PartScriptMeta
}

export interface PartScript {
  source?: { kind: 'load' } | { kind: 'sdf' }
  params: ParamDef[]            // 参数表（const name = literal）
  statements: CadStatement[]    // 拓扑序：被依赖的语句在前
  meta?: PartScriptMeta         // 零件级模型属性（往返保真载体）；缺省时宿主按 op 兜底派生
  terminalShapes?: TerminalShape[]  // 显式 return [...] 的终端 override（缺省时运行期 DAG 判定）
}
```

**`meta` 的定位（往返保真载体）**：颜色与用户改过的名字不可从建模参数推导，必须显式记录；放 part 级 / `TerminalShape` 级而非 `args`。代码路径只携带结果值、执行端照做，不复制鼠标路径的配色/命名算法（兜底派生不是缺陷）。`CadStatement.name`（语句显示名）与 `meta.name`（零件名）是两回事，勿混。

---

## 5. 语法契约（`.faijs` 合法 JS 子集）

- `.faijs` 必须是 **JavaScript 的合法子集**——任意 JS 解析器（acorn）都能无错解析。加载流程：**acorn 解析（语法闸门：拒绝控制流等禁止形态）→ `compileToModule` 编译为 ESM 产物 → JS VM 动态 import 执行**。用户原文不直接执行（不 eval 用户文本）；编译产物由引擎从 IR 生成（当前实现为零 import ESM，走 `data:`/Blob URL——实现取舍，见 `docs/syntax-design.md` §6.1）。
- **禁止（规范要求）**：控制流（if/for/while/do/switch/try）、动态 `import()`、`eval`/`new Function`、`export`。越界一律 `ParseError`（控制流给专用错误码，路线图 V1.5）。
- **当前实现额外限制（临时，非规范）**：`param`/`with` 关键字、IIFE、模板字符串、函数定义、任意表达式语句等——这些是 parser 白名单的现状，随 V1 语言正常化逐步放开，见开发计划 `docs/plans/2026-08-29-faijs-normal-js-subset.md`。任意 callee 解构已支持（`const { a, b } = cad.mySplit(x)` 合法）。
- **平铺格式**（`scriptToCode` 产出，无 `export default` 包裹、无 `return`、无 `apiVersion` 头）：

```js
const size = 20                                   // 参数声明（右侧仅字面量）
let part0 = cad.box({ size })                     // 创建类语句（新名）
let part0 = cad.drill(part0, { diameter: 5 })     // 单入单出保名重赋值（let）
const { front: part1, back: part2 } = cad.split(part0, { … })  // split 双输出解构
let part3 = cad.group({ members: [part0, part1] })  // 结构型（compound 输出）
let part4 = cad.copy(part1)                       // 克隆型（新名，不消费源）
cad.faceCenter(part0)                             // 几何查询 → GeomRef
```

- **显式 return 仍受支持**：`return part0` / `return { shape, meta }` / `return [{ shape, meta }, …]` 产出 `script.terminalShapes`，执行期优先于 DAG 判定。
- **语句 id 可以是任意合法 JS 标识符**（AI/手写代码不受 partN 约束）；`partN` 只是 UI 生成代码的形态约定。
- 代码文本是 PartScript 的确定性序列化投影（`scriptToCode`/`statementToLine`），parser 与 codegen 双向同构；一个操作对应一行代码（注释/空行不计）。
- 错误形态：`ParseError`（parse 期，带 line）。

---

## 6. 终端判定契约（DAG 叶子，`terminal-dag.ts`）

**核心语义（用户 2026-08-27 澄清，最简）**：一个变量是否进终端 = 它「是否被消费」。被消费 → 不进终端。

- **"被消费"** = 存在一条**独占**语句 T（`T.op ∉ NON_CONSUMING_OPS`），其 index > 该变量最后一条赋值语句 P，且 T 的 inputs/refs 里包含该变量名（shape 出现在右侧）。
- **`NON_CONSUMING_OPS = {group, assembly, copy}`**：这三类语句**不消费**其右侧引用（group/assembly 不消费成员，copy 不消费源），在"消费方"判定中直接跳过。这是终端判定唯一需要特殊处理的点——除此之外，group/assembly 自身与其它 shape 无差别地按"是否被独占语句消费"判定。
- 判定单位是 **PartName**，不涉及 StmtId，与 partN 命名天然兼容。

**判定流程**（`collectResult` 内，显式 return 优先）：

1. 显式 `script.terminalShapes`（return [...]）优先；
2. 否则收集**所有 shape-typed 顶层变量名**（含 compound 变量；`isShapeLike` 只认 positions/indices，CompoundShape 无此二字段，须扩展遍历）；
3. `computeLeafTerminals(script, shapeVarNames)`：对每个变量名取"最后写者 P"，P 之后无独占语句消费它 → 终端。

**三个规范示例**：

| 脚本 | 终端 | 说明 |
|---|---|---|
| `x1=box; x2=drill(x1)` | `[x2]` | x1 被 drill 消费 → 非终端 |
| `x1=box; x1=drill(x1)` | `[x1]` | drill 即 x1 的最后写者，其后无消费 → x1 终端（drilled） |
| `x1=box; x2=assemble(x1); x1=drill(x1)` | `[x1, x2]` | assemble 不消费 x1；x2 无下游 → 双双终端；assemble 绑定 x1 最终值 |

**copy 示例**：`part0=box; part1=copy(part0)` → `[part0, part1]`（源显示 + 副本显示两份）；`part0=box; part1=copy(part0); part2=drill(part1)` → `[part0, part2]`（part1 被 drill 独占消费 → 非终端）。

### 6.1 parser 静态消费校验（规则 A/B，`validateConsumption`）

UI 生成的代码遵守静态命名规则（§3.1），不会触发；AI 生成的代码无法强制命名规则，故 parseScript 收尾处做两条静态检查（消费计数统一排除 `NON_CONSUMING_OPS`）：

- **规则 A（任何变量最多被消费一次）**：对每个 shape 变量 v，在其最后一次赋值 P 之后，被**独占语句**（op ∉ {group, assembly, copy}）消费的次数 ≤ 1；≥2 → `ParseError`（如 `part1=drill(part0); part2=extrude(part0)`）。
- **规则 B（成员必为终端）**：对每个 group/assembly 成员 m，在最后一次赋值 P 之后，不得被任何独占语句消费；违反 → `ParseError`（如 `part1=drill(part0); part2=group(part0,part1)`）。

两条规则是同一套"最后写者 + 下游无消费"消费者计数在两种变量上的不同阈值（非成员 ≤1，成员 =0）。这是宿主删除 `groupAssemblyMemberIds` 保活兜底的前提（见 `docs/plans/2026-08-27-restore-dag-terminal-detection.md` §5.2）：合法脚本中成员必为终端，无需宿主再兜底。

### 6.2 终端与执行产物

- `ExecutionResult.outputs` 仍含**全部** Shape 变量（含中间结果）——只是不进 terminals；`brepSolids`/拓扑**按 terminals** 提取/构建（中间变量无 BREP solid 与真拓扑，不导出 STEP、不建拓扑选择器）。
- 显式 `return [...]` 优先于 DAG。
- 增量（append/update）后终端集合与全量执行一致。

---

## 7. 执行契约（`CadRuntime`，`src/cad-runtime/runtime.ts`）

### 7.1 工厂与执行模式

```ts
createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime   // mode 缺省 'auto'
export type ExecutionMode = 'auto' | 'brep' | 'mesh'
```

- `auto`（默认）：优先 BREP，mesh-only op / 断链后按静态规则切 mesh + `part-brep-lost` 事件通知。
- `brep`：强制 BREP，不支持即报错（`BrepUnsupportedError` → `failedAt`），**不自动切换**。
- `mesh`：全部走 mesh 路径。

### 7.2 三入口 + plan + check + dispose

| API | 语义 |
|---|---|
| `execute(script, opts?)` | 全量执行：compileToModule → load → executeAll → collectResult |
| `append(script, newIds, opts?)` | 增量追加：只执行新增语句（前缀已在持久 ctx）；`newIds` 是源语句 outputs 中的 partName，翻译为编译产物 id |
| `update(script, opts?)` | 增量更新：plan() 得 stale 集 → reconcileCtx → executeFrom 重算；stale 为空则从 ctx 组装结果零执行 |
| `plan(script)` | 依赖分析，返回 `{ stale: CadStatement[]; reused: Map<PartName, string> }`（statementKey 级联） |
| `check(code)` | 干跑校验：parse（acorn 闸门）→ schema 校验（含 unknown-key）→ 引用预检（inputs/终端）→ `CheckResult` |
| `dispose()` | 释放全部 OCCT handle 与缓存 |

### 7.3 `ExecutionResult`（宿主主要消费面）

```ts
export interface ExecutionResult {
  outputs: Map<PartName, Shape>        // 全部 Shape 变量（含中间结果）
  brepChain: BrepChainState            // BREP 链状态（含逐 part solid 句柄）
  terminals: TerminalShape[]           // DAG 叶子终端（id 语义 = PartName）
  infos: string[]                      // 信息/警告列表
  failedAt?: { index: number; op: string; message: string }   // 执行中途出错
  brepSolids?: Map<PartName, { solid: ShapeHandle; kernel: OcctKernel }>  // 逐终端 BREP 实体
  topology?: Map<PartName, PartTopology>   // 拓扑运行时（E13：由 ExecutionResult 携带）
  compounds?: Map<PartName, PartName[]>    // compound 变量 → 成员变量名列表（group/assembly 结构）
  changed?: PartName[]                     // 被 touch 声明的原地修改 Shape 的持有变量名（去重）
}
```

### 7.4 `ExecuteOptions`

```ts
export interface ExecuteOptions {
  params?: Record<string, unknown>                 // 参数表（opts 优先，脚本 params 兜底）
  inputGeometryMap?: Map<PartName, Shape>          // 跨 part 输入几何
  sceneScript?: PartScript                         // 整场景 DAG（跨 part 引用解析）
  partTransform?: { position: Vec3; scale?: Vec3 } // part 世界→局部偏移 + 缩放
  beforeStatement?: (stmt: CadStatement, index: number) => void  // undo 逐语句快照
  startIndex?: number                              // 增量执行起点（缺省 0 = 全量）
  topology?: 'auto' | 'brep' | 'off'               // 拓扑构建开关（见 §11）
}
```

### 7.5 `ModuleExecutor`（VM 执行核心，`module-executor.ts`）

- **编译产物**：`compileToModule(script)` 生成**零 import** 的 ESM 文本（Node 走 `data:` URL，浏览器走 Blob URL）；每条语句 = `{ id: sN, deps: StmtId[], fn: (ctx, cad, exec) => Promise<void> }`。
- **ctx 持久变量容器**：跨 execute/append/update 存活；语句内所有脚本变量编译为 `ctx.<name>` 属性访问（支持原地重赋值）。
- **增量调度**：`executeAll` / `executeIds`（append）/ `executeFrom(staleIds)`（update）；`reconcileCtx` 回收"定义语句已不在脚本中"的变量并释放其内核资源（undo 删除语句后的必需动作）。
- **顶替释放预捕获**：fn 前捕获本语句写键的旧 handle，执行成功后释放（失败时缓存保持执行前状态，天然回滚）。
- **statementKey 缓存**：`key = op|JSON(args)|deps 的 outputContentKey`，plan 据此判定 stale；参数语句化后"改参数 → 参数语句 key 变化 → 级联下游 stale"。

### 7.6 `ExecContext`（库函数平台 API，`exec-context.ts`）

```ts
export interface ExecContext {
  readonly mode: ExecutionMode
  readonly kernels: { occt: OcctKernel | null; csg: CsgBackend | undefined; sdf: SdfBackend | undefined }  // 双内核地位对称
  getSolid(shape: Shape): ShapeHandle | undefined      // BREP 链记账（按 Shape 身份，身份槽）
  setSolid(shape: Shape, solid: ShapeHandle): void
  getFaceEvolution(shape: Shape): Map<number, number[]> | undefined
  setFaceEvolution(shape: Shape, evo: Map<number, number[]>): void
  dependentsOf(shape: Shape): Shape[]                   // 变更型库调用：传递下游查询
  touch(shape: Shape): void                             // 变更声明：持有它的变量列入 ExecutionResult.changed
  readonly fonts: FontProvider | undefined
  readonly texture: TextureSampler | undefined
  readonly assets: AssetResolver | undefined
  readonly events: EventSink
}
```

库函数统一形态：`(inputs..., args, exec) => Promise<Shape> | Shape`；`$geom` 查询函数末参 exec。

---

## 8. 双链路几何契约（BREP / Mesh）

### 8.1 `resolvePath`（静态判定，禁止运行时回退）

`src/stdlib/internal/resolve-path.ts`，库函数共享：

```ts
resolvePath(exec, inputs, brepImpl): 'brep' | 'mesh'
```

1. `mode='mesh'` → mesh（所有 op 必须实现 mesh 路径）。
2. `mode='brep'` → 无 brepImpl 或输入不全在链（`exec.getSolid`）→ **调用前抛错**（`BrepUnsupportedError` → failedAt）。
3. `mode='auto'` → 有 brepImpl 且全部输入在链 → brep；否则 mesh（空输入的创建类 `[].every()===true` → brep）。
4. **禁止运行时回退**：brep 路径执行抛异常 = bug，直接报错暴露。

**断链切换语义**：BREP 链上出现 mesh-only op（sdf/knurl）或输入断链后，**该链的后续部分走 mesh**；链之前的部分不变（仍是 brep）。切换由静态规则判定，无运行时 try-catch 回退。

### 8.2 `BrepChainState`（`src/brep/brep-chain.ts`）

```ts
export interface BrepChainState {
  solidCache: Map<PartName, ShapeHandle>   // 存在即该 part 仍为 BREP；缺失即已降级为 mesh
  kernel: OcctKernel | null                // mesh 模式为 null
  partTransform?: { position: Vec3; scale?: Vec3 }   // 世界→局部坐标偏移
  faceEvolutionCache?: Map<PartName, Map<number, number[]>>  // 面 ordinal 映射（布尔/变换 *WithHistory 产物）
  meshShapeCache?: Map<PartName, WasmMesh>  // 三角化缓存（拓扑 mesh = 显示 mesh）
}
```

- **逐 part**：不存在全局 brepActive 标志；一个 part 失去 BREP 状态当且仅当：被 mesh-only op 产生，或上游输入至少一个没有 BREP 实体。兄弟 part 互不污染。
- **静态 CAD 格式判定**：`isCadFormat(args, isSource)` —— `step/brep/stp` 走 BREP（IGES 不含，occt-wasm 未链接 TKDEIGES）；按 `args.format` 或 path/url 扩展名判定，纯函数、不 try-catch。
- **生命周期**：solid 所有权在**持久 solidCache**（重算顶替释放 / dispose 释放）；`releaseBrepChainState` 释放全部句柄（不再有"保留终端、释放中间"的选择性语义）。

### 8.3 Shape 与身份槽（`src/stdlib/shape.ts`）

- `solid(mesh)` / `compound(children)` 构造器产物是 Shape；`isShape` 只认构造器产物（WeakSet 登记），是终端判定的唯一依据。
- **身份槽** `WeakMap<Shape, Slot>`：`{ solid?, faceEvolution?, meshShape?, behavior? }`——链记账按 Shape 身份而非变量名，库函数不感知命名体系；`behavior` 槽是装配 compound 专有。
- **CompoundShape**：`{ kind: 'compound', children: Shape[] }`——结构（层级）而非新几何，无独立 mesh；可嵌套。它自身是 Shape → 是终端 → 在 UI 显示（显示方式由宿主决定：每个子对象各自显示 + 场景树层级）。

---

## 9. 宿主契约（`HostPorts` + 消费面）

### 9.1 `HostPorts`（`src/cad-runtime/ports.ts`）

```ts
export interface HostPorts {
  csg?: CsgBackend        // mesh 布尔/分割（Worker 或 Inline，位置由 createBrowserPorts 决定）
  sdf?: SdfBackend        // SDF 求值
  fonts?: FontProvider    // 字体字节加载 + key 列表
  texture?: TextureSampler // knurl 纹理采样
  assets?: AssetResolver  // load* 字节来源（resolveByKey / resolveFile / resolveUrl）
  events: EventSink       // 必填：emit('part-brep-lost', { partName, op, reason })
}
```

所有字段除 `events` 外可选——node 测试环境可只提供 occt kernel，BREP-path ops 不依赖 Ports。

### 9.2 宿主消费契约（3d_editor）

- 统一从 `@faicad/faijs/browser` 导入；符号级白名单（`contract-entry.test.ts`）锁定导出面。
- 执行统一走 `CadRuntime.execute/append/update`；**禁止**绕行引擎的手工执行循环（旧 `executeStatement`/`initBrepChainState` 等已删）。
- `terminalToScopedId: Record<PartName, ScopedId>` 键永远是 **PartName**（只增不删，反查取最后匹配）。
- 场景树层级从 `ExecutionResult.compounds` 构建（`buildSceneTreeFromDag` 消费 `sceneCompounds`），compound 子 shape 展开在 UI 层、不对成员做二次活跃性判定。
- 终端几何提交按 `result.terminals`；`brepSolids`/`topology` 直接消费（STEP 导出、拓扑重建）。
- **宿主不得重复实现 DAG 叶子过滤**（终端语义是引擎产物）；几何变更必须走 faijs 脚本语句。

---

## 10. stdlib 函数目录（`cad` 命名空间）

> 完整参数契约（含缺省值/必填）以 `src/mesh/api.d.ts`（**生成文件**，由 `scripts/gen-api-dts.ts` 从 `src/stdlib/schemas.ts` 生成，禁止手改）与 `docs/ops-api-inventory.md` 为准。下表是函数形态分类与消费语义。

### 10.1 创建类（无输入，单输出）

| 函数 | 同步/异步 | 说明 |
|---|---|---|
| `box` / `sphere` / `cylinder` / `cone` / `wedge` | 同步 | 原语；`size/radius/height/segments/center` 等 |
| `text` | 异步 | 文字轮廓挤出（font 资产） |
| `screw` | 异步 | 标准件（system/specIdx/thread/length/head） |
| `svgExtrude` | 异步 | SVG 挤出 |
| `sdf` | 异步 | mesh-only op（auto 模式发 part-brep-lost） |
| `load` | 异步 | `key/path/url` 恰居其一（schema 互斥校验）+ `format` |

### 10.2 变换类（1 输入，单输出，同步）

`translate`（offset）、`rotate`（anglesDeg/pivot）、`scale`（factor）。

### 10.3 特征类（1 输入，单输出）

| 函数 | 同步/异步 | 说明 |
|---|---|---|
| `drill` | 异步 | 孔（diameter/depth/holeType/direction/position/faceNormal/tolerance/screw*） |
| `extrude` | 异步 | 面拉伸（length/mode/normal/originOffset/space） |
| `engrave` | 异步 | 雕刻（mode/depth/text 或 svg） |
| `knurl` | 同步 | mesh-only op（顶点位移；auto 模式发 part-brep-lost） |

### 10.4 布尔（≥2 输入，单输出，异步）

`union` / `subtract` / `intersect` → 内部 op `boolean`（`args.operation`）；subtract/intersect 以 inputs[0] 为主体。函数名即操作，无独立 args 对象。

### 10.5 split（1 输入，双输出，异步）

`split(input, { cutMode, normal, offset, inPlaneAngleDeg, side, bbCenter, bboxSize, … })` → `{ front, back }`（解构语法 `const { front, back } = cad.split(…)`）；`cutMode` 含 plane/dovetail/dowel/straight-tenon/tenon/straight 及各自专属参数。

### 10.6 结构型（compound 输出）

| 函数 | 说明 |
|---|---|
| `group({ name, members, memberNames })` | compound Shape，无约束、无几何副作用，纯层级 |
| `assembly({ name, members, memberNames, constraints })` | compound Shape + AssemblyBehavior（约束求解 + 变换传播） |

**方法链**：`assem1.add_constraint({…})` / `assem1.do_assemble()`（void op，`outputs: []`，赋值即 ParseError）。

### 10.7 copy（克隆型，1 输入，单输出，同步）

`copy(input)`：**深拷贝**（方案 B）——mesh 路径复制 positions/indices 到新数组；BREP 路径 `kernel.copy(inputSolid)` + `solidToShape` + `setSolid`/`setFaceEvolution`（恒等面演化）。**不消费源**（`NON_CONSUMING_OPS`）、输出归"新名"类、源显示。

### 10.8 查询函数（`$geom` 派生位置，末参 exec）

`faceCenter` / `faceNormal` / `bboxCenter` / `bboxMin` / `bboxMax`——在文本中作为 `cad.faceCenter(part0)` 出现在 args 值位置，parser 转为 `GeomRef`；编译产物翻译为查询函数调用。另有 `asset(key, exec)`（`$asset` 引用解析）。

### 10.9 消费语义汇总（终端判定依据）

| 类别 | 消费其右侧引用？ | 命名 |
|---|---|---|
| 变换/特征/布尔/split/drill 等 | **是**（独占改写） | 单入单出保名；boolean/split 新名 |
| group / assembly | **否**（不消费成员） | 新名 partN |
| copy | **否**（不消费源） | 新名 partN（源保活显示） |

---

## 11. 拓扑契约

- `ExecuteOptions.topology`：`'auto'`（默认）为**终端**自动构建 BREP 真拓扑；`'brep'` 为所有在 BREP 链上的输出构建（含非终端）；`'off'` 不自动构建（只返回宿主 `setTopology` 注入的拓扑）。
- **BREP 真拓扑**由引擎在收尾时构建（复用身份槽 `meshShape` 三角化缓存，保证拓扑 mesh = 显示 mesh），随 `ExecutionResult.topology` 携带（E13 契约）。
- **假拓扑**（primitive 参数拼凑 / STL·3MF 特征检测）：宿主在加载/创建时刻构建，经 `runtime.setTopology` 注入，引擎透传；**假拓扑不重新生成**的契约不变。
- 宿主重建 SelectorRuntime 用 `buildSelectorRuntimeMaps`（从 `topology` 的 `SelectorRuntimeData` 构建）。

---

## 12. 装配 / 分组契约

- **产物是 compound Shape**（用户规定：属于 shape、在 UI 显示）：`group`/`assembly` 语句返回 compound，是终端（按 §6 判定）；自身无独立 mesh，几何由成员承载。
- **`ExecutionResult.compounds: Map<PartName, PartName[]>`**：compound 变量 → 成员变量名列表，由引擎收尾时从 compound 的 children 反查 ctx 变量名生成；宿主据此建场景树层级（UI 展开），不对成员做二次活跃性判定。
- **约束求解**（`src/stdlib/compound.ts` `solveAssembly`）：face_mate 约束 → `solveFaceMate` 求刚体变换 → 成员 mesh 原地变换 + BREP solid 变换同步 → `dependentsOf` 向下游传播（mesh 与 solid 都覆盖）→ `exec.touch` 声明变更（→ `ExecutionResult.changed`）。
- **group 语义**：原子组、零约束（`constraints: []`、`solve: () => {}`）；成员不准单独被修改（修改 group 即整体修改其全部成员）——此生命周期语义属后续独立项（见 `docs/plans/2026-08-27-restore-dag-terminal-detection.md` §4.3），不在终端判定范围内。
- **成员修改生命周期**（成员源语句变更 → 装配自动增量重算 / group 原子性约束）与终端判定正交，当前未实现、层未定，另起方案。

---

## 13. 不变式与版本化

### 13.1 身份契约（增量执行前提）

- 既有语句的 id（StmtId）**不得重命名、不得重排**；只能就地改 `args` 值（参数变更）或改 `op`（结构变更）。
- AI 提交 = **全量覆盖式文本**，引擎按 id 对齐做 diff（UNCHANGED / PARAM / STRUCT / ADD / DELETE），从首个变更点起重放。
- AI 新增语句的 id 由作者自定（任意合法 JS 标识符，不得与既有 id 重复）；删除特征 = 该 id 整行移除。
- 参数声明本身是语句（编译为 ctx 变量），"改参数 → 参数语句 key 变化 → 级联下游 stale"。

### 13.2 contentKey 与保真

- `computeContentKey`（positions/indices → 内容指纹）是几何等价的度量手段；statementKey = `op|JSON(args)|各依赖 outputContentKey`，plan 据此判定增量重算范围。

### 13.3 「结果一致」的边界（防回潮）

契约只保证：**代码 → 模型是一个函数**，且 `scriptToCode → parseScript` 往返后模型相同。**不保证也不要求**：代码路径与鼠标路径的内部实现/属性分配算法一致、实例 id 值相同、undo 栈结构相同。任何要求「代码算得和 UI 一样」的设计出现时，先回 §2 的 R-1 对照。

### 13.4 生成文件红线

- `src/mesh/api.d.ts` 是**生成文件**：由 `src/lang/args-schema.ts` 的 schema（经 `scripts/gen-api-dts.ts`）生成，禁止手改；改 schema 后必须重跑该脚本（`api-dts-sync.test.ts` 守卫生成物一致）。

### 13.5 兼容性

- 存量 `partN_vM` 与 `grp_N` fixture 原样可解析执行（解析器保留旧名格式识别），但新代码只产生 `partN`。
- `export default async (cad) => {}` 容器与扁平格式均可解析；扁平代码自动封装为合法容器。
- 顶层禁止控制流（语言约束），保证终端判定等静态规则不被 AI 代码破坏。
