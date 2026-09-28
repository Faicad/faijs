# Agent Note: ref-count guard in the sketch FCStd → canonical constraint projection

Status: implemented

English | [中文](2026-09-28-sketch-underref-constraint-crash.zh.md)

## Problem

`fromFreeCadConstraints` (`packages/sketch/src/project.ts`) dereferenced the
constraint refs it expected without checking how many were present. FreeCAD
stores an implicit axis/origin as GeoUndef, so an absolute-coordinate constraint
arrives with a SINGLE ref. `Bathroom_cabinet_sink.FCStd` Sketch259 carries
`DistanceY {refs: [{geoId: 0, pos: 1}], value: 70}`, and the referenced start
point really is stored at `y1 = 70` — the constraint is "this point's y is 70".
`two()` then called `ref(undefined)` and the projection threw
`TypeError: Cannot read properties of undefined (reading 'pos')`.

`convert.ts` catches that throw and records the sketch as `L2 / solver-throw`,
which fails the whole file (no container is written). It was the largest gap
class in the corpus: 436 of the first 900 files (1047 sketches). Because the
throw aborted a sketch before its consumers ran, it also masked the real gaps
behind it — the failure was reported as a sketch crash even when the sketch's
own solve had succeeded.

`DistanceY`/`DistanceX` are not the only exposure: `Coincident`, `Parallel`,
`Tangent`, `Perpendicular`, `Equal` and `DistanceX/Y` all reach `two()`, and
`PointOnObject` (`refs[1]`) and `Symmetric` (`refs[2]`) index directly, so any
short refs array crashed the same way.

## Decision

Check each constraint's ref count BEFORE any dereference, against a per-type
minimum (`REFS_REQUIRED`), and route anything below it to the projection's
existing `unmapped` ledger with reason `ambiguous-refs`. The ledger already
existed for axis refs, reference constraints and unsupported types, so no new
vocabulary is invented and the loss stays visible rather than silent.

Only types the projection switch actually handles are listed in `REFS_REQUIRED`.
Types it does not handle (`InternalAlignment`, `Block`, `Weight`, …) are absent
from the map, so they keep flowing to the `default:` branch and keep reporting
`unsupported-type` — the guard must not re-label a diagnostic that was already
correct.

The guard deliberately does NOT try to encode the missing information. The
planegcs backend ignores a 1-ref `DistanceX`/`DistanceY` as well (its `r[1]` is
absent, so no primitive is pushed). Both projections therefore agree that such a
constraint carries no solve information, which is what keeps the convert-time
fidelity precheck and the emitted `cad.sketch` consistent. Teaching either side
to pin an absolute coordinate would need a new canonical constraint kind and is
left as a separate change.

## Consequences

- The crash class is gone. Measured on the samples that previously reported
  `solver-throw`:
  - `Bathroom_cabinet_sink.FCStd` → `ok: true, gaps: []`, 63 sketches all `L0`.
  - `Plate Wheel simplex 1x17,02.FCStd` → `ok: true, gaps: []` (previously
    `solver-throw` + `groove-profile-baked-upstream`).
  - `battery-AAA.fcstd` → `ok: true, gaps: []`.
- Those samples show the dropped 1-ref constraint does not shift the solution:
  the surrounding constraints still pin the geometry, and the classify step
  still lands on `L0` (solver reproduces the stored coordinates).
- Two other samples stopped crashing and exposed the NEXT root cause instead:
  `FAULHABER_2342L-012CPR.FCStd` and `Fountain.FCStd` now fail on
  `external-geometry-unresolved: unsupported sub-element: Vertex55/Vertex19`
  (`external-geo.ts` only accepts `Edge<N>` links), cascading into
  `pad-missing-profile` / `groove-missing-base` / `fillet-missing-base`. That is
  a separate feature gap, not a regression.
- `packages/sketch` is outside both the pre-commit eslint glob
  (`{src,packages/core/src,packages/stdlib/src,packages/gear-lib-demo/src}/**`)
  and `npm run lint` (`packages/core/src packages/faijs-extra/src`), so
  `project.ts` carries a pre-existing `no-unused-vars` error on the unused
  `geoms` parameter (present at HEAD as well). It is disclosed here rather than
  papered over with a rename, because that parameter is where the documented
  "bounds checking" of `geoms` belongs and the fix is a behavior change of its
  own.

## Files

- `packages/sketch/src/project.ts` — `REFS_REQUIRED` plus the ref-count guard and
  its doc bullet.
- `packages/sketch/src/project-fcstd.test.ts` — two regression tests: a 1-ref
  `DistanceY` is ledgered instead of thrown, and under-specified constraints of
  every kind never throw.

## Alternatives considered

- **Throw a typed `SketchProjectionError` instead of ledgering.** Rejected: the
  caller (`convert.ts`) treats any throw as `solver-throw` and fails the file.
  A recorded ledger entry is the projection's documented way to report "no
  canonical counterpart", and it keeps the failure attribution correct.
- **Add canonical `coordinateX`/`coordinateY` kinds now, with the backend
  mapping 1-ref DistanceX/Y to `coordinate_x`/`coordinate_y`.** Deferred, not
  rejected: it is the faithful encoding, but it changes the public canonical
  vocabulary (`cad.sketch` constraints), needs the reverse mapping and CadQuery
  tables updated, and must be verified against the corpus — a change of its own
  rather than a crash fix.
- **Relax the caller's `polyline.length >= 2` filter for external geometry.**
  Out of scope here; that filter concerns external links, not sketch
  constraints.
