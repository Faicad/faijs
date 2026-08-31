# 基于 brepjs 实现 faijs 的技术可行性分析

> 分析对象：`C:/git/OpenCascade/brepjs`（v18.164.0，Apache-2.0）
> 分析目的：判定 faijs 应「直接基于 brepjs 二次开发」还是「fork brepjs 改造源码」，或另择路线。
> 方法：实地读码 + 实测（本仓 `packages/mech-lib` 的 brepjs 集成测试已跑通 13/13）。
> 所有结论均附 `文件:行号`，可复核。

---

## §0 结论速览

**先给结论：不建议整体迁移到 brepjs，也不建议 fork。建议「分层采纳」。**

| 判定项 | 结论 | 一句话理由 |
|---|---|---|
| 直接基于 brepjs 重写 faijs | ❌ 不可行 | brepjs 的**形状模型与 faijs 相反**：单一 `KernelShape`、整树单内核、`importSTL` 进 OCCT。faijs 的立身之本（mesh/brep/sdf 混合建模）在 brepjs 里不存在。 |
| fork brepjs 改造源码 | ❌ 最差选项 | 要改的正是 brepjs 的**架构地基**（封闭节点集、单内核形状模型），改完即不是 brepjs；且上游 45 个版本 / 17 处 BREAKING 在前，rebase 是永久负债。 |
| 分层采纳（推荐） | ✅ | 算法层**移植**、拓扑历史层**抄思想**、库生态层**直接依赖**——后两层 faijs 已落地并实测通过。 |

**三个需求逐条判定：**

| faijs 需求 | brepjs 能否满足 | 关键证据 |
|---|---|---|
| ① UI 生成代码 `partN = libname.opname(args...)` | ⚠️ **部分**（模块加载机制可抄，op 扩展性不满足） | brepjs 第三方库是普通 JS 模块调公开 API；但加一个 op 要改 brepjs 源码树 |
| ② 增量执行 | ⚠️ **部分**（缓存机制更强，但绑在封闭 IR 上） | `csg/evaluate.ts:245-248` 的内容寻址缓存优于 faijs；但 IR 节点集封闭、求值器非重入、内核切换作用域拒绝 async |
| ③ BREP + mesh 融合 | ❌ **不满足，且方向相反** | 无跨内核转换；`meshBoolean` 在 OCCT 上直接抛错；STL 被导入成 OCCT faceted solid |

**一个反直觉但重要的发现：faijs 已经在用 brepjs，而且用对了。** `packages/mech-lib` 以 `dependencies` 依赖 `brepjs@18.119.2`，通过 `OcctWasmAdapter.fromKernel()` 复用 faijs 自己的 occt-wasm 实例（零额外 wasm 下载），把 brepjs 建的齿轮转成带 BREP 槽的 faijs `Shape`，再与 `cad.box` 做**精确 BREP 布尔**。实测 13/13 通过（见 §4）。

---

## §1 需求原文与验收口径

用户原话（逐字保留）：

> 通过前面的分析，我意识到faijs项目前期的很多设计是错误的。比如拓扑数据定义，没有历史追踪功能。而brepjs项目要合理的多。
> 所以我有一个想法，基于brepjs来实现faijs的需求。
> faijs独特的要求包括：1. 可以通过UI生成代码，目前的格式是partN=libname.opname(args...)
> 2. 能够增量执行UI生成的代码
> 3. 能够支持brep与mesh操作的融合。比如一个brep模型与一个stl文件的bool操作。
> 请分析基于brepjs项目，能否实现上面的需求。是直接基于brepjs二次开发，还是fork brepjs以后对源码进行改造？
> 请给一个技术分析报告。

**验收口径**：三条需求是**并列且缺一不可**的。下文以「三条全中」为「可行」的判据，任何一条不满足即判「不可行」。

**语言定位的唯一权威**（`C:\my\Faicad\3d_editor\Faijs语言的思考.md`，以下称《思考》）：

| 条款 | 原文 | 对本分析的约束力 |
|---|---|---|
| 总体目标 1（`:4`） | 「需要能同时支持brep/mesh/sdf（甚至点云逆向）等各种建模方式。」 | **与 brepjs 的单形状模型直接冲突** |
| 总体目标 2（`:5`） | 「需要支持多个后端建模引擎，目前brep用occt，mesh用manifold。未来要支持引擎切换。」 | 要求 brep / mesh **双槽独立切换** |
| 语言特性 4（`:12`） | 「faijs引擎负责代码的解析与校验…但是执行完全交给js虚拟机。」 | 执行必须是 JS VM，非 IR 求值器 |
| 语言特性 5（`:13`） | 「几何运算全部交给faijs语言库来实现，faijs引擎不内置。」 | **op 必须可由第三方库扩展** |
| 语言特性 7（`:15`） | 「faijs可以UI录制，按行增量执行。这是它和cadquery、openscad之类3D建模语言最大的不同。」 | 增量执行是**身份特征** |
| §5（`:79-80`） | 「运行时如何加载第三方写的faits库？可以参考brepjs的方案：`C:\git\OpenCascade\brepjs\docs\dynamic-third-party-library-loading_cn.md`」 | 用户已点名 brepjs 的**这一份**文档 |
| 其他 1（`:90`） | 「本语言的核心思想，不能放入 ../faijs 项目，以免专利失效。」 | 语言核心思想不进 faijs 仓 |

---

## §2 brepjs 架构解剖：两个互不相交的执行模型

**这是全文的支点。** brepjs 内部并存两套执行模型，而 faijs 需要的三样东西恰好分处于两侧。

### §2.1 模型 A —— 命令式 API（`src/topology/api.ts`）

普通 TypeScript 函数，直接调内核：

```ts
// src/topology/api.ts:155-203
export function fuse<T extends Shape3D>(...)
export function cut<T extends Shape3D>(...)
export function fillet<T extends ValidSolid>(shape, radius): Result<T>
export function chamfer<T extends ValidSolid>(...)
```

