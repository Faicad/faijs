# Agent Note: Circular-arc angle datum unified (one arc across both engines for `cad.circleArc`) + `cad.tangentArc` opened to smlib

Status: implemented

2026-11-17. Follows `2026-11-16-sweep-api-consolidation.zh.md` (public surface consolidated to
`sweep` + `sweepRaw`).

English | [中文](2026-11-17-arc-angle-datum.zh.md)

## Problem

1. **Each engine had its own angle zero point.** `cad.circleArc(center, normal, r, a0, a1)`
   produced **different arcs** on occt and smlib for the same arguments, possibly with opposite
   parametric direction. User-reproducible symptom: using
   `cad.wireFromEdges([cad.circleArc(...), cad.edge([0,0,0],[-10,0,0])])` as the spine for
   `cad.sweep` — one engine sweeps a solid bent pipe of 16 × 25.708, the other sweeps 0 (the arc
   and the leg simply do not join).
2. **`cad.tangentArc` was occt-only.** It binds directly to occt's native `GC_MakeArcOfCircle`;
   smlib has no corresponding primitive, hence `engines: ['occt']`. But "passing through the
   start point, leaving along a given tangent, ending at the endpoint" is a mathematically unique
   circle — this should not be a platform-capability issue.

## Key findings (from code reading / measurement)

- `smlibKernel.ts:1231 shapeOrientation` directly `return unsupported(...)` ⇒ the earlier idea
  of "root-fix direction by reading shapeOrientation" does not hold, and is not necessary.
- `smlibKernel.ts:135 circlePlacementMatrix` already uses a canonical frame:
  `ref = |n.x| < 0.999 ? +X : +Y`, `u = normalize(ref's projection into the circle plane)`,
  `v = n × u`. **That frame is a ready-made contract** — lift it to L1; the smlib side keeps
  zero behavior change, and only occt gets corrected.
- Measured, occt's angle mapping can be written as `θ(α) = δ + σ·α` (σ = +1 pure rotation,
  σ = −1 reflection): for n = +X, δ = +90°, σ = +1; for n = +Y, σ = −1 (two forms of the same
  logic). ⇒ No need to guess engine internals — **measure both ends to solve for δ/σ**, then
  rebuild from the inverted parameters.

## Decision

Approved by the user 2026-11-17 ("OK, start implementing").

### 1. The angle datum becomes the single L1 contract

```
n̂ = unit(normal)
ref = |n̂.x| < 0.999 ? (1,0,0) : (0,1,0)     // fall back to +Y when the normal nearly aligns with +X
u  = unit(ref − (ref·n̂) n̂)                   // world +X projected into the circle plane
v  = n̂ × u
P(θ) = center + radius (cosθ·u + sinθ·v)      // θ in radians
```

