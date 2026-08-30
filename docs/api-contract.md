# faijs API Contract (Current Design Intent)

English | [中文](api-contract.zh.md)

> Position: This document records the **current** design intent and API contract of the faijs engine — layering responsibilities, naming rules, statement model, syntax, terminal detection, execution, dual-path geometry, host injection and consumption surface.
>
> **This document does not cover development plans or track defects** (see `docs/plans/` for historical phases and known issues).
>
> Related documents:
> - `docs/syntax-design.md` — `.faijs` syntax and incremental execution contract
> - `docs/ops-api-inventory.md` — API manual for writing `.faijs` code (AI/user side)
> - `docs/plans/2026-08-27-restore-dag-terminal-detection.md` — DAG terminal detection design (landed)
> - `docs/plans/2026-08-27-faijs-language-refactor.md` — Function-oriented long-term direction (pending review)
> - `docs/plans/2026-08-26-phase3-implementation-plan.md` — Naming rules and StmtId/partName separation (landed)
> - `docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md` — JS VM execution + stdlib-ization (landed)

---

## 1. Architecture Layers (L0–L3)

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

### 1.1 Entry export surface

| Entry | Contents | Notes |
|---|---|---|
| `@faicad/faijs` (`src/index.ts`) | Full export (incl. Node-side OCCT low-level) | Production code should prefer `/browser` |
| `@faicad/faijs/browser` (`src/browser.ts`) | Browser-safe surface: **no node-host**; A/B/C/D four export categories | Host (3d_editor) imports from this entry |
| `@faicad/faijs/node` (`src/node.ts`) | Node-specific: `createNodePorts` / CLI / FsAssetResolver etc. | Node-specific code must not be statically imported into browser builds |
| `@faicad/faijs/csg` (`src/csg.ts`) | CSG/Boolean low-level helpers (manifold data exchange) | Browser-safe |
| `@faicad/faijs/sdf` (`src/sdf.ts`) | SDF runtime templates and types | Browser-safe |

**Rule**: statically importing node-host in a browser build causes 404 — Node-specific code must be imported from `@faicad/faijs/node`; `src/browser.ts` / `src/csg.ts` / `src/sdf.ts` are browser-safe surfaces and must not depend on `node:fs` / `node:path`.

### 1.2 Responsibility boundaries (host contract)

- **faijs has one job**: execute faijs scripts to produce 3D models (`ExecutionResult`).
- **The host has two jobs**: ① generate correct faijs scripts; ② call faijs to execute those scripts.
- 🔴 **All geometry changes must go through faijs script statements — execute faijs scripts to obtain them.**
- The host only consumes `ExecutionResult`; it **must not re-derive** terminal detection or implement its own DAG leaf filtering (terminal semantics is an engine product).

---

## 2. Iron rules (written into the contract; no implementation may violate them)

- **R-1 Single geometry implementation**: statement op maps one-to-one to a geometry core function; parameter orchestration happens only inside the geometry core. No "UI one copy, replay one copy" duplication. Each op has BREP and Mesh execution paths; switching is determined by **static rules** — **runtime try-catch of BREP exceptions with mesh fallback is forbidden** (a BREP path exception = design defect or bug; report it directly).
- **R-2 User source text is not directly executed (parse then compile, JS VM executes)**: `.faijs` is a legal JS subset; at load time it is parsed by acorn to restore structured statements (syntax gate: rejects control flow and other forbidden forms), then compiled to an ESM product by `compileToModule`, and executed via JS VM dynamic import. Security boundary = parser syntax gate + compiled product generated by the engine (user text never enters the VM) — **user text is never eval'd** (`new Function` in `sdf-core.ts` evaluates user-supplied function bodies for SDF; this is inherent SDF backend behavior, not on the main script path). **The current product is zero-import ESM** (loaded via `data:`/Blob URL) — this is an **implementation trade-off, not a spec requirement**; see `docs/syntax-design.md` §6.1.
- **R-3 Naming and terminal semantics are owned by the engine**: `partN` naming rules, DAG leaf terminal detection, and consumption legality static validation are all encapsulated in faijs (`allocate-id.ts` / `terminal-dag.ts` / `parser.ts`); the host does not reimplement them.
- **R-4 Coordinate space convention**: millimeters (mm), +Z up, angles in degrees. All `cad.*` inputs/outputs are world-space `Shape`; local↔world transforms are the host/executor's responsibility; the geometry core does not read mesh world matrices.
- **R-5 BREP chain is per-part**: whether a part is still BREP is uniquely determined by whether its handle exists in `solidCache`; there is no global `brepActive` flag; sibling parts do not pollute each other.

