# Third-Party Library Development Guide

English | [中文](library-dev-guide.zh.md)

> This guide is organized by the three layers of the faijs ecosystem — what the **library author** writes, what the **Host** (engine assembly) handles, and what **`.fai.js` scripts** call. Each layer has its own section: responsibilities, interfaces, and boundaries.

> Related documents: `docs/api-contract.md` (engine contract — §7 for the three API surfaces and the Result error system), `docs/ops-api-inventory.md` (the `cad.*` script-face API manual).

---

## 1. The three layers at a glance

```mermaid
flowchart LR
  A[Library author writes] -->|exported functions + annotations + contractVersion| B[Host assembles & admits]
  B -->|registerLib: dual-ops pass through, bare fns lifted| C[.fai.js calls]
  C -->|ns.fn / cad.* + Result unwrap at statement boundary| D[Engine dispatches & bridges]
  D -->|Shape / handle / data record| C
```

| Layer | Role | Writes / does | Produces | Key interface |
|---|---|---|---|---|
| ① Library author | TS/JS library developer | Exported functions, `Result` returns, `defineOp` / `fn.outputs` / `solidOf` annotations, `contractVersion` | A plain module namespace | `@faicad/faijs/sdk` |
| ② Host | Engine assembly (app / worker) | Creates the runtime, registers libraries, provides kernel & backends | Callable namespaces (`ns.*`, `cad.*`) | `runtime.registerLib(binding, ns, { autoLift: true })` |
| ③ `.fai.js` script | User / UI / AI generated code | Imports libraries and calls their functions | Geometry products & data in the value store | `ns.fn(...)` / `cad.*` |

The data flow is one direction at authoring time and another at run time: the author writes a namespace, the Host registers and admits it, and scripts call the admitted functions — the engine handles dispatch, bridging, and the statement Result boundary between them.

---

## 2. Layer 1 — what the library author writes

### 2.1 The library module

A faijs library is a plain TS/JS module namespace of exported functions. The author writes the module; they do **not** register it — that is the Host's job (§3).

```ts
import { keep, fromBrep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'

export const contractVersion = CONTRACT_VERSION

export function external(params: { teeth: number; moduleSize: number; thickness: number }) {
  // ... build the gear, return a faijs Shape or a geometry handle ...
}
```

### 2.2 Exported functions return `Result`

Library functions return `Result<T>` (`ok` / `err`). The engine unwraps at the statement boundary: an `err` becomes a statement failure (`ExecutionResult.failedAt`) — **not a crash**; earlier statements keep their outputs. Bugs (unexpected exceptions) still propagate out of `execute()`.

### 2.3 Return values — the three-way classification

The engine distinguishes geometry from plain data by one discriminant — the `__occtWasm` marker (`isOcctHandle` in `brep/handle-bridge.ts`). Return one of three shapes:

| Return value | Classification | Engine behavior |
|---|---|---|
| faijs `Shape` (from `solid` / `fromBrep`) | already-wrapped | passed through unchanged |
| OCCT handle: object tagged `__occtWasm: true`, or a branded number id | geometry handle | tessellated + BREP slot registered (`fromHandle`) |
| plain object, no marker | data record (e.g. sheetmetal `part`) | stored as-is — **never** tessellated as a handle |

A data record where a handle is expected fails at the SDK boundary with `E_BAD_HANDLE`, not at kernel depth. Do not invent other handle shapes.

Two return shapes sit outside the three and are worth naming, because a lifted bare function reaches them with no author intent:

| Return value | Where it lands | Consequence |
|---|---|---|
| `undefined` (a `void` function) | misses the object test, falls into `fromHandle(undefined)` | hard failure: `E_BAD_HANDLE: expected an OCCT handle (numeric id or __occtWasm-tagged object); got undefined` |
| an unresolved `Promise` | the plain-object branch — `typeof` is `'object'`, no marker | **no error**: admitted as a data record, never awaited, never rejected — the value is silently lost |

