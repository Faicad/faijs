/**
 * P1 (Stage 2) Workplane tool-group op parity — upstream cadquery 2.8.0
 * `test_cadquery` cases for: size / clean / bezier / consolidateWires / sort.
 *
 * These are the remaining "A-straight" Workplane methods whose kernel support
 * was already present (bbox / healSolid+fixShape+removeDegenerateEdges /
 * makeBezierEdge / makeCompound) but had no compat wrapper. Mirrors assert by
 * volume / bbox / subshape count parity.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  Workplane,
  box,
  circle,
  moveTo,
  wire,
  extrude,
  bezier,
  size,
  clean,
  consolidateWires,
  sort,
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

describe('size (upstream Workplane.size)', () => {
  it('2×3×4 box → size [2,3,4]', async () => {
    const b = await box(Workplane(), 2, 3, 4)
    const d = size(b)
    expect(d[0]).toBeCloseTo(2, 6)
    expect(d[1]).toBeCloseTo(3, 6)
    expect(d[2]).toBeCloseTo(4, 6)
  })

  it('throws when the workplane has no solid', () => {
    expect(() => size(Workplane())).toThrow(/no solid/)
  })
})

describe('clean (upstream Workplane.clean)', () => {
  it('heals a box without changing its volume', async () => {
    const b = await box(Workplane(), 2, 2, 2)
    const c = clean(b)
    expect(volume(c)).toBeCloseTo(8, 6)
  })

  it('throws when the workplane has no solid', () => {
    expect(() => clean(Workplane())).toThrow(/no solid/)
  })
})

describe('bezier (upstream Workplane.bezier)', () => {
  it('drafts a bezier, wires it, and extrudes to a solid', async () => {
    const wp = moveTo(Workplane(), 0, 0)
    const drafted = bezier(wp, [
      [0, 0],
      [2, 3],
      [5, 3],
      [7, 0],
    ])
    const wired = wire(drafted)
    const solid = await extrude(wired, 2)
    expect(solid.shape).not.toBeNull()
    // The Bézier spans x∈[0,7]; extruded 2 deep → volume > 0.
    expect(volume(solid)).toBeGreaterThan(0)
  })

  it('rejects fewer than 2 control points', () => {
    expect(() => bezier(Workplane(), [[0, 0]])).toThrow(/at least 2 control points/)
  })
})

describe('consolidateWires (upstream Workplane.consolidateWires)', () => {
  it('merges two pending wires into a 2-wire compound', async () => {
    let wp = circle(Workplane(), 1)
    wp = circle(wp, 0.5)
    const cons = await consolidateWires(wp)
    expect(cons.shape).not.toBeNull()
    const wires = getKernel().getSubShapes(brepOf(cons.shape as never) as never, 'wire')
    expect(wires.length).toBe(2)
  })

  it('throws when there are no pending wires', async () => {
    await expect(consolidateWires(Workplane())).rejects.toThrow(/no pending wires/)
  })
})

describe('sort (upstream Workplane.sort)', () => {
  it('reorders pending wires by bounding-box area, largest first', () => {
    let wp = circle(Workplane(), 2)
    wp = circle(wp, 1)
    // before sort: [r=2, r=1]
    expect((wp.pendingWires![0] as { radius: number }).radius).toBe(2)
    const sorted = sort(wp, 'area')
    const radii = sorted.pendingWires!.map((w) => (w as { radius: number }).radius)
    expect(radii[0]).toBeGreaterThan(radii[1]!)
  })
})
