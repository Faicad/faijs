# CadQuery free-function solid + solidWithInner (B2-2)

**Date**: 2026-10-04
**Batch**: B2-2 (G-C8 partial)
**Status**: Implemented, 12/12 parity PASS

## Context

CadQuery's `Workplane.solid()` and `Workplane.solid(inner=...)` build a solid from a collection of faces, handling internal voids (cavities). The upstream `test_solid` has 12 exported variables; 8 were blocked by `solid` and 4 by `op:solid-voids`.

## Decision

Implemented two free functions in `workplane.ts`:

1. **`solid(...inputs)`** — sew all faces from inputs. Single shell → `makeSolid` directly. Multiple shells (outer + inner voids) → find largest-volume shell as outer, boolean cut the rest.
2. **`solidWithInner(outer, inner[])`** — explicit outer faces + inner void faces. Outer: sew + makeSolid. Each inner: prefer `wp.baseShape` (the original solid before face selection) to get a solid handle directly, bypassing the sew-Face issue. Fallback: sew inner faces + makeSolid.

### Key: boolean cut, not buildSolidFromFaces

`buildSolidFromFaces` / `sewAndSolidify` treat inner faces as outer faces and **add** void volumes instead of subtracting. Boolean cut (outer − inner₁ − inner₂) is correct: it preserves all faces (outer + inner with reversed orientation as void boundaries).

### Key: wp.baseShape vs wp.shape

`Workplane.clone()` sets `out.shape = out.objects[0]`, so after `cq.faces(sph, '')` the `.shape` becomes the first face, not the original solid. `.baseShape` preserves the original shape from before face selection. This matters for `solidWithInner` where inner inputs are face-selected workplanes — we need the original solid handle for boolean cut, not a re-sewn face.

## Discoveries (GOTCHA)

1. **CadQuery `sphere(d)` — d is DIAMETER, not radius.** `sphere(0.1)` → radius 0.05. faijs `cq.sphere(wp, radius)` takes radius directly, so mirrors use `cq.sphere(wp, 0.05)`.
2. **CadQuery `.moved(shape)` moves to shape's CENTER, not its Location.** `toLocs()` for Solid returns `Location(self.Center())`. `box(10,10,1)` center is (0,0,0.5), so `sphere(0.1).moved(b_large)` places sphere at (0,0,0.5).
3. **`kernel.sew([sphereFace], 1e-6)` returns a Face, not a Shell.** `makeSolid` cannot wrap a Face. Fix: use `wp.baseShape` to get the original solid handle directly, bypassing sew entirely for inner inputs that originate from a solid.

## Parity

All 12 variables PASS (volΔ=0, comΔ=0, topo full match):
- b/b_large/b_small/b1/s1/s2: f6/e12/v8
- sphere1/sphere2: f1/e3/v2
- s3/s4/s6: f18/e36/v24
- s5: f8/e18/v12

## Manifest impact

ported 476→488, blocked 166→154. Tags `solid`(8) and `op:solid-voids`(4) eliminated. Remaining G-C8: 3 `addCavity` cases (deferred to B4).