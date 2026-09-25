# Agent Note: core-decouple Phase 1–2 — first-party basics and vendored bridge removal

Status: implemented

## Problem

The `@faicad/faijs-brepjs` subpackage still owns parts of the faijs BREP surface:
the reverse-projection bridge (`api/occt-kernel-bridge.ts`) injects the vendored
kernel registry at engine-registration time, and several basic pieces (Result
family, brepjs-compat utilities, view projection helpers, convex hull) are
copied from brepjs. The plan's end state deletes the brepjs subpackage; Phases
1–2 land the prerequisites: inline the basics into core and remove the bridge.

## Decision

1. **First-party basics land in core.** `result/` (`result.ts`, `errors.ts`,
   `bug.ts`, `kernelErrorTranslation.ts`, `vec3.ts`) and `api/brepjs-compat/`
   (`types`, `planeTypes`, `constants`, `vecOps`, `planeOps`) are verbatim
   copies of the brepjs sources with imports rewritten to first-party paths;
   `api/view/projectionPlanes.ts` + `cameraFns.ts` are copied from brepjs
   `projection/` (projectEdges trimmed); `api/result.ts` re-exports the
   first-party module (keeping the `@faicad/faijs/api/result` deep path).
2. **Hull goes native.** `occt-kernel/hullGeometry.ts` (QuickHull, verbatim)
   + `hullOps.ts` drive `hullFromPoints` straight on the occt-wasm kernel
   (`buildTriFace` → `sewAndSolidify` → `fixFaceOrientations`), dropping the
   `OcctWasmAdapter.fromKernel` dependency in `occt-primitives.ts`.
3. **The bridge is deleted.** `api/occt-kernel-bridge.ts` is removed;
   `registerOcctBrepEngine` no longer injects the vendored registry.
4. **The two remaining core consumers read the vendored registry directly**
   via `@faicad/faijs-brepjs/kernel/index`: `compat-projection.ts` checks
   `getActiveKernelId() === null`, `l3-bridge.ts` uses `getKernel()`.
5. **Vendored assembly moves to hosts/tests.** `injectCurrentBrepEngineAsKernel`
   semantics become a self-assembly helper in tests/sheetmetal:
   `OcctWasmAdapter.fromKernel(getHostKernel())` → `registerKernel('occt-wasm')`
   → `freezeKernels()` (idempotent, D10 single-instance preserved by the shared
   host kernel).
6. **Core tests get a global vitest setup** (`src/test/vendored-setup.ts`,
   top-level await) so compat-op and view-projection tests keep working without
   per-file assembly.
7. **Measurement parity moves.** `measurement-parity.test.ts` keeps the
   BrepEngineApi parity describe; the vendored-measurement and injection-reset
   describes are re-homed into `packages/tests/faijs/vendored-measurement-selfhost`
   (self-assembled); `engine-switch-p2.test.ts` drops the assembly-integrity
   describe (the glue-method check died with the bridge).

## Alternatives considered

- **Keep the bridge** (P7 single-instance semantics) — conflicts with the
  end state of deleting the brepjs package; rejected.
- **Per-file assembly in core tests** — 11 files duplicated the same setup;
  the global vitest setup was chosen instead (idempotent, no functional
  effect on unit-only files).
- **Lazy on-demand injection in the bridge** — extra intermediate-state
  complexity with no path to the end state; rejected.

## Consequences

- In the intermediate state, any host/tests running compat ops must
  self-assemble the vendored registry; core product code never injects.
- Core's brepjs footprint shrinks (bridge removed; the remaining core
  consumers are `compat-projection`/`l3-bridge` plus the vitest setup).
- Verified green: core 146 files / 2061 passed / 10 skipped; tests 44 files /
  1040 passed / 2 skipped (d10, p3, p5, p7, vendored-measurement-selfhost,
  compat-face); sheetmetal 22 files / 233 passed; export-surface snapshot
  unchanged vs the Phase 0 baseline (18 subpaths, zero diff).
