# Agent Note: Script-face sweep / loft family — input adaptation and the platform-op split

Status: implemented

English | [中文](2026-09-24-script-face-sweep-loft.zh.md)

## Problem

The previous round gave the scripting face a way to *produce* a wire (`wire` / `helix` / `sketch({as:'wire'})`), but the actions that *consume* one were still unreachable. Four of them — `sweep`, `complexExtrude`, `twistExtrude`, `roof` — existed only as generated compatOps that had never been marked `scriptFace`; `loft` was `skip` in the arg-spec.

The real blocker was **not** argument borrowing. `sweep`/`loft` were skipped with the reason "the compat-op template cannot borrow arrays", but `borrowDeep` does recurse into arrays and nested shapes. The blocker is **input-shape adaptation**: the natural section source on the script face is `sketch(...)`, which produces a **face**, while the vendored `sweep(wire, spine, …)` / `loft([wire, …])` accept only **wire**. A generated single-handle projection template has no place to express "face → outer wire". Precedent already existed: `fillet` and `extrude` are likewise overridden by hand-written faijs ops for exactly this reason.

## Decision

1. **Hand-write `api/sweep.ts` and `api/loft.ts` as platform ops** — `engines:['occt']` with no `capabilities` (D11-7: the two are mutually exclusive). Both reach the vendored implementation through the ordinary L3 bridge (`borrowBrepjsShape` → `callBrepjs` → `unwrapOrThrow` → `adoptEntity`) and declare `naming: {kind:'unmodeled'}` (a swept/lofted body has no face vocabulary yet; precedent `torus`).
2. **One shared input-adaptation path**: `api/internal/profile-wire.ts` → `toProfileWireView(section)`. 1D input (decided by `isCurveShape`, the discriminant the previous round introduced) is borrowed as-is; a 2D face is reduced to its **outer wire** via the vendored `outerWire` (hole loops are dropped — a sweep spine / loft section is a single contour). It is deliberately a leaf module so the two ops cannot drift into two judgement paths.
3. **Ownership is stated explicitly in that helper**: `borrowBrepjsShape` returns a zero-copy *borrow* (the faijs `Shape` keeps ownership), whereas `outerWire` returns a *new* arena wire whose lifetime belongs to the vendored finalizer. Therefore **no** `unregisterFromCleanup` here — that is the R1 rule for the *adoption* path, which this is not.
4. **`shellMode` is not exposed.** Vendored `sweep(…, shellMode)` returns `[shell, startWire, endWire]`, a tuple that cannot cross the single-product boundary (design principle 5: multi-product results go through named `outputs`, never arrays). `loftAll` (returns `Shape3D[]`) is not exposed for the same reason.
5. **`complexExtrude` / `twistExtrude` / `roof` need no hand-written op.** They are already generated compatOps; they were merely missing `scriptFace: true`. Admitting them is an arg-spec flag, not new code.
6. **Stale skip reasons corrected.** `loft` moves to `skip` with the reason "overridden by handwritten `api/loft.ts`" (the `fillet` precedent); `guidedSweep` / `multiSectionSweep` keep `skip` but now state the true cause — array borrowing is supported, faijs simply has not written those ops yet (long tail, out of scope this round).
7. **Generated artefacts re-run**: `gen-l3-surface.ts` (script-face + manifest), `gen-symbol-table.ts` (symbol table), `gen-api-dts.ts` (`api.d.ts`, whose embedded op catalogue was stale).

## Alternatives considered

- **Teach the generator a "face → outer wire" input mode.** Rejected: the generator's value is uniform single-handle projection; per-op adaptation hooks would move modelling decisions into codegen. Hand-written ops are the established route for this exact situation.
- **Declare `capabilities:['sweepPipeShell']` instead of `engines:['occt']`.** Rejected: capability routing is for *neutral* ops that run on any BREP engine (`roof` is the live example); engine identity is for ops that only exist on one platform. D11-7 makes the two mutually exclusive.
- **Expose `shellMode` / `loftAll` by lifting tuples/arrays onto the script face.** Rejected by design principle 5.
- **Give `sweep` / `loft` a mesh implementation.** Rejected: `BRepOffsetAPI_MakePipeShell` and `BRepOffsetAPI_ThruSections` are inherently BREP-only, which is precisely what the platform-op mechanism is for.

## Consequences

- `cad.sweep(profile, spine, opts?)` and `cad.loft(sections, opts?)` are reachable from `.fai.js`. Both accept a **wire or a face** as section; both are rejected before execution when the active engine is not occt.
- `cad.complexExtrude`, `cad.twistExtrude` and `cad.roof` are reachable. `roof` stays neutral (capability-routed, no engine identity).
- **GOTCHA pinned by test**: vendored `complexExtrude(wire, center, normal, profile?)` treats `normal` as the **extrusion vector**, not a unit direction — `[0,0,30]` extrudes 30 mm along +Z, and `center` is the spine start.
- **GOTCHA pinned by test**: brepkit's capability table has no `makeWire`, so `cad.wire` fails before an engine-gate case could ever reach the op under test; engine-gate inputs are therefore built from `cad.cylinder` (brepkit declares `makeCylinder`).
- **GOTCHA pinned by test**: occt-wasm 3.x lacks `sweepAdvanced`, so vendored `sweep` discards `transitionMode` and emits a one-off `console.warn`. CI treats any `stderr |` line as a failure, so the warning is spied *and content-checked* (only the "occt-wasm version capability" family is tolerated) rather than globally muted.
- Two repo-level guards that were already red before this round are repaired: `mesh/api.d.ts` was stale (regenerated), and `surface-mechanism.test.ts`'s script-face kind whitelist predated the commit that put `query` ops on the script face — it now admits `brep-op` / `faijs` / `query`.
- The platform-import guard (`scripts/check-platform-imports.mjs`) is clean again: `helix.ts`, written in the previous round, imported `occt-kernel/*` without the required `@platform occt` annotation.

## Verification

- `packages/core/src/api/sweep-loft.test.ts` (14 tests): sweep with a 2D face section (exercising the outer-wire adaptation) and with a 1D wire section; loft with two face sections and with two wire sections; sweep/loft geometry asserted via BREP bounding boxes; `complexExtrude` / `twistExtrude` reachability; **every** `engines:['occt']` op fails *before execution* under brepkit with `op '<name>' requires engine occt`; sweep / loft / complexExtrude / twistExtrude are **not** intercepted under `brep_mock` (D11-3 exemption); `roof` is not engine-gated at all (neutral op).
- Full core suite: 140 files, 1973 passed / 10 skipped, 0 failed.
- `faijs-extra` `cad-membership` (10 passed) and the integration `faijs/p23-cad-face` (15 passed / 1 skipped) green.
- `tsc --noEmit`, `eslint` on the touched files, and `scripts/check-platform-imports.mjs` clean.
