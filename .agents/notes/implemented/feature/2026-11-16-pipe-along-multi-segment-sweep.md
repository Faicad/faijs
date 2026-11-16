# Agent Note: sweepAlong — spine facts, strategy, executor, guard for 3D sweep

Status: implemented

English | [中文](2026-11-16-pipe-along-multi-segment-sweep.zh.md)

## Problem

Sweeping a constant section along an arbitrary 3D centreline produced wrong solids
without any error: lost volume, lost inner cavity, misplaced tube, silently missing a
leg. The first attempt at this (`cad.pipeAlong`) worked around the symptoms by splitting
the spine into segments and unioning, but the diagnosis behind it was incomplete — it
attributed to the kernel what was really six independent faijs-layer defects:

- **R1 the section is never placed on the path.** `MakePipe` / `MakePipeShell` sweep the
  section wherever the caller put it. A section at the origin and a spine starting at
  `z=90` sweeps the tube around the origin; the volume identity still passes, the tube is
  simply in the wrong place.
- **R2 the default corner transition is `transformed`.** With G0 corners the section
  stops rotating at the corner and the sweep degenerates into a translated slab:
  measured 0.5000 for a 90° bend, 0.6366 (= 2/π) for a 4-segment polyline arc.
- **R3 mixed edge kinds need segment-wise sweeping.** A single sweep over an arc plus a
  straight leg is mis-signed; the previous note recorded "V = A×(arcLength − legLength)",
  which turned out to be the *unplaced* case (R1) — once the section is placed the same
  single sweep is exact.
- **R4 a holed face was reduced to its outer ring**, so `sweepAdvanced` produced a solid
  bar instead of a tube.
- **R5 volume was the only criterion.** A 15° fold deviates 1.70%, inside the 5% guard,
  while the solid is a flattened slab. A mixed-kind spine losing a whole leg deviates 78%
  but the bbox only loses one leg.
- **R6 nothing looked at the spine before sweeping.** Discontinuous / folded / degenerate
  spines reached the kernel, which then failed with messages that named neither the cause
  nor the fix.

## Decision

Split sweeping into four stages, each in its own module, each independently testable:

