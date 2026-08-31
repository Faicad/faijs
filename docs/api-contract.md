# faijs API Contract (Current Design Intent)

English | [中文](api-contract.zh.md)

> Position: This document records the **current** API contract of faijs — layering and package structure, engine/library responsibility boundaries, naming rules, statement model, syntax, terminal detection, execution, geometry engine slots, host injection and consumption surface.
>
> **This document covers the standing interface contract only: it does not track development plans or defects, and it does not reference `docs/plans/` documents.**
>
> Related documents:
> - `docs/syntax-design.md` — `.faijs` syntax and incremental execution contract
> - `docs/ops-api-inventory.md` — API manual for writing `.faijs` code (AI/user side, generated file)

---

## 1. Architecture Layers and Package Structure

faijs is an **npm workspaces monorepo**. The root package `@faicad/faijs` is a **thin facade** (`src/index.ts` is 22 lines); the real implementation lives in workspace packages.

| Package | Package name | Responsibility |
|---|---|---|
| `packages/core` | `@faicad/faijs-core` | **Engine**: parse / validate / schedule / bookkeep / resources. Zero geometry, zero function knowledge |
| `packages/stdlib` | `@faicad/faijs-stdlib` | **Geometry library**: every op in the `cad` namespace (assembly and boolean included) |
| `packages/mech-lib` | `@faicad/mech-lib` | Third-party library sample (peer dependency on `@faicad/faijs-core`) |
| `packages/fixtures` | `@faicad/faijs-fixtures` | Private, data only |
| `packages/tests` | `@faicad/faijs-tests` | Private, integration tests |
| `packages/demo` | `@faicad/faijs-demo` | Private, vite demo |

Dependencies are one-directional and acyclic: `stdlib → core`, `mech-lib → core`, `tests → mech-lib + fixtures`, `root → core + stdlib`. **core has no internal dependencies.**

```
┌──────────────────────────────────────────────────────────────┐
│ L0  text layer  packages/core/src/lang/                      │
│   parser (acorn + syntax gate)   codegen (debug re-print)    │
│   compile (to zero-import ESM)   allocate-id (partN)         │
│   keep (retention directives)   internal statement model     │
├──────────────────────────────────────────────────────────────┤
│ L0+ anchor  packages/core/src/runtime-state.ts (no imports)  │
│   Backends / keep sink / Shape identity tables / contract ver│
├──────────────────────────────────────────────────────────────┤
│ L1  geometry library  packages/stdlib/src/ (**outside eng**)  │
│   primitives transform drill extrude engrave knurl           │
│   boolean split compound copy geom reconcile                 │
├──────────────────────────────────────────────────────────────┤
│ L1' engine core  packages/core/src/{mesh,brep,topology}/     │
│   mesh path + CSG | brep/engine (two-slot registry) | topo   │
├──────────────────────────────────────────────────────────────┤
│ L2  orchestration  packages/core/src/cad-runtime/            │
│   CadRuntime (execute/append/update/check — text in, result out)│
│   ModuleExecutor (module load + incremental + persistent ctx)│
│   backend-dispatch (dispatchPath)   terminal-dag             │
│   module-resolver (on-demand library resolution)             │
├──────────────────────────────────────────────────────────────┤
│ L3  Host  node-host (fs/CLI)   browser-host (worker/fetch)   │
└──────────────────────────────────────────────────────────────┘
```

### 1.1 Entry export surface

The root package `@faicad/faijs` has **11 subpath exports** (the `exports` field of `package.json`):

| Entry | Contents | Notes |
|---|---|---|
| `@faicad/faijs` | Facade: `export * from '@faicad/faijs-core'` plus a wrapped `createRuntime` | Unified host entry; **the package name must not change** |
| `/browser` | Browser-safe surface (no node-host) | Preferred entry for hosts (3d_editor) |
| `/sdk` | **Third-party library authoring surface**, zero heavy dependencies | The only entry a library author should depend on |
| `/stdlib` | Geometry library namespace | `cad` must be injected by the caller |
| `/csg` | CSG / Manifold data exchange | Browser-safe |
| `/sdf` | SDF runtime templates and types | Browser-safe |
| `/node` | Node-only: `createNodePorts` / CLI / FsAssetResolver | Must not enter browser builds |
| `/faqts`, `/faqts/node`, `/faqts/browser` | Whole-module `.ts` execution channel (second execution path) | See §10.5 |
| `/module-resolver` | Third-party library version resolution | See §10.4 |

