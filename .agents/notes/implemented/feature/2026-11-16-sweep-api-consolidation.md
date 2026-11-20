# Agent Note: Sweep public surface consolidated to `sweep` + `sweepRaw` (with measured three-engine capability matrix)

Status: implemented

2026-11-16. Follows `2026-11-16-pipe-along-multi-segment-sweep.zh.md` (four-segment sweep) and
this round's two steps: "API merge + engine probing".

English | [中文](2026-11-16-sweep-api-consolidation.zh.md)

## Problem

The repo had four sweep paths with names that gave no clue; the differences were all in the
**kernel**, not in user intent:

| Old symbol | Kernel entry | Domain |
|---|---|---|
| `cad.pipe` | occt `MakePipe` | Single-edge / same-type G1; face section → solid, wire/edge → shell; **no transition control, no placement** |
| `cad.sweep` | L1 neutral (occt `sweepPipeShell` / brepkit NURBS / smlib planar path) | Outer ring only (holes lost), no placement |
| `cad.sweepAdvanced` | occt `sweepFull` full control set | law / auxSpine / support / withContact… |
| `cad.sweepAlong` | Strategy executor (facts → strategy → execute → criteria) | The one that actually "worked by intent" |

For the same intent — "sweep a section along a centerline into a pipe" — the user could not tell
from the names which one to pick. No script in the repo used `pipe` (only 3 tests + doc examples)
⇒ deleting it loses zero capability.

## Decision

Approved by the user 2026-11-16, explicitly "no compatibility needed".

The public surface keeps only **two** symbols:

- `cad.sweep(section, spine, SweepOptions{strategy, autoPlace, volumeTolerance, strict})`
  — the single entry: spine facts → strategy (single / miter / segments / closed) → execute → C1/C2/C3.
- `cad.sweepRaw(profile, spine, SweepRawOptions)` — the kernel control-plane escape hatch
  (formerly `sweepAdvanced`).

Deleted `cad.pipe` (its domain = `sweep`'s `single` strategy; hollow faces are covered by
per-ring sweep + `cut`; the raw `MakePipe` pipeline survives as `sweepRaw({ mode:'simple' })`),
deleted `cad.sweepAlong` (merged into `sweep`), renamed `sweepAdvanced` to `sweepRaw`.
**No compatibility aliases are left behind.**

## Engine capability matrix (all measured, not statically inferred)

`packages/core/test/api/sweep-engines.test.ts`: the same script run against three engines,
4×4 section.

| Case | occt | smlib | brepkit |
|---|---|---|---|
| S1 straight line 25 (section at start) | 400 | 400 | 400 |
| S2 section at z=0, spine z=90..140 (autoPlace) | 800 | 800 | 800 |
| S4 two collinear G1 segments | 400 | 400 | 400 |
| S5 L-shaped 90° corner (miter) | 320 | `E_SWEEP_ENGINE_CAP` | `E_SWEEP_ENGINE_CAP` |
| S6 section with hole (8/4) | 3015.93 | 3015.93 | volume right (3015.93) but C1 area reading distorted ⇒ criterion false-positives |
| K1 kernel level: planar true arc r=10/90° | — | 251.33 (= area × arc length) | — |
| K2 kernel level: closed full circle r=10 | 1005.31 | 1005.31 (= area × perimeter) | — |

This yields the table (`sweep.ts#STRATEGIES_BY_ENGINE`, the single authority on engine
capability):

| Engine | single | miter | segments | closed | C2 |
|---|---|---|---|---|---|
| occt | ✔ | ✔ | ✔ | ✔ | ✔ |
| smlib | ✔ | ✘ | ✘ | ✔ | ✘ (`shapeOrientation` unsupported) |
| brepkit | ✔ | ✘ | ✘ | ✘ | ✘ |

## Three facts only real measurement exposed

1. **smlib's kernel itself moves the section to the path start** (`moveProfile=true` of
   `SmApiCreateSweepAlongPlanarPath`): stacking our autoPlace does **not** move it twice — S2
   matches occt at 800.
2. **smlib handles multi-edge paths / closed paths / holed sections** (S4 / K2 / S6 all match
   occt). The initial conclusion was "lacks corner transition (miter) and true-arc spines" ⇒
   `closed` open, `miter`/`segments` temporarily off. **That conclusion was half-overturned by
   the P0 probes later that day**, see "Round 2: support smlib as far as possible" below.