- **扩展方式**：写一个新的 `*Fns.ts`，`getKernel()` 拿内核直接干活
  （`apps/docs/extending/custom-ops.md:10-21` 给出落文件位置的表格）
- **性质**：开放、库化、可被第三方 npm 包调用 —— **形状上等同于 faijs 的 stdlib**
- **代价**：**无历史追踪、无增量、无拓扑引用持久性**。每次调用是一次性的内核操作。

第三方库生态就建在模型 A 之上（`docs/dynamic-third-party-library-loading_cn.md:179-214`）：库就是普通 npm 包，`package.json` 依赖 brepjs，`import { sketchExtrude, cut } from 'brepjs'` 直接用。

### §2.2 模型 B —— 声明式 CSG IR（`src/csg/`）

一个**内容寻址 DAG**，节点带 Merkle 哈希与自由参数集：

```ts
// src/csg/types.ts:23-26
export interface IRNodeBase {
  readonly structuralHash: bigint;
  readonly freeParams: ReadonlySet<string>;
}

// src/csg/types.ts:181-197（拓扑引用以纯数据形式进入节点，因此可哈希）
export interface FilletNode extends IRNodeBase {
  readonly kind: 'Fillet';
  readonly target: IRNode;
  readonly ref: EdgeRef;      // 可序列化 lineage 引用
  readonly radius: Expr;
}
```

求值器带**子树级缓存**：

```ts
// src/csg/evaluate.ts:1-3
// Cache key = (structuralHash, kernelId, projectedEnvHash, toleranceHash).
// Only the param keys a subtree depends on enter its env projection, so
// unrelated env changes don't invalidate independent subtrees.
```

```ts
// src/csg/evaluate.ts:245-248
function cacheKey(node, env, kernelId, tolerance) {
  return `${toHex(node.structuralHash)}:${kernelId}:${toHex(projHash)}:${tolHash}`;
}
```

**模型 B 的三个硬约束（逐条实测）**：

| 约束 | 证据 | 后果 |
|---|---|---|
| **① 节点集封闭** | `src/csg/types.ts:288-303` 是 `IRNode` 闭联合；`src/csg/evaluate.ts:122-124` 注释：「Exhaustive dispatch — TS catches any new NodeKind missing an evaluator at compile time, so there's **no runtime 'unknown kind' fallback**」；全 `src/csg/*.ts` 搜 `Custom\|registerNode\|plugin\|userOp` **零命中** | 加一个 op = 改引擎（types + builders + evaluator + serialize + optimize + edit），**不是库能做的事** |
| **② 整树单内核** | `src/csg/evaluate.ts:452` `this.kernelId = options.kernel ?? getActiveKernelId() ?? 'unregistered'`；`:492` `return withKernel(this.kernelId, () => {...})` | DAG 中**不存在**「这个节点走 OCCT、那个节点走 manifold」 |
| **③ 串行模型，拒绝 async** | `src/kernel/index.ts:96-115`：`withKernel()` 显式检测并抛出「callback returned a Promise. Async code must use getKernel(id) directly」；`src/csg/evaluate.ts` 头部：`evaluate()` **非重入**（从 `onStep` 回调里调用会抛） | faijs 的执行链是 **async**（wasm 初始化、worker、动态 import），与 brepjs 的同步作用域模型不兼容 |

**持久化格式是 JSON，不是源码**：

```ts
// src/csg/serialize.ts:41-48
export const CSG_VERSION = 8;
export interface CsgEnvelope {
  readonly csgVersion: number;
  readonly defs?: readonly unknown[];
  readonly root: unknown;
}
```

全仓搜 `codegen` / `toSource` / `generateCode`（`src/csg/`、`src/topology/`、`packages/brepjs-cad/src/`）**零命中** —— brepjs **没有任何文本源码表示**，`partN = libname.opname(...)` 这种形态在 brepjs 里没有对应物。

### §2.3 形状模型：单一 `KernelShape`，没有 mesh 表示

这是与 faijs 最根本的分歧，必须讲清楚：

| | faijs | brepjs |
|---|---|---|
| 形状类型 | `Shape = { positions: Float32Array; indices: Uint32Array }`（`packages/core/src/mesh/types.ts:38-41`）—— **mesh 是必有载荷**；BREP 是可选叠加层 | 单一 `KernelShape`（内核句柄的不透明别名）。**没有 mesh 类型** |
| STL 落到哪 | mesh 路径（manifold-3d），永不进 OCCT | **OCCT**：`src/io/importFns.ts:65` `getKernel().importSTL(data)` → 返回 `KernelShape`，经 `ShapeUpgrade_UnifySameDomain` 缝成 faceted solid |
| 混合建模 | 一等公民（`dispatchPath` 静态判定 + 断链物化） | **不存在** |

**跨内核转换不存在。** 全仓搜 `toKernel` / `convertShape` / `crossKernel` 在形状层面**零命中**；`asManifoldShape` 只是一个**类型守卫**，不做任何转换：

```ts
// src/kernel/manifold/meshHandle.ts:34-39
export function asManifoldShape(shape: KernelShape): ManifoldShape | undefined {
  if (shape && typeof shape === 'object' && 'manifold' in shape && 'node' in shape) {
    return shape as ManifoldShape;
  }
  return undefined;
}
```

### §2.4 mesh→BREP 的唯一桥梁：op-graph replay（单向、有禁区）

brepjs 的 manifold 适配器给每个网格操作记录一个 `OpNode`：

```ts
// src/kernel/manifold/opGraph.ts:33-47
export interface OpNode {
  readonly op: OpKind;                              // 开放 string union
  readonly params: Readonly<Record<string, unknown>>;
  readonly inputs: readonly OpNode[];
  readonly replayable: boolean;
}
export function makeNode(op, params, inputs): OpNode {
  const replayable = opIsReplayable(op) && inputs.every((i) => i.replayable);
  return { op, params, inputs, replayable };
}
```

replay 引擎后序遍历该图，在 OCCT 上**重放**出真正的 B-rep（`src/kernel/manifold/replay.ts:1-8`）。

