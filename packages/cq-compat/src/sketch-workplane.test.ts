/**
 * Workplane↔Sketch integration tests — upstream cadquery 2.8.0 testSketch
 * parity for the Workplane-layer sketch binding: `sketch(wp)` /
 * `sketchFinish(sk, wp)` / `placeSketch(wp, ...sks)` and the `extrude`/`loft`
 * consumption of materialized sketch faces (`pendingFaces`).
 *
 * Anchors are the upstream testSketch assertions (analytic values).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  Workplane,
  box,
  extrude,
  loft,
  sketch,
  sketchFinish,
  placeSketch,
  workplane,
  faces,
} from './workplane'
import {
  slot as sketchSlot,
  clean as sketchClean,
  polygon as sketchPolygon,
  moved as sketchMoved,
  type Sketch,
} from './sketch'
import { brepOf } from '@faicad/faijs/shape'

beforeAll(async () => {
  await setupNativeKernel()
})

function volume(wp: Workplane): number {
  const k = getKernel() as unknown as { getVolume: (h: never) => number }
  return k.getVolume(brepOf(wp.shape as never) as never)
}

describe('sketch(wp) binding + extrude consumption (upstream testSketch r1)', () => {
  it('two slots on the box top face, extruded 1 → valid fused solid', async () => {
    // r1: Workplane().box(10,10,1).faces(">Z").sketch()
    //       .slot(2,1).slot(2,1,angle=90).clean().finalize().extrude(1)
    let sk: Sketch = sketch(await workplane(await faces(await box(Workplane(), 10, 10, 1), '>Z')))
    sk = sketchSlot(sk, 2, 1)
    sk = sketchSlot(sk, 2, 1, { angle: 90 })
    sk = sketchClean(sk)
    const wp = sketchFinish(sk, await workplane(await faces(await box(Workplane(), 10, 10, 1), '>Z')))
    const r1 = await extrude(wp, 1)
    expect(r1.shape).not.toBeNull()
    const v = volume(r1)
    // GOTCHA (probed on cadquery 2.8.0): upstream Sketch.slot(w,h) treats w
    // as the distance BETWEEN arc centers — slot(2,1) area = w·h + π/4·h² =
    // 2.7854, matching cq-compat's slot exactly (NOTE: Workplane.slot2D uses
    // the OPPOSITE convention, total length including the caps). Two crossing
    // slots overlap in a 1×1 square → union 4.5708, fused onto the 10×10×1
    // slab → 104.5708.
    expect(v).toBeCloseTo(104.5708, 4)
    // the sketch faces sat on the z=0.5 top plane (10×10×1 box is centred:
    // z∈[-0.5,0.5], top face at 0.5) → prism reaches z=1.5
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { zmin: number; zmax: number }
    }
    const bb = k.getBoundingBox(brepOf(r1.shape as never) as never)
    expect(bb.zmin).toBeCloseTo(-0.5, 6)
    expect(bb.zmax).toBeCloseTo(1.5, 6)
  })
})

describe('placeSketch + loft (upstream testSketch r4)', () => {
  it('loft between a trapezoid sketch and its z+3 copy → 1 solid', async () => {
    // r4: Workplane().placeSketch(s, s.moved(Location(0,0,3))).loft()
    const base = await sketchPolygon(sketchCreateFree(), [[0, 0], [0, 1], [1, 0]])
    const top = sketchMoved(base, 0, 0, 0, 3)
    const wp = placeSketch(Workplane(), base, top)
    const r4 = await loft(wp)
    expect(r4.shape).not.toBeNull()
    // triangular prism: area 0.5 × height 3
    expect(volume(r4)).toBeCloseTo(1.5, 6)
  })
})

describe('sketchFinish + extrude standalone (upstream testSketch r5)', () => {
  it('triangle polygon sketch extruded 1 → volume 0.5', async () => {
    // r5: Workplane().sketch().polygon([(0,0),(0,1),(1,0)]).finalize().extrude(1)
    const sk = sketchPolygon(sketch(Workplane()), [[0, 0], [0, 1], [1, 0]])
    const r5 = await extrude(sketchFinish(sk, Workplane()), 1)
    expect(volume(r5)).toBeCloseTo(0.5, 6)
  })
})

/** Local import-name collision workaround: sketch() is the workplane binding. */
function sketchCreateFree(): ReturnType<typeof sketch> {
  // an unbound sketch: strip the plane binding from a fresh Workplane-bound one
  const sk = sketch(Workplane())
  delete sk.plane
  sk.locs = []
  return sk
}