3. **brepkit's `shapeType` only distinguishes SOLID / FACE / COMPOUND** (`brepkitKernel.ts:1478`);
   wires always report COMPOUND. So the spine criterion cannot use type strings — it must judge by
   **structure** (has `edge`, and no `face`) — otherwise every legal spine on brepkit gets
   wrongly rejected as `E_SWEEP_SPINE_NOT_WIRE`.

## Two defects found and fixed along the way

- A bare **edge section** (output of `cad.circleArc`) sent straight to the kernel → occt
  `BRepFill_Section: bad shape type of section`. Now `sweepRingsOnce` wraps the edge into a wire,
  and the product is a **solid** (the old `pipe` "edge → shell" semantics died with `pipe`).
- Polyline spines (16/40-segment approximations of arcs) no longer need "volume-guard
  post-hoc alarms": after the strategy layer picks `miter` the volume is exact (measured in
  A2b/A5); `strategy:'single'` still reproduces the old 2/π deviation (A2 kept as a guard case).

## Unresolved / follow-ups

- `docs/ops-api-inventory.md(.zh.md)` **could not be regenerated**: the generator
  `scripts/gen-ops-api-inventory.ts` is deprecated and currently throws outright because
  "per-op chapter set ≠ symbol-table op set (171 vs 172, missing `validateSolid`)" — a
  pre-existing gap unrelated to this change. This round the three chapters (pipe / sweep /
  sweepRaw), the op list and the naming table were **hand-synced** to the generator's format.
  Once `validateSolid` gets a chapter, regenerate and discard the manual diff.
- `cad.circleArc` was not implemented on `smlib` ⇒ arc spines (`single` true arc, `segments`)
  were unreachable at op level. **Fixed in round 2** (`circleArc` / `edge` go through the L1
  neutral path, `engines: ['occt','smlib']`).
- On brepkit, `getSurfaceArea` of a holed face reads no net area (reads 16, true value 150.8).
  brepkit is a kernel about to be retired — not fixed; the test pins the current behavior
  (delete along with brepkit).

## Verification

```
npx vitest run test/api/sweep-engines.test.ts test/api/sweep-along.test.ts \
  test/api/sweep-guard.test.ts test/api/sweep-kernel-behavior.test.ts \
  test/api/sweep-hollow-pipe.test.ts test/api/sweep-loft.test.ts \
  test/api/sweep-revolve-guard.test.ts test/api/occt-s4-solid-offset.test.ts \
  test/brep/engine/engine-switch-smlib.test.ts \
  test/brep/engine/multi-engine-op-parity.test.ts test/api/occt-s4-c4-disposition.test.ts
```
11 files / 156 cases all green; `npx tsc --noEmit` has no sweep-related errors (55 pre-existing
errors all in `test/probe-revolve-*` / `revolve-degenerate` / `smlib-kernel/circular-pattern-step`);
`check-api-test-coverage --package=core` (baseline regenerated) passes.

## Round 2: support smlib as far as possible (P0 ceiling probes + relaxed capability table)

The user asked to "support at least occt/smlib (smlib is the required future kernel)", so we first
measured smlib's kernel-level true ceiling, then relaxed `STRATEGIES_BY_ENGINE` accordingly. All
numbers come from `P0a–P0i` (kernel level) and `S1–S9` (op level) in
`test/api/sweep-engines.test.ts`.

### P0 kernel-level measurements (4×4 section, `squareFace`)

| Probe | Spine | Result |
|---|---|---|
| P0a | spatial 3D spline (4 control points, out of plane) | V=570.705 = 16 × 35.669 ⇒ **spatial G1 works too** (despite the entry being named AlongPlanarPath) |
| P0b | true arc r=10 90° + tangent straight leg (one wire, two edge kinds) | V=411.327 = 16 × 25.708 ⇒ mixed-edge G1 sweeps in one pass |
| P0c | circular **wire** section (not face) | V=314.159 = 4π × 25, type=SOLID ⇒ wire sections produce solids |
| P0d | holed face + closed circular path | V=4021.230 = **64** × 62.83 ⇒ the hole ring is ignored by the kernel (net area should be 51.43) |
| P0e | helix (pitch 10 / h 20 / r 8) | V=1639.964 = 16 × 102.498 ⇒ spatial spines work |
| P0f | planar L corner (G0, path length 20) | V=320.000 **exact** ⇒ the kernel itself mitered, it did not collapse |
| P0g | same, geometric inspection | bbox x=[-2,10] z=[0,12], faces=8, manifold=true ⇒ exactly the right corner material |
| P0h | per-segment sweep + fuse (arc 251.327 + straight 160) | fused=411.327 ⇒ the `segments` equivalent execution holds |
| P0i | **spatial** G0 corner (z segment + oblique segment) | V=**0**, manifold=**false** ⇒ the kernel emits degenerate slivers |