The `Promise` row is the dangerous one: nothing in the pipeline reports it. §4.5 covers how a call ends up unawaited.

`unwrapResult` recognises a `Result` by one structural test — `typeof v.ok === 'boolean'` (`api/internal/result-unwrap.ts`). A data record carrying a boolean field named `ok` is therefore unwrapped as a Result: `ok: true` yields `v.value`, `ok: false` throws `OpError`. Never name a field `ok` in a returned data record.

### 2.4 Dual-path ops: `defineOp`

Declare both implementation paths and L3 metadata with `defineOp` (from `@faicad/faijs/sdk`):

```ts ignore-check
import { defineOp, keepHidden } from '@faicad/faijs/sdk'

export const intersect = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'intersect')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'intersect')
  },
  capabilities: ['intersect'], // concrete BREP capability needed — a *WithHistory kernel
                              // function name, matched against the engine's `evolution` list
  outputs: [...],             // named multi-product fields (§2.6)
  schema: { ... },            // param types for the UI panel (L3)
  slotMap: { ... },           // positional → object boxing, for brepjs-style calls
})
```

- **`mesh` / `brep`**: the two engine paths. `mesh` is the default; `brep` is optional. A brep-only op raises `E_MESH_UNSUPPORTED` on the mesh path.
- **`capabilities`**: BREP engine features the op needs — gated against the host's declared `brepCapabilities`.
- **`outputs`**: named multi-product fields (the only recognized multi-output contract name; array fields adopted element-by-element).
- **`schema` / `slotMap`**: L3 metadata — parameter types for the UI panel, and the positional → object boxing table for brepjs-style calls.

### 2.5 `keep` / `keepHidden` — UI-layer visibility

Which input shapes stay visible in the UI layer. Function-body declarations (written by the library author, evaluated at run time) are **overridden by call-site declarations** (written by the user / UI / AI at script recording time):

| Declaration site | Who writes it | Priority |
|---|---|---|
| Call site (`.fai.js` statement options) | User / UI / AI | Highest |
| Function body (`keep` / `keepHidden` inside the impl) | Library author | Overridden |

### 2.6 Bare functions and `fn.outputs`

A plain exported function (no `defineOp`) is lifted into a brep-only op when registered with `{ autoLift: true }`. Declare multi-output fields with the one recognized annotation:

```ts ignore-check
interface PlanetaryOutput {
  sun: ValidSolid
  planets: ValidSolid[]
  ring: ValidSolid
}
export function planetary(params: PlanetaryParams): Result<PlanetaryOutput> {
  // ... build sun, planets, ring ...
  return ok({ sun, planets, ring })
}
;(planetary as { outputs?: string[] }).outputs = ['sun', 'planets', 'ring']
```

### 2.7 `solidOf` — explicit geometry terminal

For data-centric libraries (sheetmetal: `part` is a plain object with an embedded `solid`), provide `solidOf(part)` as the explicit geometry terminal:

```ts ignore-check
export function solidOf(part: SheetMetalPart): Result<ValidSolid> {
  return ok(part.solid!)
}
```

### 2.8 Hard constraints

1. **`contractVersion`**: match the runtime's (`assertContractVersion`); dual-ops are rejected without it.
2. **No engine internals**: no access to engine-internal mutable state (`currentStmt` / `script` / `outputCache` / `brepChain`), no DAG queries or mutation of published `Shape`s.
3. **Handle ownership**: once a returned handle is adopted by the engine, do not `delete()` it afterward (return = transfer).

### 2.9 Every export is script-face API

Admission walks `Object.entries(ns)` — there is no notion of an internal or host-only export (§3.3). Constants, `contractVersion`, re-exported helpers and host-side lifecycle functions are all reachable from `.fai.js`, and every export that is a function is subject to lifting, with the return-value contract of §2.3. Keep host-only helpers (reset / flush / collect callbacks, caches) in a separate module that the library imports, and export from the library only what a script is meant to call.

### 2.10 What the author produces

