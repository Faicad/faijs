# @faicad/faijs

Faicad CAD execution engine — a `faijs` language parser, BREP/mesh dual-path geometry
operations, and a `CadRuntime` orchestrator.

- **L0 text layer** (`src/lang/`): `faijs` = a legal subset of JavaScript with **no
  control flow** (`if`/`for`/`while`/`do`/`switch`/`try`, dynamic `import()`).
  Scripts are parsed with acorn, compiled to a zero-import ESM module, and executed by
  the JS VM (never `eval`/`new Function`).
- **L1 geometry layer** (`src/brep/` + `src/mesh/`): every op has a BREP (OCCT) path
  and a mesh (manifold-3d) path; `src/ops/dispatcher.ts` picks statically.
- **L2 orchestration** (`src/cad-runtime/`): `CadRuntime` + `HostPorts`.
- **L3 host** (`src/node-host/` / `src/browser-host/`).

Units: millimeters, +Z up, angles in degrees. Contract docs: `docs/api-contract.md`,
`docs/syntax-design.md`.

## Entry points

| Import | Contents |
|---|---|
| `@faicad/faijs` | Full API (L0–L3, incl. Node host) |
| `@faicad/faijs/browser` | Browser-safe subset (no `node:*`) |
| `@faicad/faijs/node` | Node host entry |
| `@faicad/faijs/stdlib` | Built-in library namespace |
| `@faicad/faijs/sdk` | **Third-party library authoring surface** (zero heavy deps) |

## Developing a third-party library (`@faicad/faijs/sdk`)

A `.faijs` script can `import * as mech from 'mech-lib'` and call
`mech.makeHeadstock(...)`; the host loads your module (`import(url)`) and registers it
via `CadRuntime.registerLib(binding, module)` **before** any check/execute.

Your module is a plain ESM file exporting functions — write it against the SDK entry:

```ts
// mech-lib.mjs
import { solid, fromBrep, keep, getBackends, CONTRACT_VERSION } from '@faicad/faijs/sdk'

// Optional but recommended: pin the runtime contract version (registerLib validates it).
export const contractVersion = CONTRACT_VERSION

// Library functions follow the faijs source signature: (inputShapes…, params) — no hidden args.
export function makeHeadstock({ teeth = 8 } = {}) {
  // Shapes you produce MUST be created through the constructors so the engine
  // recognizes them (identity table) and can union/drill/extrude them downstream.
  const mesh = buildHeadstockMesh(teeth)
  return solid(mesh)
}

export function cutGear(input, { module: m, teeth }) {
  const { csg } = getBackends() // kernel / csg / sdf / fonts / assets are injectable resources
  const result = cutTeeth(input, m, teeth)
  // BREP chain: register the OCCT handle so hasBrep()/brepOf()/STEP export work.
  return fromBrep(result.mesh, { solid: result.solid, faceEvolution: result.faceEvolution })
}
```

Contract points:

- **Signature form**: `(input, params)` — matches the faijs source form; the engine
  calls `ns.<callee>(inputs..., args)` with the args object merged, exactly like the
  built-in `cad.*` ops. No hidden `exec` parameter.
- **Shape identity**: every returned shape must come from `solid(mesh)` /
  `fromBrep(mesh, holder)` / `compound(children)`; otherwise the engine treats it as
  an opaque value and downstream geometry ops (union, drill, …) reject it.
- **`keep(...shapes)` / `keepHidden(...shapes)`**: call inside your function body to
  declare which input shapes stay visible / hidden after your op (replaces the old
  per-op `keep` type annotations).
- **`contractVersion`**: export it (matching `CONTRACT_VERSION`) so `registerLib` can
  reject incompatible versions loudly instead of silently misbehaving.
- **Brevity on BREP**: `hasBrep(shape)` / `brepOf(shape)` let you check whether an
  input is on the BREP chain; mesh-only fallbacks must be decided statically per the
  dispatch rules, not by try/catch at runtime.

Loading is the host's job (URL → `import(url)` → `registerLib`); the SDK never loads
modules itself and ships with **zero heavy runtime dependencies** (no `three`,
`occt-wasm`, `manifold`, `node:*`) — enforced by a dist guard test.