Three old judgments corrected:
1. `miter` **can** be given to smlib — planar G0 corners measured exact (320);
2. `segments` **can** be given to smlib — per-segment sweep + fuse measured identical to one-pass;
3. `addHolesInFace` hole rings are **not** recognized by the kernel's sweep (the earlier
   inference "holes will be recognized" was wrong), so `sweepRingsOnce`'s per-ring sweep +
   `cut` is the only correct path (that is where S6's 3015.93 comes from).

### What changed

- `api/sweep.ts`: `STRATEGIES_BY_ENGINE.smlib = ['single','miter','segments','closed']`;
  added an **smlib-specific pre-rejection**: `strategy === 'miter' && !facts.planar` →
  `E_SWEEP_ENGINE_CAP` (message points out "spatial G0 corners sweep to V=0/non-manifold —
  use occt, make the spine planar, or switch to a true arc"); `capsAvailable` extended to
  smlib (C2 end-face normals restored on smlib).
- `api/internal/spine-analysis.ts`: new `SpineFacts.planar` (coplanarity check from sample
  points of every face/edge; `line` takes both ends, `arc` takes three points, `other` takes
  five — a single spatial spline sampled at only 3 points would be misjudged as coplanar),
  `SpineEdgeFacts` gains `mid` / `samples`, and `describeSpine` reports `non-planar`.
- `api/internal/sweep-guard.ts`: the `shapeOrientation` query gets its own try/catch — engines
  that cannot read orientation (smlib) no longer skip the whole face. C2 tests `|dot|`,
  sign-independent, so it works without orientation support.
- `api/curve-sketch/index.ts`: `circleArc` / `edge` switched to the L1 neutral path
  (`makeCircleArc` / `makeLineEdge`), `engines: ['occt','smlib']`.
- `smlib-kernel/smlibKernel.ts`:
  ① `makeCircleArc` takes its arguments as **radians** per the L1 contract (the old
  implementation took degrees; `0..2π` would be interpreted as an absurd span beyond 0..360°;
  the `engine-switch-smlib` kernel probes were rewritten to radian calls accordingly);
  ② `meshShape` short-circuits Curve / Edge handles to an empty mesh (otherwise
  `cad.circleArc`'s product makes `smw_tessellate` throw `not a live solid id` inside
  `solidToShape`).
- Docs: `docs/ops-api-inventory.md(.zh.md)` notes for `circleArc` / `edge` changed to
  "neutral ops"; `wireFromEdges`'s "at least 2 edges" became "at least 1 (relaxed 2026-11-14)".

### New known difference (unfixed, recorded)

`cad.circleArc([0,0,10],[0,1,0],10,0,90)` on occt goes from (0,0,0) to (10,0,10)
(`Geom_TrimmedCurve` reversed trimming), on smlib from (10,0,10) to (0,0,0). **Same arc
geometry, opposite direction**: single-edge spines (S8) give 251.33 on both, but when splicing
"arc + tangent straight leg" the leg must attach at each engine's own endpoint (`S9` therefore
has a `S9_SMLIB` copy; the occt side is not measured in that case — segments on occt are
covered by `sweep-along`'s true-arc cases). `spine-analysis` uses `curveParameters`
first→last to determine direction, which reads the tangent backwards for reversed-trimmed
edges — a pre-existing occt semantic detail; fixing it requires reading `shapeOrientation`
and is a separate change.

### Verification (round 2)

```
npx vitest run test/api/sweep-engines.test.ts test/api/sweep-along.test.ts \
  test/api/sweep-guard.test.ts test/api/sweep-revolve-guard.test.ts \
  test/api/sweep-loft.test.ts test/api/sweep-hollow-pipe.test.ts \
  test/api/sweep-kernel-behavior.test.ts        # 7 files / 139 cases
npx vitest run test/api/wire-from-edges.test.ts \
  test/brep/engine/engine-switch-smlib.test.ts \
  test/api/occt-s4-curve-sketch.test.ts test/api/occt-s4-curve-sketch-contract.test.ts   # 4 files / 50 cases
```
All green; `npx tsc --noEmit` has no errors related to this change (30 pre-existing errors all
in `test/probe-revolve-*` / `test/api/revolve-degenerate.test.ts` /
`test/smlib-kernel/circular-pattern-step.test.ts`);
`npx tsx scripts/check-api-test-coverage.ts --package=core` passes (L1 183 / L2 93, baseline
unchanged). Also fixed a **stale assertion** in `wire-from-edges.test.ts` (single edges have
been legal since 2026-11-14 and no longer report TOO_FEW).

### Aside: the "strategy-layer self-mitring" of spatial G0 corners is feasible, measured (P0j / P0k)

- **P0j (naive approach insufficient)**: per-segment sweep then plain `fuse` — planar 90°
  corner V=**304.000**, spatial 90° V=**305.373** (exact value 320). The missing 16 mm³ is
  exactly the overlap of the two segments at the corner (x∈[0,2], z∈[8,10], y∈[-2,2]) —
  `fuse` swallows the overlap and the outside gets no miter filler. **The volume is off by only
  5%, right on the C1 default tolerance boundary, so the guard cannot be relied on as a backstop**;
  and the shape (outer V-notch + inner sharp corner) is not what we want either.
- **P0k (self-mitring recipe works)**: over-extend each segment at the corner end by δ=2.5,
  then cut off the excess with the corner's **angle-bisector plane** (normal = sum of the two
  unit tangents), each keeping its own side, finally `fuse`: planar 90° V=**320.000**,
  faces=**8** (exactly the kernel's own miter face count); spatial 90° V=**319.988**,
  manifold=true, faces=**19** (the seam did not merge into a single plane — a margin to be
  squeezed later). Only `makeLineEdge` / `sweep` / `splitByPlane` / `fuse` are used — no
  kernel transitionMode needed.
- Both conclusions are now assertions (`P0j` pins 304/305.373; `P0k` pins 320/319.988 with
  8 planar faces).

## Round 3: spatial G0 corner mitring implemented in the strategy layer (smlib matches occt exactly)

The previous round's P0k only proved the recipe was feasible; this round wired it into
`api/sweep.ts`.

### Implementation

- `planMiterJoints(facts, radius)`: for each G0 corner computes the **angle-bisector plane
  normal** `n = t̂_prev + t̂_next` and the extension `delta = 1.05 × half-width × tan(θ/2)`
  (must be slightly larger than the `extent` the miter plane cuts on the segment axis, otherwise
  `splitByPlane` only "grazes" without really cutting). The extension is further clamped by
  `0.98 × min(adjacent segment lengths)`; when the extension would overshoot the next corner it
  throws `E_SPINE_MITER_SELF_INTERSECT` (corners that cannot be built do not silently produce slivers).
- `sweepWithBuiltJoints(...)`: per-segment sweep (straight segments extend along the same line;
  arcs/splines get a small tangent straight stub appended at the endpoint, error O(δ²/2R)) →
  each segment is cut by `splitByPlane` at the corner to keep only its own side (the probe
  point is the segment's parametric midpoint, always on its own side) → `fuse` merges in
  order. Section placement per segment reuses `sectionPlacementMatrix` (placed at the
  **extended start**); hole rings still go through `sweepRingsOnce`'s per-ring sweep + `cut`.
- Wiring: `strategy === 'miter' && engineId !== 'occt'` takes the self-mitring path; **planar**
  corners on smlib still use the kernel (cheaper, fewer faces, exact anyway). The smlib spatial
  corner `E_SWEEP_ENGINE_CAP` rejection in `assertEngineCan` is removed — no longer rejected,
  but built.

### Measured (`test/api/sweep-engines.test.ts`)

| Case | Result |
|---|---|
| S7 spatial corner (3 segments / 2 corners, length 30) | smlib **480.0000000** (16×30), identical to occt; previously `E_SWEEP_ENGINE_CAP` |
| S10 explicit `{strategy:'miter'}` | **480.0000000** (the override also self-miters, no kernel fallback) |
| S11 `strict` default (C2 end-face normals + C3 bbox) | passes — the self-mitered body's end-face normals and bbox criteria hold |
| S5 planar corner | still **320**, smlib uses the kernel miter (path unchanged) |
| P0i kernel single-pass sweep | still V=0 / non-manifold (pins the kernel boundary, as the contrast for "why self-mitring is required") |

### Known boundaries (recorded, not done)

- **Forced `strategy:'segments'` with a G0-cornered spine** still does "per-segment sweep +
  plain fuse" and leaves a V-notch (occt's `sweep-along.test.ts` R5 pins that wrong value at
  0.85–0.93). The self-mitring recipe is currently wired only to `miter`; making `segments`
  correct too is just wiring the same `sweepWithBuiltJoints` over (but `miter` and `segments`
  semantics would merge — a separate decision on whether to keep the word `segments`).
- Spines with corners on arc segments cannot reach this path: `mixed + corner` is rejected at
  the strategy layer with `E_SPINE_MIXED_CORNER`, so in practice only straight-line corners are
  effective; the arc extension logic is kept for a future release of mixed corners.
- The spatial corner's fuse seam does not fully merge into a single plane (P0k kernel-level
  faces=19); volume is exact and C2/C3 pass, but the face count exceeds occt's — a quality
  margin that can be squeezed later.

## Round 4: merging the per-segment executors — `segments` also handles G0 corners, `E_SPINE_MIXED_CORNER` removed

### Why merge

There were two nearly identical per-segment code paths: the `segments` branch (per-segment sweep
with plain fuse, only when fully G1) and `sweepWithBuiltJoints` (per-segment sweep, over-extension,
bisector-plane trim, fuse). The only difference was whether the seam is trimmed.

After merging there is one executor: **split the spine into segments → single sweep per segment
→ trim the seams per the corner plan (which may be empty) → fuse in order**. When there are no
G0 corners, `planMiterJoints` returns an empty plan ⇒ δ=0, no cuts ⇒ bitwise equivalent to the
old `segments`.

### Measured (behavior changes from the merge)

| Case | Before merge | After merge |
|---|---|---|
| Forced `segments` + 16-segment polyline (occt) | 0.8801 (V-notch pinned) | **0.9996**, **identical** to `miter` |
| Forced `segments` + 4-segment polyline (occt) | 0.8968 | **0.9936**, identical to `miter` |
| Mixed edges + G0 corner (arc tail bends 90° into a straight leg, occt) | `E_SPINE_MIXED_CORNER` | **411.33 × 1.0046** (+0.46%) |
| Mixed edges + G0 corner (smlib, planar / spatial) | `E_SPINE_MIXED_CORNER` | `E_SWEEP_ENGINE_CAP` (boolean limitation, see below) |

Conclusion: on pure straight polylines `segments` and `miter` are now **numerically identical**
(0.9936 / 0.9996); the only remaining difference is the implementation and cost of "kernel
one-pass sweep vs per-segment + seam trim".

### Code changes

- `api/sweep.ts`: deleted the `segments` branch; the condition merged into
  `strategy === 'segments' || (strategy === 'miter' && engineId !== 'occt')`;
  added the smlib-specific gate `smlib && facts.mixed && corners > 0` → `E_SWEEP_ENGINE_CAP`;
  the file-header capability table, `SweepOptions.strategy`, and `@throws`
  (`E_SPINE_MIXED_CORNER` marked deprecated) updated in sync.
- `api/internal/sweep-strategy.ts`: corner detection moved before mixed detection;
  `mixed + corners` changed from `E_SPINE_MIXED_CORNER` to `segments` (reason written into the
  reason string); file-header facts table updated.

### Why "mixed edges + corner" is still rejected on smlib

Measured (arc tail bending 90° into a straight leg, 4×4 section):
- After over-extending the arc segment, the **half returned by `splitByPlane` is empty**
  (V=0) — the planar version gets 160 (only the straight leg remains), and the spatial version's
  `fuse` fails outright with `smw_fuse: boolean failed`;
- The same geometry is fine on occt (1.0046), so this is not a strategy/geometry problem but a
  boundary of smlib booleans on "trimmed curved-surface sweep solids".
⇒ Explicit rejection with a clear reason; never produce a sliver like 160.

### Tests updated / promoted along the way

- `sweep-along.test.ts`: old R2 (mixed+corner rejection) → **S8** (now sweeps, measured +0.46%);
  old R5 (forced segments = 0.89 wrong value) → **S9** (0.9996); R5's slot replaced with the
  **new** hard boundary "corners too dense → `E_SPINE_MITER_SELF_INTERSECT`" (section radius 4,
  adjacent segments 1.414).
- `sweep-kernel-behavior.test.ts`: K6d changed from "segments 0.88–0.90 < miter 0.99+" to
  "both in the same range (poly4 0.9936 / poly16 0.9996, bitwise identical)".
- `sweep-engines.test.ts`: new S12a/S12b (smlib mixed+corner → `E_SWEEP_ENGINE_CAP`,
  including the `boolean failed` evidence string).

### Known leftovers (next round candidates)

1. **The +0.46% residual of arc extension**: currently "appends a small straight stub along the
   endpoint tangent" (O(δ²/2R)). The root fix is to extend the arc segment **along the same
   circle** (rebuild the extended arc via `makeCircleArc` using `facts.radius` + the endpoint
   tangent), which would bring occt's mixed+corner to 1.0000; it may also stop smlib's boolean
   from crashing.
2. Truly supporting mixed+corner on smlib requires bypassing the `splitByPlane`+`fuse` chain
   (e.g. continuing the arc before trimming, or `sectionByPlane` + manual capping) — a separate
   topic.

### Verification (round 4)

```
13 files / 209 cases all green
(sweep-engines 38 / sweep-along 15 / sweep-kernel-behavior 28 / spine-analysis /
 wire-from-edges 50 within batch / engine-switch-smlib / curve-sketch ×2 / multi-engine-op-parity)
npx tsc --noEmit → 30 pre-existing errors (all in revolve probes and circular-pattern-step), zero errors in changed files
npx tsx scripts/check-api-test-coverage.ts --package=core → passes (L1 183 / L2 93, baseline unchanged)
```

## Round 5: arc extension switched to "continue along the same circle", plus one wrong judgment corrected

### What was done

`packages/core/src/api/sweep.ts`:

- `fitArc`: reverse-solves an edge's geometry into a true circular arc — the three-point
  circumcircle (`circumcenter`, planar solution, only dividing by `sin∠BAC`) + 4 more samples
  along the parameter to verify circularity (relative tolerance `ARC_FIT_REL_TOL = 1e-6 × R`),
  then establishing the angle basis (`u` = start radial direction, `v = normal × u`, `a1` = end
  angle), requiring "the increasing-angle direction = the start tangent". **It does not look at
  `kind` / `curveType`**: smlib's `curveType` does not return `'circle'` for arcs (measured
  `kind === 'other'`), so field-based detection would miss every arc on smlib.