A plain module namespace: exported functions, optional annotations (`fn.outputs` on bare functions), optional `defineOp` declarations, and `contractVersion`. The Host receives this namespace as-is — it never rewrites the author's code.

---

## 3. Layer 2 — what the Host handles

### 3.1 Host responsibilities

The Host (a Node host or browser worker) assembles the engine and makes libraries callable:

1. Provides the engine: kernel (`brep` / `csg` / `sdf`), backends, fonts/assets — via `createRuntime(ports, mode)`.
2. Registers libraries with `runtime.registerLib(binding, ns, { autoLift: true })`.
3. Provides the `cad` namespace (built-in ops) and hosts the value store.

### 3.1.1 Assembling the engine — kernel, BREP engine, and backends

`createRuntime(ports, mode)` creates a *runtime instance*; it does **not** by itself provide a geometry kernel. A usable Host must additionally initialize the OCCT wasm kernel, register the BREP engine, and push the backend configuration into the global runtime state. Without these, bare calls to the ① TS-compat face (`box`, `union`, …) and script-face booleans fail.

A complete, copy-pasteable bootstrap:

```ts
import { createRuntime, createNodePorts, initOcctWasm } from '@faicad/faijs/node'
import { registerOcctBrepEngine, OCCT_BREP_ENGINE_ID } from '@faicad/faijs/brep/engine/adapters/occt'
import { getBrepEngine, getActiveBrepEngineId } from '@faicad/faijs/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION } from '@faicad/faijs/runtime-state'

// One-time Host bootstrap. Call once at startup, before any geometry op.
// Order matters: kernel -> engine registration -> backend config.
export async function assembleHost(): Promise<void> {
  // 1. Boot the OCCT wasm kernel.
  await initOcctWasm()

  // 2. Register the OCCT BREP engine into the engine registry.
  await registerOcctBrepEngine()

  // 3. Read the registered engine back and push the full backend config.
  const eng = await getBrepEngine(OCCT_BREP_ENGINE_ID)
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: {
      mode: 'brep',
      brepEngineId: getActiveBrepEngineId() ?? OCCT_BREP_ENGINE_ID,
      // capabilities MUST travel with mode/brepEngineId (see pitfall 2 below).
      brepCapabilities: eng.capabilities,
    },
    kernel: { brep: eng.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: undefined,
    cad: undefined,
  })
}
```

After `assembleHost()`, create a runtime for script execution (② script face) or call the ① TS-compat flat functions directly — the ① face needs no runtime once the kernel/engine/backends are configured:

```ts
import * as F from '@faicad/faijs'
import { createRuntime, createNodePorts } from '@faicad/faijs/node'
import * as gear from 'my-gear-lib'

// ② script face: run .fai.js
const runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear, { autoLift: true })
await runtime.execute('let g = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })')

// ① TS-compat face: bare function calls (no runtime needed after assembleHost())
const a = await F.box(10, 10, 10)
const b = await F.union(a, await F.translate(a, [5, 0, 0]))
```

#### Three pitfalls (observed empirically)

1. **`createRuntime` without `registerOcctBrepEngine` → `[faijs/bridge] BREP engine API not available: BREP operations require an initialized engine`.** Script-face calls get a kernel via the brep chain automatically, but bare ①-face calls do not. Always run `assembleHost()` first.
2. **`configureBackends` missing `config.brepCapabilities` → `E_BREP_UNSUPPORTED: current engine lacks capability 'fuseWithHistory' (brepEngineId=<none>)`.** The `config` field is a *getter* at `runtime.ts`; copying a snippet that only sets `config: { mode: 'brep' }` (e.g. from a test that only uses `directEdit`) leaves `brepCapabilities` `undefined`, and the first boolean op fails. Always pass `brepCapabilities` together with `mode` and `brepEngineId`.
3. **`defineOp`-wrapped functions return `Promise<Shape>`, not `Result`.** The ①-face ops (`box`, `union`, `volume`, …) are `defineOp` wrappers; calling them yields a `Shape` (or a promise of one), **not** a `Result`. Testing such a value with `isErr(x)` gives a false positive — `isErr` checks `ok === false`, but a `Shape` has no `ok` field. Only values *you* return from your own library functions carry a `Result`.

