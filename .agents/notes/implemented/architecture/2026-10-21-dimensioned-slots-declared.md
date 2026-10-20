# Agent Note: every dimensioned slot is declared — no bare numbers, and the internal unit stops being contract

Status: implemented

English | [中文](2026-10-21-dimensioned-slots-declared.zh.md)

## Problem

The 2026-10-20 sketch retrospective recorded the angle-unit split as a *user-facing* contract: script-face angles are degrees, but `contours[].segments[].startAngle` / `endAngle` and `cad.boolean`'s `options.simplifyAngularTolerance` are raw radians, and nothing rejects a wrong unit there — it silently produces wrong geometry.

That framing was wrong. The contract the user actually wants is: **a dimensioned slot never accepts a bare number**. Whether the internals use degrees or radians is an implementation detail that must not appear in the contract at all. Framed that way, the "raw radian" slots are not an exception to document — they are **undeclared slots**, i.e. holes in the unit system.

Two distinct defects fell out of that reframe:

1. **67 numeric parameters were undeclared.** `check-op-dims.mjs` (the 2026-10-10 guard) only enforced the *presence* of `paramDims`, never its coverage, so `paramDims: {}` passed CI while declaring nothing. An undeclared slot is invisible to the dimension pass: bare numbers sail through and the value is consumed in whatever unit the internals happen to use.
2. **The dimension pass does not run on the execute path.** `check()` passes `opDims` to `extractMetadata`; `executeDirectText` does not. So the "no bare numbers" rule is enforced only in dry-run, and is silently waived when the script actually runs.

## Decision

**Declare every numeric parameter, and make the two radian slots behave like every other angle slot.**

- `contours[].segments[]` gets a recursive `DimSpec` (`contoursDimSpec()`, `sketch/dim-spec.ts`): coordinates and radii are `length`, arc `startAngle` / `endAngle` are `angle`, spline `knots` / `degree` / `multiplicities` are `plain`. It is attached as `spec` to `cad.profile`, `cad.punchHole`, `cad.sketchOnPlane`, `cad.sketchOnFace` and `cad.sketchOnSurface`.
- Because the angle base unit is the degree (`DEGREE = 1`, `RADIAN = 180/π`), declaring those slots `angle` means the arriving value is degrees. `contourAnglesToRadians()` (`api/profile.ts`) converts once **at each op entry** — never inside `profileSegToCurve`, which is shared with non-script callers and with kernel-produced `extractContours` output (radians). Converting there would double-convert them.
- `cad.boolean`'s `simplifyAngularTolerance` is declared `angle` and converted at the op entry with `fromBase(…, 'radian', 'angle')`.
- The remaining 65 slots are declared with their dimension or explicitly `plain`.
- `check-op-dims.mjs` gains **Rule 3 (exhaustiveness)**: every JSDoc `@param … type:number` on an op that declares `paramDims` must appear in it; `plain` satisfies the rule. This is what makes the invariant hold over time instead of being true once.
- Scripts that fed radians into those slots are migrated to `* RADIAN` (kernel-derived values keep bit-for-bit fidelity) or to degrees where the value is round.

**The execute-path gap is deliberately NOT closed here.** Measured: wiring `opDims` into `executeDirectText` fails **703 tests across 133 files**, because the entire existing corpus writes bare numbers (`cad.box(20, 20, 20)` and similar). The contract in `docs/api-contract.md` §15.2 has been nominal until now; making it real is a corpus migration plus a breaking change for every host that emits `.fai.js` text — a decision for the user, not a bug fix. The gap is documented at the call site in `runtime.ts` and in §15.4 with the measured number.

## Alternatives considered

- **Keep documenting the radian slots as an exception.** Rejected: it is the framing the user corrected. An "exception" that silently accepts bare numbers *is* the bug.
- **Declare the contour angles `plain`.** Rejected: `plain` means "dimensionless on purpose", and an arc's sweep is dimensioned. It would have silenced the new gate while leaving the trap.
- **Convert inside `profileSegToCurve` / `toContourBlueprints`.** Rejected: those helpers are shared with kernel-produced contours (`extractContours`, radians) and with direct TS callers (e.g. `buildSketchOnPlaneWith` in `sketch-on-plane-open-wire.test.ts`). Entry-point conversion keeps exactly one script-face↔internal boundary; that test passing unchanged is the evidence the boundary is in the right place.
- **Enable the dimension pass on the execute path now.** Deferred with a measurement, not rejected. 703 failures is a migration project, and it breaks hosts that emit script text; doing it silently would have shipped a large breaking change as a side effect of a contract fix.
- **Skip Rule 3 and rely on review.** Rejected: the 67 holes prove review does not catch this. The guard is cheap (it already walks the same AST) and it is verified to fail when a declaration is removed.

## Consequences

- Every numeric parameter on a `paramDims`-declaring op is now accounted for, and CI enforces it.
- A bare number on a contour arc angle or on `simplifyAngularTolerance` is now a declared-slot violation instead of silently wrong geometry.
- **Behaviour change for script callers of the five contour ops:** arc angles are now read as degrees. Direct TS callers (`buildProfileShape`, `toContourBlueprints`, `buildSketchOnPlaneWith`) still pass radians and are unaffected — this asymmetry is intentional and documented.
- The internal unit is no longer part of the contract: `docs/sketch-contract.md` §2 lost its "raw radians" rows and now states the rule (write a quantity) plus where the conversion happens.
- Tests: 4880 passed, 4 failed — the same 4 that fail on a pristine HEAD checkout (`case2-load-stl-cylinder-assembly` ×2, `engine-verdict-equivalence` ×2), verified against a `git worktree` at HEAD rather than assumed.