- `extendArcOnSameCircle`: continues the arc along the same circle by `dStart` / `dEnd` arc
  length (angle = arc length / R), built as a **three-point arc** `makeArcEdge(s, m, e)`, not
  `makeCircleArc(center, normal, radius, a0, a1)` — the latter's angle zero point is defined by
  each engine's own circle placement (smlib takes the world +X projection, occt has its own
  convention), which is a different basis from the "start radial direction" used here; the
  three-point arc is independent of the zero point.
- `sweepWithBuiltJoints`: arc segments prefer same-circle continuation (single edge), with
  `startPoint` / `startTangent` fed to `sectionPlacementMatrix` from the extended new pose;
  splines/ellipses cannot be continued and still fall back to the "tangent straight stub".

### One wrong judgment from the previous round, corrected

The previous round attributed smlib's "mixed edges + G0 corner" failure to "smlib booleans
failing on trimmed curved-surface sweep solids". **Wrong**. The new probe P0l
(`test/api/sweep-engines.test.ts`) splits the same geometry into two wires:

| wire | arc parametric direction | wireLength | sweep volume | own half after miter trim |
|---|---|---|---|---|
| forward | 0°→90°, straight leg continues from the 90° end | 17.808 | 284.927 | 251.719 |
| reversed | 90°→0°, straight leg still continues from the 90° end | 17.808 | **0.000** | **0.000** |

