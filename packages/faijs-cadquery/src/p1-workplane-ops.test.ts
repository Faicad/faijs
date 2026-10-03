/**
 * P1 (Stage 2) Workplane op parity tests — upstream cadquery 2.8.0
 * test_cadquery cases for the newly wrapped ops: split / section /
 * sweep (single section) / offset2D / wires / shells / mirrorX / mirrorY /
 * polarArray / polarLine / polarLineTo / rotateAboutCenter / slot2D.
 *
 * Mirrors assert by volume / area / bbox parity (upstream values computed
 * analytically for the simple primitives used here).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  Workplane,
  box,
  rect,
  circle,
  moveTo,
  lineTo,
  vLine,
  hLine,
  threePointArc,
  wire,
  split,
  section,
  sweep,
  offset2D,
  wires,
  shells,
  mirrorX,
  mirrorY,
  polarArray,
  polarLine,
  polarLineTo,
  rotateAboutCenter,
  slot2D,
  extrude,
  copyWorkplane,
  workplane,
  faces,
  partAt,
  size,
  fillet,
  edges,
  faceFromPoints,
  solidFromFaces,
} from './workplane'
import { brepOf } from '@faicad/faijs/shape'

beforeAll(async () => {
  await setupNativeKernel()
})

/** Kernel-level volume of a Workplane's shape. */
function volume(wp: Workplane): number {
  const k = getKernel() as unknown as { getVolume: (h: never) => number }
  return k.getVolume(brepOf(wp.shape as never) as never)
}

/** Kernel-level surface area of a Workplane's shape. */
function area(wp: Workplane): number {
  const k = getKernel() as unknown as { getSurfaceArea: (h: never) => number }
  return k.getSurfaceArea(brepOf(wp.shape as never) as never)
}

describe('copyWorkplane parity (upstream Workplane.copyWorkplane)', () => {
  it('adopts obj0 top-face workplane → box centred at (0,0,5)', async () => {
    const obj0 = await workplane(await faces(await box(Workplane(), 1, 1, 10), '>Z'))
    const obj1 = await box(copyWorkplane(Workplane(), obj0), 1, 1, 1)
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
    }
    const bb = k.getBoundingBox(brepOf(obj1.shape as never) as never)
    // upstream asserts Center == (0, 0, 5): the result is ONLY the 1×1×1 box
    // at the adopted plane (z=5) — GOTCHA (probed on cadquery 2.8.0): the
    // copied stack holds just the origin Vector, so the base 1×1×10 box is
    // NOT fused into the result (bbox z∈[4.5, 5.5]).
    expect((bb.xmin + bb.xmax) / 2).toBeCloseTo(0, 9)
    expect((bb.ymin + bb.ymax) / 2).toBeCloseTo(0, 9)
    expect((bb.zmin + bb.zmax) / 2).toBeCloseTo(5, 9)
    expect(bb.zmin).toBeCloseTo(4.5, 9)
    expect(bb.zmax).toBeCloseTo(5.5, 9)
  })
})

describe('edges("#Z") parity (upstream DirectionMinMaxSelector)', () => {
  it('#Z selects the 4 top-rim edges of a plain box (fillet applies)', async () => {
    const b = await box(Workplane(), 10, 10, 10)
    const f = await fillet(await edges(b, '#Z'), 2)
    // filleting the 4 top edges keeps the volume below the raw 1000
    expect(volume(f)).toBeGreaterThan(900)
    expect(volume(f)).toBeLessThan(1000)
  })

  it('#Z on an already-filleted box selects the top rim (8 edges incl. arcs)', async () => {
    // GOTCHA (probed 2026-10-01): the kernel fillet REJECTS re-filleting the
    // fillet OUTPUT — "fillet: operation failed" (8 top-rim edges) or
    // "fillet: TopoDS::Solid" (single edge, kernel-level probe) — even though
    // the input is still a 1-solid TopoDS (getSubShapes 'solid' == 1).
    // Selector-side #Z resolution is correct (8 edges); the blocker is
    // kernel-side (blocks the testEnclosure op:split-all chain), so this test
    // pins the failure propagating (fail-loud, no silent no-op).
    // NOTE: the first fillet must be geometrically feasible (2r < box width) —
    // an r=10 fillet on a 10-wide box fails with the same message.
    const b = await box(Workplane(), 20, 20, 10)
    const f1 = await fillet(await edges(b, '|Z'), 5)
    await expect(fillet(await edges(f1, '#Z'), 2)).rejects.toThrow(/TopoDS::Solid|operation failed/)
  })
})