**禁区写在两处，措辞毫不含糊**：

```ts
// src/kernel/manifold/opGraph.ts:24
// - non-replayable origins: importMesh, importSTEP, importIGES, fromBREP, spine
```

```ts
// src/kernel/manifold/replay.ts:16-17
// Non-replayable nodes (raw-mesh imports, mesh booleans, triangle sewing) have
// no exact B-rep counterpart; replaying one throws.
```

```ts
// src/kernel/manifold/replay.ts:529-537
if (!node.replayable) {
  throw new Error(
    `manifold replay: op '${node.op}' is not replayable (raw-mesh origin or unsupported)`
  );
}
```

**⇒ 用户点名的场景「一个 brep 模型与一个 stl 文件的 bool 操作」，在 brepjs 的 replay 机制下走不通**：STL 的 origin 是 `importMesh`（非 replayable），无法提升到 BREP。

### §2.5 brepjs 自己的「线性历史」：`historyFns` 是公开 API 但零内部消费

`src/operations/historyFns.ts`（399 行）提供了非常接近 faijs 语句表的模型：

```ts
// src/operations/historyFns.ts:23-36
export interface OperationStep {
  readonly id: string;
  readonly type: string;                              // 'extrude' | 'fuse' | 'fillet' ...
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly inputIds: ReadonlyArray<string>;
  readonly outputId: string;
  readonly timestamp: number;
}
export interface ModelHistory {
  readonly steps: ReadonlyArray<OperationStep>;
  readonly shapes: ReadonlyMap<string, AnyShape<Dimension>>;
}
```

配上 `replayFrom(history, stepId, registry)`（`:245`）、`modifyStep(history, stepId, newParams, registry)`（`:325`）、`serializeHistory/deserializeHistory`（`:357/:375`）—— **形似 faijs 的语句级增量重放**。

**但它是死的。** 全仓消费点只有两处 re-export：

```
src/index.ts:934,944,950,954        // 导出
src/operations.ts:94,104,108,111    // 导出
apps/playground/src/types/brepjs-ambient.d.ts:6495-6561   // 类型声明
```

没有任何 brepjs 内部模块调用它。这与 brepjs 的 `capabilities`（全仓无消费方，只描述不路由）是**同一种模式**：**提供了机制，不负责接线**。

> 判读：`historyFns` 是「你自己拿去搭历史系统」的工具箱，不是 brepjs 自身的建模主干。把它当成「brepjs 有历史追踪」的证据会误判。brepjs 真正在运转的历史追踪，是 §2.2 的 CSG IR + §2.6 的 shapeRef。

### §2.6 拓扑历史追踪：`shapeRef`（这部分确实值得学）

核心命题（上一份倒角文档已论证，此处只复述结论）：

```
// src/topology/shapeRef/shapeRefTypes.ts:88
An edge *is* the intersection of its two faces.

// src/topology/shapeRef/shapeRefTypes.ts:94-100
export interface EdgeRef {
  readonly faceRoles: readonly [string, string];   // :97
  ...
}
```

分层要点：`faceRoles` 是**身份**，`hint` 仅在两 role 共享多条边时做 tiebreaker（分差 < `HINT_MARGIN = 1e-6` 判 `ambiguous`，**不随便挑**）。

---

## §3 三项需求逐条对照

### §3.1 需求 ①：UI 生成代码 `partN = libname.opname(args...)`

**拆成两半看：模块加载（✅ 可抄） + op 扩展性（❌ 不满足）。**

#### (a) 模块加载机制 —— brepjs 有成熟方案，且用户已点名

`docs/dynamic-third-party-library-loading_cn.md` 的论证链：

| 结论 | 出处 |
|---|---|
| 浏览器只认四类 specifier（URL / 相对 / 绝对 / blob:data:），**裸标识符 `from 'my-gear-lib'` 无法解析** | `:11-20` |
| **import map 在 Worker 内一律无效**（常见误解，需更正） | `:25` |
| 唯一同时满足「Worker 内 + 运行时动态注册」的方案 = ④ 模块注册表 + 单例 Blob wrapper + 源码改写 | `:37-44` |
| Blob 装不下「活的库」→ 先挂 `self.__lib`，再让 Blob 只写 `export const box = m["box"]` | `:52-61` |
| CDN 库的内部 brepjs 必须指向同一单例，否则「内核未注册 / 几何孤岛」 | `:167-175` |

**faijs 已经解决了同一问题，且路径相同。** `packages/core/src/cad-runtime/module-executor.ts:95-101` 明确写着：

> 「dynamically imports compiled modules from data:/Blob URLs (zero imports, isomorphic on both platforms)」

**⇒ 这一半不需要从 brepjs 引入任何东西。**

#### (b) op 扩展性 —— brepjs 的模型 B 是封闭的，与《思考》第 13 条正面冲突

《思考》`:13`：**「几何运算全部交给faijs语言库来实现，faijs引擎不内置。」**

brepjs 的自定义 op 文档在这一点上是诚实的：

```
// apps/docs/extending/custom-ops.md:8
The examples assume you're contributing to brepjs upstream, but the same structure
works for a fork or a local extension.
```

```
// apps/docs/extending/custom-ops.md:10-21
| Operation kind             | File pattern                   | Layer |
| New primitive              | src/topology/<name>Fns.ts      | 2     |
| Composition (extrude-like) | src/operations/<name>Fns.ts    | 2     |
... (共 8 类)
```

**「加一个 op」= 往 brepjs 自己的 `src/` 树里加文件。** 而且加出来的 op 落在 §2.1 的模型 A —— 它是命令式的 `getKernel()` 调用，**不进 CSG IR，因此不享受历史追踪与增量缓存**。

**⇒ brepjs 的两半是断裂的**：
- 想要**第三方库扩展 op**（faijs 需求 ①、《思考》第 13 条）→ 只能用模型 A → **丢掉历史与增量**
- 想要**历史与增量**（faijs 需求 ②的强化）→ 只能用模型 B → **op 必须内置于引擎，第三方无法扩展**

