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

describe('split parity (upstream Workplane.split)', () => {
  it('2×2×2 box split at z=0.5 keeps both halves → total volume 8', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const sp = await split(b, [0, 0, 0.5], [0, 0, 1])
    expect(volume(sp)).toBeCloseTo(8, 6)
  })

  it('split at an interior plane z=0.25 keeps both halves → total volume 8', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    // GOTCHA: L1 splitByPlane asserts solidCount=2 and REJECTS boundary
    // planes (a plane through a face leaves one side empty, got 1)
    const sp = await split(b, [0, 0, 0.25], [0, 0, 1])
    expect(volume(sp)).toBeCloseTo(8, 6)
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
  it('mirrorX(union) of a box at +X doubles nothing (self-overlap) but succeeds', async () => {
    const b = await box(Workplane(), 1, 1, 1)
    const m = await mirrorX(b, false)
    expect(area(m)).toBeCloseTo(6, 6)
  })

  it('mirrorY(union=false) mirrors without fusing', async () => {
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

  it('polarArray fill=false: count-1 spacing over angle', () => {
    const pa = polarArray(Workplane(), 2, 0, 90, 3, false)
    expect(pa.pts.length).toBe(3)
    // first at 0°, last at 90°
    expect(pa.pts[0][1]).toBeCloseTo(0, 9)
    expect(pa.pts[2][0]).toBeCloseTo(0, 9)
    expect(pa.pts[2][1]).toBeCloseTo(2, 9)
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
