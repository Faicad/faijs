# Agent Note: cq-compat adds four gear-extension primitives (E1–E4)

Status: implemented

English | [中文](2026-09-11-cq-compat-gear-extensions-e1-e4.zh.md)

## Problem

The `fai_cq_gears` port needs four CadQuery standard-library primitives that `@faicad/cq-compat` did not yet expose: `Face.makeSplineSurface` (gear flank surface), `Workplane().makeHelix` (worm helix), `face.split` (end-face trim), and `Workplane().twistExtrude` (herringbone/spur variant). If `fai_cq_gears` had built these on a bare `occt-wasm` kernel of its own, it would duplicate work cq-compat already did and re-step on raw-kernel quirks (instance-bound `ShapeHandle`s, Vec3 shape, tessellation wiring).

## Decision

Add the four primitives inside cq-compat as thin wrappers, so `fai_cq_gears` consumes them through the cq-compat API instead of touching `occt-wasm` directly. Each op lives in `packages/cq-compat/src/workplane.ts` as an `export async function`, calls the native kernel via the shared `getKernel()` singleton (`getKernel() as unknown as OcctKernel`), and is exported from `index.ts`. `splineFace`→`bsplineSurface`, `helix`→`makeHelixWire`, `splitFace`→`halfSpace`+`split`+`getSubShapes`, `twistExtrude`→ native `rotate`/`translate` sweep through `loft`. All four carry full JSDoc (repo-wide `verify-export-jsdoc` gate). Unit tests (4 files, 9 cases) build base geometry through the native kernel and assert extents/volume; they pass, and the full cq-compat suite (122 tests) is green with no regression.

## Alternatives considered

- **`fai_cq_gears` builds a bare `occt-wasm` `RawOcctKernel` of its own.** Rejected: duplicates cq-compat's bridge work and reintroduces instance-bound `ShapeHandle` hazards; the port was explicitly re-scoped to depend on cq-compat.
- **Extend the vendored brepjs layer to add the four methods.** Rejected: `occt-wasm`'s `OcctKernel` already declares `split`/`makeHelixWire`/`bsplineSurface` natively, so no vendored-layer extension is needed — these are thin wrappers, not new geometry.
- **`twistExtrude` via route B (self-built twisted surface + sew + makeSolid).** Rejected: route A (sweep rotated+translated profile copies through `loft`) is already verified and reuses existing cq-compat machinery.

## Consequences

- Four primitives (`splineFace`, `helix`, `splitFace`, `twistExtrude`) are exported from `@faicad/cq-compat` and ready for `fai_cq_gears` to import.
- Three hard-won traps are now documented for any future native-kernel op: occt-wasm `Vec3` is a `{x,y,z}` object (not a tuple); `fromHandle` requires `configureBackends({ kernel: { brep: getKernel() } })` to be meshable (do not use `createRuntime` for direct op calls — its `kernel.brep` getter is only populated inside `runtime.execute`); native `rotate` takes radians and an `{ point, direction }` axis.
- parity status via the `run-cand` mirror framework: `splitFace` passes all three `testSplitKeeping*` cases; `splineFace`/`helix`/`twistExtrude` are recorded BLOCKED because the mismatch root cause is a tool/kernel limitation rather than a cq-compat geometry difference (interpolation vs. approximation surface fit; lossy bare-wire STEP export; OCCT robustness on near-coincident B-spline booleans). Net parity 35.69% (PASS 228 / PASS-NT 4 / FAIL 1 / BLOCKED 417).
- `fai_cq_gears` may now delete its `// TEMP-SHIM: delete when cq-compat E{n} lands` bridges and drop all direct `occt-wasm`/`initOcctWasm`/`RawOcctKernel` references from `packages/fai_cq_gears/src`.