The engine package also exposes fine-grained subpaths (`@faicad/faijs-core/runtime-state`, `/shape`, `/identity`, `/lang/*`, `/brep/*`, and so on) for library authors to import on demand.

**Rule**: a static import of node-host inside a browser build 404s — Node-only code must be imported from `/node`. The runtime export surface of the 11 entries is guarded by snapshot comparison between `scripts/api-surface-snapshot.mjs` and `scripts/api-surface-snapshot.json`.

### 1.2 Responsibility boundaries (engine / library split)

- **Engine = parse + validate + schedule + bookkeep + resources; library = all geometry.**
- **To decide where a function belongs, ask "is it a geometry algorithm?", not "who imports it today?"** If the engine currently calls a geometry function, that is a defect to clean up — not a reason to move the function into the engine.
- **The engine has zero function knowledge**: parser / compile / runtime must not branch on function names or classify functions. The engine knows only one uniform concept, "library function", and function information can only be data (`StdlibNamespace`).
- faijs has exactly one responsibility: execute a script and produce a 3D model (`ExecutionResult`). The host has exactly two: generate a correct script, and call faijs to execute it.
- 🔴 **All geometry changes must go through script statements**; the host only consumes `ExecutionResult` and must not re-derive terminal detection or implement its own DAG leaf filtering.

---

## 2. Iron Rules (written into the contract; no implementation may violate them)

- **R-1 The engine embeds no geometry.** All geometry operations are implemented by libraries; the engine only schedules, bookkeeps and supplies resources.
- **R-2 A library function signature is exactly what the source says.** Implicit injection is forbidden: `cad.box({ size })` compiles to `cad.box({ size })`, no more and no fewer parameters; no appending a trailing parameter at compile time, no `rest.pop()` to obtain context.
- **R-3 User source text is never executed directly.** acorn parse (syntax gate) → engine compiles into a zero-import module → JS VM dynamic import. The security boundary is the syntax gate plus engine-generated output; **user text is never eval'd**.
- **R-4 Naming and terminal semantics are owned by the engine.** `partN` allocation, DAG leaf detection and consumption validation all live inside the engine; the host does not reimplement them.
- **R-5 Coordinate space**: millimeters (mm), +Z up, angles in degrees. Every `cad.*` input and output is a world-space `Shape`.
- **R-6 The BREP chain is per part.** Whether a part is still BREP is decided solely by whether `solidCache` holds a handle for it; there is no global flag, and sibling parts never contaminate each other.
- **R-7 Static dispatch, no runtime fallback.** An exception on the BREP path is a bug — surface it, never catch it and silently switch to mesh. A missing capability degrades statically or raises a clear error; **never fake an API**.
- **R-8 keep is the only coupling point between faijs and the UI.** faijs defines no features, UI forms, icons or edit panels — those belong to the upper-layer application (3d_editor).
- **R-9 Terminology: op vs. feature.** At the **faijs layer**, op = an operation that returns a geometric entity (`Shape` / `CompoundShape`). At the **host layer (3d_editor)**, op = any operation / any function call, and feature = the generic CAD term implemented by one or more ops / function calls. The engine has zero function knowledge (§1.2) and sees only "a library function call returning a geometric entity"; feature semantics, like UI forms / icons / edit panels, belong to the upper-layer application (see R-8). The user's exact words (zh) are quoted in the Chinese version (§2 R-9).

---

## 3. Naming Contract (StmtId and PartName)

Each statement carries two **orthogonal identifiers**:

| Key | Meaning | Allocation rule | Use |
|---|---|---|---|
| **StmtId (`sN`)** | Identity of a statement, order-stable | Assigned in statement order at parse time, `s1, s2, …` (parameter statements occupy the leading range) | Timeline node key, incremental plan cache key, diff key |
| **PartName (`partN`)** | Variable name; a statement may have 0 to many | `derivePartName` (see §3.1) | Key of `ExecutionResult.outputs/compounds`, execution ctx variable key, terminal id |

**Invariants**:

- The statement id is always a StmtId (`sN`), **never a variable name**; variable names exist only in the statement's declared outputs.
- The declared outputs are always explicit: single output = `[name]`; split = `[front, back]`; void op = `[]`.
- `TerminalShape.id` is a PartName, not a StmtId.

### 3.1 `derivePartName` naming rules

**The single rule: always allocate a new name, incrementing `partN` by output count.** Input-name reuse (name-preserving reassignment for translate/drill and friends) and the `_vM` version suffix have both been removed.