describe('faceFromPoints + solidFromFaces parity (upstream testMakeShellSolid)', () => {
  it('unit tetrahedron from 4 vertex-ring faces → vol √2/12, f4/e6/v4', async () => {
    // upstream: 4 vertices at (√2/4, ±√2/4, ∓√2/4), 3-edge faces sewn into a
    // shell, then Solid.makeSolid — a regular tetrahedron of edge 1.
    const c0 = Math.sqrt(2) / 4
    const v = [
      [c0, -c0, c0],
      [c0, c0, -c0],
      [-c0, c0, c0],
      [-c0, -c0, -c0],
   ] as [number, number, number][]
    const ixs = [[0, 1, 2], [1, 0, 3], [2, 3, 0], [3, 2, 1]]
    const faceWps = ixs.map((ix) => faceFromPoints(Workplane(), ix.map((i) => v[i]!)))
    // NOTE: the FIRST argument of solidFromFaces is the frame workplane (not a
    // face) — passing faceWps[0] there silently drops it from the sew (3 faces,
    // vol √2/18). All four faces go in the faces array.
    const solid = await solidFromFaces(Workplane(), faceWps)
    // regular tetrahedron of edge 1: V = √2 / 12
    expect(volume(solid)).toBeCloseTo(Math.SQRT2 / 12, 9)
    const k = getKernel() as unknown as { getSubShapes: (h: never, t: string) => unknown[] }
    expect(k.getSubShapes(brepOf(solid.shape as never) as never, 'face').length).toBe(4)
  })
})

describe('split parity (upstream Workplane.split)', () => {
  it('keepTop only → single top half (vol 4)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1], { keepTop: true, keepBottom: false })
    expect(volume(sp)).toBeCloseTo(4, 6)
  })

  it('keepBottom only → single bottom half (vol 4)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1], { keepTop: false, keepBottom: true })
    expect(volume(sp)).toBeCloseTo(4, 6)
  })

  it('both kept → two-object stack; partAt(0)/(1) pick each half (vol 4)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1], { keepTop: true, keepBottom: true })
    const top = partAt(sp, 0)
    const bottom = partAt(sp, 1)
    expect(volume(top)).toBeCloseTo(4, 6)
    expect(volume(bottom)).toBeCloseTo(4, 6)
  })

  it('partAt index out of range throws', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0], [0, 0, 1])
    expect(() => partAt(sp, 5)).toThrow(/out of range/)
  })

  it('2×2×2 box split at z=0.5 keeps both halves on the stack → total volume 8', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0.5], [0, 0, 1])
    // P3-4: both-keep pushes TWO objects (upstream `rv = [top, bottom];
    // newObject(rv)`), so `.shape` is only the first half — the total volume is
    // the sum over the stack (probe p3-4-end-split-probe.py: split_size == 2).
    expect(size(sp)).toBe(2)
    expect(volume(partAt(sp, 0)) + volume(partAt(sp, 1))).toBeCloseTo(8, 6)
  })

  it('split at an interior plane z=0.25 keeps both halves → total volume 8', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    // GOTCHA: L1 splitByPlane asserts solidCount=2 and REJECTS boundary
    // planes (a plane through a face leaves one side empty, got 1)
    const sp = await split(b, [0, 0, 0.25], [0, 0, 1])
    expect(size(sp)).toBe(2)
    expect(volume(partAt(sp, 0)) + volume(partAt(sp, 1))).toBeCloseTo(8, 6)
  })

  it('split at a boundary plane throws (L1 solidCount=2 assertion)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    await expect(split(b, [0, 0, 1], [0, 0, 1])).rejects.toThrow(/expected 2 solids/)
  })
})