The root cause is that **the wire's edges are not head-to-tail connected**: smlib's `makeWire`
does not check this, `sweep` does not complain, and hands back an empty body; and once
`sweep-guard`'s `getLength/getVolume` throws, it `return`s — so the empty body slips through
silently and only fails later in `fuse` / volume reconciliation under someone else's name.
`cad.circleArc`'s arcs on smlib have parametric direction opposite to geometric direction (the
known difference), and appending a tangent straight leg after one ⇒ splices exactly the
`reversed` kind of wire.

### The general guard added along the way

`E_SWEEP_EMPTY_PIECE`: after each segment's sweep the volume is read immediately; `<= 0` or
unreadable throws, with a message pointing out "the wire's edges are not head-to-tail
connected". This one is engine-independent and turns "silent empty body" into immediate failure.
**Note it has no test coverage today**: the reachable path (smlib + non-circular-arc curved
segment) cannot be built from the public API (smlib's only curve constructor `cad.circleArc`
is always a true circle), so it is a door left for future spline spines; the underlying
behavior is pinned by P0l.

### Measured (round 5)

| Case | Before round 5 | After round 5 |
|---|---|---|
| occt mixed edges + G0 (R6 circular section, `sweep-along` S8) | ×1.00462 (tangent stub) | ×**1.00441** (same-circle continuation) |
| smlib mixed edges + planar G0 (`sweep-engines` S12a) | `E_SWEEP_ENGINE_CAP` | **411.98** (×1.0016) |
| smlib mixed edges + spatial G0 (S12b) | `E_SWEEP_ENGINE_CAP` | **411.30** (×0.9999) |