### 3.2 Registering a library

```ts ignore-check
import { createRuntime, createNodePorts } from '@faicad/faijs'
import * as gear from 'my-gear-lib'

const runtime = createRuntime(createNodePorts(), 'auto')
runtime.registerLib('gear', gear, { autoLift: true })
```

The `binding` (`'gear'`) is the name scripts import and call: `gear.external({ ... })` in `.fai.js`.

A library that consumes faijs core `Shape`s and calls core ops internally (faijs-native, like `sheetmetal`) must add `borrow: false`: the default borrow step rewrites nested `Shape` arguments into brepjs handle views, and core ops then reject them with "input is not on the BREP chain". Real brepjs-shaped libraries keep the default.

### 3.3 Admission — what happens to each export

With `{ autoLift: true }`, the Host's admission step processes every export of the namespace:

| Export kind | What happens |
|---|---|
| `defineOp`-declared function (carries `DUAL_OP_META`) | Passes through with its spec intact — no rewriting |
| Bare function | Lifted into a brep-only op; `fn.outputs` (if present) becomes its `outputs` spec |
| `contractVersion` | Validated against the runtime's (`assertLibConforms`) — mismatch rejects the library |
| Other values (constants, data) | Registered as-is for script access |

Lifting is decided once for the whole namespace, not per export: `autoLift ?? !hasDualOp(ns)`. A namespace containing at least one `defineOp` function is inferred `false` — so in a **mixed** library (one dual-op plus plain helpers) the helpers are *not* lifted, while in an all-bare-function library they are. Pass `autoLift` explicitly when a namespace mixes the two kinds, rather than relying on the inference.

### 3.4 Engine boundary behavior (Host has no knowledge of it)

When a script calls an admitted function, the engine itself handles the boundary mechanics — the Host writes none of this:

1. **Dispatch**: mesh / brep path chosen statically (chain state + capabilities), no runtime fallback.
2. **Borrow**: faijs `Shape` arguments become zero-copy views for the brepjs side (current call only).
3. **Call + unwrap**: the function runs; a `Result` `err` is unwrapped into a statement failure.
4. **Adopt**: geometry products cross back as faijs `Shape`s (tessellation + BREP slot); plain data passes through (§2.3).

### 3.5 What the Host produces

Callable namespaces: `gear.*` (third-party) and `cad.*` (built-in), both usable from `.fai.js` with the same statement-level semantics.

### 3.6 Opting out of lifting — data and declaration libraries

A library whose functions return data or only register declarations (kinematics, annotations, metadata, colours) must not be lifted. Every lifted function is wrapped into a brep-only op, so its product crosses `wrapBrepOne`, where a `void` or primitive return becomes `E_BAD_HANDLE` (§2.3). Three ways to keep a library unlifted:

| Mechanism | Written by | Keyed on | Applies to |
|---|---|---|---|
| `registerLib(binding, ns, { autoLift: false })` | Host | the binding name | host-registered libraries |
| `libLoader.options.autoLiftFor = (name) => (name === 'my-lib' ? false : undefined)` | Host | the import specifier as written in the script (`packageName ?? specifier`) | libraries auto-loaded from `import` statements |
| `"faijs": { "autoLift": false }` in the library's `package.json` | Library author | the package name | browser hosts — `createBrowserLibLoader` picks it up from build-time `lib-meta.json` or via `prefetchMeta()` |

Return `undefined` — not `false` — from `autoLiftFor` for every library you do not mean to affect: `undefined` falls back to `options.autoLift` and then to the inference.

With lifting off, the namespace is injected as-is. Functions stay synchronous, may return `void` or any value, and behave as ordinary JS to the script. The library gives up the boundary services that lifting provides: no `Result` unwrapping (the script receives the `Result` record itself), no multi-output adoption through `fn.outputs`, and no capability or platform gating (§4.4).

