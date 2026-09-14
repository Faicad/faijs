# Agent Note: fai_cq_warehouse W4 nuts & washers — revolve returns a shell, 2× GProps on washer bores, per-case tolerance for short helical threads

Status: implemented

English | [中文](2026-09-14-fai-cq-warehouse-nut-washer-geometry.zh.md)

## Problem

`@faicad/fai-cq-warehouse` ports the `cq_warehouse` CadQuery library to TypeScript. W4 is Nut (7 classes) + Washer (3 classes). Upstream builds a nut by revolving a chamfered hexagon section, intersecting it with an extruded hexagon prism, drilling a clearance hole, then optionally fusing a flange profile and/or a real helical thread. Four traps surfaced:

1. **The kernel's `revolve` returns a SHELL, not a SOLID.** `revolve(profile, +Z, 2π)` on a closed 4-point section reports `solids = 0 / shells = 1`, while cadquery's `Workplane.revolve()` hands back a Solid. `getVolume` on the closed shell is *coincidentally exact* (`141.371669` for r=3, h=5), which is exactly why the bug hides: a volume-only check passes. What breaks instead: `common(shell, blank)` on the nut silently returns **one third** of the correct volume, `fuse(shell, solid)` throws `boolean operation failed`, and even in a containment case where `common` gives the right volume the result is still a shell — so the exported STEP is a SHELL while every A-side `shapeType` is `Solid`.
2. **A-side `volume` is 2× the analytic value for revolve-native holed tubes.** `Solid.Volume()` (OCP `BRepGProp`) reports exactly twice the analytic volume for a washer bore, on all six washer cases (e.g. plain M6 iso7089: analytic 145.669368, `Volume()` 291.338736, tessellation 145.609004). Nuts are unaffected because their centre hole is cut after the revolve. `occt-wasm`'s `getVolume` is exact on the same geometry, so the STEP comparison itself is unaffected — but reading A-side truth must go through `volume_mesh`.
3. **`extrude` must be handed a face, not a wire.** `extrude(wire, 0,0,3)` on a 4×2 rectangle returns volume `−16`; the face gives `24`. The kernel does not validate input topology, so this fails silently rather than throwing.
4. **Short internal helical threads amplify the `BRepGProp` aliasing by an order of magnitude.** For `nut-hex-m6-iso4032-threaded` (L=5.2, `fade` at both ends, ≈5 teeth), importing both STEPs into the same kernel gives a GProps volume difference of `4.577e-3` relative and a GProps CoM difference of `5.107e-3` mm — while the **tessellated** volume differs by `3.636e-7` and the tessellated CoM by `1.506e-5`. Both sides' GProps disagree with their own tessellation (A `6.176e-4`, B `3.978e-3`), so the outlier is the measurement, not the geometry. Same root cause as W3, one order larger.

## Decision

### `revolveProfile` returns a solid

`primitives.revolveProfile` now ends with `orientOutward(kern.makeSolid(kern.revolve(profile, axis, angleRad)))`. This is what cadquery's `revolve()` means (upstream still unwraps `Compound.Solids()[0]` after `.val()`). Immediately after the fix `common(nutSolid, blank) = 302.297726`, matching the A-side analytic `302.2977262431188` digit for digit.

### Nut construction mirrors the upstream four steps verbatim

| upstream `make_nut` (`fastener.py:581`) | this package |
|---|---|
| `profile.toPending().revolve()` | `revolveProfile(profileWire(profile), AXIS_Z, 2π)` (solid, see above) |
| `Workplane("XY").add(nut_plan()).toPending().extrude(max_nut_height)` | `extrudeFace(planarFace(planWire), maxNutHeight)` — **face**, not wire |
| `.faces("<Z").workplane().hole(d, m)` | `cut(blank, cylinderBetween(d / 2, 0, m))` |
| `.intersect(nut_blank)` | `intersect(nut, blank)` |
| `.union(flange)` | `fuse(out, flangeWithCentreHole)` |
| `.union(thread)` (`simple=False`) | `fuse(out, isoThread({ external: false, end_finishes: ['fade','fade'] }))` |

`max_nut_height` is the **highest profile vertex z**, not `nut_data["m"]`: DomedCapNut's spherical cap makes it `m + dk/2`.

### Washers are exact

`plainWasher` / `chamferedWasher` / `cheeseHeadWasher` revolve their section profiles with no approximation, so all six cases compare with **zero** bbox / volume / CoM difference and need no tolerance override at all.

### BradTeeNut is implemented in W4 behind a temporary recess cutter

`BradTeeNut.custom_make` needs `extensions.clearanceHole`, which lands in W9·P1-b; it *also* uses W5's `CounterSunkScrew` purely as a parameter carrier (`clearance_hole_diameters` + `countersink_profile`). Per the plan's §8-W4 dedup table, the temporary cutter lives in `src/recess.ts` as `tempClearanceHoleCutter` / `tempCounterSunkCountersinkProfile` — `Temp`-prefixed, one consumer (`nut.ts: bradTeeNut`), JSDoc stating "delete after P1-b, do not spread references". `countersink_profile` is a **90° frustum** `(0,0) → (0,k) → (dk/2,k) → (dk/2 − k·tan(a/2), 0)`, not a rectangle, and ignores `fit`.

### HeatSetNut stays an explicit gap