**That +0.44% is not extension error**: the mitred volume of mixed curvature is simply not
"area × path length" (Pappus is exact only when both sides are straight pipes). The same
geometry (R6 pipe / R10 arc / 90°) was cross-checked against three accounts by numerical
integration:

| Account | Arc-segment volume |
|---|---|
| Arc pipe ending at the corner (no extension) | 1645.988 |
| Arc pipe continued to +36.1° (δ = 1.05 × extent) | 1789.428 (= this implementation, measured 1789.352) |
| Arc pipe continued to +180° | 3620.583 |

⇒ The rule "keep your own side" itself leaves a small stretch of curved pipe beyond the corner
on your side; the amount depends on the extension length, so the **minimum cuttable length**
must be used (`1.05 × extent` — give more and the miter plane cuts it off, give less and no
miter can be cut). The residual growing with extension is an inherent property of this rule,
not an implementation defect.

### Verification (round 5)

```
13 files / 210 cases all green (new P0l)
npx tsc --noEmit → 30 pre-existing errors (revolve probes / circular-pattern-step), zero errors in changed files
npx tsx scripts/check-api-test-coverage.ts --package=core → passes (L1 183 / L2 93, baseline unchanged)
```

## Alternatives considered

- **Keep the four symbols and add compatibility aliases for the removed ones** — rejected:
  the user explicitly ruled out compatibility ("no compatibility needed"), the names encode
  kernel differences rather than intent, and no script in the repo used `pipe`, so aliases
  would only preserve confusion.