---

## 3. Naming Contract (Phase 3: StmtId and PartName separation)

Each part has two **orthogonal identifiers** within a PartScript:

| Key | Meaning | Allocation rule | Usage |
|---|---|---|---|
| **StmtId (`sN`)** | Statement identity, order-stable | Allocated in compile/parse order by statement sequence `s1, s2, …` (parameter statements occupy the prefix `s1..sK`, K = param count) | Timeline node keys, incremental scheduling plan cache keys, `executeScriptDiff` diff keys |
| **PartName (`partN`)** | Variable name; one statement may have 0–multiple | `allocateStatementId` / `allocateSplitIds` (see §3.1) | `ExecutionResult.outputs/terminals/compounds` keys, execution ctx variable keys, host `terminalToScopedId` keys |

**Invariants**:
- `CadStatement.id` is always a StmtId (`sN`), **not a variable name**; variable names exist only in `outputs: PartName[]`.
- `outputs` is always explicit: single-output op = `[partName]`; split = `[front, back]`; void op (add_constraint/do_assemble) = `[]`.
- `TerminalShape.id` is typed as StmtId but **semantically a PartName** (`collectResult` closes with `asStmtId(partName)`) — the host should treat `terminals[].id` as PartName when consuming.
- Legacy `partN_vM` fixtures remain parseable and executable (`isPartVmId`/`getModelNum`/`getVersionNum` retained for parsing old names), but new allocations produce only `partN`; `grp_N` likewise (old names parseable, new allocations removed).

### 3.1 `allocateStatementId` naming rules (static, UI-generated code follows)

| Case | Variable name | Example |
|---|---|---|
| Single-input single-output (translate/rotate/scale/drill/extrude/engrave/knurl etc.) | **Reuses input name** | `part0 = cad.drill(part0, …)` |
| No input / single output (box/sphere/cylinder/cone/wedge/text/screw/svgExtrude/sdf/load) | **New name** `partN` (N = current max model number + 1) | `let part3 = cad.box(…)` |
| Boolean (union/subtract/intersect → op `boolean`) | New name `partN` (multi-input 2→1) | `let part5 = cad.union(part1, part3)` |
| split (1→2) | `allocateSplitIds` → `partN` / `part(N+1)` | `const { front: part1, back: part2 } = cad.split(part0, …)` |
| group/assembly | New name `partN` (removed `grp_N`) | `let part4 = cad.group({ members: [part0, part1] })` |
| **copy** (clone type) | **New name** `partN` (output is an independent new object, does not preserve name) | `let part2 = cad.copy(part1)` |
| void op (add_constraint/do_assemble) | No output (`outputs: []`), does not call allocator | `assem4.add_constraint(…)` |

