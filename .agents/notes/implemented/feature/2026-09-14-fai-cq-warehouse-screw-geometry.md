# Agent Note: fai_cq_warehouse W5 screws — `Edge.Center()` is an arc centroid, `fillet2D` needs an exact solve for arc neighbours, and GProps aliases on helical external threads

Status: implemented

English | [中文](2026-09-14-fai-cq-warehouse-screw-geometry.zh.md)

## Problem

`@faicad/fai-cq-warehouse` ports the `cq_warehouse` CadQuery library to TypeScript. W5 is the Screw family (12 classes). Each class builds a head by drawing a 2D profile in the XZ plane, revolving it, intersecting the result with an extruded plan (hexagon for hex heads) or with a plan minus a drive recess, optionally fusing a flange profile, and finally unioning the shank plus an optional real helical thread. Three traps surfaced, two of them new relative to W3/W4:

1. **cq's `edges(">Z")` / `vertices(">X")` sort key is `Edge.Center()` — and for a circular edge that is the *arc centroid*, not the circle centre.** `RaisedCounterSunkOvalHeadScrew` picks the fillet corner with `profile.toPending().edges(">Z").vertices(">X").vals()`. Its oval-top arc (r = 12) has its **centre** at z = `−9.165350`, while its **centroid** sits at z = `2.386`. Using the centre as the sort key selects the wrong edge, the fillet lands on the axis corner, and the geometry is completely wrong. The maximum-`z` `Edge.Center()` among the remaining edges is `1.4173` (`vLineTo` midpoint) / `≤1.5` (straight edges), so nothing else can win — the arc centroid wins only if you compute it as a centroid.

2. **`Wire.fillet2D(radius, vertices)` must not approximate a circular neighbour as its chord.** The closed form `t = r/tan(θ/2)` is exact only when *both* adjacent edges are straight. On the RCOS "oval arc → conical flank" corner it produces a point **off the arc**: measured `|p1 − centre| = 12.000988` against `rf = 12`, and `p1.x = 5.363082` where cadquery gives `5.361036` — a `2.0e-3` error, i.e. 400× the vertex-lock tolerance. The exact solution is the centre-of-fillet construction: two distance constraints (line: `(C − a)·n = r`; circle: `|C − Q| = R ∓ r`), with the arc tangency point at `Q + R·unit(C − Q)`.