**brepjs 自身没有把这两半接起来**（`historyFns` 零消费就是证据）。faijs 需要的正是这个接缝。

#### (c) 文本源码格式

`partN = libname.opname(args...)` 要求**文本源码**是一等公民。《思考》`:11`：「UI生成的代码不需要类型，也就是生成js代码。」

brepjs 没有文本源码：持久化是 `CsgEnvelope` JSON（`src/csg/serialize.ts:41-48`）；`packages/brepjs-cad` 的 sandbox 执行的是**子进程里的 TS 程序**（`packages/brepjs-cad/src/sandbox/runProgram.ts:1-8`，spawn 子进程 + 超时 + 内存上限，结果以 JSON 跨进程传递）—— 那是一个**一次性、无增量、无状态**的执行器，与「UI 录制、按行增量执行」不是一回事。

**判定：需求 ① 的模块加载可抄，op 扩展性与文本源码形态不满足。**

---

### §3.2 需求 ②：增量执行

**brepjs 的缓存机制本身比 faijs 更强，但它长在一个 faijs 用不上的 IR 上。**

#### 机制对比

| 维度 | faijs | brepjs CSG IR |
|---|---|---|
| 缓存键 | `op\|JSON(args)\|deps 的 outputContentKey`（`module-executor.ts:102`）；content key = mesh 的 FNV-1a 哈希（`content-key.ts:10-32`） | `structuralHash : kernelId : projectedEnvHash : toleranceHash`（`evaluate.ts:245-248`） |
| 失效分析 | **动态**：依赖下游**实际产物内容** | **静态**：节点预计算 `freeParams`，只有子树真正依赖的参数进入 env 投影 |
| 粒度 | 语句级（`StmtId`） | 节点级（子树） |
| 缓存管理 | 无 LRU 说明 | LRU 可选（`maxCacheEntries`）、事务性（失败的 evaluate 不改缓存）、`onStep` 可观测命中（`evaluate.ts:88-100`） |
| 执行模型 | async，JS VM | **同步**，非重入，内核作用域拒绝 Promise |

**brepjs 的 `freeParams` 投影确实更精确**：faijs 只有执行/命中相邻层之后才知道某个上游是否变了；brepjs 在建树时就静态知道「这个子树的输出只依赖参数 `{w, h}`」，改 `d` 不会让它失效。

#### 但换不过来，三个理由

1. **IR 是封闭的**（§2.2 约束①）。faijs 的 op 住在库里（22 个 stdlib 文件 + `mech-lib` + 未来第三方库），无法表达为 30 个固定节点 kind。
2. **执行必须是 JS VM**（《思考》`:12`「执行完全交给js虚拟机」）。brepjs 的 Evaluator 是自己的解释器。
3. **同步模型**（§2.2 约束③）。faijs 全链 async。

#### 可借鉴的点（值得，且改动可控）

| 可借鉴 | 落到 faijs 何处 |
|---|---|
| `freeParams` 静态失效分析 | 在 parser 静态提取阶段为每个语句计算「依赖的参数名集合」，与现有 statement key 求交 —— 提高参数化编辑的命中率 |
| `onStep` + `cacheHit` 可观测性 | `ModuleExecutor` 已有 `cache`，补一个 step 回调即可支持 UI 显示「本次重算了 3 步」 |
| 事务性缓存（失败不污染） | faijs 的 `cache` 是 `Map<StmtId, {key, outputContentKey}>`，失败路径需确认不清空已有条目 |

**判定：需求 ② faijs 已有可用方案；brepjs 的更强但绑定封闭 IR，可抄其增量分析思想，不可换其 IR。**

---

### §3.3 需求 ③：BREP + mesh 融合（brep 模型 × stl 文件布尔）

**这是 brepjs 最弱的一环，而且它的「解法」与 faijs 的定位方向相反。**

#### (a) brepjs 里没有跨内核布尔

- 求值器固定单内核（`evaluate.ts:452`），DAG 无法表达混合
- 无跨内核转换（`asManifoldShape` 只是类型守卫，`meshHandle.ts:34-39`）
- replay 单向，且 `importMesh` 是显式禁区（`opGraph.ts:24`、`replay.ts:529-537`）

#### (b) OCCT 适配器的 mesh 布尔直接抛错

```ts
// src/kernel/occtWasm/booleanOps.ts:179-187
export function meshBoolean(...)  {
  throw new Error('occt-wasm: meshBoolean is not supported (use brepkit for mesh booleans)');
}
```

```ts
// src/kernel/interfaces/booleanOps.ts:38-46
/**
 * **Cross-kernel note**: Only brepkit supports mesh booleans natively.
 * OCCT adapter throws.
 */
```

#### (c) brepjs 的「解法」：把 STL 塞进 OCCT 做精确布尔

```
src/io/importFns.ts:65  importSTL(blob) → getKernel().importSTL(data) → KernelShape
                        （OCCT 内核；ShapeUpgrade_UnifySameDomain + 缝成 solid）
```

**技术评价**：这条路**能算**，但正是 faijs 明确拒绝的路 —— OCCT 拿一个 10 万三角的 faceted solid 去参与 `BRepAlgoAPI` 精确布尔，是 CAD 界公认的慢且易碎路径。用户在前序会话中的原话（项目记忆 2026-08-29）：

> 「加入我导入一个stl文件，然后建模一个box，然后布尔。怎么处理？怎么可能是什么治本？错的离谱。必需支持mesh+brep的布尔。这是必需支持的场景。」

#### (d) 踩上 AGPL

要在 brepjs 里做网格布尔，唯一出路是 brepkit。实测 `package-lock.json`：

```
node_modules/brepkit-wasm => "AGPL-3.0-only"   v3.3.7
node_modules/manifold-3d  => "Apache-2.0"      v3.5.1
node_modules/occt-wasm    => "MIT OR Apache-2.0" v4.3.0   ← npm 字段只描述 tooling
```