describe('section parity (upstream Workplane.section)', () => {
  it('mid-plane section of a 2×2×2 box → 4 edges (square outline)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sec = await section(b, 0.5)
    const k = getKernel() as unknown as { getSubShapes: (h: never, t: string) => unknown[] }
    expect(k.getSubShapes(brepOf(sec.shape as never) as never, 'edge').length).toBe(4)
  })

  it('section above the box throws (no intersection)', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    await expect(section(b, 5)).rejects.toThrow(/does not intersect/)
  })
})

describe('sweep parity (upstream Workplane.sweep, single section)', () => {
  it('circle ⊥ straight spine → volume πr²L', async () => {
    let path = await moveTo(Workplane(), 0, 0)
    path = await lineTo(path, 10, 0)
    const pathWp = wire(path)
    const prof = await circle(Workplane('YZ'), 1)
    const sw = await sweep(prof, pathWp)
    expect(volume(sw)).toBeCloseTo(Math.PI * 10, 1)
  })

  it('coplanar profile degrades (GOTCHA: profile must ⊥ spine)', async () => {
    // XZ-plane profile along an X spine is squashed flat — volume ≈ 0
    let path = await moveTo(Workplane(), 0, 0)
    path = await lineTo(path, 10, 0)
    const pathWp = wire(path)
    const prof = await rect(Workplane('XZ'), 2, 2)
    const sw = await sweep(prof, pathWp)
    expect(Math.abs(volume(sw))).toBeLessThan(1e-6)
  })

  it('multisection: pipeShell + end caps → valid solid (P2 unblocked)', async () => {
    // L spine, square profile + two extra sections → per-section pipeShell
    // swept and fused with capped ends (valid=true, probe-verified)
    let path = await moveTo(Workplane(), 0, 0)
    path = await lineTo(path, 10, 0)
    path = await lineTo(path, 10, 5)
    const pathWp = wire(path)
    const prof = await rect(Workplane('YZ'), 2, 2)
    const s1 = await rect(Workplane('YZ'), 2, 2)
    const s2 = await rect(Workplane('YZ'), 3, 3)
    const sw = await sweep(prof, pathWp, { multisection: [s1, s2] })
    expect(volume(sw)).toBeGreaterThan(0)
    const k = getKernel() as unknown as { isValid: (h: never) => boolean }
    expect(k.isValid(brepOf(sw.shape as never) as never)).toBe(true)
  })

  it('multisection: [] keeps the single-section MakePipe path', async () => {
    let path = await moveTo(Workplane(), 0, 0)
    path = await lineTo(path, 10, 0)
    const pathWp = wire(path)
    const prof = await circle(Workplane('YZ'), 1)
    const sw = await sweep(prof, pathWp, { multisection: [] })
    expect(volume(sw)).toBeCloseTo(Math.PI * 10, 1)
  })
})

describe('offset2D parity (upstream Workplane.offset2D)', () => {
  it('rect 2×2 offset +0.5 (arc joins) → extruded volume 8.7854 (kernel arc-join anchor)', async () => {
    const r = await rect(Workplane(), 2, 2)
    const off = await offset2D(r, 0.5)
    const solid = await extrude(off, 1)
    // GOTCHA: kernel offsetWire2D arc-join does not reproduce upstream's
    // sharp-corner round (π/4 corner terms) — measured anchor 8.7854
    // (3×3 square minus 0.2146 corner deficit ≈ (1−π/4)·1²), kept as the
    // parity anchor rather than a guessed analytic value.
    expect(volume(solid)).toBeCloseTo(8.785398163397447, 3)
  })

  it('rect 2×2 offset −0.5 (inward) → extruded volume 1', async () => {
    const r = await rect(Workplane(), 2, 2)
    const off = await offset2D(r, -0.5)
    const solid = await extrude(off, 1)
    expect(volume(solid)).toBeCloseTo(1, 3)
  })

  it('offset without pending wires throws', async () => {
    await expect(offset2D(Workplane(), 1)).rejects.toThrow(/no pending wires/)
  })
})

describe('selector family parity', () => {
  it('wires of a box → 1 shape (outer wire)', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const w = wires(b)
    expect(w.shape).toBeTruthy()
  })

  it('shells of a box → 1 shell', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const sh = shells(b)
    expect(sh.shape).toBeTruthy()
  })
})