3. **Helical external threads make `BRepGProp` quadrature alias, and the first moment is an order of magnitude worse than the volume.** For `screw-shcs-m6-iso4762-threaded` (`simple=false`, 25 mm shank) the same occt-wasm kernel measures a GProps volume difference of `4.149e-4` relative and a GProps CoM difference of `5.472e-2` mm between the two STEP files — yet **each side disagrees with its own tessellation**: A by `1.221e-2` mm, B by `5.779e-2` mm (B's y component is `−0.055304` by GProps and `+0.002484` by tessellation). Same root cause as W3/W4, one order larger because the threaded section is ~20 mm long.

## Decision

### `edgeCenter` reproduces `Edge.Center()` for arcs

`screw.ts` implements `edgeCenter(seg)` as `centre + (2R·sin(Δ/2)/Δ)·unit(arc-mid direction)` with Δ the signed sweep. `>Z` / `>X` selectors are then built on top of it. The regression lock in `screw.test.ts` pins the RCOS numbers (`centre z = −9.165350` from the dumped 3-point circumcircle, arc centroid `z = 2.386`, and the assertion that the centroid beats both the `vLineTo` midpoint `1.4173` and the arc's own endpoints).

### `filletAt` solves the corner exactly

`filletAt(prev, next, r)` now takes the two segments (not just their tangents) so it can see the edge kinds:

| case | construction |
|---|---|
| line + line | classic `t = r/tan(θ/2)` — kept bit-identical, re-verified against `csk-m6-iso10642` (`t = 0.597511` → trim point `5.402489` vs A-side `5.402482`) |
| line + arc, arc + line | parameterise the line as `C = a + s·d + r·n` (n = material-side unit normal, side chosen by the bisector initial guess `C₀ = corner + bis·r/sin(θ/2)`), substitute into `\|C − Q\| = R ∓ r` to get a quadratic in `s`; take the root whose foot is nearest the corner; arc tangency = `Q + R·unit(C − Q)` |
| arc + arc | not reachable in W5 — throws |
| any spline | throws (upstream never fillets a spline) |

The rounded arc's midpoint is `C + r·unit(corner − C)`, which reduces to the old `C − bis·r` for line-line corners.

### Head profiles and derived quantities are transcribed verbatim, quirks included

All 12 `head_profile` / `head_plan` / `flange_profile` / `countersink_profile` hooks are line-for-line ports. Two upstream quirks are **deliberately preserved and locked by tests**:

- `CheeseHeadScrew` writes `polarLine(k / cos(degrees(5)), 5 - 90)`. `math.degrees(5)` = `286.4789` is fed to `cos` as **radians**, yielding `−0.8287276` → a **negative length** `−1.20648k`; combined with the `−85°` direction this is geometrically equivalent to moving *up* along a 5°-inclined flank. "Fixing" it to `cos(radians(5))` puts the endpoint at `(5.341, −3.9)` instead of `y = 4.688102`. The upstream formula is copied as `Math.cos((5 * 180) / Math.PI)`.
- `SetScrew` has no head (`custom_make`): upstream builds `circle(min_radius).polygon(6, e).extrude(t).faces(">Z").workplane().circle(min_radius).extrude(length−t).mirror()`. Nesting a wire as a hole fails here, so the equivalent `cut(cylinderBetween(min_radius, −length, 0), hexPrism(e, −t, 0))` is used; volumes match digit for digit (A-side `200.625411`).

`buildScrew` also returns the upstream derived set: `headHeight`, `headDiameter`, `maxThreadLength`, `threadLength`, `socketClearance`, `headOffset`, `minHoleDepth`, `minHoleDepthStraight`.

### One per-case tolerance override, with a reverse guard

`compare.ts` gains exactly one W5 entry, `match: /^screw-shcs-m6-iso4762-threaded$/`, with `volumeRelativeTolerance: 2e-3` (= measured `4.149e-4` × 4.8) and `linearTolerance: 2e-1` (= measured `5.472e-2` × 3.7), the same ~×4 policy as the W3 thread family (×4.4) and the W4 threaded nut (×4.37). `linearTolerance` is loose because the quantity itself is noisy at that level (its own self-inconsistency is `5.8e-2` mm); the geometry equivalence is proven independently by mesh convergence. The other 27 cases pass under the **global** default `1e-6`, so they were left alone.

## Evidence

| what | metric | value |
|---|---|---|
| spine case `screw-shcs-m6-iso4762` (plain shank) | A-side volume | `900.6842796` — matches B side exactly |
| short control: same class, `simple=true` | volume / CoM difference | `1.010e-15` relative / `5.135e-11` mm |
| threaded case, mesh convergence | tessellated volume rel. diff | `2.133e-4` @ deflection `2e-3` → `5.818e-6` @ `8e-4` (**↓37×**) |
| threaded case, mesh convergence | tessellated CoM diff | `1.554e-3` mm @ `2e-3` → `4.203e-5` mm @ `8e-4` (**↓37×**) |
| threaded case | self-inconsistency (GProps vs own tessellation) | A `1.221e-2` mm / B `5.779e-2` mm |
| RCOS corner | filament tangency point | exact `5.3610355, 1.5705238` vs A-side dump `5.361036, 1.570524`; chord approximation gives `5.363082` |

STEP comparison: **28 / 28 EQUIVALENT** out of 32 reference cases (4 are the explicit PH gap, below). Package tests: `src/screw.test.ts` **70 / 70**, whole package `npx vitest run` **234 / 234** across 8 files.

Full tables — the per-class spec matrix, the RCOS arc-centroid selector table, the fillet2D comparison, the threaded GProps-vs-tessellation matrix, the mesh-convergence sweep, the tolerance four-step calibration and the reproduction commands — are in `docs/analysis/2026-09-14-cq-warehouse-screw-probe.md`.

## Known gaps

- **`PanHeadWithCollarScrew` (din967, 2 cases) and `RaisedCheeseHeadScrew` (iso7045, 2 cases).** Each class's only `fastener_type` is a PH (cross) recess. Its 30° tapered cutter degenerates in width; cadquery's `LocOpe_DPrism` continues the cone, while `draftPrism` self-intersects and throws `E_RECESS_TAPER_UNSUPPORTED` (see the `recess.ts` header). All four manifest cases assert the throw, and the **head profiles are still locked vertex-by-vertex** — the gap is confined to the recess.
- **Four head recesses remain implemented but unused by W5.** Same situation as W4's D1: the drive recesses exist for screw heads, and W5 exercises three of the seven (`slot`, hexalobular, cross). The unused ones stay uncovered rather than being approximated.

## Alternatives considered

- **Use the circle centre as the `>Z` key** (the intuitive reading). Rejected: measured `−9.165350` vs the centroid `2.386`, and the centroid is what selects correctly. Locking the wrong value would have made the whole RCOS class wrong in a way that still produced a plausible-looking solid.
- **Keep the chord approximation for arc neighbours and widen the vertex tolerance.** Rejected outright: `2.0e-3` is the error being measured, so the "fix" is to stop measuring. The exact solve costs ten lines and matches cadquery to six decimals.
- **"Fix" the `degrees(5)` unit bug while porting.** Rejected: the endpoint would move to `(5.341, −3.9)`, i.e. the port would no longer match the reference. The quirk is upstream behaviour and is pinned by a test that also asserts the "corrected" formula produces the wrong value.
- **Relax the global `volumeRelativeTolerance` to cover the threaded screw.** Rejected: it would relax the gate for all 33 classes to absorb one measurement artifact; the other 27 screw cases already agree at `1e-6`.
- **Skip `SetScrew` because it has no head.** Rejected: it is one of the two classes the plan asks to keep separate (the hex socket is the most error-prone feature), so its `custom_make` path was implemented and verified by volume.

## Consequences

- `scripts/kernel-screw-probe.ts` is a permanent evidence carrier (three sections: threaded GProps-vs-tessellation with self-deviations, unthreaded control, mesh-convergence sweep). `scripts/probe-screw-head-profiles.py` is the permanent A-side edge-sequence dumper — both replace the throwaway `_probe-*` scratch files.
- The 12-class head-profile hooks are now regression-locked vertex-by-vertex against the A-side dump, so a future change to `filletAt`, `edgeCenter` or `arcCenter` fails immediately rather than silently shifting a head.
- **`primitives.filletCorner2D` (W4, used by `recess.ts`) and `screw.filletAt` are two separate fillet implementations, and only the latter was fixed here.** The former is documented as *line-line corners only*, and its single caller feeds it an explicit 12-vertex polygon — so it has no circular neighbour today and was left alone. If W6/W7 need to fillet a corner with a circular neighbour in a polygon-wire context, `filletCorner2D` must be upgraded first, and then the two must be merged rather than left side by side ("one fact, one home").
- The manifest grew by one case (`screw-pancollar-m4-din967`) so `PanHeadWithCollarScrew` also has ≥2 sizes; the reference set is now 71 cases and the screw subset is 32.
- `npx tsc --noEmit` still reports the pre-existing `packages/cq-compat/src/workplane.ts:4548` error (unchanged, unrelated to this package). `npx eslint src scripts --ext .ts` is clean for this package.