| Case | Variable name | Example |
|---|---|---|
| No assignment (add_constraint / do_assemble) | None (R0) | `assem1.add_constraint({ … })` |
| Has an assignment (including single-input/single-output) | A new name, one `partN` per output | `let part3 = cad.drill(part0, { diameter: 5 })` |
| split (1→2) | Two consecutive new names | `const { front: part1, back: part2 } = cad.split(part0, { cutMode: 'plane' })` |
| Equal multi-input/multi-output (Shape[] batch) | Disabled (R4), throws | — |

The model number N is the maximum `partN` found by a lexical scan of the code text, plus 1 (no parsing, so in-progress code is allowed).

**`partN` constrains UI-generated code only.** AI-written or hand-written code may use any **legal JS identifier** (`const shaft = cad.cylinder({ … })`); the engine treats both identically.

---

## 4. Statement and Script Model

A `.faijs` script is a sequence of statements, one operation per line (the flat format, §5). The engine parses the text into an internal representation; **that representation is an implementation detail — it is not part of this interface contract and may change at any time**. The contract-facing statement model is the code itself: variable names (`PartName`), the called function, positional inputs, the trailing options object, and the declared outputs (§3, §5).

`Shape` (`packages/core/src/mesh/types.ts`) is the core geometry type: `{ positions: Float32Array; indices: Uint32Array }` (triangle mesh, world space). `CompoundShape` is `{ kind: 'compound', children: Shape[] }`.

### 4.1 Terminals

```ts
import type { PartName } from '@faicad/faijs'

export interface TerminalShape {
  id: PartName                // identified by variable name, not statement id
  kind?: 'shape' | 'compound' | 'value'
  hidden?: boolean            // kept but not rendered; undefined means visible
}
```

`ExecutionResult.terminals` carries these; an explicit `return [...]` in the code overrides the DAG-derived terminal set.

---

## 5. Syntax Contract (`.faijs` legal JS subset)

`.faijs` must be a **legal subset of JavaScript** — any JS parser (acorn) parses it without error. Load flow: acorn parse (syntax gate) → the engine compiles the parsed script into a module → JS VM dynamic import for execution; **user text is never eval'd** (R-3).

**Forbidden**: control flow (if/for/while/do/switch/try), dynamic `import()`, `eval`/`new Function`, `export`. Any violation is reported with a diagnostic code `E_CONTROL_FLOW` / `E_SYNTAX` / `E_VALUE` / `E_REFERENCE` / `E_IMPORT`, surfaced through `check()`.

**Allowed**: top-level `import` (third-party libraries, not control flow), top-level function definitions, statically foldable expressions (binary / template literal / ternary), arbitrary callee destructuring, member method chains (`asm1.add_constraint({ … })`).

Flat format (UI recording, one operation per line):

```js
import * as mech from 'mech-lib'
const size = 20
let part0 = cad.box({ size })
let part3 = cad.drill(part0, { diameter: 5 })
const { front: part1, back: part2 } = cad.split(part0, { cutMode: 'plane' })
let part4 = cad.group({ members: [part0, part1] })
let part5 = mech.makeHeadstock({ length: 120 })
```

The **keep directive** lives inside args (it is not a new keyword) — see §6. Code text is the single source of truth; the internal representation compiled from it is an implementation detail, and re-printing text from it is debug-only (see §13.3 PS). One operation is one line of code is a flat-format convention.

---

## 6. Terminal Detection Contract (keep-driven)

**Core semantics**: whether a variable becomes a terminal is whether it "is consumed". Consumed → not a terminal.

A retention declaration can appear in two places, with priority **call site > function body**:

```js
cad.drill(a, { diameter: 8, keep: ['a'], keepHidden: true })
```

```ts ignore-check
export function group(params) {
  keep(...params.members)
  return compound(params.members)
}
```

### 6.1 The `consumes()` decision chain (C0 → C3 → C5, short-circuiting)

| Rule | Condition | Result |
|---|---|---|
| **C0/C1** | Variable ∈ `resolveKeep(stmt).kept` (call-site or function-body declaration) | **Not consumed** |
| **C3** | The statement assigns and every output is non-geometric | **Consumes** no input at all |
| **C5** | Default | **Consumed** (an `inputs` positional reference, or a variable reference in args) |

Additional rules: a reference inside a nested call is a read-only query and does not consume; `receiver` (member method call) does not consume the receiver variable.

C3 is an objective default that requires **zero signature knowledge**: a function returning non-geometry cannot have swallowed geometry into its result, so inputs of third-party measurement/query functions are not eaten by mistake.

`resolveKeep` merges function-body registration (`internalKeep`) with call-site `parseUserKeep`; **hidden follows "the last retention declaration wins"** (in statement order, a later declaration overrides an earlier one).

