# Agent Note: occt-wasm op-coverage scanner rebuilt on TS-AST recognition and a full-op collection

Status: implemented

English | [中文](2026-10-07-occt-op-coverage-rebuild.zh.md)

## Problem

The first-pass scanner that produced the occt-wasm baseline report (six-class disposition of
the 211 `OcctKernel` methods, plan) had two recognised defects plus two attribution traps:

- It recognised kernel calls with regular expressions that fail on the real call shapes —
  `const x = <k>.<m>.bind(k)`, `(<cast>).<m>.call(k, …)`, destructuring, and casts.
- It collected the platform-op set from `scriptFace: true` schema rows only, missing the
  argument-spec hand-ops and the hand-written platform ops, so 50 ops existed but several were
  invisible to the scan.
- Traps: it treated the `getBrepApi()` L1-contract handle as an occt kernel handle (falsely
  classing neutral ops as platform ops), and it attributed kernel calls at whole-file
  granularity, so multi-op files drowned one op's attribution in its siblings'.

Without a trustworthy scanner there is no baseline to freeze, and the L3 "bare call" count
cannot be reasoned about stage S2 against.

## Decision

Rebuild the scanner on TypeScript-AST reachability and a precise op set, and freeze the
disposition `packages/core/src/api/surface/occt-op-coverage.json`.

- Kernel-handle recognition lives in the new `packages/core/src/occt-scan/recognize.ts`:
  it identifies occt-kernel identifiers by declaration (`getOcctKernel()` / `getKernel()` /
  `initOcctWasm()`), follows cast/alias/`as`-chains at the AST level, resolves `bind`/`call`
  and destructuring aliases back to the underlying method name, and — critically — does **not**
  treat `const kernel = getBrepApi()` as a kernel handle (the trap-1 line).
- The op set is the union of `defineOp`/`compatOp` top-level exports across `api/` (both
  generated and hand-written), merged by op name preferring the declaration that carries a
  `brep` bridge.
- Per-op attribution is function-precise: for ops with a `brep: __own_X` bridge it slices the
  bridge's target function; for hand-written single-op files it uses the whole file, which is
  where helper implementations such as `loftBrep`/`sweepBrep` live. This satisfies the
  per-function rule without over-attributing multi-op generated files.
- The six-class breakdown matches the plan's §7.2 disposition branch: C1=102, C2=10, L3=0,
  C3=4, C4=63, C5=10, C6=22 — sum 211, disjoint, and every unreached method lands in exactly
  one of C3/C4/C5/C6 (asserted in the JSON, `exhaustiveness`).
- L3 is empty because the apparent `healSolid → healFace` violation was itself the third
  attribution trap, not a real declaration gap (§7.5 trap 2, "cross-function helper" face):
  `healSolidBrep` is engine-agnostic (routes through `getBrepApi()`/L1 contract), and occt's
  `healFace` / `healWire` are reached by the `heal` op (already declared `engines: ['occt']`).
  The scanner now follows transitive local-helper calls (`exportRange` plus a `kernelCallsFromRoot`
  closure over same-file top-level helpers) so a non-exported helper such as `healFaceBrep`
  is attributed to the op that actually calls it. `surfaceCurvature` is classified C3 because
  the script op `inspectCurvature` already covers curvature inspection.
- Regression tests `test/occt-scan/recognize.test.ts` lock the four call shapes plus trap 1;
  `test/occt-scan/coverage-baseline.test.ts` locks the S2 baseline invariants (L3 empty,
  healFace/healWire ∈ C2, getShapeType ∈ C1, exhaustive/disjoint).

## Alternatives considered

- **Fix the old regex recogniser in place.** Rejected: the regex cannot express the
  bind/call/destructure/cast cases structurally, and `getBrepApi` vs `getOcctKernel` is a
  semantic distinction a regex cannot be trusted to make.
- **Attribution left at the file level, subtracting other ops.** Rejected: subtraction is
  brittle. Function-precise slicing of the bridge + single-op whole-file is exact for both
  the generated multi-op files (bridge) and the hand-written helper files (single-op).
- **Do not freeze a baseline yet (wait for L3=0).** Rejected: S1 's job is precisely to freeze
  the honest current baseline; freezing the corrected L3=0 disposition is the reviewable
  artifact for S2.

## Consequences

- `npm run scan:occt-ops` produces the report and rewrites the frozen JSON. Adding the script
  target made the scan reproducible via the documented recipe.
- `recognize.ts` is internal to the scanner (annotated `@internal`), not a public API.
- The baseline C2=10 (not 9) and L3=0 record the scan's correct, honest disposition. The
  C2=10 figure includes `healFace` / `healWire` (reached by the declared `heal` op) and
  `loftWithVertices` / `thicken`. C1=102 reproduces the plan's target, and the six-way sum
  is exact.
- `live-shapes.test.ts` carried a pre-existing `tsc` error (asserting a raw `kind` property on
  `HostArg`, which the wide `JsonValue | HostRef` union cannot be narrowed on). It now uses the
  exported `isHostVarRef` guard, which is both the correct typing and the documented access
  pattern; `npm run typecheck` is green. The guard usage is a better example than a hand cast.