describe('mirrorX / mirrorY parity', () => {
  // GOTCHA: upstream (cadquery 2.8.0) `mirrorX()` takes NO arguments and
  // mirrors about the workplane's X AXIS — local y → −y — not about the YZ
  // plane (x → −x). Evidence: testSimpleMirror refs bbox x[0,3] y[−2,2] for a
  // profile drafted entirely in y ≥ 0. An earlier cq-compat mirrored x → −x,
  // which silently produced the 90°-rotated twin of every mirrored sketch.
  it('mirrorX mirrors the drafted profile about the X axis (y → −y)', async () => {
    const p = await vLine(await moveTo(Workplane('XY'), 1, 2), 3)
    const m = await mirrorX(p)
    const wires = m.pendingWires ?? []
    // The drafted line sits wholly off the axis, so no endpoint is shared and
    // upstream consolidateWires() leaves two separate wires.
    expect(wires.length).toBe(2)
    // original y ∈ [2, 5]; mirrored twin y ∈ [−5, −2]
    const ys = (wires[1] as { pts: [number, number][] }).pts.map((q) => q[1])
    expect(Math.max(...ys)).toBeCloseTo(-2, 9)
    expect(Math.min(...ys)).toBeCloseTo(-5, 9)
  })

  it('mirrorX splices into ONE closed ring when both ends sit on the axis', async () => {
    // The testSimpleMirror profile: drafted in y ≥ 0, both endpoints on y = 0.
    let p = await moveTo(Workplane('XY'), 0, 0)
    p = await lineTo(p, 2, 2)
    p = await threePointArc(p, [3, 1], [2, 0])
    const m = await mirrorX(p)
    const wires = m.pendingWires ?? []
    expect(wires.length).toBe(1)
    const pts = (wires[0] as { pts: [number, number][] }).pts
    // (0,0) → (2,2) → (2,0) → (2,−2) → implicit close back to (0,0)
    expect(pts.length).toBe(4)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[2]).toEqual([2, 0])
    expect(pts[3]).toEqual([2, -2])
  })

  it('mirrorY mirrors the drafted profile about the Y axis (x → −x)', async () => {
    const p = await hLine(await moveTo(Workplane('XY'), 4, 1), 3)
    const m = await mirrorY(p)
    const wires = m.pendingWires ?? []
    expect(wires.length).toBe(2)
    const xs = (wires[1] as { pts: [number, number][] }).pts.map((q) => q[0])
    expect(Math.max(...xs)).toBeCloseTo(-4, 9)
    expect(Math.min(...xs)).toBeCloseTo(-7, 9)
  })

  it('mirrorX of a solid (no drafting in progress) mirrors the shape', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const m = await mirrorX(b)
    expect(area(m)).toBeCloseTo(6, 6)
  })

  it('mirrorY of a solid mirrors the shape without fusing', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const m = await mirrorY(b)
    expect(area(m)).toBeCloseTo(6, 6)
  })
})

