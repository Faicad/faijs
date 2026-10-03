/**
 * extrude `both=` / `combine="cut"|"s"` parity tests (upstream cadquery 2.8.0
 * `Workplane.extrude` + `cutBlind`), plus the cutBlind direction sign rule.
 *
 * Verified against cadquery 2.8.0 (probe-ref on the mirrored ref STEPs):
 *   circle(1).extrude(1, both=True)               -> vol 2π, z[-1,1]
 *   rect(40,40).extrude(20, both=True)            -> vol 64000, bbox ±20
 *   ... .rect(20,20).extrude(20, both=True, "s")  -> vol 48000 (through hole)
 * wp_ref.workplane(offset=-20).rect(20,20).extrude(40, "s") -> vol 48000
 *
 * Upstream delegates `combine in ("cut","s")` to cutBlind (cq.py:3063-3065) and
 * `both=True` to `_extrude` (which extrudes ±distance and fuses, cq.py:3788-3792).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { brepOf } from '@faicad/faijs/shape'
import { setupNativeKernel } from './gear-test-harness'
import { Workplane, box, rect, circle, extrude, workplane, faces } from './workplane'

beforeAll(async () => {
  await setupNativeKernel()
})

/** Kernel-level volume of a Workplane's shape. */
function volume(wp: Workplane): number {
  const k = getKernel() as unknown as { getVolume: (h: never) => number }
  return k.getVolume(brepOf(wp.shape as never) as never)
}

interface BBox {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
  zmin: number
  zmax: number
}

/** Kernel-level bounding box of a Workplane's shape. */
function bbox(wp: Workplane): BBox {
  const k = getKernel() as unknown as { getBoundingBox: (h: never) => BBox }
  return k.getBoundingBox(brepOf(wp.shape as never) as never)
}

describe('extrude both=True (upstream `extrude(..., both=True)` = extrude ±distance, fuse)', () => {
  it('circle(1).extrude(1, both=True) → vol 2π, z[-1,1]', async () => {
    const s = await extrude(circle(Workplane('XY'), 1), 1, true, { both: true })
    expect(volume(s)).toBeCloseTo(2 * Math.PI, 9)
    const bb = bbox(s)
    expect(bb.zmin).toBeCloseTo(-1, 9)
    expect(bb.zmax).toBeCloseTo(1, 9)
  })

  it('rect(40,40).extrude(20, both=True) → vol 64000, bbox ±20', async () => {
    const s = await extrude(rect(Workplane('XY'), 40, 40), 20, true, { both: true })
    expect(volume(s)).toBeCloseTo(64000, 6)
    const bb = bbox(s)
    expect(bb.xmin).toBeCloseTo(-20, 9)
    expect(bb.xmax).toBeCloseTo(20, 9)
    expect(bb.zmin).toBeCloseTo(-20, 9)
    expect(bb.zmax).toBeCloseTo(20, 9)
  })
})

describe('extrude combine="s" (subtractive — delegates to cutBlind)', () => {
  it('both=True + combine="s" punches a 20×20 through hole → vol 48000', async () => {
    const wpRef = await extrude(rect(Workplane('XY'), 40, 40), 20, true, { both: true })
    const w1 = await workplane(wpRef)
    const s = await extrude(rect(w1, 20, 20), 20, 's', { both: true })
    // 40×40×40 box minus a 20×20 prism spanning the full ±20 → through hole.
    expect(volume(s)).toBeCloseTo(48000, 6)
    const bb = bbox(s)
    expect(bb.zmin).toBeCloseTo(-20, 9)
    expect(bb.zmax).toBeCloseTo(20, 9)
  })
})

describe('extrude combine="cut" (cq.py:3063-3065)', () => {
  it('box(5,5,5).faces(">Z").workplane(invert=True).circle(0.5).extrude(4, "cut") → vol 125-π', async () => {
    // workplane(invert=True) flips the >Z face's outward normal (+Z) to -Z, so a
    // POSITIVE depth cuts *into* the solid (a r=0.5 pocket 4 deep: z=+2.5 → -1.5).
    const b = await box(Workplane('XY'), 5, 5, 5)
    const w1 = await workplane(faces(b, '>Z'), { invert: true })
    const s = await extrude(circle(w1, 0.5), 4, 'cut')
    expect(volume(s)).toBeCloseTo(125 - Math.PI, 9)
  })
})

describe('cutBlind direction sign (cq.py:3526-3528)', () => {
  it('POSITIVE depth cuts along +normal: bottom-face workplane → through hole', async () => {
    // wp_ref is a 40×40×40 box centred at origin; workplane(offset=-20) sits at
    // z=-20 with normal +Z. Cut 40 along +Z → z[-20,20] → through hole (48000).
    const wpRef = await extrude(rect(Workplane('XY'), 40, 40), 20, true, { both: true })
    const w1 = await workplane(wpRef, { offset: -20 })
    const s = await extrude(rect(w1, 20, 20), 40, 's')
    expect(volume(s)).toBeCloseTo(48000, 6)
  })

  it('NEGATIVE depth cuts along -normal: top-face workplane → inward pocket', async () => {
    // box(5,5,5).faces(">Z").workplane().rect(1,1).cutBlind(-1): the pushed top
    // face's normal points +Z (out of the solid), so a NEGATIVE depth cuts in.
    const b = await box(Workplane('XY'), 5, 5, 5)
    const w1 = await workplane(faces(b, '>Z'))
    const s = await extrude(rect(w1, 1, 1), -1, 's')
    expect(volume(s)).toBeCloseTo(125 - 1, 9)
  })
})