---

## 4. Layer 3 — what `.fai.js` calls

### 4.1 Call forms

Top-level call arguments are full expressions (`lang/parser.ts`) — **`.fai.js` is a true JS subset at the call site**:

- **Positional arguments of any form, in any mix**: literals (`addHole(p, 'root', 15, 15, 4)`), arrays, declared variables, member access (`hem(p0.solid, spec)`), nested namespace queries, runtime expressions.
- **Multiple object arguments are kept as-is**: `tabAndSlot(p, tabSpec, slotSpec)` works — no overwrite, no merge. The *last* plain object is the options slot (carrying `keep` / `keepHidden`); earlier objects are positional data.

```js
import * as gear from 'my-gear-lib'
let g1 = gear.external({ teeth: 20, moduleSize: 2, thickness: 10 })
let b0 = cad.box(30, 30, 5)
let u1 = cad.union(g1, b0)
```

### 4.2 Statement-boundary behavior

Every statement that calls a library op is a boundary: the `Result` is unwrapped (`err` → `ExecutionResult.failedAt`, earlier statements keep their outputs), and `keep` / `keepHidden` at the call site override any function-body declaration (§2.5).

### 4.3 Call matrix

1. **The object-form entry is a recommended style, not a requirement.** Spec-object parameters stay idiomatic, but string-id / scalar / array first parameters are callable too.
2. **Record *fields* are readable in the script** (`hem(u1.solid, …)` — member access is a runtime-evaluated expression). Whole-record passing still works.
3. **Library `err` results are statement failures, not crashes** — `OpError` → `ExecutionResult.failedAt`; earlier statements keep their outputs.

Verified against `@faicad/sheetmetal` (whole-package registration, `{ autoLift: true, borrow: false }`) — every signature shape is callable now:

| Callable | Example |
|---|---|
| spec-object functions | `author(spec)`, `hem(p, spec)` |
| string-id / scalar / array functions | `addHole(p, 'root', 15, 15, 4)`, `allowance(p, 0.44)` |
| member access on variables | `hem(p0.solid, { kFactor: 0.44 })` |
| multiple object arguments | `tabAndSlot(p, tabSpec, slotSpec)` |
| geometry terminal | `unfoldSolid(s1)` — borrows a zero-copy arena view |

`solidOf` remains as an explicit terminal for the TS compat face and library-side use; on the script face it is no longer *required* — member access (`p.solid`) reaches the field directly.
### 4.4 Platform ops and the `engines` declaration

A library op is a **platform op** when its implementation statically imports a platform module (`occt-kernel/*` or `brepkit-kernel/*`) — the import is the sole judge (§1.1 of the narrowing plan). Such an op must declare its platform identity in `defineOp`:

```ts ignore-check
import { defineOp } from '@faicad/faijs/sdk'
import { occt } from './my-occt-only-helper' // imports occt-kernel/* → platform op

export const myOp = defineOp({
  name: 'myOp',
  engines: ['occt'], // REQUIRED for platform ops
  brep: async (ctx, ...args) => { /* ... */ },
})
```

Rules (D11, checked by `assertLibConforms` + the `check-platform-imports.mjs` CI guard):

1. **`engines` lists real engine ids** — `'occt'` / `'brepkit'` / `'brep_mock'` (never a bare string).
2. **`engines` and `capabilities` may be declared together** — the two are orthogonal: `engines` narrows *which engines* the op runs on, `capabilities` states *which kernel capabilities* it needs. The D11-7 mutual exclusion was withdrawn on 2026-09-24 and `assertLibConforms` no longer rejects the combination. Both empty is allowed only for mesh-only ops.
3. **Interception happens at execution** — under a non-listed engine the op fails before touching the kernel (`BrepUnsupportedError` → `ExecutionResult.failedAt`). The static guard only enforces the declaration, it does not substitute for it.
4. **`brep_mock` is exempt** from the interception (test stand-in, D11-3) — declared `engines` are still honored for parity/switch tests.
5. **Library dual-ops that import a platform module are bound by the same rule** — write `engines` in `defineOp`, interception occurs in `dispatchPath` at execution time, no registration-time validation.