brepjs 的 `packages/brepjs-manifold`（manifold 网格内核适配）是 **MIT**，但它是 **optional peerDependency**（`package.json` `peerDependenciesMeta`），不是默认路径。

#### (e) faijs 的做法反而更对

faijs 的 `Shape` 以 mesh 为必有载荷，STL 走 mesh 路径，brep 在断链时刻物化为 mesh 后做 **manifold 布尔**（`manifold-3d` = Apache-2.0）。代价是断链后不可自动恢复（单向，这是设计决定，见项目记忆）。

**判定：需求 ③ brepjs 不满足。若强行采纳 brepjs，要么丢掉这个需求，要么背上 AGPL 依赖。**

---

### §3.4 附带问题：mesh 近似拓扑的历史追踪

（用户在前一轮提出：「本项目对stl之类的生成了近似拓扑，这部分没法做历史追踪，你判断要如何重构，也许只是简单的让数据格式兼容。」）

**brepjs 对此也没有答案** —— 它没有 mesh 表示，STL 被缝成 OCCT faceted solid 后，「面」就是真的 OCCT face，于是问题被**绕开**而不是被解决（代价是 §3.3(c) 的性能与鲁棒性）。

**faijs 侧的根因**：mesh 拓扑的面/边 id 来自**每次三角化后的重新编号**，没有稳定身份，因此跨操作无从追踪。而 BREP 侧的 ordinal 来自 `getSubShapes` 枚举，在确定性重放下是稳定的。

**建议（用户的直觉是对的：主要是数据格式兼容）**：

| 层 | 做法 |
|---|---|
| **id 空间统一** | mesh 近似拓扑与 BREP 真拓扑共用同一套 `SelectorId` 编排（`o1.f3` / `o1.e7`）与同一份 `Reference` 结构（`packages/core/src/topology/types.ts`）。UI 层零改动。 |
| **来源标记** | `Reference` 增加 `provenance: 'brep' \| 'mesh-approx'`。**格式统一，能力分层。** |
| **能力分层** | `provenance === 'brep'` → 可历史追踪（lineage 校验可用）；`provenance === 'mesh-approx'` → **可选中、可作为参数传入，但明确不支持历史追踪**，UI 在编辑历史引用时显式提示「该引用来自近似拓扑，参数变更后可能失配」。 |
| **禁止事项** | **不得**为了「看起来能做历史追踪」而给 mesh 面编造稳定 id（例如按几何哈希命名）—— 那会把「近似」伪装成「精确」，是静默错误。 |

这与《思考》`:52` 的判据一致：「原来文档里写的『每个 API 返回新几何，不修改输入』。这是实现细节，并不是语义上的规定。」 —— 分层要看**语义**，不是看实现细节是否凑得上。

---

## §4 已有的实证：faijs 已经在用 brepjs，而且用对了

这一节是本分析中最有分量的事实，因为它把「直接依赖」从推想变成了**已验证**。

### §4.1 依赖声明

```json
// packages/mech-lib/package.json:14
"dependencies": { "brepjs": "18.119.2" }
```

硬依赖（非 dev、非 peer）。根 `node_modules/brepjs` 已安装，实测版本 `18.119.2`。

### §4.2 adapter 的五项职责（`packages/mech-lib/src/brepjs-gear.ts:1-25`）

```
① 注入 faijs 内核：OcctWasmAdapter.fromKernel(getRawModule/getRawKernel)
   复用 faijs 的 occt-wasm 实例 —— 零 shim、零额外 wasm 下载
② 调 brepjs 建形（makeExternalGear / makeInternalGear / makePlanetaryGear / thread）
③ wrapped.id → fromHandle 转 faijs Shape（拿到 BREP 槽，hasBrep === true）
④ 模块级数组钉住 brepjs 句柄，阻止 GC / FinalizationRegistry 兜底释放
⑤ 错误转译：isErr(r) → throw new Error(code + ': ' + message)，不静默
```

### §4.3 实测结果（本次分析时执行）