`HeatSetNut.make_nut` builds knurl faces with `cq.Face.makeNSidedSurface(4 edges, [])`. The kernel has no such primitive, and the nearest substitute `makeNonPlanarFace(wire)` degenerates the 4-edge twisted face to 3 edges (area 2.749170) — not equivalent. `heatSetNut()` **throws explicitly** naming the missing primitive rather than shipping a heuristic; the two A-side references stay in the manifest for whoever adds the primitive.

### One per-case tolerance override, with a reverse guard

`src/testing/compare.ts` gains a single nut entry: `nut-hex-m6-iso4032-threaded` → `volumeRelativeTolerance: 2e-2, linearTolerance: 2e-2` (= measured 4.577e-3 × 4.37 and 5.107e-3 × 3.9, the same 4.4× policy as the thread family). `linearTolerance` is shared by bbox and CoM, but this case's bbox differs by `1.013e-13` — eleven orders of margin, so relaxing it is safe. Global defaults are untouched, and the worst volume deviation among the other ten nut cases is `3.720e-10` (margin 2700×).

## Evidence

STEP equivalence (both STEPs imported into one `occt-wasm` kernel):

| group | cases | equivalent | note |
|---|---|---|---|
| HexNut / HexNutWithFlange / DomedCapNut / UnchamferedHexagonNut / SquareNut | 10 | 10/10 | no override needed |
| BradTeeNut (M6 / M8) | 2 | 2/2 | volume rel. diff 1.3e-10 / < 1e-8 |
| Washers (3 classes) | 6 | 6/6 | bbox / volume / CoM differences all 0 |
| HexNut (`simple=false`, threaded) | 1 | 1/1 | per-case override, see above |
| HeatSetNut | 2 | **0/2 (known gap)** | throws explicitly |
| **total** | **21** | **19/21** | the 2 gaps are an in-scope explicit gap, not a silent skip |

B-side GProps volume vs A-side `volume` lands within `1e-8` relative for every non-threaded case (`hexnut-m6-iso4032`: `302.297726` vs `302.2977262431188`). BradTeeNut was decomposed independently against upstream Python — `make_nut() = 3585.465923`, 65.4292 removed per hole, 196.290 for three, final `3389.175287` vs A-side `3389.1752874338977`.

Full per-case tables, the washer 2× matrix, the threaded four-step calibration and the reproduction commands are in `docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md`.

## Known gaps

- **HeatSetNut (2 cases)**: needs `Face.makeNSidedSurface`. `nut.test.ts` asserts both the throw and that the gap list matches the manifest, so the gap cannot be silently skipped; the A-side data is kept.
- **Five head recesses are not in W4.** The plan's §8-W4 line says "recess.ts five recesses", but those are *screw-head* drive recesses; no W4 nut uses one. Implementing uncovered code would violate "one fact, one home", so it is deferred to W5 (recorded as deviation D1 in the analysis doc).
- **Two explicit deviations from upstream inside `recess.ts`** (both volume-neutral): no `.clean()` (`ShapeUpgrade_UnifySameDomain` is a cq-compat parity debt) and no `null_object` + `eachpoint` location derivation (polar coordinates are equivalent and more direct).

## Alternatives considered

- **Keep the shell and boolean against it anyway.** Rejected: `common` silently returns one third of the volume and `fuse` throws, so the failure is either wrong geometry or a late crash. `getVolume` passing on the shell is precisely the trap.
- **Approximate HeatSetNut with `makeNonPlanarFace`.** Rejected: measured area 2.749170 on a degenerate 3-edge face, geometrically not the same surface, and a heuristic standing in for a missing primitive is the plan's §5.4 red line. The kernel-pitfalls test keeps this as a locked "wrong-looking-right" case.
- **Judge washer volume by A-side `volume`.** Rejected: that field is 2× the analytic value, so every comparison would show a ~50% phantom deviation. `washer.test.ts` keeps two "wrong baseline" regression locks so nobody reintroduces it.
- **Relax the global `volumeRelativeTolerance` instead of one per-case override.** Rejected outright — it would relax the gate for all 33 classes to fix one measurement artifact.
- **Implement all five head recesses now because the plan mentioned them.** Rejected: nothing in W4 exercises them; the plan line itself is corrected in the analysis doc (D1).

## Consequences

- W5–W7 can reuse `revolveProfile` (now solid), `extrudeFace`, `planarFace`, `bboxDiagonal` and `volumeOf` / `meshVolume` unchanged; every later revolve-based class inherits the fixed topology.
- Three behaviours are now pinned by regression locks rather than prose: `kernel-pitfalls.test.ts` trap 8 (revolve topology, from `kernel-nut-probe.ts` § 7), `nut.test.ts` (BradTeeNut / hexNut solids; threaded four-step reverse guard; polar array exclusivity; known gap), `washer.test.ts` (2× wrong baseline; zero-difference assertion with no override).
- The W4 scratch probes were folded into the permanent carriers and deleted: the threaded GProps-vs-tessellation arbitration became `kernel-nut-probe.ts` **section 8**, and the A-side BradTeeNut decomposition became the permanent `scripts/probe-bradtee-decomposition.py`.
- A manifest case (`nut-bradtee-m8-hilitchi`) was added so BradTeeNut has ≥2 sizes, which the coverage assertion requires; the reference set is now 39 cases and the nut/washer subset is 21.
- `npx vitest run` for this package is 7 files / 157 tests, all green. `npx tsc --noEmit` still reports the pre-existing `packages/cq-compat/src/workplane.ts:4548` error (importing `@faicad/cq-compat` in tests exposes it); it is unrelated to this package.