Semantics: **0° = the projection of world +X into the circle plane, counterclockwise around the
normal is positive**; the parametric start always equals the `a0` point, and the direction
matches the arguments (the span's sign decides the direction).

### 2. Inside the op: "build → measure → invert → rebuild → verify both ends"

`neutralCircleArc` in `api/curve-sketch/index.ts`:

1. First build a trial per the contract (`makeCircleArc`, keeping the analytic primitive's
   precision; `curveType` stays canonical);
2. Measure the trial's two ends with `curveParameters` + `curvePointAtParam` and compare
   pointwise against the contract points (both ends);
3. Measure `θ(first)` / `θ(last)`, choosing among `[raw, raw ± 2π]` the branch of the same
   magnitude as the requested span;
4. `σ = sign(θl − θf) === sign(span) ? +1 : −1`, `δ = θf − σ·a0`;
5. Rebuild with `build(σ(a0 − δ), σ(a1 − δ))`, then verify both ends again;
6. On success `release(trial)` and return the rebuild; on failure `release(rebuilt)` and throw
   `E_CIRCLEARC_DATUM` (with the measured δ/σ).

**Boundaries**: a closed circle with `|a1 − a0| = 360°` is not corrected (the geometry has only
one interpretation; the seam position is engine-specific); `> 360°` is rejected outright (a
trimmed-circle edge cannot express multiple turns), with `E_CIRCLEARC_SPAN`. Tolerance
`tol = max(1e-9, 1e-7·radius)`.

**Why not replace with three-point arcs**: for small spans the three points are nearly
collinear and the circumcenter inversion is ill-conditioned; analytic primitives are more
accurate on small arcs. **Why not abandon the analytic primitive**: `curveType` must report a
canonical arc (not bspline).

### 3. `tangentArc` switched to neutral geometry, `engines` extended to `['occt','smlib']`

The circle is unique: the center lies on the line through the start point perpendicular to the
tangent, and must be equidistant from both ends ⇒

```
ĥ = unit(component of the chord along the direction in ⟂t̂)     x = |d|² / (2 |d⊥|)
c = start + x·ĥ
axis = unit(cross(start − c, t̂))
rVec = start − c,  eVec = end − c
φ = atan2(dot(cross(rVec,eVec), axis)/r², dot(rVec,eVec)/r²),  φ ≤ 0 → φ + 2π
mid = c + rotateAbout3(rVec, axis, φ/2)
```

The directed angle φ ∈ (0, 2π) automatically covers the long arc (no longer the implicit
"take the short arc" assumption). Then the L1 `makeArcEdge` three-point arc lands on the
engine; if the three-point arc fails to start at `start` in either direction,
`E_TANGENTARC_ORIENTATION`.

Error codes: `E_TANGENTARC_DEGENERATE` (zero tangent / start = end),
`E_TANGENTARC_COLLINEAR` (tangent parallel to the chord ⇒ the circle degenerates to a line),
`E_TANGENTARC_ORIENTATION`.

## Measured geometry (canonical frame; usable directly as test rulers)

| Arguments | Start → End | End tangents |
|---|---|---|
| axis +X, c=(0,-10,0), r=10, 0→90 | (0,0,0) → (0,-10,10) | start +Z, end −Y |
| axis +Y, c=(0,0,10), r=10, 0→90 | (10,0,10) → (0,0,0) | start +X, end −Z |
| axis −Y, r=R, 0→90 | (R,0,0) → (0,0,R) | start +Z |
| axis −Y, r=R, 180→360 | (−R,0,0) → (R,0,0) | both ends ∓Z (U-shaped bottom bend) |
| closed 0→360 | unchanged | — |

## Change list

- `packages/core/src/api/curve-sketch/index.ts`: added
  `dot3/cross3/unit3/asTriple/asBrep/dist3/curveEndsOf/circleFrame/framePoint/rotateAbout3/neutralCircleArc/tangentArcMidPoint`;
  `circleArcBrep` just calls `neutralCircleArc`; `tangentArcBrep` goes through `makeArcEdge`
  with endpoint-direction fallback; `tangentArc.engines = ['occt','smlib']`; both ops' JSDoc
  `@note` rewritten (unique datum, engine-specific closed seam, span cap, error codes).
- `packages/core/test/api/curve-arc-engines.test.ts` (new, 28 cases): 6 `ARC_CASES` groups
  (n=+Z 0..90 / n=+Y 0..90 / n=+Y 0..30 / n=+Y −90..90 / n=+X 0..90 / n=(1,1,1) 20..200)
  × 2 engines asserting "parametric start = the a0 point, end = the a1 point" + arc length =
  r×span + cross-engine pointwise comparison + closed arc length + `E_CIRCLEARC_SPAN` + the
  user symptom regression (both engines' volumes = 16×25.708, not 0) + tangentArc geometry
  (half circle 5π, quarter 5π/2, start tangent = the given tangent) + the two error codes +
  smlib as a sweep spine. Expected values are **independently recomputed** from the canonical
  frame in the test — the op's implementation is not reused (a second ruler).
- Existing suites had their geometry fixed to the new datum (each case's original intent
  unchanged: G1 stays G1, G0 stays G0, breakage stays breakage): `spine-analysis` (ARC
  endpoints, ARC_PLUS_LEG, ARC_BROKEN legs), `sweep-along` (S4/S8 legs, R1/R3 broken legs),
  `sweep-hollow-pipe` (`U_SPINE` bottom bend 180→360, G0e rewritten as a contract case, F2b
  back to 0→90), `sweep-kernel-behavior` (K1c/K9 spine legs now continue along −Y, K1c bbox
  assertion moved to the y axis), `smlib-p2-ops` (`makeCircleArc` takes radians, not degrees).

## Evidence

- Related suites 134/134 pass (`curve-arc-engines` 28, `spine-analysis` 25, `sweep-along` 25,
  `sweep-hollow-pipe` 21, `sweep-kernel-behavior` 28, `smlib-p2-ops` 32);
  6 more suites referencing circular arcs pass 107/107 (`occt-s4-curve-sketch`(-contract),
  `wire-from-edges`, `sweep-engines`, `dxf-import`, `engine-switch-smlib`) — i.e. common sketch
  planes with +Z normals are completely unchanged.
- Rotation invariance: `sweep-along` S8's mixed+G0 mitred volume ratio = `1.0044100166799876`,
  bitwise identical to the old geometry (measured value unchanged after rotating the whole
  geometry 90° around the arc normal ⇒ the datum change did not alter mitring behavior).
- `npx tsc --noEmit`: 30 pre-existing errors; zero new errors in `curve-sketch` or this
  round's changes.
- `npx tsx scripts/check-api-test-coverage.ts --package=core`: gate passes
  (L1 1024 exports / 183 known gaps, L2 154 / 93, baseline unchanged).

## Gotchas (useful next round)

- Observing a `kind:'curve'` product via `result.outputs` explodes on smlib with
  `[smlib-kernel] getSubShapes(face): not implemented in P1` (`buildTopologyFromMesh →
  buildSelectorManifestCore`) — **unrelated to the arc itself**: the runtime topology collection
  stage does not support smlib curve products. Workaround: call the op directly
  (`import { circleArc } from 'src/api/curve-sketch'`) then `brepOf(shape)`.
- Before calling an op directly you must
  `configureBackends({ contractVersion, config:{mode:'auto', brepEngineId}, kernel:{ brep: brep.primitives, ... } })`;
  ops return **Promises** and must be `await`ed — otherwise `brepOf` receives a Promise and
  errors escape the try/catch.
- Corner legs must point **outward along the radius**: at one point the leg was flipped toward
  the center, the two sweep solids overlapped, and the union volume dropped 6.8% (2709 vs 2907),
  caught by the 5% default tolerance. S4/S8 are now "tangent continuation" and "90° corner
  outward along +Z" respectively.
- Under the new geometry the arc starts exactly at the origin and the section (XY plane)
  coincides with the spine start ⇒ `sweepRaw`'s default path auto-rights itself; the
  "unplaced section loses volume" evidence now requires shifting the whole spine +10 along +Z
  (K1c was changed accordingly).

## P0 probe results: the ellipse family (rational quadratic NURBS) feasibility

`packages/core/test/smlib-kernel/smlib-p0-rational-ellipse.test.ts` (16 cases, all green, 1.5s).
Construction: an arc of a circle (half-angle 45°) as a degree-2 rational Bézier with weights
`(1, cos45°, 1)`; an ellipse as the affine image of a circle (weights are invariant under
affine transforms); spans > 90° are split into ≤90° segments at degree 2 ⇒ interior seam
multiplicity 2. The criteria use **hand-computed rational Bézier formulas on the test side**
(`B(t) = [(1−t)²P₀ + 2t(1−t)wP₁ + t²P₂] / [(1−t)² + 2t(1−t)w + t²]`) and Simpson numerical
integration as independent rulers.

| Item | Measured | Conclusion |
|---|---|---|
| A Is rational evaluation real (smlib) | 7 sample points match hand calculation to 1e-9; `|P(0.5)| = 1`; circle 90° arc length = π/2 (1e-6); control arc with weights set to 1 gives length 1.623225 (true circle 1.570796) | ✅ the kernel **really evaluates rationally** (not dropping weights into a parabola) |
| B Is the ellipse exact (smlib) | `(x/a)² + (y/b)² = 1` holds at 7 points to 1e-9; quarter-ellipse arc length 12.110560123 vs analytic 12.110560276 (rel. 1.3e-9) | ✅ exact |
| B `curveType` | smlib: rational-circle = `bspline`, rational-ellipse = `bspline`; occt: rational = `bspline`, native `makeEllipseArc` = `ellipse` | ⚠️ **semantic downgrade confirmed, symmetric across both engines** (both report bspline) |
| B Parametric domain | single segment `[0,1]`; two spliced segments `[0,2]` | angle ↔ parameter is not one-to-one; a mapping table is needed |
| C Two segments spliced to 180° | domain [0,2], seam point (0,5), half-ellipse arc length 24.221120625 vs analytic 24.221120551 (rel. 3e-9) | ✅ multi-segment splicing works |
| C As a sweep spine (smlib) | r=1 circular section, volume ratio = **1.000001233** (analytic 38.046447 / measured 38.046494) | ✅ usable, precision better than expected (1e-6 level) |
| C As a boolean operand (smlib) | `cut(box27000, tube)` → 26980.978, removing 19.022 | ✅ usable |
| C Side-face surface types (smlib) | 3 faces: `{bspline: 1, plane: 2}` | ⚠️ the side faces really are NURBS faces (the original judgment holds) |
| O3 occt length integration | rational vs native relative deviation **4.647e-6** (point geometry still 1e-9 level, see O1) | ⚠️ downstream "area × length" criteria need relaxing to 1e-4 level, or cross-checking against native ellipse arc lengths |

**Two extra facts**:

1. The L1 primitive surface (`brep/engine/primitives.ts`) **has no ellipse at all** —
   `makeEllipseEdge` / `makeEllipseArc` are raw `OcctKernel` methods that ops call via
   `getOcctKernel()`, bypassing the L1 contract. So the ellipse family is not "an adapter
   missing a mapping" but **a capability missing at the contract layer**; still, no new L1
   method is needed — the existing `makeBSplineEdge` suffices, implemented on both engines.
2. smlib's `makeBSplineEdge` adapter already passes weights through
   (`w = weights.some(x => x !== 1) ? weights : undefined` →
   `k.makeCanonicalCurve(..., w, degree, 6)`).

**Landing judgment (superseded by the next section, kept as process record)**: plan A (unify
both engines on rational quadratic + L1-side geometric recognition to restore semantics) is
technically feasible with sufficient geometric precision; the only real costs are the
`curveType` downgrade (symmetric across engines) and occt's 5e-6 length integration. The
semantic restoration approach follows the same idea as this round's `circleArc`: L1 samples and
inverts the geometry itself (center / axes / start-end angles), turning `kind:'arc'` from "the
type the engine reports" into "geometry L1 recognizes".

> ⚠️ The "L1-side geometric recognition to restore semantics" above was rejected in review:
> sampling to guess the kernel type and then overwriting `curveType` amounts to **faking kernel
> facts** (unlike "correcting construction by measurement"), and would touch the
> no-cross-layer-assertion-lies red line of `occt-primitives.ts`. The final decision is in
> "Decision: plan A / step 1" below.

# Decision: plan A / step 1 — "geometry usable, semantics as-reported"

The user-set boundary: **do not overwrite `curveType`, do not downgrade occt, do not touch
existing volume/length criterion tolerances, do not build a sampling recognition layer**;
cross-engine comparison **compares sampled geometry, not type labels**.

## What was implemented (all landed and green)

| Location | Change |
|---|---|
| `src/brep/engine/primitives.ts` | L1 contract surface **gains** `makeEllipseEdge` / `makeEllipseArc` (radians; canonical frame documented in JSDoc, including both engines' semantic differences and "direction read via `shapeOrientation`") |
| `src/occt-kernel/occt-primitives.ts` | native `gp_Elips` direct connection + `ellipseArcOcct` axis-basis alignment: probe the kernel's XDirection → solve for the rotation angle ρ → build the arc then rotate it back by ρ around `(center, n̂)` (rigid motion, **still reports `ellipse`**); verify both ends + the parametric midpoint; `reverseShape` when direction is opposite |
| `src/smlib-kernel/smlibKernel.ts` | `rationalEllipseNodes` exact rational quadratic (segment count `ceil(|span|/90°)`, weights `cos(Δ/2)`, interior seam multiplicity 2) + `circlePlacementMatrix` landing on the plane; negative spans are CW via reversed pole ordering |
| `src/brepkit-kernel/brepkitKernel.ts` | both methods `fail('...brepkit has no analytic ellipse (engine retired)')` (the engine is fixed for retirement; op declarations exclude brepkit, so normal paths never pass through) |
| `src/brep/engine/adapters/brep-mock.ts` | minimal stubs for both methods (tag carries a/b), keeping guard tests usable |
| `src/api/curve-sketch/index.ts` | both ops drop `getOcctKernel()` and go through `getBrepApi()`; `engines: ['occt','smlib']`; new `E_ELLIPSEARC_ZERO_SPAN` / `E_ELLIPSEARC_SPAN` |
| `test/api/curve-ellipse-engines.test.ts` | new, 32 cases: endpoints/samples on the ellipse, arc length against analytic integration, CW, tilted normals, `a=b` degenerate circle, cross-engine comparison, `curveType` guardrails (occt=`ellipse` / smlib=`bspline`, still `ellipse` after tilted-normal rotation), error codes |
| `test/topology/naming/{mesh-primitive,resolve,roles,score}.test.ts` | fake kernels got minimal stubs per the repo's existing discipline (**not** changed to `as BrepEngineApi`, preserving contextual types) |
| `docs/ops-api-inventory.{md,zh.md}` | sections 3.10 / 3.11 `@note` changed from "platform ops, occt only" to neutral ops + semantic differences + measured length deltas |

## New measurements this round (datum probes D/E, 21/21 green → the same-named `smlib-p0-rational-ellipse.test.ts` in this file)

| Fact | Value |
|---|---|
| occt `makeEllipseEdge` (n=+Z, a=10,b=5) | params `[0, 2π]`, closed, 0/90/180/270° = (10,0)/(0,5)/(−10,0)/(0,−5) ⇒ **naturally consistent with the canonical frame**; but **the closed-curve `curveLength` is coarse: 48.505863 vs analytic 48.442241 (1.3e-3)** |
| occt `makeEllipseArc` 0→90° | params `[0, π/2]`, endpoints exact, length 12.110560 = analytic ⇒ the parameter is the angle |
| occt negative end angle `0→−90°` | normalized to `[0, 4.7124]` (+270°) ⇒ **negative angles cannot express CW** |
| occt tilted normal `n=+X` / `+Y` | the 0° point falls on `+Z` in both ⇒ the kernel's XDirection is rotated as a whole relative to the contract frame's `u` (measured ρ is arbitrary), and `gp_Elips` requires `a>=b` ⇒ **cannot swap radii**; only rotation alignment works |
| smlib closed rational ellipse (4×90°) | closed, params `[0,4]`, length **48.442242** (≈ analytic 48.442241) ⇒ more accurate than occt's closed query |
| smlib reversed arc (90°→0, CW) | first (0,5) / last (10,0) / mid (7.071,3.536), `(x/a)²+(y/b)²−1 = 2.22e-16`, length 12.110560 ⇒ **reversed pole ordering is CW** |

## Gotchas

- When `Edit`'s `old_string` ends with a newline and `new_string` does not, it glues "comment
  line + next code line" into one line: hit twice this round (`// …describe(` and
  `…,    // helix`), the first time failing outright with `[PARSE_ERROR] Unexpected token`.
  When replacing comment lines, **explicitly preserve the newline**.
- Verifying only the two endpoints is not enough: a CW arc of span 135° and its CCW
  complement of 225° coincide exactly at both endpoints ⇒ the **parametric midpoint** must also
  be verified, otherwise a long arc slips through (that is exactly how the occt CW case was
  caught this round).
- `shapeOrientation` on smlib is still `unsupported` ⇒ helpers reading direction must tolerate
  failure (smlib's CW is a genuinely reversed parametrization; solving by parameter order is
  correct anyway).

## Not done / follow-ups

- occt's closed-ellipse length query is off by 1.3e-3: per the "no downgrade" principle the
  occt construction is **not** changed; instead docs/tests declare that length tolerance follows
  the engine. Downstream criteria using "area × length" should assume 1e-3-level tolerance for
  the ellipse family.
- `docs/api-contract.zh.md` §7.11 still treats brepkit as a peer engine, and its L1/L2 wording
  differs from `scripts/check-api-test-coverage.ts` — the terminology conflict is not yet fixed
  (the user has pointed out that this terminology is stale).
- smlib-side gaps unchanged: `shapeOrientation`, `getSubShapes(face)`, `curveSplit` remain
  unimplemented in P1.

## Alternatives considered

- **Replace the analytic arc primitive with three-point arcs** — rejected: for small spans the
  three points are nearly collinear and the circumcenter inversion is ill-conditioned;
  analytic primitives are more accurate on small arcs, and `curveType` must report a canonical
  arc (not bspline).
- **Read the direction via `shapeOrientation` to fix the arc orientation** — rejected: smlib's
  `shapeOrientation` is unimplemented (`unsupported`), so it cannot serve as the cross-engine
  basis; the measured-δ/σ inversion works on both engines without it.
- **L1-side sampling recognition to restore ellipse semantics (overwrite `curveType`)** —
  rejected in review: sampling to guess the kernel type and then overwriting `curveType`
  amounts to faking kernel facts (unlike "correcting construction by measurement"), touching
  the no-cross-layer-assertion-lies red line of `occt-primitives.ts`; the user set the
  boundary to "geometry usable, semantics as-reported".

## Consequences

- `cad.circleArc` produces the same arc on occt and smlib under the canonical frame
  (0° = projection of world +X into the circle plane, counterclockwise positive); both engines
  agree pointwise, and the user symptom (sweep 0 vs 16×25.708) is fixed on both.
- Closed circles (span = 360°) keep engine-specific seam positions; spans > 360° are rejected
  with `E_CIRCLEARC_SPAN`; datum failures throw `E_CIRCLEARC_DATUM` with measured δ/σ.
- `cad.tangentArc` is now a neutral op (`engines: ['occt','smlib']`) with directed-angle long-arc
  support and the three `E_TANGENTARC_*` error codes.
- The ellipse family landed as L1 `makeEllipseEdge` / `makeEllipseArc` with "geometry usable,
  semantics as-reported": occt reports `ellipse`, smlib's rational construction reports
  `bspline`; cross-engine criteria must compare sampled geometry, not type labels, and the
  ellipse family's length tolerance is 1e-3-level (occt closed-ellipse query is coarse).
- All existing suites that reference circular arcs were re-based onto the new datum; rotation
  invariance was verified (S8 mitred volume ratio bitwise unchanged after a 90° rotation).