```
npx vitest run src/brepjs-gear.test.ts src/c3-brepjs-scenario.test.ts

 ✓ src/c3-brepjs-scenario.test.ts (4 tests) 14564ms
 ✓ src/brepjs-gear.test.ts (9 tests) 34296ms
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

覆盖的关键断言：

| 断言 | 含义 |
|---|---|
| C3-1 | brepjs 建的齿轮 `hasBrep === true`（精确几何，非 faceted） |
| C3-2 | `cad.union(gearPart, boxPart)` 的 `dispatchPath === 'brep'`，**不降级到 mesh** |
| C3-3 | UNION 结果导出 STEP 含 `ADVANCED_FACE`（精确，非 faceted `POLYGONAL`） |
| C3-4 | brepjs `GearResult` 字段（pitch=48 / tip=52）与 faijs 网格外径吻合 |
| C1-4 | 句柄所有权：模块级 pinned 递增，只钉不释 |
| C1-5 | 错误转译：非法入参 → throw，携带 brepjs error code |

**⇒ 「brepjs 作为第三方库被 faijs 消费」这条路已经打通，且共享同一份 occt-wasm。这正是需求 ①的正解形态。**

### §4.4 另一条已走通的路：算法移植（`packages/stdlib/src/brepjs-mirror/`）

```
threadFns.ts        150 行   + threadFns.test.ts      216 行
joinery-brep.ts     656 行   + joinery-brep.test.ts   277 行
```

`brepjs-mirror/threadFns.ts:1-16` 的移植说明逐条列出了差异：

```
- brepjs 用 BlueprintSketcher + line() + wire() 构造截面 → 本项目直接用 kernel.makeLineEdge + kernel.makeWire
- brepjs 用 loft() 函数               → 本项目直接用 kernel.loft(wires, isSolid, ruled)
- brepjs 用 DisposalScope 管理中间句柄 → 本项目手动 kernel.release
- brepjs 用 Result 类型               → 本项目抛出异常
```

**⇒ 移植一个 brepjs 算法的成本 ≈ 150 行 + 一份机械的 4 点适配清单。这是「抄算法不抄框架」的可行性与成本的直接证据。**

---

## §5 三条路线对比

| 维度 | ① 直接依赖 brepjs（推荐） | ② fork brepjs 改造 | ③ 移植算法（已在做） |
|---|---|---|---|
| 落地成本 | **已落地**（mech-lib，13/13） | 极高 | 低（150 行/op 量级） |
| 需求 ① op 扩展 | ✅ 库即 npm 包 | ⚠️ 改源码树 | ✅ |
| 需求 ② 增量 | ❌ 依赖 brepjs 侧无增量（模型 A） | ⚠️ 需开放 IR | ✅ faijs 自持 |
| 需求 ③ mesh 融合 | ❌ | ❌ 需重写形状模型 | ✅ faijs 自持 |
| 拓扑历史追踪 | ❌ 跨库不连贯（brepjs 侧无 lineage 输出给 faijs） | ⚠️ 需自己接 | ⚠️ 需自己实现（抄 shapeRef 思想） |
| 升级成本 | 锁版本 + adapter 契约测试 | **永久 rebase** | 无（复制即拥有） |
| 许可证 | brepjs Apache-2.0 ✓ | 继承 Apache-2.0 ✓ | 需注意源文件的 Apache-2.0 署名义务 |
| 专利风险（《思考》`:90`） | 低（不引入语言核心思想） | 中（可能带入其建模范式） | 低 |

### §5.1 为什么 fork 是最差选项

1. **要改的是地基，不是房间。** 需要改的三处 —— 开放 IR 节点集（`types.ts` 闭联合 + `evaluate.ts` 穷举 switch）、跨内核形状模型（单一 `KernelShape`）、async 执行模型（`withKernel` 显式拒绝 Promise）—— 每一处都是 brepjs 的设计前提。改完之后的产物不是 brepjs。
2. **上游不会接受这些改动**（方向相反），所以 fork 必然是**永久分叉**。
3. **上游节奏极端。** 实测：

```
faijs 锁定 brepjs 18.119.2  →  当前 18.164.0（落后 45 个版本）
CHANGELOG 中 "BREAKING CHANGE" 条目：17 处
近期发布：2026-08-19 → 2026-08-28 约 20 次发布（实测 CHANGELOG.md:3-176）
git log 总量：955 commits
```

   fork 意味着每周处理若干个上游 breaking change，而 faijs 自己的双链架构、拓扑体系、UI 集成还在推进中。
4. **fork 换不来需求 ②③。** 形状模型与增量模型都得重写，等于从头写一个 faijs，还要额外维护一个分叉。

### §5.2 为什么「直接依赖」也不能作为整体方案

它解决需求 ①（已验证），但**不解决需求 ②③**，且会引入一个新的问题：**跨库拓扑身份断裂**。

brepjs 建的几何经 `fromHandle` 进 faijs 后，faijs 侧**没有面演化历史**（`packages/mech-lib/src/b7-no-face-evolution.test.ts:1-22` 已实证，且该文件记录了引擎现状：faceEvolution 全库只有写入方、无引擎侧读取消费者，面选择退化为「实时枚举当前面的 ordinal」，几何精度不受影响）。

**⇒ 一旦 faijs 补上真正的拓扑历史追踪（当前欠缺、也是用户本次关切的起点），brepjs 产物会成为这条链上的**断点**。** 这需要在 adapter 层显式处理，不能默认它「自然就通」。

---

## §6 许可证与供应链（实测数据）

这是采纳 brepjs 的**最大收益**，值得单独讲。

### §6.1 实测许可证

| 包 | 版本 | 许可证 | 来源 |
|---|---|---|---|
| `brepjs` | 18.164.0 | **Apache-2.0** | `LICENSE` 头 |
| `brepjs-manifold` | 0.1.0 | **MIT** | `packages/brepjs-manifold/package.json` |
| `brepjs-cad` | 0.178.0 | Apache-2.0 | `packages/brepjs-cad/package.json` |
| `manifold-3d` | 3.5.1 | **Apache-2.0** | `package-lock.json` |
| `occt-wasm` | 4.3.0 | tooling **MIT OR Apache-2.0** / **WASM 产物 LGPL-2.1-only** | `node_modules/occt-wasm/README.md:410-416` |
| `brepkit-wasm` | 3.3.7 | **AGPL-3.0-only** | `package-lock.json` |

occt-wasm README 原文（`:412-416`）：

```
**Build tooling** (xtask, scripts, TypeScript wrapper): MIT OR Apache-2.0
**Compiled WASM output**: LGPL-2.1-only (inherits from OCCT)
The LGPL requires that end users can replace the LGPL component. For web applications,
this is satisfied by loading the .wasm file from a URL ... If you ship a desktop app
with the WASM embedded, consult the LGPL-2.1 FAQ.
```

### §6.2 brepjs 的许可证架构 —— **这个范式值得 faijs 抄**

brepjs 本体保持 Apache-2.0 的办法，是把所有有传染性的依赖做成 **optional peer dependency**：

```json
// package.json
"peerDependencies": {
  "brepjs-manifold": "^0.1.0",
  "brepjs-opencascade": "^0.5.1 || ... ",
  "brepkit-wasm": "^0.10.1 || ^1.0.0 || ^2.0.0 || ^3.0.0",
  "occt-wasm": "^3.8.0 || ^4.0.0"
},
"peerDependenciesMeta": {
  "brepjs-manifold":   { "optional": true },
  "brepjs-opencascade":{ "optional": true },
  "brepkit-wasm":      { "optional": true },
  "occt-wasm":         { "optional": true }
}
```

运行时按需加载（`src/quick.ts:9` + `src/kernel/optionalBackend.ts:15` 的**可变动态 import**，对打包器不可分析，故未安装的后端不会构建期失败）。

**这正好是《思考》`:5`「未来要支持引擎切换」与 faijs 私有打包诉求所要求的架构形态。** faijs 当前的 `BrepEngineApi` 双槽（brep 槽 + mesh 槽）在**接口层**已经是这个形状；可补的是**依赖层**的 optional peer + 动态 import 手法，以及明确记录每个后端引擎的许可证分层（与项目记忆中「occt-wasm 授权分层」一条一致）。

### §6.3 一个必须避开的坑

**不要因为「brepjs 支持网格布尔」而引入 brepkit**（`brepkit-wasm` = AGPL-3.0-only）。faijs 的网格布尔走 `manifold-3d`（Apache-2.0），已满足私有打包诉求，无需换。

### §6.4 体积

`.size-limit.json`：`brepjs` 主入口 **68 kB**（gzip 前的 JS），全部 JS 380 kB 上限。occt-wasm 的 wasm 是外链。对 3d_editor 而言，若以 optional peer 方式引入 brepjs，只在用到 `mech-lib` 齿轮等能力时才加载，主路径不受影响。

---

## §7 建议方案：分层采纳

```
┌─────────────────────────────────────────────────────────────┐
│ L3  库生态层   brepjs 作为第三方库  ← 已落地（mech-lib）      │
│                继续：更多 brepjs 能力经 adapter 接入          │
├─────────────────────────────────────────────────────────────┤
│ L2  拓扑历史层 抄 shapeRef 的【思想】，不抄代码               │
│                faijs 是纯文本确定性重放 → ordinal 稳定，      │
│                不需要 brepjs 的 role 表；但照抄其「校验」哲学 │
├─────────────────────────────────────────────────────────────┤
│ L1  算法层     移植 brepjs 算法到 BrepEngineApi              │
│                已有先例：brepjs-mirror（thread / joinery）    │
├─────────────────────────────────────────────────────────────┤
│ L0  引擎/形状层 不动。保留 Shape={positions,indices} + 双槽   │
│                这是 faijs 与 brepjs 的根本分歧所在，不可让    │
└─────────────────────────────────────────────────────────────┘
```

### §7.1 各层具体动作

| 层 | 动作 | 依据 |
|---|---|---|
| **L0** | **不动。** 保留 `Shape = {positions, indices}` 必有 mesh + BREP 可选叠加层；保留 brep/mesh 双槽与 `dispatchPath` 静态判定 | §3.3；《思考》`:4-5` |
| **L1** | 需要 brepjs 某个算法时，**移植**而非依赖。沿用 `brepjs-mirror` 的 four-point 适配清单（Sketcher→kernel 原语、Result→throw、DisposalScope→手动 release、高层封装→`BrepEngineApi` 直调） | §4.4 |
| **L2** | 引入拓扑身份与历史追踪时，**抄 shapeRef 的判据与分层**：身份（两个相邻面）与 hint（仅 tiebreaker）分离；不可定案即抛错（`ambiguous` / `not-found`），**不静默挑一个**。faijs 侧用 ordinal + `adjacentSelectors` 实现，不用 role 表 | §2.6 |
| **L3** | 继续以 `dependencies` 依赖 brepjs，经 adapter 注入 faijs 内核。**补一件事**：为 adapter 产物显式标记「无面演化历史」，并与 L2 的历史追踪机制对齐，不留隐式断点 | §4.1-4.3；`b7-no-face-evolution.test.ts` |

### §7.2 可抄但需重新实现的三件东西

| brepjs 机制 | 抄什么 | 不抄什么 |
|---|---|---|
| `csg/evaluate.ts` 的 `freeParams` 投影 | 「静态失效分析」的思想 —— 在 parser 阶段算每个语句依赖的参数集 | 整棵 IR、Merkle 哈希、同步求值器 |
| `shapeRef` 的 EdgeRef | 「边的身份 = 两个相邻面之交」的判据 + 「hint 只做 tiebreaker」的分层 + 「不可定案即报错」的纪律 | role 表（`assignRoles`/`updateRoles`）—— faijs 是确定性重放，ordinal 稳定，不需要 |
| optional peer + 动态 import 的内核加载 | 「有传染性的引擎做成可选 peer」的许可证隔离范式 | 单槽 `getKernel()` —— faijs 是双槽 |

---

## §8 风险与未决问题

| 编号 | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | **brepjs 版本漂移**：faijs 锁 18.119.2，上游已到 18.164.0（45 个版本，17 处 BREAKING） | adapter 可能在新版本上失效 | adapter 契约测试（`brepjs-gear.test.ts` 13 项）作为升级门禁；升级时单跑该测试 |
| R2 | **跨库拓扑身份断裂**：brepjs 产物进 faijs 后无面演化历史，在补上历史追踪后会成为断点 | 面/边引用在参数变更后失配 | L3 显式标记 `provenance`，不隐式假设「自然连通」 |
| R3 | **mesh 近似拓扑的历史追踪**无先例可抄（brepjs 绕开了这个问题） | 需求 ③ 相关能力缺失 | §3.4：id 空间统一 + `provenance` 分层 + 禁止给 mesh 面编造稳定 id |
| R4 | `mech-lib` 把 brepjs 声明为**硬依赖**，会把 brepjs 拖进 3d_editor 的构建图 | 体积 / 供应链 | 评估改为 optional peer + 动态 import（§6.2 范式） |
| R5 | brepjs 的 mesh 路径（brepkit）是 AGPL | 私有打包风险 | 明确**不引入** brepkit；网格布尔只用 manifold-3d |
| R6 | 本分析未验证：brepjs 的 `chamferWithHistory` / 面演化 API 在 faijs 侧能否经 adapter 暴露 | 影响「非对称倒角的面演化」能力 | 立项前单独验证（前序倒角方案已列为 R1/R2 实测项） |
| R7 | 本分析未验证：`withKernel` 的同步约束在 faijs 的 async 执行链中是否会造成死锁/误用 | 只在移植 brepjs 代码时才会遇到 | L1 移植时逐点检查（已有 four-point 清单中的 Result→throw 一项相关） |

---

## §9 调研足迹

### brepjs（`C:/git/OpenCascade/brepjs`，v18.164.0）

| 区域 | 文件与行号 |
|---|---|
| 包定义 / 许可证 / 可选依赖 | `package.json`（`license: Apache-2.0`；`exports` 17 子路径；`peerDependenciesMeta` 四项 optional） |
| CSG IR 类型 | `src/csg/types.ts`（`IRNodeBase` `:23-26`；`FilletNode` `:181-189`；`ChamferNode` `:191-197`；`IRNode` 闭联合 `:288-303`） |
| CSG 求值器 | `src/csg/evaluate.ts`（缓存键注释 `:1-3`；`EvaluatorOptions` `:71-100`；穷举 dispatch `:122-124`；`cacheKey` `:245-248`；`this.kernelId` `:452`；`withKernel` `:492`） |
| CSG 序列化 | `src/csg/serialize.ts`（`CSG_VERSION = 8` `:41`；`CsgEnvelope` `:44-48`；`toJSON` `:60`；`fromJSON` `:383`） |
| CSG 公共面 | `src/csg/index.ts:147-163`（`Evaluator` / `toJSON` / `fromJSON` / `replaceNode`） |
| 内核注册与切换 | `src/kernel/index.ts`（`registerKernel` `:39`；`getKernel` `:50`；`getActiveKernelId` `:92`；`withKernel` 拒绝 Promise `:96-115`） |
| 内核接口 | `src/kernel/interfaces/booleanOps.ts:38-46`（cross-kernel note）；`src/kernel/interfaces/ioOps.ts`（`importSTEP` `:18`；`importSTL` `:19`） |
| OCCT mesh 布尔缺口 | `src/kernel/occtWasm/booleanOps.ts:179-187` |
| manifold op-graph | `src/kernel/manifold/opGraph.ts`（非 replayable origins `:24`；`OpNode` `:33-47`） |
| manifold replay | `src/kernel/manifold/replay.ts`（模块注释 `:16-17`；`throw` on !replayable `:529-537`） |
| manifold 句柄 | `src/kernel/manifold/meshHandle.ts`（`asManifoldShape` 类型守卫 `:34-39`；`resolveOcct` `:47-56`） |
| 导入实现 | `src/io/importFns.ts`（`importSTEP` `:29`；`importSTL` `:65`；`importIGES` `:91`） |
| 线性历史（零内部消费） | `src/operations/historyFns.ts`（`OperationStep` `:23-31`；`ModelHistory` `:33-36`；`replayFrom` `:245`；`modifyStep` `:325`；`SerializedHistory` `:350`） |
| 拓扑引用 | `src/topology/shapeRef/shapeRefTypes.ts:88`（边 = 两面之交）；`EdgeRef` `:94-100` |
| 第三方库加载 | `docs/dynamic-third-party-library-loading_cn.md`（裸标识符 `:11-20`；Worker 内 import map 无效 `:25`；机制对照表 `:37-44`；单例原理 `:52-61`；CDN 陷阱 `:167-175`） |
| 自定义 op | `apps/docs/extending/custom-ops.md`（「contributing upstream / fork / local extension」`:14`；落文件表格 `:22-32`） |
| 沙箱执行（无增量） | `packages/brepjs-cad/src/sandbox/runProgram.ts:1-8` |
| 许可证实测 | `node_modules/occt-wasm/README.md:410-416`；`package-lock.json`（brepkit-wasm `AGPL-3.0-only` / manifold-3d `Apache-2.0` / occt-wasm `MIT OR Apache-2.0`） |
| 发布节奏 | `CHANGELOG.md:3-176`（近 10 日约 20 次发布；BREAKING 条目 17 处）；`git log` 955 commits |

### faijs（本仓）

| 区域 | 文件与行号 |
|---|---|
| 形状模型 | `packages/core/src/mesh/types.ts:38-41`（`Shape = { positions, indices }`） |
| 路径分派 | `packages/core/src/cad-runtime/backend-dispatch.ts:76-131` |
| 增量执行 | `packages/core/src/cad-runtime/module-executor.ts:95-101`（类文档注释）、`:102-107`（statementKey 缓存 + `ctx`）；`packages/core/src/cad-runtime/content-key.ts:10-32` |
| brepjs 依赖 | `packages/mech-lib/package.json:14`（`brepjs: 18.119.2`） |
| brepjs adapter | `packages/mech-lib/src/brepjs-gear.ts:1-25`（五项职责）；`brepjs-gear.test.ts`（9 项）；`c3-brepjs-scenario.test.ts`（4 项）；`b7-no-face-evolution.test.ts:1-22` |
| 算法移植先例 | `packages/stdlib/src/brepjs-mirror/threadFns.ts:1-16`（移植差异四点）；`joinery-brep.ts`（656 行） |
| 规模 | 225 个 TS 文件 / 44,688 行（`packages/*/src`）；stdlib 22 个文件 |

### 实测记录

- `npx vitest run src/brepjs-gear.test.ts src/c3-brepjs-scenario.test.ts`（cwd `packages/mech-lib`）→ **Test Files 2 passed / Tests 13 passed**，耗时 53.69s。
- `node -e` 读取 `package-lock.json` 与 `node_modules/brepjs/package.json` 核实许可证与版本。
- 全仓 grep 核实「无 codegen / 无跨内核转换 / 无 Custom 节点扩展点」等**否定性结论**（均以零命中为据）。

---

## §10 一句话回答用户的两个问题

> **「能否实现上面的需求？」**
> 不能全部实现。需求 ① 可以（且已实现）；需求 ② 的增量思想可借、IR 不可换；需求 ③ **不能**——brepjs 的形状模型与 faijs 的混合建模定位方向相反。

> **「直接基于 brepjs 二次开发，还是 fork brepjs 改造？」**
> **都不是。** 直接依赖（作为第三方库，经 adapter 注入 faijs 内核）用于**库生态层**；**算法移植**用于**算法层**；**抄思想不抄代码**用于**拓扑历史层**；引擎与形状层保持 faijs 自有。fork 是三者中代价最高、收益最低的选项。