1. **Facts** — `api/internal/spine-analysis.ts`. `analyzeSpine(api, wire)` reads edges,
   kinds (`line`/`arc`/`other`), end points, end tangents (numerical single-sided
   difference, **not** the kernel's `curveTangent`), lengths, arc radii, G0 corners
   (`turn > 1e-3 rad`), gaps, closure, folds (`turn > 175°`), degenerate edges. Read-only:
   borrowed sub-shape handles are released, nothing is constructed, nothing throws.
2. **Strategy** — `api/internal/sweep-strategy.ts`. `selectStrategy(facts, req)` maps
   facts to `single` / `miter` / `segments` / `closed`, or rejects with
   `E_SPINE_EMPTY` / `E_SPINE_DEGENERATE` / `E_SPINE_DISCONTINUOUS` / `E_SPINE_FOLD` /
   `E_SPINE_MIXED_CORNER` / `E_SPINE_MITER_SELF_INTERSECT`. Hard refusals come first and
   cannot be bypassed by `opts.strategy`.
3. **Executor** — `sweepAlongBrep` in `api/solid-offset/index.ts`. `single` / `miter` /
   `closed` run one kernel sweep; `segments` sweeps each edge and `fuse`s coplanar joints;
   holed sections are swept per ring and the hole rings are `cut` out. The section is
   placed by `api/internal/section-placement.ts` (minimum rotation preserving in-plane
   orientation, bbox centre onto the path).
4. **Guard** — `api/internal/sweep-guard.ts`. C1 volume identity (default 5%, injectable
   per call), C2 cap normal within 1° of the spine tangent at that end, C3 result bbox
   covers the spine bbox, C4 strategy-level refusals. `strict:false` downgrades C2/C3 to
   notices through `setSweepNoticeHook` — C1 always throws.

`cad.pipeAlong` is renamed to `cad.sweepAlong(profile, spine, opts)`; the old name
asserted "pipe" while the op now covers `single` / `miter` / `segments` / `closed`. Three
old entry points were narrowed rather than left as silent traps:

- `cad.pipe` rejects multi-edge and G0 spines (`E_PIPE_SPINE_UNSUPPORTED`) — `MakePipe`
  has no corner-transition entry, so such a spine can only produce a slab.
- `cad.sweepAdvanced` resolves `transitionMode:'auto'` from the spine facts (G0 corners
  ⇒ `rightCorner`, all-G1 ⇒ kernel default) and gained `autoPlace` / `strict`. The old
  behaviour is still reachable by passing `transitionMode:'transformed'` explicitly.
- `cad.sweep` keeps the two-kernel option intersection, so it verifies C1 only.

## Alternatives considered

- **Keep `pipeAlong` (always segment-wise).** Rejected: segment-wise sweeping leaves a
  V-shaped gap at every G0 corner (measured 0.8968 / 0.8801 on 4- and 16-segment
  polylines), while a single mitered sweep gives 0.9936 / 0.9996 — the segmented route is
  strictly worse whenever the spine has corners.
- **Fix placement by exposing `withContact` / `withCorrection`.** Rejected:
  `withContact` only slides the section until it touches the spine (centre off by one
  section radius), and neither option carries an in-plane orientation, so asymmetric
  sections get twisted. Placement is a 12-element matrix computed once
  (`sectionPlacementMatrix`), shared by `sweepAlong` and `sweepAdvanced({autoPlace})`.
- **Rely on a wider volume tolerance.** Rejected: widening only hides geometry, and the
  15° fold proves the metric itself is blind. C2 exists precisely because volume alone
  cannot see "the section never rotated".
- **Read tangents with the kernel's `curveTangent`.** Rejected: on this occt-wasm binding
  the (`curveParameters` → `curveTangent`) sequence can make a *later* `sweepFull` fail;
  the numerical difference costs 1e-3 of arc-radius accuracy and removes the interaction.
- **Reject closed centrelines.** Overtaken by measurement: a full-circle spine sweeps
  correctly in one kernel call (torus volume = area × circumference), so `closed` became
  a strategy instead of a refusal.
- **Keep `pipeAlong` as an alias for one minor.** Not adopted: the symbol never shipped.

## Consequences

- **One call, correct result**: `cad.sweepAlong` on a single arc / polyline / mixed G1 /
  closed spine gives 1.0000 / 0.9936–0.9996 / 1.0000 / 1.0000 of the analytic volume,
  with holed sections keeping their cavity.
- **Errors name the cause and the fix**: a discontinuous spine reports the two endpoints
  and the distance; a mixed+G0 spine explains that the two problems need opposite routes;
  a slab reports the cap-normal deviation in degrees and points at `sweepAlong`.
- **Attribution corrected**: the earlier "mixed edge kinds lose a leg" and "the binding
  layer breaks after reading edge data" conclusions were both artifacts — the first of an
  unplaced section, the second of a test spine that was itself disconnected (`circleArc`
  angles: with `axis = +X`, `0°` lands on `+Z`, not `+X`). Both are now pinned:
  `sweep-hollow-pipe.test.ts` F2b sweeps a truly tangent-continuous arc+leg at 1.0000, and
  `sweep-kernel-behavior.test.ts` K9 analyses a spine and then sweeps it in the same
  process.
- **New tests**: `test/api/spine-analysis.test.ts` (12), `test/api/sweep-along.test.ts`
  (12), `test/api/sweep-guard.test.ts` (10), plus rewritten K1c / K2 / K4 / K9.
- **`sweep` still has no `volumeTolerance`**: the option is exposed on `pipe`,
  `sweepAdvanced` and `sweepAlong`. `test/api/sweep-mesh-winding.test.ts` sets the
  process-level tolerance to 0.99 through the documented `setSweepVolumeTolerance` exit
  and additionally pins the measured 5/12 volume fact of a coarse polyline spine.
- **Cost**: `segments` is one sweep per edge plus one `fuse` per joint; `single` / `miter`
  / `closed` are one sweep plus one guard pass.
