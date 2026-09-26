# Sketch constraint library extraction — `cad.sketch` rename and library boundary

**Date**: 2026-09-26
**Status**: implemented
**Plan**: `docs/plans/2026-09-26-sketch-constraint-lib-plan.md`

## Decision: rename `cad.sketch` → `cad.profile`, give `sketch` to the constraint library

The existing `cad.sketch` op (closed-contour face construction from raw segments) was renamed `cad.profile`. The `sketch` name was released to the new `@faicad/faijs-sketch` constraint library, whose op is `cad.sketch` (solve constraints → build face).

**Why**: `sketch` is the user-facing word for constraint-driven 2D design. The old op was a misnomer — it did no solving, just contour-to-face. `profile` is the correct cross-domain term for a cross-section / contour used for extrude/revolve/sweep.

**What was given up**: the old `cad.sketch` name. No alias transition (D6) — all call sites (3d_editor, .fai.js fixtures, tests) were updated in the same change. This is a breaking rename for any external consumer still on `cad.sketch`.

**Alternatives rejected**:
- `cad.contour` — collides with fcstd internal `Contour`/`ContourSeg` types.
- `cad.face2d` — too narrow; the op also produces wires.
- Alias transition (`cad.sketch` → `cad.profile` with deprecation alias) — rejected because the constraint library needs the `sketch` name immediately; a transition period would require two names to coexist.

## Boundary: the library has no core deep-path privilege

`@faicad/faijs-sketch` consumes core only through its public exports (`@faicad/faijs/api/profile`, `@faicad/faijs/api/result`, `@faicad/faijs/mesh/types`). It does not reach into `packages/core/src/` deep paths. This is the same contract `@faicad/faijs-extra` follows.

**Why**: deep-path imports break publish-state resolution — the installed package has `dist/`, not `src/`. The npm install smoke test (`src/install-smoke.test.ts`) is the tripwire: it packs, installs into an isolated dir, and runs the full solve pipeline. Any deep-path import would fail at `ERR_MODULE_NOT_FOUND` in the installed state.

**How to apply**: when adding a new capability to the sketch library, import from `@faicad/faijs/api/*` or `@faicad/faijs/mesh/types` only. If a needed function is not exported, export it from core first — do not reach into `src/`.

## Diagnostic status: underconstrained detection via `gcs.dof()`

The solve status (`solved` / `underconstrained` / `redundant` / `conflicting` / `failed`) is determined by combining planegcs's `has_gcs_redundant_constraints()` / `has_gcs_conflicting_constraints()` with a DoF probe (`wrapper.gcs.dof()`).

**Why**: planegcs does not natively distinguish "solved with zero DoF" from "solved with remaining DoF" — both return `SolveStatus.Success`. The DoF probe is the only way to surface underconstrained status. Without it, an underconstrained sketch would silently report `solved`, violating the "allowed ≠ silent" contract (D3).

**GOTCHA**: `fixed` constraints in the canonical model are projected as no-ops (FCStd has no explicit fixed constraint; the implicit fixed frame covers origin/axes). This means a `fixed` constraint on a user-specified point does NOT actually fix that point in the solver. Sketches relying on `fixed` for absolute positioning will have remaining DoF. This is a known first-release limitation.