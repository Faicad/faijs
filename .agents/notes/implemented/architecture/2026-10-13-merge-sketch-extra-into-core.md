# Agent Note: Merge sketch and faijs-extra into core, delete draw — cad reserved binding

Status: implemented

## Problem

The cad namespace (`cad.*`) was assembled by the host at runtime via a three-step
protocol (`registerLib('cad', merge(...))` + `register*Symbols()` + `install*()`).
If any step was missed, `.fai.js` scripts would fail silently or at varying stages.
The internal physical package structure (which package an op lived in) leaked as
a public contract — downstream repos hardcoded `@faicad/faijs-sketch`,
`@faicad/faijs-extra`, etc. Internal restructuring forced downstream import changes
even when script semantics were unchanged.

Additionally, the `cad` binding could be overridden by the host via `libs.cad` or
`registerLib('cad', ...)`, meaning there was no single authoritative cad namespace.

## Decision

1. **Merge**: `packages/sketch` → `core/src/sketch/`, `packages/faijs-extra` →
   `core/src/extra/`, `packages/draw` deleted (deprecated, replaced by
   `cad.sketchOnPlane` / `cad.profile`).

2. **Single assembly point**: `createApiNamespace()` now carries the complete cad
   surface (platform + sketch + extra ops). `createRuntime(ports)` registers it
   internally. Hosts no longer assemble cad.

3. **Reserved binding**: `cad` is the only reserved binding name. Passing
   `libs.cad` to `createRuntime` or `createBareRuntime` throws `E_CAD_RESERVED`.
   After `createRuntime` sets `_cadReserved = true`, `registerLib('cad', ...)`
   is rejected. Third-party libraries under any other name are unaffected.

4. **Solver injection**: `installSketchSolver` replaced by `setSketchSolverInitFn`
   + `initSketchSolver` three-stage pattern (aligned with `setOcctWasmInitFn` /
   `setBrepkitWasmInitFn`): ① host-injected factory, ② Node auto-resolve,
   ③ throw. globalThis sharing for CDN multi-instance.

5. **Engrave provider**: `decoration-provider.ts` deleted; `mesh/engrave.ts`
   directly calls `createEngraveDecorationProvider()` from `extra/mesh/`.

6. **Sub-path contracts** (all public, published with core):
   - `@faicad/faijs/sketch` (was `@faicad/faijs-sketch`)
   - `@faicad/faijs/sketch/node` (was `@faicad/faijs-sketch/node`)
   - `@faicad/faijs/extra` (was `@faicad/faijs-extra`)
   - `@faicad/faijs/extra/browser` (was `@faicad/faijs-extra/browser`)
   - `@faicad/faijs/extra/editor-ops` (was `@faicad/faijs-extra/editor-ops`)

## Alternatives considered

- **Keep packages, just auto-assemble**: Rejected — downstream still hardcodes
  package paths; the problem is physical packaging as public contract, not just
  assembly convenience.
- **Compatibility shims**: Rejected — user explicitly chose zero-compatibility,
  one-time breaking change. No forwarding shells, no old package names.
- **`HostPorts.assets` resource key for planegcs wasm**: Rejected — planegcs
  wasm loading is the same problem as occt/brepkit; reuse the same pattern
  (`setXxxWasmInitFn` + `initXxx`), not a new mechanism.
- **Spread ops in `createApiNamespace()`**: Rejected — `gen-symbol-table.ts`
  cannot discover SpreadAssignment; explicit keys are required for the symbol
  table to stay in sync.
- **Delete `createBareRuntime`**: Rejected — it serves a legitimate "pure engine"
  use case; the `libs.cad` guard is sufficient to prevent bypassing cad authority.

## Consequences

- `createRuntime(ports)` is the single cad assembly point; hosts only provide
  ports + wasm sources + third-party libs.
- 10 new ops (`sketch`, `fai_drill`, `fai_extrude`, `fai_split`, `group`,
  `assembly`, `copy`, `load`, `text`, `svgExtrude`) are explicitly listed in
  `createApiNamespace()` — no spread.
- Guard tests: `cad-binding-reserved`, `cad-face-completeness`,
  `assembly-single-point`, `solver-loader`, `editor-ops-closure` prevent
  regression.
- `op-set-consistency` test asserts merged ops are in the symbol table
  (spread trap guard).
- Downstream repos must update imports (see plan §7.6 for per-repo changes).
- `@salusoft89/planegcs` is now a direct dependency of core (was sketch's dep).