### 6.2 `computeLeafTerminals()`

For each shape variable (compound variables included), take its "last writer P"; if no statement after P consumes it, it is a terminal. A variable with no producer (manually injected by the host) counts as a terminal.

- An explicit `return [...]` in the code takes priority over DAG detection.
- `hidden` carries a field only when explicitly `true`; visible normalizes to `undefined` (matching the host's `setNodeVisible(scopedId, !terminal.hidden)`).

### 6.3 Static validation

`validateKeepDirectives(stmt)` is a purely static validation that applies to third-party libraries as well: `keep` must be an array; entries must be variable references or `{ shape, hidden }`; referenced targets must be one of the statement's inputs or appear in args; `keepHidden` must be a boolean. Violations go into `CheckResult.errors`.

### 6.4 Terminals and execution products

`ExecutionResult.outputs` contains **all** Shape variables (intermediate results included) — they simply do not enter terminals; `brepSolids` and topology are extracted **per terminal**. Non-geometric DAG leaves (measurements, plain objects) go into `activeValues`, not `terminals`.

---

## 7. Execution Contract (`CadRuntime`)

### 7.1 Factory and execution modes

```ts ignore-check
createRuntime(ports: HostPorts, mode?: ExecutionMode, libs?: Record<string, StdlibNamespace>): CadRuntime
export type ExecutionMode = 'auto' | 'brep' | 'mesh'
```

- `auto` (default): prefer BREP; a mesh-only op, a broken input chain, or a missing capability falls back to mesh statically.
- `brep`: force BREP; anything unsupported raises (`BrepUnsupportedError` → `failedAt`) and **never switches automatically**.
- `mesh`: every op takes the mesh path.

**Facade vs engine**: core's `createRuntime` does **not** assemble `cad` (the engine has zero function knowledge); the root facade `src/index.ts` wraps it and injects `registerLib('cad', createInternalStdlib())`. Third-party libraries are always registered through `runtime.registerLib(binding, ns)`.

### 7.2 `CadRuntime` API

| API | Semantics |
|---|---|
| `execute(code, opts?)` | Full run: execute every statement of the code text |
| `append(code, newIds, opts?)` | Incremental append: execute only the new statements (the prefix is already in the persistent ctx) |
| `update(code, opts?)` | Incremental update: `plan` computes the stale set → `reconcileCtx` → recompute from that set in topological order; zero execution when nothing is stale |
| `check(code)` | Dry-run validation: parse (syntax gate) → schema (unknown keys included) → reference pre-check → `CheckResult` |
| `registerLib(binding, ns)` | Register a library namespace (third-party library channel) |
| `setTopology` / `getTopology` / `deleteTopology` / `buildBrepTopology` | Topology injection and construction |
| `dispose()` | Release all BREP handles and caches |

All three execution entries are **public interfaces whose input is code text** (`execute` / `append` / `update`); the engine parses the text internally. Incremental semantics are content-addressed (§13.2).

`CheckResult = { ok, errors: CheckError[], warnings, script? }`, where `script` provides `{ statements, callees }` for AI self-correction.

### 7.3 `ExecutionResult` (host main consumption surface)

```ts ignore-check
export interface ExecutionResult {
  outputs: Map<PartName, Shape | CompoundShape>   // all shape variables, intermediates included
  brepChain: BrepChainState                       // BREP chain state (per-part handles)
  terminals: TerminalShape[]                      // DAG leaf terminals
  infos: string[]
  failedAt?: { index: number; callee: string; message: string }
  brepSolids?: Map<PartName, { solid: BrepHandle; kernel: BrepEngineApi }>
  topology?: Map<PartName, PartTopology>
  compounds?: Map<PartName, PartName[]>           // compound variable -> member names
  changed?: PartName[]                            // variables whose value changed this run
  activeValues?: Map<PartName, unknown>           // live but non-geometric leaf values
}
```

### 7.4 `ExecuteOptions`

```ts ignore-check
export interface ExecuteOptions {
  params?: Record<string, unknown>
  inputGeometryMap?: Map<PartName, Shape>
  sceneCode?: string                               // whole-scene code text for cross-part refs
  partTransform?: { position: Vec3; scale?: Vec3 }
  startIndex?: number
  topology?: 'auto' | 'brep' | 'off'
}
```

There are exactly three public execution entries — `execute(code)` / `append(code, newIds)` / `update(code)` — all taking code text; there is no fourth entry and no `ExecuteCodeOptions`. `sceneCode` carries the whole-scene code text for cross-part references.

### 7.5 Incremental execution semantics

- **Content-addressed**: a statement's identity key combines the namespace-qualified callee, the JSON of its args (keep excluded), and each dependency's content fingerprint; a parameter statement keys on `param|JSON(value)`. `keep` / `keepHidden` are excluded — **toggling retention or hidden state triggers zero geometry recomputation**.
- **Persistent ctx**: script variables live in a container that survives across executions; in-place reassignment is supported.
- **Replay scope**: `plan` computes the stale set and replays from the first change point; when nothing is stale, nothing executes.

### 7.6 The three library contract surfaces

The old `ExecContext` packed kernels, identity slots and DAG queries into one injected `exec` object; it is abolished. The current contract is three **explicitly imported** surfaces, all exported from `@faicad/faijs/sdk`.

**Surface A — Backends (host injects once, libraries import to access)**

```ts ignore-check
configureBackends(backends: Backends): void   // called once at host startup
getBackends(): Backends                       // throws when unconfigured; no silent default
export interface Backends {
  readonly contractVersion: number
  readonly config: { mode; brepEngineId?; brepCapabilities?; partTransform? }
  readonly kernel: { readonly brep: unknown | null; readonly csg?; readonly sdf? }
  readonly fonts; texture; assets; events
  readonly cad?: StdlibNamespace
}
export const CONTRACT_VERSION = 1
```

**Surface B — Shape constructors (zero bookkeeping in libraries)**

```ts ignore-check
solid(mesh): SolidShape                       // every mesh product must be created here
fromBrep(mesh, holder): SolidShape            // BREP product: registers handle + face evolution
compound(children): CompoundShape             // structure (hierarchy), not new geometry
isShape(v) / isCompound(v) / isCompoundLike(v)
hasBrep(shape): boolean / brepOf(shape): unknown | undefined
```

**Surface C — keep declarations (called inside library function bodies)**

```ts ignore-check
keep(...shapes): void        // keep and render
keepHidden(...shapes): void  // keep but do not render on canvas
```

**Two prohibitions**: a library **must not** access engine-internal mutable state (no `currentStmt` / `script` / `outputCache` / `brepChain`); a library **must not** query or modify the DAG (no `dependentsOf` / `touch`, and no in-place mutation of an already published Shape). Those capabilities belong to the engine: `changed` is derived by engine comparison, and downstream invalidation after assembly transforms is done by the engine's `computeDownstream`.

---

## 8. Geometry Contract (BREP / Mesh dual path)

### 8.1 `dispatchPath` (static determination, no runtime fallback)

Located in `packages/core/src/cad-runtime/backend-dispatch.ts` (**not on the SDK public surface** — library authors declare implementation sets via `defineOp`, see §10.3):

```ts ignore-check
dispatchPath(inputs: Shape[], impls: { mesh?: UnknownFn; brep?: UnknownFn }, requiredCapability?: BrepCapabilityName): 'brep' | 'mesh'
```

Decision order:

1. `mode='mesh'` → no `impls.mesh` → **throw `MeshUnsupportedError`** (`E_MESH_UNSUPPORTED`); else mesh.
2. `mode='brep'` → no `impls.brep`, inputs off-chain, or `requiredCapability` missing → **throw `BrepUnsupportedError`**.
3. `mode='auto'` → capability missing → mesh (static degradation); else `impls.brep` present and all inputs on the chain → brep, else mesh.

Creation ops (empty inputs) satisfy `[].every(hasBrep) === true`, so they take the brep path. Both unsupported errors are captured by the engine as `ExecutionResult.failedAt`.

### 8.2 Two-slot engine registry

The mesh engine and the BREP engine are **two orthogonal slots**, not alternatives: mesh is mandatory for every chain (`Shape` is the required payload plus display tessellation), while BREP is an optional precision layer that can break away at any time. Switching one does not affect the other.

```ts ignore-check
registerBrepEngine(id: string, provider: BrepEngineProvider): void  // first registrant becomes default
registerMeshEngine(id: string, engine: MeshEngine): void
getBrepEngine(id?): Promise<BrepEngine>     // async provider, result cached
getMeshEngine(id?): MeshEngine
freezeEngineRegistries(): void              // freeze after assembly; further registration throws
export interface BrepEngine { readonly id: string; readonly primitives: BrepEngineApi; readonly capabilities?: BrepCapabilities }
export type BrepEngineProvider = () => Promise<BrepEngine>
```

**Registration happens only during host startup assembly; the registry is read-only at runtime** and offers no unregister / setDefault / runtime switching. OCCT is installed as the default BREP engine by the adapter's idempotent `ensureOcctDefaultEngine()`.

**Capability declarations** (`BrepCapabilities`, all optional): `evolution` (`*WithHistory` face evolution), `heal`, `directEdit`, `advSurface`, `assembly` (XCAF), `meshLift` (mesh→BREP lifting). A missing capability degrades statically or raises a clear error — **never faked**.

### 8.3 `BrepChainState`

```ts ignore-check
export interface BrepChainState {
  solidCache: Map<PartName, BrepHandle>       // present = still BREP; absent = downgraded
  kernel: BrepEngineApi | null                // null in mesh mode
  capabilities?: BrepCapabilities             // current engine capabilities (capability routing)
  partTransform?: { position: Vec3; scale?: Vec3 }
  faceEvolutionCache?: Map<PartName, Map<number, number[]>>
  meshShapeCache?: Map<PartName, WasmMesh>    // tessellation cache (topology mesh = display mesh)
}
```

**Lifecycle**: solid ownership lives in the **persistent `solidCache`** (released on recomputation replacement or on `dispose`).

### 8.4 Shape and identity slots

`Shape` is the **mandatory payload** (mesh); BREP is an **optional layer** on top of the identity slot. The identity tables (`created` WeakSet / `slots` WeakMap / `shapeToName`) hang off the global anchor `runtime-state` on `globalThis` — this lets "two copies of faijs code" (one in the host bundle, one bundled into a third-party library) share one state and avoids Shape identity islands.

`isShape` recognizes only constructor products (WeakSet registration) and is the sole basis for terminal detection. `isCompoundLike` is a structural test (`kind === 'compound' && Array.isArray(children)`); the engine uses it for internal terminal/consumption decisions, and it also works for unregistered compounds returned by third-party libraries.

### 8.5 Chain break materialization

**A chain break** is when a product uses `solid()` instead of `fromBrep()` → it has no BREP handle → that part keeps only its mesh layer from then on, **permanently and non-recoverably**. The moment of the break is when `dispatchPath` returns `'mesh'`.

Three triggers: T1 a mesh-only op (such as knurl/sdf); T2 mixed inputs (`inputs.every(hasBrep)` is false); T3 explicit `mode='mesh'`.

**Materialization entry point** `reconcileBrepInputs(inputs)` (`packages/stdlib/src/reconcile.ts`): BREP-side inputs are tessellated and reduced (weld vertices → remove degenerate faces → unify orientation → assert 2-manifold), while mesh-side inputs pass through unchanged.

The `part-brep-lost` event is emitted **uniformly by the engine** (libraries do not emit it): the criterion is that the statement has geometry inputs, all inputs are on the chain, but the output is not.

---

## 9. Host Contract

### 9.1 `HostPorts`

```ts ignore-check
export interface HostPorts {
  csg?: CsgBackend
  sdf?: SdfBackend
  fonts?: FontProvider
  texture?: TextureSampler
  assets?: AssetResolver
  events: EventSink   // required: emit('part-brep-lost', { partName, callee, reason })
}
```

Everything except `events` is optional — a Node test environment can supply only the BREP engine, since BREP-path ops do not depend on Ports.

### 9.2 Host consumption contract (3d_editor)

- Import uniformly from `@faicad/faijs/browser`.
- Execute uniformly through `CadRuntime.execute` / `append` / `update` / `check` (code text in, `ExecutionResult` out).
- **The host must not reimplement DAG leaf filtering** (terminal semantics are an engine product); geometry changes must go through script statements.
- Build scene tree hierarchy from `ExecutionResult.compounds`; submit terminal geometry per `result.terminals`; consume `brepSolids`/`topology` directly (STEP export, topology rebuild).
- **STEP export**: mesh parts can be exported too — the difference is a faceted STEP rather than an exact BREP solid. Handle each part by its type (exact vs tessellated) instead of failing the whole export.

---

## 10. stdlib and Third-Party Libraries

### 10.1 Function catalog (`cad` namespace, 30 functions)

| Category | Functions |
|---|---|
| Creation | `box` `sphere` `cylinder` `cone` `wedge` `text` `screw` `svgExtrude` `sdf` `load` |
| Transform | `translate` `rotate` `scale` |
| Feature | `drill` `extrude` `engrave` `knurl` |
| Boolean | `union` `subtract` `intersect` |
| Split | `split` (dual output, destructured as `const { front, back } = …`) |
| Structural | `group` `assembly` (compound output) |
| Clone | `copy` |
| Query | `faceCenter` `faceNormal` `bboxCenter` `bboxMin` `bboxMax` |
| Asset | `asset` |

> Note: "Feature" above is an internal faijs catalog category (ops modifying existing geometry), unrelated to the host-layer "feature" term — the generic CAD term implemented by one or more ops / function calls (see §2 R-9).

**The complete parameter contract (defaults / required) is `docs/ops-api-inventory.md`** (generated from stdlib JSDoc; do not edit by hand).

### 10.2 Consumption semantics (declaration-driven)

Consumption is no longer hard-coded per op category; it is **declaration-driven**: consume by default (C5), retention declared by a library function body's `keep()` / `keepHidden()`, and overridden by a call-site `keep` directive.

| Library function | Declaration | Effect |
|---|---|---|
| `group` / `assembly` | `keep(...members)` | Members are not consumed; members and the compound are both displayed |
| `copy` | `keep(input)` | The source is not consumed; source and copy are both displayed |
| Boolean family | `keepHidden(...inputs)` | Sources are kept but not rendered on canvas |

### 10.3 Uniform library function shape (`defineOp`)

Library functions declare implementations with `defineOp` (`@faicad/faijs/sdk`); do not hand-write `dispatchPath` (not on the SDK public surface, §8.1):

```ts
import { defineOp } from '@faicad/faijs/sdk'
import type { Shape } from '@faicad/faijs/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'

interface MyParams { size: number }
declare function myOpMesh(input: Shape, params: MyParams): { positions: Float32Array; indices: Uint32Array }
declare function myOpBrep(input: Shape, params: MyParams): BrepHandle

export const myOp = defineOp({
  mesh: (input: Shape, params: MyParams) => myOpMesh(input, params),
  brep: (input: Shape, params: MyParams) => myOpBrep(input, params),
})
```

`defineOp` constraints:

- At least one implementation; **mesh is the default path** (mesh-only / brep-only both legal).
- Geometry inputs are collected automatically (`args.filter(isShape)`); multi-product functions declare `outputs: string[]` (e.g. `split` → `{ front, back }`).
- The wrapper dispatches by mode (internally `dispatchPath`, §8.1); failures raise `BrepUnsupportedError` / `MeshUnsupportedError`, converted to `ExecutionResult.failedAt`. Capabilities (e.g. boolean `['evolution']`) degrade to mesh in auto when missing; brep mode raises.

### 10.4 Third-party library channel

- **Registration**: `runtime.registerLib(binding, ns)`; a script writes `import * as mech from 'mech-lib'` and calls `mech.fn(...)`. The engine records the call's origin namespace, and the incremental key carries the package-name prefix.
- **Validation**: a library exporting defineOp declarations must carry a matching `contractVersion` (= `CONTRACT_VERSION`); `registerLib` validates strictly via `assertLibConforms` (D-4). Plain functions without defineOp are legal but get no mode routing / wrapping / assembly validation.
- **Resolution**: `@faicad/faijs/module-resolver` provides `resolveImports` and semver checks (`satisfies`), enabling on-demand loading of large library slices.

### 10.5 Whole-module `.ts` execution channel (faqts)

`@faicad/faijs/faqts` is a **second execution path running parallel** to the recording pipeline: `.ts` source is transformed as a whole and executed in one shot, with no per-statement scheduling and no timeline; outputs are declared by the author through explicit `export` (no automatic DAG detection). It shares the same `cad` API and Shape contract as the faijs side, so products of the two are interoperable.

---

## 11. Topology Contract

- `ExecuteOptions.topology`: `'auto'` (default) builds BREP true topology for **terminals that are on the BREP chain**; `'brep'` builds it for all on-chain outputs (non-terminals included); `'off'` disables automatic construction.
- **BREP true topology** is built by the engine at wrap-up, reusing the tessellation cache in the identity slot so that topology mesh equals display mesh; it is carried on `ExecutionResult.topology`.
- **Fake topology** (primitive parameter assembly / STL·3MF feature detection) is built by the host at load/creation time and injected via `runtime.setTopology`; the engine passes it through. **Fake topology is never regenerated.**
- The host rebuilds SelectorRuntime with `buildSelectorRuntimeMaps` (from the `SelectorRuntimeData` of `topology`).

### 11.1 TopoRef naming layer (cross-history identity)

- **Two layers**: the snapshot address layer (`FaceId`/`EdgeId` ordinals, `SelectorManifest`/`SelectorRuntime`) serves picking/rendering, unchanged; the cross-history layer (`TopoRef` + `RoleTable`) names the same face/edge/point across replay.
- **`TopoRef` is pure JSON-safe data** written into `.faijs` op params (face / edge / vertex / derived-face). Resolution: `TopoRef` → resolver → current ordinal or live BREP handle; ordinals are never stored back as identity.
- **`ExecutionResult.naming: Map<PartName, {source, faceNaming, edgeNaming}>`** carries naming rows (ordinal 1-based ↔ index); hosts build `TopoRef` from a picked Reference via `captureTopoRef(row)`.
- **`RoleTable` is execution-time state only** (Shape identity slot + runtime `roleTableCache`, same lifecycle as `faceEvolutionCache`), never serialized; hashes are session-live handles, the table rebuilds across sessions.
- **Three-state resolution**: `exact` / `geometric-fallback`; failures throw `TopoRefError` (`E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND`).
- **Source tiers**: BREP carries semantic+positional roles propagated through evolution; primitive fake topology gets the same semantic namer over its fixed face order; mesh (STL/3MF) is hint-only (`role=''`).
- **Chain-switch degradation**: a part dropping BREP→mesh mid-chain keeps `{origin, role}` and hints as pure data; resolution falls back to the face-hint snapshot — reference degradation, not a runtime engine-path fallback.

---

## 12. Assembly / Grouping Contract

- The product of `group` / `assembly` is a **compound Shape** (it is a shape, enters terminals, and is displayed in the UI); it has no independent mesh of its own — geometry is carried by its members.
- `ExecutionResult.compounds: Map<PartName, PartName[]>` is generated by the engine at wrap-up by reverse-looking-up ctx variable names from the compound's children; the host builds scene tree hierarchy from it and does not run a second liveness pass over members.
- **Solving ≠ propagation** (responsibility split): constraint solving happens in the **library** (`solveTransforms` → `setPendingAssemblyTransforms` registers the result); **applying the transform and invalidating downstream happens in the engine** (`takePendingAssemblyTransforms` → member mesh and BREP solid transformed in sync → `computeDownstream` recomputes downstream → variable names go into `ExecutionResult.changed`).
- **Member method chains**: `assem1.add_constraint({ … })` / `assem1.do_assemble()` are void ops (`outputs: []`) and do not consume the receiver variable.
- **`group` semantics**: an atomic group with zero constraints; members must not be modified individually (modifying the group modifies all of its members).

---

## 13. Invariants and Versioning

### 13.1 Identity contract (precondition for incremental execution)

- Existing statement ids (StmtId) **must not be renamed or reordered**; only `args` values may change in place (parameter change) or `callee` may change (structural change).
- An AI submission is a **full overwriting text**; the engine aligns by id and diffs (UNCHANGED / PARAM / STRUCT / ADD / DELETE), replaying from the first change point.
- A parameter declaration is itself a statement, so "changing a parameter → the parameter statement's key changes → downstream goes stale in cascade".

### 13.2 Incremental fidelity

`computeContentKey` (positions/indices → content fingerprint) is the measure of geometric equivalence; the statement identity key (callee + args minus keep + each dependency's content fingerprint) decides the incremental recomputation scope, and `plan` uses it. See §7.5.

### 13.3 The boundary of "consistent results" (anti-regression)

The contract guarantees only: **code → model is a function**, and the save/load round trip: code exported from 3d_editor, saved as a `.faijs` file, re-imported, yields an identical model — a text-level round trip (text is the source). It does **not** guarantee or require: identical internal implementations or attribute-assignment algorithms between the code path and the mouse path, identical instance id values, or identical undo stack structure.

PS: Re-printing text from the IR is debug-only, never part of a contract.

### 13.4 Generated file red lines

- `docs/ops-api-inventory.md` is generated by `scripts/gen-ops-api-inventory.ts` from stdlib JSDoc — **do not edit by hand** (CI `--check` guards it).
- `packages/core/src/mesh/api.d.ts` is generated by `packages/core/scripts/gen-api-dts.ts` from the stdlib function catalog — **do not edit by hand** (guard test `packages/core/src/api-dts-sync.test.ts`).

### 13.5 Compatibility

- Control flow is forbidden at the top level (a language constraint), which keeps static rules such as terminal detection safe from AI-generated code.
- Legacy version-suffixed names are no longer produced and no longer parsed (the version suffix and the `grp_` prefix were both removed; compatibility parsing was removed, decision 2, see `lang/allocate-id.ts`).
- Both the `export default async (cad) => {}` container and the flat format parse; flat code is automatically wrapped into a legal container.
