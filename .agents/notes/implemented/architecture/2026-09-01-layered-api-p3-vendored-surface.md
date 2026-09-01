# Agent Note: Layered API port — P3 vendored surface (L2 first batch, brepjs's own tests)

Status: implemented

English | [中文](2026-09-01-layered-api-p3-vendored-surface.zh.md)

## Problem

P2 landed the occt-wasm kernel tree and the D10 frozen kernel registry, but the L2 layer (`topology/` + `query/` + `measurement/`) was still an untested port. The P3 acceptance gate is "run brepjs's own tests against the ported stack, with the kernel reached through the D10 binding" — meaning we had to reproduce brepjs's test harness semantics (kernel setup, divergence registry) on top of the ported tree, without modifying any ported code.

Two friction points were structural, not geometry bugs:

- The ported tests call `getKernel()` directly (imported from `@/kernel/index.js` in brepjs) to build null-shaped inputs and raw arcs. Our facade had no `getKernel` re-export, so the null-shape pre-validation suites crashed with `getKernel is not a function`.
- Two behaviors genuinely differ on the occt-wasm adapter: `fuse` ignores the `simplify` option (no OCCT `SimplifyResult`), and a partial-arc `curveAxis` needs `castShape`-level arc handling. brepjs's own divergence registry marks `booleanFns.pairwiseSimplifyFaceMerge` as skip for occt-wasm — this is expected, upstream-acknowledged divergence, not a port bug.

## Decision

1. **Harness in packages/tests** — `faijs/p3-vendored-surface/`:
   - `brep-surface.ts`: thin facade re-exporting the ~125 vendored symbols the tests import, plus a minimal sketch-shape compatibility surface (`P3SketchSurface` + `sketchRectangle`/`sketchCircle`) so `shape()` recognizes construction objects. The sketch layer itself is P5; only the wrapper plumbing is stubbed here.
   - `kernel-setup.ts`: `initKernel()` = `initOcctWasm()` + `bindOcctKernel()` (D10), and re-exports `getKernel`/`bindOcctKernel`/`getBrepjsKernel`/`isOcctKernelBound` plus the divergence helpers.
   - `kernel-divergences.ts`: faithful port of brepjs's `tests/helpers/kernelDivergences.ts` registry, pinned to the `occt-wasm` branch (our host kernel). This is what turns the two genuine divergences into skips instead of failures.
   - 11 test files moved verbatim from brepjs `tests/` (topology/query/measurement + shapeFns/faceFns/curveFns/booleanFns/finderFns/wrapperFns/primitiveFns/measureFns), import lines rewritten only (`@/…` → `.`.relative).
2. **Vendored-test typecheck posture** — the ported test copies live in `p3-vendored-surface/tests/` and are excluded from `packages/tests` strict `tsc` (tsconfig `exclude`), mirroring brepjs's own `tsconfig` which excludes `tests/`. They are written to run under vitest (esbuild), not to pass `noUncheckedIndexedAccess` strictness; the harness glue (`brep-surface.ts`, `kernel-setup.ts`, `kernel-divergences.ts`) stays inside the typecheck.
3. **`getKernel` made available through the facade** so null-shape construction in measureFns/booleanFns works exactly as it does against brepjs's own `@/index`.

## Alternatives considered

- **Patch the ported code to force behaviors** (e.g. make `fuse` post-simplify in the adapter). Rejected: D2/D3 keep the transplanted tree byte-faithful; `booleanFns.pairwiseSimplifyFaceMerge` divergence is already recorded upstream for occt-wasm, so honoring the registry is the correct "pass" path, not a hack.
- **Inline-rewriting `Shape`-typed calls in the test copies** to satisfy strict TS. Rejected: that would fork the fixtures from brepjs and defeat the "run upstream tests as-is" goal; the exclude is the upstream-faithful answer.
- **Wire the harness into the main D10 `occt-kernel` smoke** instead of a new suite. Rejected: D10 stays a narrow single-instance guarantee; P3 needs its own suite grouped under one directory so a future kernel (brepkit/manifold) can re-run the same 394 tests with a different registry branch.

## Consequences

- `npx vitest run faijs/p3-vendored-surface` (from `packages/tests`) = 392 passed / 2 skipped. The 2 skips are the occt-wasm divergences (fuse simplify, plus one existing wrapper skip); the codepath is also exercised by the full workspace run (634 passed / 2 skipped overall).
- The full `faijs/**` typecheck includes the harness glue, not the ported copies; vendored `tsc` and `check-layer-boundaries` remain green.
- corner / blueprint / 2d suites were deliberately not ported in this batch — they depend on 2d + blueprints layers (P5).