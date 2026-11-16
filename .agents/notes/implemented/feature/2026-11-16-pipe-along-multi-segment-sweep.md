# Agent Note: pipeAlong — one-call multi-segment tube sweep with holed sections

Status: implemented

English | [中文](2026-11-16-pipe-along-multi-segment-sweep.zh.md)

## Problem

Sweeping a constant section along a multi-segment 3D centreline was only possible by
hand: split the path into single-segment wires, build a section per segment, translate
it onto that segment's start frame, pipe each segment, then union. The case8 drawing
(U-shaped tube with a run-out that leaves the U's plane) needed five such segments.

Three kernel facts forced that shape:

- `pipe` / `sweepPipeShell` / `sweepFull` accept **one** profile handle and **one**
  spine, and they do not relocate a section onto an arc's start frame. `withContact`
  and `withCorrection` are refused on a single true arc when the section stays at the
  origin.
- A multi-edge spine (tangent or cornered) loses solid volume: a two-segment 90° bend
  keeps 50%, a tangent arc+line pair keeps 14.5%, and the post-condition guard
  rejects both.
- A holed face section lost its bore entirely: `toProfileWireView` kept only the outer
  ring, so `sweepAdvanced` produced a solid rod instead of a tube.

## Decision

Add `cad.pipeAlong(section, spine, opts?)` in `api/solid-offset/index.ts`:

1. Split the spine into edges (`getSubShapes(wire, 'edge')`); order is irrelevant
   because each segment is swept independently and unioned.
2. For each edge, read its start point and start tangent (`curveParameters` +
   `curvePointAtParam` + `curveTangent`) and build a 12-value affine matrix that maps
   the section's local XY frame onto that point with normal = tangent, centring the
   section's bbox centre on the centreline (Pappus: volume = net area × length).
3. Sweep each segment with `kernel.pipe(face, segWire)` and keep the existing
   `assertSweptVolumeMatches` guard per segment (default 5%).
4. Hole rings are swept separately and subtracted from the outer sweep; the composite
   is re-checked against the face's net area.
5. Union the segments.

`pipeAlong` is occt-only, and `opts.closed` is rejected for now
(`E_PIPE_ALONG_CLOSED_UNSUPPORTED`).

`sweepAdvanced` also gained holed-face support along the same path: `toProfileRingsView`
now returns every ring, and `sweepAdvancedBrep` sweeps each ring and cuts the holes out.
Simple (single-ring) sections keep the previous behaviour byte-for-byte.

Two follow-ups landed with it, both from the same "coarse sweep on purpose" workflow:

- **Per-call guard tolerance.** `assertSweptVolumeMatches` takes an optional
  `volumeTolerance` in `(0, 1)`; `pipe`, `sweepAdvanced` and `pipeAlong` expose it as
  `opts.volumeTolerance`. The process-wide `setSweepVolumeTolerance` stays as the
  default. Out-of-range values throw `E_SWEEP_TOL_INVALID` instead of being clamped,
  and the error message now names both escape hatches plus "raising it does NOT fix
  the geometry".
- **Section placement is documented, not extended.** `sketchOnPlane` already accepts
  `plane: { origin, normal, xAxis }`, so a section can be dropped on a spine's start
  frame with no translate and no new op. Its `@example` now shows that (and the
  `xAxis` requirement for asymmetric sections), which flows into the generated manual
  instead of being hand-edited there.

## Alternatives considered

- **Feed all rings to the kernel.** Rejected: `sweepPipeShell(face)` refuses a face
  outright (`BRepFill_Section: bad shape type of section`), and the family takes one
  section handle.
- **Rely on `withContact` / `withCorrection`.** Rejected by measurement: both are
  refused on a true arc when the section is not already on the start frame.
- **Sweep the whole multi-edge spine in one call.** Rejected by measurement: 50%
  (cornered) and 85.5% (tangent) volume loss, guard refuses both.
- **Extend segments slightly to force overlap before union.** Rejected: the coincident
  joint already unions exactly (verified), so a fudge epsilon would only add error.
- **Add `pipe(profile, spine, { autoContact })`.** Not adopted: `pipeAlong` already
  places every section, so a second relocation switch on the single-segment op would be
  redundant surface area on a validated code path.

## Testing

- `test/api/sweep-hollow-pipe.test.ts` F1–F3 pin the kernel facts (holed face loses its
  bore; cornered and tangent multi-segment spines lose volume; boolean subtraction of
  ring sweeps restores the bore).
- G1/G2: one call over a three-segment U produces exact volume for solid and annular
  sections.
- G4: case8's 3D path (short leg → 180° bend → long leg → run-out arc → cross tube)
  with the Ø17.3/Ø13.3 annulus yields bbox 90 × 95 × 180 and volume 34862.09
  (analytic 34863.9), matching the previously delivered five-segment model.
- G3: `opts.closed` is rejected with a dedicated error code.
- P2g1–P2g4: default 5% still rejects a cornered spine; `volumeTolerance: 0.6` lets the
  same call through while the volume stays at 50% of analytic (relaxing does not repair
  geometry); `pipe` honours the same option; `1.5` / `0` / `-0.2` raise
  `E_SWEEP_TOL_INVALID`.
- P1a–P1c: `sketchOnPlane({ plane: { origin, normal } })` puts the section on a spine's
  start frame (volume = area × length with no translate), a section left at the origin
  is rejected by the guard, and an explicit `xAxis` pins an asymmetric section's
  orientation. P1a also pins the auto-`xAxis` rule (normal `+Y` ⇒ local `+X` lands on
  world `+Z`).

## Consequences

- case8's `part-along.fai.js` builds the same solid in one call; `faijs run` exports a
  watertight STL with 0 non-manifold edges and identical bbox/volume.
- Cost per call is one sweep per edge plus one union; acceptable for tube-scale parts.
- Sections must be symmetric about the centreline: an asymmetric section would break
  the Pappus identity on arcs and be rejected by the guard rather than silently drift.
- `circleArc`'s angle basis is not "0° at +X": with `axis = (0,-1,0)` the 0° ray points
  at −Z and 90° at +X, and negative end angles wrap into a longer sweep. Callers
  building U bends should prefer `tangentArc(start, tangent, end)`; the convention is
  pinned by G0e.
- `docs/ops-api-inventory.md` is not regenerated: its generator already failed before
  this change because `validateSolid` has no chapter (172 chapters vs 173 ops). The
  JSDoc on `pipeAlong` is the source of truth until that pre-existing gap is closed.
- `sweep` does **not** expose `volumeTolerance` yet: the plan scoped the option to
  `pipe` / `sweepAdvanced` (plus `pipeAlong`). This is visible on HEAD as two
  pre-existing failures in `test/api/sweep-mesh-winding.test.ts`, whose polyline spine
  the `sweep` guard rejects (58.3% off); they date from the 2026-11-15 guard commit and
  are unrelated to this change. The same option on `sweep` is the obvious fix.