describe('polarArray / polarLine / polarLineTo parity', () => {
  it('polarArray fill: 4 points evenly on r=4 from 0°', () => {
    const pa = polarArray(Workplane(), 4, 0, 360, 4)
    expect(pa.pts.length).toBe(4)
    expect(pa.pts[0][0]).toBeCloseTo(4, 9)
    expect(pa.pts[0][1]).toBeCloseTo(0, 9)
    expect(pa.pts[1][0]).toBeCloseTo(0, 9)
    expect(pa.pts[1][1]).toBeCloseTo(4, 9)
  })

  // GOTCHA (verified against cadquery 2.8.0 `Workplane.polarArray`): the two
  // `fill` branches read `angle` OPPOSITE to the intuitive naming.
  //   fill=True  → `angle` is the TOTAL sweep, so step = angle/(count−1)
  //                (…unless it is a whole number of turns, then angle/count);
  //   fill=False → `angle` IS the angle BETWEEN elements, so step = angle.
  // This test previously asserted the fill=False branch as "count−1 spacing",
  // i.e. it had the two branches swapped.
  it('polarArray fill=true on a partial sweep: count-1 spacing over angle', () => {
    const pa = polarArray(Workplane(), 2, 0, 90, 3, true)
    expect(pa.pts.length).toBe(3)
    // step = 90/(3−1) = 45° → 0°, 45°, 90°
    expect(pa.pts[0][1]).toBeCloseTo(0, 9)
    expect(pa.pts[2][0]).toBeCloseTo(0, 9)
    expect(pa.pts[2][1]).toBeCloseTo(2, 9)
  })

  it('polarArray fill=false: angle is the angle BETWEEN elements', () => {
    const pa = polarArray(Workplane(), 2, 0, 90, 3, false)
    expect(pa.pts.length).toBe(3)
    // step = 90° → 0°, 90°, 180°
    expect(pa.pts[1][0]).toBeCloseTo(0, 9)
    expect(pa.pts[1][1]).toBeCloseTo(2, 9)
    expect(pa.pts[2][0]).toBeCloseTo(-2, 9)
    expect(pa.pts[2][1]).toBeCloseTo(0, 9)
  })

  it('polarArray carries the polar angle as each point rotation (rotate=True)', () => {
    const pa = polarArray(Workplane(), 2, 10, 50, 3)
    expect(pa.ptsAngle).toEqual([10, 35, 60])
  })

  it('polarArray rotate=False carries no rotation', () => {
    const pa = polarArray(Workplane(), 2, 10, 50, 3, true, false)
    expect(pa.ptsAngle).toEqual([0, 0, 0])
  })

  it('polarArray count<1 raises (upstream ValueError)', () => {
    expect(() => polarArray(Workplane(), 1, 0, 90, 0)).toThrow(/at least 1 element/)
  })

  it('polarLine drafts at an angle from the current point', async () => {
    let wp = await moveTo(Workplane(), 1, 1)
    wp = polarLine(wp, Math.SQRT2, 45)
    // endpoint = (1,1) + (√2·cos45, √2·sin45) = (2, 2)
    const last = (wp.pendingEdges ?? [])[(wp.pendingEdges ?? []).length - 1]
    expect(last.to[0]).toBeCloseTo(2, 9)
    expect(last.to[1]).toBeCloseTo(2, 9)
  })

  it('polarLineTo drafts to an absolute polar destination', async () => {
    let wp = await moveTo(Workplane(), 5, 5)
    wp = polarLineTo(wp, 2, 0)
    // destination = origin + 2·(cos0, sin0) = (2, 0) — NOT relative from (5,5)
    const last = (wp.pendingEdges ?? [])[(wp.pendingEdges ?? []).length - 1]
    expect(last.to[0]).toBeCloseTo(2, 9)
    expect(last.to[1]).toBeCloseTo(0, 9)
  })
})

describe('rotateAboutCenter parity', () => {
  it('90° about local Y through the centre turns X-extent into Z-extent', async () => {
    const b = await box(Workplane(), 4, 1, 1)
    const r = await rotateAboutCenter(b, [0, 1, 0], 90)
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
    }
    const bb = k.getBoundingBox(brepOf(r.shape as never) as never)
    expect(bb.xmax - bb.xmin).toBeCloseTo(1, 6)
    expect(bb.zmax - bb.zmin).toBeCloseTo(4, 6)
  })
})

describe('slot2D parity', () => {
  it('slot 4×2 extruded → volume straight 2×2 + π·1² (overall length 4)', async () => {
    const s = await slot2D(Workplane(), 4, 2)
    const sv = await extrude(s, 1)
    // overall length 4, width 2 → straight section (4−2)×2 + semicircle caps π·1²
    expect(volume(sv)).toBeCloseTo((4 - 2) * 2 + Math.PI, 2)
  })

  it('slot rotated 90° swaps extents (overall bbox 2×4)', async () => {
    const s = await slot2D(Workplane(), 4, 2, 90)
    const sv = await extrude(s, 1)
    expect(volume(sv)).toBeCloseTo((4 - 2) * 2 + Math.PI, 2)
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { xmin: number; xmax: number; ymin: number; ymax: number }
    }
    const bb = k.getBoundingBox(brepOf(sv.shape as never) as never)
    // rotated: X extent = width (2), Y extent = overall length (4)
    expect(bb.xmax - bb.xmin).toBeCloseTo(2, 3)
    expect(bb.ymax - bb.ymin).toBeCloseTo(4, 3)
  })

  it('diameter > length throws', async () => {
    await expect(slot2D(Workplane(), 2, 4)).rejects.toThrow(/diameter cannot exceed/)
  })
})