A neutral op (implementation uses only `getBrepApi()` L1 methods) must *not* write `engines` — the L1 contract face is engine-agnostic by construction.

### 4.5 Library calls outside a statement position

Three places where a library call behaves differently than §4.1 suggests. The local function ABI itself (injected namespace bindings, verbatim body) is specified in `docs/language-design.md` §6.2.

1. **A user function body cannot read top-level script variables.** Only parameters, namespace bindings and S4 safe globals resolve there; a top-level `const SUN_TEETH = 20` is invisible inside the body and fails with `SUN_TEETH is not defined`. Pass every value the body needs as an argument.
2. **Op calls inside a body are not awaited.** `ns.fn(…)` there yields a `Promise`, and the engine inserts `await` at statement boundaries only (§4.2). A body that collects op results into an array hands on an array of pending promises, which the return classification admits as data records (§2.3) — the data is lost with no error. The VM backend (the default, `exec-backend.ts`) leaves them unawaited; the interpreter backend awaits each call during expression evaluation. Rely on neither: design data APIs so their results are consumed at statement level, or turn lifting off (§3.6) so the calls are synchronous.
3. **A namespace binding is not a top-level identifier.** It is bound where the statement transform rewrites a call into `await __ns.<binding>.<fn>(…)`. In any other top-level value position — `let ms = [anim.driver('a', 1)]` — the name stays unbound and fails with `anim is not defined`. Write such an array literal inline as the call argument instead.

A script cannot repair (2) by awaiting by hand: `await` in an argument position is rejected at parse time with `E_VALUE: unsupported value expression: AwaitExpression`.


---

## 5. End-to-end walkthrough

One function crossing all three layers, step by step:

1. **Author writes** (`Layer 1`): `planetary` returns `Result<{ sun, planets, ring }>` and carries `fn.outputs = ['sun', 'planets', 'ring']` (§2.6).
2. **Host registers** (`Layer 2`): `registerLib('gear', gear, { autoLift: true })` — `planetary` is lifted into a brep-only op with `outputs: ['sun', 'planets', 'ring']`; `contractVersion` is validated (§3.3).
3. **Script calls** (`Layer 3`): `let p0 = gear.planetary({ ratio: 4 })` — the statement records `keep` from the call site, the engine dispatches, borrows shape inputs, calls `planetary`, unwraps the `Result`.
4. **Products return**: `p0.sun` / `p0.planets` / `p0.ring` are adopted as faijs `Shape`s (or data records), stored in the value store — usable by later statements (`cad.union(p0.sun, b0)`).

Each step belongs to exactly one layer: author writes, Host admits, script calls, engine bridges.

---

## 6. Porting an existing brepjs library

Already wrote a brepjs library? Porting is mostly mechanical — faijs shares the brepjs conventions (positional params, `Result` returns, the DSL):

1. **Change imports**: `from 'brepjs'` → `from '@faicad/faijs'` (including `package.json`).
2. **Remove `registerKernel` calls** — faijs manages the kernel (single-instance); the host provides it.
3. **Remove `pinned` arrays / finalizer workarounds** — adoption lifecycle (borrow → call → unwrap → adopt) is handled by the engine; the library no longer manages disposal.
4. **Register the namespace**: `runtime.registerLib('mylib', myNamespace, { autoLift: true })`.
5. **Add `fn.outputs` / `solidOf` where needed** (§2.6 / §2.7).

The brepjs-side concepts (borrowed views scoped to the current call, returned-handle ownership transfer) are satisfied by brepjs conventions themselves. For engine-boundary questions, Layer 1 (§2.3 return classification, §2.6 `outputs`, §2.7 `solidOf`, §2.8 hard constraints) is authoritative.