- **Merge everything into a single `sweep` (no `sweepRaw` escape hatch)** — rejected: occt's
  full control set (law / auxSpine / support / withContact…) has no strategy-level equivalent,
  and the strategy layer is intentionally scoped to intent-level strategies; hiding the kernel
  controls behind `sweep` would entangle the two layers.
- **Rely on the kernel's own miter for spatial G0 corners on smlib** — rejected by measurement:
  the kernel emits degenerate slivers (P0i: V=0, non-manifold), hence the strategy-layer
  self-mitring recipe (`planMiterJoints` + `sweepWithBuiltJoints`).

## Consequences

- The public surface is `cad.sweep` + `cad.sweepRaw`; `cad.pipe` and `cad.sweepAlong` are gone
  with no aliases. Existing scripts using the removed symbols break by design.
- `STRATEGIES_BY_ENGINE` is the single authority on per-engine capability; smlib now supports
  `single`/`miter`/`segments`/`closed` (spatial G0 corners self-mitered, planar corners via the
  kernel) and C2 end-face normal checks; brepkit keeps its measured caps.
- On pure straight polylines `segments` and `miter` are numerically identical; mixed-edge
  spines with corners now sweep with a ~+0.46% volume residual (arc extended along the same
  circle), except on smlib where mixed+corner is explicitly rejected (boolean limitation).
- New guards: `E_SWEEP_EMPTY_PIECE` (silent empty sweep bodies become immediate failures) and
  `E_SPINE_MITER_SELF_INTERSECT` (unbuildable corners fail loudly).
- Known leftovers: `docs/ops-api-inventory.md(.zh.md)` needs a full regeneration once
  `validateSolid` gets a chapter; `E_SWEEP_EMPTY_PIECE` has no op-level test coverage today
  (pinned at kernel level by P0l).
