# Agent Note: sweep mesh winding is a mesh-output contract, not a kernel detail

Status: implemented

English | [中文](2026-10-21-sweep-mesh-winding-consistency.zh.md)

## Problem

A weapp sweep displayed as a **broken shell**: a large wedge-shaped hole ran through the
surface, so the body read as "patches", not a solid. Exporting the same body to STL
looked correct — which is what made the report look like a renderer defect.

Both observations come from one fact. The mesh `cad.sweep` returned had triangles that
traverse a shared edge in the **same** direction (non-manifold winding). The renderer
draws with `FrontSide`, so a triangle whose winding is inverted is culled and the surface
opens up; STL viewers usually render double-sided, so the same triangles look solid there.

Device geometry (verbatim from the report):

```js
let sk0 = cad.sketch({ shapes:[{kind:'rect', cx:-0.5, cy:-0.5, w:29, d:27}], constraints:[], plane:'XY' })
let w0 = cad.sketchOnPlane({ contours:[{segments:[
  {kind:'line', x1:0, y1:0, x2:12, y2:-11},
  {kind:'line', x1:12, y1:-11, x2:17, y2:-35}]}],
  plane:{origin:[-0.5,-0.5,0], normal:[-1,0,0], xAxis:[0,0,1]}, as:'wire' })
let part0 = cad.sweep(sk0, w0)
```

Measured on that mesh (28 vertices / 52 triangles): **8 edges whose two triangles traverse
them the same way**, and 21 % of the surface area involved.

Single-factor measurement isolated the trigger:

| profile | path | winding conflicts |
|---|---|---|
| 29×27 | two-segment polyline (bend 35.7°) | **8** |
| 8×8 | same polyline | 0 |
| 29×27 | single straight segment | 0 |
| 14×14 | same polyline | 0 |

The body must be **large profile AND bent path** at once. Profile half-width across the
bend (13.5 mm) times `cot(bend/2)` is ≈ 41 mm, against a first segment of 16.3 mm — the
profile sweeps over itself on the inside of the bend, the side-wall boundary curve
self-intersects, and the kernel's fan triangulation splits that concave/self-intersecting
polygon into crossing triangles.

So the **geometry is self-intersecting** (a separate, upstream product question). But the
mesh still has to be *renderable*: winding consistency is a property of the mesh, and the
repository already owns the algorithm — `mesh/reconcile.ts`'s `unifyOrientation` — which
`cad.sweep` simply never called. Treating that as "the kernel's business" is what left the
one consumer that draws single-sided with a hole.

## Decision

`sweepBrep` now passes its BREP-derived mesh through **`weldVertices` + `unifyOrientation`**
before returning (`packages/core/src/api/sweep.ts`).

Three details are load-bearing:

1. **Repay in place, never `{...s}`.** BREP handles live in runtime slots keyed by the
   shape *object reference* (`shape.ts:480 brepOf`). Spreading the shape produces a new
   object whose `brepOf` is `undefined`, and the next `getBoundingBox` / `getVolume`
   crashes. (This was observed immediately: 3 existing sweep tests went red with
   `getBoundingBox` failures before the fix was corrected.)
2. **No degenerate-triangle removal.** `weldVertices` and `unifyOrientation` preserve both
   triangle count and triangle order, so `materialGroups`' `(start, count)` stays valid.
   Running the full `reconcileMesh` would also drop zero-area triangles and silently
   reindex faces.
3. **No manifold assertion.** This is display-mesh hygiene, not solid validation. A
   self-intersecting body cannot be repaired into a valid solid here — deciding whether to
   accept it belongs upstream — but the mesh must render correctly single-sided.

## Alternatives considered

- **Draw with `DoubleSide` in the viewer.** Masks the symptom at every consumer (lighting
  and shadow normals stay wrong) and leaves `cad.sweep` emitting meshes that violate the
  contract. Rejected: the defect is in the data, not in the material.
- **Patch the mesh in the weapp viewer.** This is genuinely kernel-agnostic and would work,
  but it re-implements `unifyOrientation` in a consumer, leaves every other caller of
  `cad.sweep` broken, and puts a correctness guarantee in the layer that merely displays.
- **Run the full `reconcileMesh` (weld → degenerate removal → unify → assert).** The
  degenerate-removal step renumbers triangles and invalidates `materialGroups`; the
  manifold assertion would turn a self-intersecting-but-displayable body into a hard op
  failure. Rejected for a display-path fix.
- **Fix it in brepkit's sweep.** For a self-intersecting sweep there is no globally
  consistent orientation to emit; a kernel cannot promise one. The kernel can only report
  or refuse, and it is a different repository with a much slower feedback loop.
- **Reject the input instead (a sweepability check: profile envelope vs segment length and
  bend angle).** Orthogonal and still worth doing — it prevents silently producing a
  self-intersecting solid at all. It does not replace this fix: a mesh must render
  correctly whether or not the body is valid.

## Consequences

- `cad.sweep` output is now winding-consistent by contract, pinned by
  `test/api/sweep-mesh-winding.test.ts` (device geometry: conflicts must be 0; an 8×8
  control case guards the assertion itself against false positives).
- Verified end-to-end: the same mesh rendered with the viewer's own parameters
  (`FrontSide`, 60° crease) went from an open hole to solid; the weapp probe reports
  winding conflicts 0 after rebuilding the worker bundle.
- **A self-intersecting body still is a self-intersecting body.** Volume, booleans, and
  STEP export on this shape remain unreliable; the fix makes it drawable, not valid.
  Screenshots now show a solid, which is exactly why the upstream check matters — without
  it, an invalid body looks acceptable.
- No change to `cad.loft`, `cad.revolve`, or `cad.extrude`. They may have the same class of
  defect on pathological input; the same two calls apply, but each needs its own evidence
  before being touched.