Model number N increments monotonically within a single script (`getMaxModelNum` scans from existing statements' `outputs`).

---

## 4. Statement and script model (`src/lang/types.ts`)

### 4.1 Base value types

```ts
export type Vec3 = [number, number, number]      // 毫米，右手系 +Z 向上

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[] | { [k: string]: JsonValue }

export type Arg = JsonValue | ParamRef | GeomRef | AssetRef
/** 语句输入引用的左值变量名（PartName） */
export type ShapeRef = PartName
```

`Shape` (`src/mesh/types.ts`) is the core geometry type: `{ positions: Float32Array; indices: Uint32Array }` (triangle mesh, world space).

### 4.2 Reference types (distinct from literals)

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

`GeomRef` evaluation semantics: use `of` to get upstream geometry → resolve position by `feature`; `faceCenter/faceNormal` first uses `faceOrdinal` to get the face directly; on failure or no ordinal, uses `anchor` to find the nearest face, finally falling back to `bboxCenter`.

### 4.3 `CadStatement` (core contract)

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

### 4.4 `PartScript` and terminals

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

**`meta` positioning (round-trip fidelity carrier)**: color and user-renamed names cannot be derived from modeling parameters and must be recorded explicitly; placed at part level / `TerminalShape` level, not in `args`. The code path only carries result values; the execution end follows them without replicating the mouse-path coloring/naming algorithm (fallback derivation is not a defect). `CadStatement.name` (statement display name) and `meta.name` (part name) are different things; do not conflate.

---

## 5. Syntax contract (`.faijs` legal JS subset)

- `.faijs` must be a **legal subset of JavaScript** — any JS parser (acorn) can parse it without errors. Loading flow: **acorn parse (syntax gate: rejects control flow and other forbidden forms) → `compileToModule` compile to ESM product → JS VM dynamic import execute**. User source text is not directly executed (user text is not eval'd); the compiled product is generated by the engine from IR (current implementation is zero-import ESM, via `data:`/Blob URL — implementation trade-off, see `docs/syntax-design.md` §6.1).
- **Forbidden (spec requirement)**: control flow (if/for/while/do/switch/try), dynamic `import()`, `eval`/`new Function`, `export`. Violations produce `ParseError` (control flow has a dedicated error code, roadmap V1.5).
- **Current implementation extra restrictions (temporary, non-spec)**: `param`/`with` keywords, IIFE, template strings, function definitions, arbitrary expression statements — these are the current parser whitelist state; will be gradually relaxed with V1 language normalization, see dev plan `docs/plans/2026-08-29-faijs-normal-js-subset.md`. Arbitrary callee destructuring is already supported (`const { a, b } = cad.mySplit(x)` is legal).
- **Flat format** (`scriptToCode` output, no `export default` wrapper, no `return`, no `apiVersion` header):

```js
const size = 20                                   // 参数声明（右侧仅字面量）
let part0 = cad.box({ size })                     // 创建类语句（新名）
let part0 = cad.drill(part0, { diameter: 5 })     // 单入单出保名重赋值（let）
const { front: part1, back: part2 } = cad.split(part0, { … })  // split 双输出解构
let part3 = cad.group({ members: [part0, part1] })  // 结构型（compound 输出）
let part4 = cad.copy(part1)                       // 克隆型（新名，不消费源）
cad.faceCenter(part0)                             // 几何查询 → GeomRef
```

- **Explicit return is still supported**: `return part0` / `return { shape, meta }` / `return [{ shape, meta }, …]` produce `script.terminalShapes`, which take priority over DAG detection at runtime.
- **Statement ids can be any legal JS identifier** (AI/handwritten code is not constrained by partN); `partN` is only a convention for UI-generated code.
- Code text is the deterministic serialization projection of PartScript (`scriptToCode`/`statementToLine`); parser and codegen are bidirectionally isomorphic; one operation = one line of code (comments/blank lines excluded).
- Error forms: `ParseError` (parse phase, with line).

---

## 6. Terminal detection contract (DAG leaves, `terminal-dag.ts`)

**Core semantics (user clarification 2026-08-27, simplest)**: whether a variable enters terminals = whether it is "consumed". If consumed → not a terminal.

- **"Consumed"** = there exists an **exclusive** statement T (`T.op ∉ NON_CONSUMING_OPS`) whose index > the variable's last assignment statement P, and T's inputs/refs contain that variable name (shape appears on the right side).
- **`NON_CONSUMING_OPS = {group, assembly, copy}`**: these three statement types **do not consume** their right-side references (group/assembly does not consume members, copy does not consume the source); they are skipped directly in "consumer" determination. This is the only point requiring special handling in terminal detection — aside from this, group/assembly themselves are judged by "whether consumed by an exclusive statement" like any other shape.
- The unit of determination is **PartName**, not StmtId; naturally compatible with partN naming.

**Determination flow** (inside `collectResult`, explicit return takes priority):

1. Explicit `script.terminalShapes` (return [...]) first;
2. Otherwise collect **all shape-typed top-level variable names** (including compound variables; `isShapeLike` only recognizes positions/indices, CompoundShape lacks those two fields, must extend traversal);
3. `computeLeafTerminals(script, shapeVarNames)`: for each variable name, take "last writer P"; if no exclusive statement consumes it after P → terminal.

**Three spec examples**:

| Script | Terminals | Explanation |
|---|---|---|
| `x1=box; x2=drill(x1)` | `[x2]` | x1 consumed by drill → not terminal |
| `x1=box; x1=drill(x1)` | `[x1]` | drill is x1's last writer; no consumer after → x1 terminal (drilled) |
| `x1=box; x2=assemble(x1); x1=drill(x1)` | `[x1, x2]` | assemble does not consume x1; x2 has no downstream → both terminal; assemble binds to x1's final value |

**copy example**: `part0=box; part1=copy(part0)` → `[part0, part1]` (source + copy both displayed); `part0=box; part1=copy(part0); part2=drill(part1)` → `[part0, part2]` (part1 consumed by drill → not terminal).

### 6.1 Parser static consumption validation (rules A/B, `validateConsumption`)

UI-generated code follows static naming rules (§3.1) and will not trigger; AI-generated code cannot enforce naming rules, so two static checks run at the end of `parseScript` (consumption counting uniformly excludes `NON_CONSUMING_OPS`):

- **Rule A (any variable consumed at most once)**: for each shape variable v, after its last assignment P, the count of consumption by **exclusive statements** (op ∉ {group, assembly, copy}) ≤ 1; ≥2 → `ParseError` (e.g., `part1=drill(part0); part2=extrude(part0)`).
- **Rule B (members must be terminals)**: for each group/assembly member m, after the last assignment P, it must not be consumed by any exclusive statement; violation → `ParseError` (e.g., `part1=drill(part0); part2=group(part0,part1)`).

Both rules are the same "last writer + no downstream consumer" count with different thresholds on two variable types (non-member ≤1, member =0). This is the precondition for the host removing the `groupAssemblyMemberIds` keep-alive fallback (see `docs/plans/2026-08-27-restore-dag-terminal-detection.md` §5.2): in a legal script, members are always terminals, no host fallback needed.

### 6.2 Terminals and execution products

- `ExecutionResult.outputs` still contains **all** Shape variables (including intermediate results) — they just don't enter terminals; `brepSolids`/topology are extracted/built **by terminals** (intermediate variables have no BREP solid or real topology; no STEP export, no topology selectors).
- Explicit `return [...]` takes priority over DAG.
- After incremental (append/update), the terminal set is consistent with full execution.

---

## 7. Execution contract (`CadRuntime`, `src/cad-runtime/runtime.ts`)

### 7.1 Factory and execution modes

```ts
createRuntime(ports: HostPorts, mode?: ExecutionMode): CadRuntime   // mode 缺省 'auto'
export type ExecutionMode = 'auto' | 'brep' | 'mesh'
```

- `auto` (default): prefer BREP; mesh-only op / broken chain switches to mesh by static rules + `part-brep-lost` event notification.
- `brep`: force BREP; unsupported → error (`BrepUnsupportedError` → `failedAt`), **no auto-switch**.
- `mesh`: all ops use mesh path.

### 7.2 Three entry points + plan + check + dispose

| API | Semantics |
|---|---|
| `execute(script, opts?)` | Full execution: compileToModule → load → executeAll → collectResult |
| `append(script, newIds, opts?)` | Incremental append: execute only new statements (prefix already in persistent ctx); `newIds` are partNames from source statement outputs, translated to compiled product ids |
| `update(script, opts?)` | Incremental update: plan() → stale set → reconcileCtx → executeFrom recompute; empty stale → assemble result from ctx with zero execution |
| `plan(script)` | Dependency analysis, returns `{ stale: CadStatement[]; reused: Map<PartName, string> }` (statementKey cascade) |
| `check(code)` | Dry-run validation: parse (acorn gate) → schema validation (incl. unknown-key) → reference pre-check (inputs/terminals) → `CheckResult` |
| `dispose()` | Release all OCCT handles and caches |

### 7.3 `ExecutionResult` (host main consumption surface)

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

### 7.5 `ModuleExecutor` (VM execution core, `module-executor.ts`)

- **Compiled product**: `compileToModule(script)` generates **zero-import** ESM text (Node via `data:` URL, browser via Blob URL); each statement = `{ id: sN, deps: StmtId[], fn: (ctx, cad, exec) => Promise<void> }`.
- **ctx persistent variable container**: survives across execute/append/update; all script variables in a statement compile to `ctx.<name>` property accesses (supports in-place reassignment).
- **Incremental scheduling**: `executeAll` / `executeIds` (append) / `executeFrom(staleIds)` (update); `reconcileCtx` reclaims variables whose defining statements are no longer in the script and releases their kernel resources (required after undo deletes a statement).
- **Pre-capture for replacement release**: before fn execution, capture old handles for this statement's write keys; release after success (on failure, cache maintains pre-execution state, natural rollback).
- **statementKey cache**: `key = op|JSON(args)|deps outputContentKey`; plan uses this to determine stale; after parameter statement-ization, "change parameter → param statement key changes → cascade downstream stale".

### 7.6 `ExecContext` (library function platform API, `exec-context.ts`)

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

Library function uniform signature: `(inputs..., args, exec) => Promise<Shape> | Shape`; `$geom` query functions take exec as last param.

---

## 8. Dual-path geometry contract (BREP / Mesh)

### 8.1 `resolvePath` (static determination, no runtime fallback)

`src/stdlib/internal/resolve-path.ts`, shared by library functions:

```ts
resolvePath(exec, inputs, brepImpl): 'brep' | 'mesh'
```

1. `mode='mesh'` → mesh (all ops must implement mesh path).
2. `mode='brep'` → no brepImpl or inputs not all on chain (`exec.getSolid`) → **throw before call** (`BrepUnsupportedError` → failedAt).
3. `mode='auto'` → has brepImpl and all inputs on chain → brep; otherwise mesh (empty inputs `[].every()===true` → brep).
4. **No runtime fallback**: brep path exception = bug; report directly.

**Chain break switching semantics**: after a mesh-only op (sdf/knurl) appears on the BREP chain or inputs break the chain, **the subsequent part of that chain goes mesh**; the part before the chain remains unchanged (still brep). Switching is determined by static rules, no runtime try-catch fallback.

### 8.2 `BrepChainState` (`src/brep/brep-chain.ts`)

```ts
export interface BrepChainState {
  solidCache: Map<PartName, ShapeHandle>   // 存在即该 part 仍为 BREP；缺失即已降级为 mesh
  kernel: OcctKernel | null                // mesh 模式为 null
  partTransform?: { position: Vec3; scale?: Vec3 }   // 世界→局部坐标偏移
  faceEvolutionCache?: Map<PartName, Map<number, number[]>>  // 面 ordinal 映射（布尔/变换 *WithHistory 产物）
  meshShapeCache?: Map<PartName, WasmMesh>  // 三角化缓存（拓扑 mesh = 显示 mesh）
}
```

- **Per-part**: no global brepActive flag; a part loses BREP status if and only if: produced by a mesh-only op, or at least one upstream input has no BREP solid. Sibling parts do not pollute each other.
- **Static CAD format determination**: `isCadFormat(args, isSource)` — `step/brep/stp` → BREP (IGES not included; occt-wasm does not link TKDEIGES); determined by `args.format` or path/url extension; pure function, no try-catch.
- **Lifecycle**: solid ownership is in the **persistent solidCache** (replacement release on recompute / dispose release); `releaseBrepChainState` releases all handles (no longer has "keep terminal, release intermediate" selective semantics).

### 8.3 Shape and identity slot (`src/stdlib/shape.ts`)

- `solid(mesh)` / `compound(children)` constructor products are Shapes; `isShape` only recognizes constructor products (WeakSet registered), the sole basis for terminal determination.
- **Identity slot** `WeakMap<Shape, Slot>`: `{ solid?, faceEvolution?, meshShape?, behavior? }` — chain bookkeeping by Shape identity, not variable name; library functions are unaware of the naming system; `behavior` slot is assembly compound-specific.
- **CompoundShape**: `{ kind: 'compound', children: Shape[] }` — structure (hierarchy) not new geometry, no independent mesh; can nest. It is itself a Shape → is a terminal → displays in UI (display method decided by host: each child displayed individually + scene tree hierarchy).

---

## 9. Host contract (`HostPorts` + consumption surface)

### 9.1 `HostPorts` (`src/cad-runtime/ports.ts`)

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

All fields except `events` are optional — node test environment can provide only occt kernel; BREP-path ops do not depend on Ports.

### 9.2 Host consumption contract (3d_editor)

- Import uniformly from `@faicad/faijs/browser`; symbol-level whitelist (`contract-entry.test.ts`) locks the export surface.
- Execution uniformly goes through `CadRuntime.execute/append/update`; **bypassing the engine with manual execution loops is forbidden** (old `executeStatement`/`initBrepChainState` etc. deleted).
- `terminalToScopedId: Record<PartName, ScopedId>` keys are always **PartName** (append-only, reverse lookup takes last match).
- Scene tree hierarchy built from `ExecutionResult.compounds` (`buildSceneTreeFromDag` consumes `sceneCompounds`); compound child shapes expand in UI layer; no secondary liveness check on members.
- Terminal geometry commit follows `result.terminals`; `brepSolids`/`topology` consumed directly (STEP export, topology rebuild).
- **The host must not reimplement DAG leaf filtering** (terminal semantics is an engine product); geometry changes must go through faijs script statements.

---

## 10. stdlib function catalog (`cad` namespace)

> Full parameter contracts (incl. defaults/required) are in `src/mesh/api.d.ts` (**generated file**, from `scripts/gen-api-dts.ts` based on `src/stdlib/schemas.ts`, do not hand-edit) and `docs/ops-api-inventory.md`. The table below is function form classification and consumption semantics.

### 10.1 Creation (no input, single output)

| Function | Sync/Async | Notes |
|---|---|---|
| `box` / `sphere` / `cylinder` / `cone` / `wedge` | Sync | Primitives; `size/radius/height/segments/center` etc. |
| `text` | Async | Text outline extrusion (font asset) |
| `screw` | Async | Standard part (system/specIdx/thread/length/head) |
| `svgExtrude` | Async | SVG extrusion |
| `sdf` | Async | mesh-only op (auto mode emits part-brep-lost) |
| `load` | Async | `key/path/url` exactly one (schema mutual-exclusion check) + `format` |

### 10.2 Transform (1 input, single output, sync)

`translate` (offset), `rotate` (anglesDeg/pivot), `scale` (factor).

### 10.3 Feature (1 input, single output)

| Function | Sync/Async | Notes |
|---|---|---|
| `drill` | Async | Hole (diameter/depth/holeType/direction/position/faceNormal/tolerance/screw*) |
| `extrude` | Async | Face extrusion (length/mode/normal/originOffset/space) |
| `engrave` | Async | Engraving (mode/depth/text or svg) |
| `knurl` | Sync | mesh-only op (vertex displacement; auto mode emits part-brep-lost) |

### 10.4 Boolean (≥2 inputs, single output, async)

`union` / `subtract` / `intersect` → internal op `boolean` (`args.operation`); subtract/intersect use inputs[0] as the subject. Function name is the operation; no separate args object.

### 10.5 split (1 input, dual output, async)

`split(input, { cutMode, normal, offset, inPlaneAngleDeg, side, bbCenter, bboxSize, … })` → `{ front, back }` (destructuring syntax `const { front, back } = cad.split(…)`); `cutMode` includes plane/dovetail/dowel/straight-tenon/tenon/straight and respective dedicated params.

### 10.6 Structural (compound output)

| Function | Notes |
|---|---|
| `group({ name, members, memberNames })` | compound Shape, no constraints, no geometry side effects, pure hierarchy |
| `assembly({ name, members, memberNames, constraints })` | compound Shape + AssemblyBehavior (constraint solving + transform propagation) |

**Method chain**: `assem1.add_constraint({…})` / `assem1.do_assemble()` (void op, `outputs: []`, assignment → ParseError).

### 10.7 copy (clone type, 1 input, single output, sync)

`copy(input)`: **deep copy** (option B) — mesh path copies positions/indices to new arrays; BREP path `kernel.copy(inputSolid)` + `solidToShape` + `setSolid`/`setFaceEvolution` (identity face evolution). **Does not consume source** (`NON_CONSUMING_OPS`), output gets a "new name", source remains visible.

### 10.8 Query functions (`$geom` derived positions, last param exec)

`faceCenter` / `faceNormal` / `bboxCenter` / `bboxMin` / `bboxMax` — appear in text as `cad.faceCenter(part0)` in an args value position; parser converts to `GeomRef`; compiled product translates to a query function call. Also `asset(key, exec)` (`$asset` reference resolution).

### 10.9 Consumption semantics summary (terminal detection basis)

| Category | Consumes right-side references? | Naming |
|---|---|---|
| Transform/Feature/Boolean/split/drill etc. | **Yes** (exclusive overwrite) | Single-input single-output name-preserving; boolean/split new name |
| group / assembly | **No** (does not consume members) | New name `partN` |
| copy | **No** (does not consume source) | New name `partN` (source stays alive and visible) |

---

## 11. Topology contract

- `ExecuteOptions.topology`: `'auto'` (default) builds BREP real topology for **terminals** automatically; `'brep'` builds for all outputs on the BREP chain (incl. non-terminals); `'off'` does not auto-build (only returns topology injected by host `setTopology`).
- **BREP real topology** is built by the engine at finalization (reuses identity slot `meshShape` triangulation cache, ensuring topology mesh = display mesh), carried via `ExecutionResult.topology` (E13 contract).
- **Fake topology** (primitive parameter assembly / STL·3MF feature detection): built by the host at load/create time, injected via `runtime.setTopology`, passed through by the engine; **fake topology is not regenerated** contract unchanged.
- Host rebuilds SelectorRuntime using `buildSelectorRuntimeMaps` (from `topology`'s `SelectorRuntimeData`).

---

## 12. Assembly / grouping contract

- **Product is compound Shape** (user requirement: belongs to shapes, displays in UI): `group`/`assembly` statements return compound, are terminals (per §6); no independent mesh, geometry carried by members.
- **`ExecutionResult.compounds: Map<PartName, PartName[]>`**: compound variable → member variable name list, generated by the engine at finalization by reverse-looking up ctx variable names from compound's children; host builds scene tree hierarchy (UI expansion), no secondary liveness check on members.
- **Constraint solving** (`src/stdlib/compound.ts` `solveAssembly`): face_mate constraint → `solveFaceMate` computes rigid transform → member mesh in-place transform + BREP solid transform sync → `dependentsOf` propagates downstream (mesh and solid both covered) → `exec.touch` declares change (→ `ExecutionResult.changed`).
- **group semantics**: atomic group, zero constraints (`constraints: []`, `solve: () => {}`); members cannot be individually modified (modifying a group = modifying all its members) — this lifecycle semantics is a separate future item (see `docs/plans/2026-08-27-restore-dag-terminal-detection.md` §4.3), outside terminal detection scope.
- **Member modification lifecycle** (member source statement change → assembly auto incremental recompute / group atomicity constraint) is orthogonal to terminal detection, not currently implemented, layer undetermined, separate plan.

---

## 13. Invariants and versioning

### 13.1 Identity contract (incremental execution precondition)

- Existing statement ids (StmtId) **must not be renamed or reordered**; only in-place `args` value changes (parameter change) or `op` changes (structural change) are allowed.
- AI submission = **full overwrite text**; the engine diffs by id (UNCHANGED / PARAM / STRUCT / ADD / DELETE), replays from the first change point.
- AI new statement ids are chosen by the author (any legal JS identifier, must not duplicate existing ids); deleting a feature = that id's line removed entirely.
- Parameter declarations are statements themselves (compiled to ctx variables); "change parameter → param statement key changes → cascade downstream stale".

### 13.2 contentKey and fidelity

- `computeContentKey` (positions/indices → content fingerprint) is the geometric equivalence metric; statementKey = `op|JSON(args)|deps outputContentKey`; plan uses this to determine incremental recompute scope.

### 13.3 "Result consistent" boundary (anti-regression)

The contract only guarantees: **code → model is a function**, and `scriptToCode → parseScript` round-trip produces the same model. **Does not guarantee or require**: code path and mouse path internal implementation/property allocation algorithms match, instance id values match, undo stack structure matches. When any design requiring "code computes the same as UI" appears, first check against R-1 in §2.

### 13.4 Generated file red line

- `src/mesh/api.d.ts` is a **generated file**: generated from `src/lang/args-schema.ts` schema (via `scripts/gen-api-dts.ts`), do not hand-edit; after changing schema, must re-run that script (`api-dts-sync.test.ts` guards generated product consistency).

### 13.5 Compatibility

- Legacy `partN_vM` and `grp_N` fixtures remain parseable and executable (parser retains old name format recognition), but new code produces only `partN`.
- `export default async (cad) => {}` container and flat format are both parseable; flat code is auto-wrapped into a legal container.
- Top-level control flow is forbidden (language constraint), ensuring terminal detection and other static rules are not broken by AI code.