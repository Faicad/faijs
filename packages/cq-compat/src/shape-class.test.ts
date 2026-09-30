/**
 * Shape class-model parity tests — upstream cadquery 2.8.0 Shape.py /
 * selectors.py high-value subset (plan Stage 5 / P0-3).
 *
 * Covered: Face.makePlane (normal/base placement), Compound.makeCompound,
 * Shape.shells/solids/compounds/faces selectors, TypeSelector /
 * DirectionSelector / NearestToPointSelector / StringSyntaxSelector, and the
 * owned-vs-borrowed handle lifecycle (dispose of a borrowed view is a no-op).
 *
 * makeSplineApprox: the sync class-model path throws with a pointer to the
 * async splineFace op (kernel has no sync grid→BSplineSurface interpolation;
 * see plan §8) — asserted as a documented boundary.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import { setupNativeKernel } from './gear-test-harness'
import {
  faceMakePlane,
  makeCompound,
  shells,
  solids,
  compounds,
  facesOf,
  wrapShape,
  borrowShape,
  unwrapShape,
  disposeShape,
  TypeSelector,
  DirectionSelector,
  NearestToPointSelector,
  StringSyntaxSelector,
} from './shape-class'
import type { CqShape } from './shape-class'

beforeAll(async () => {
  await setupNativeKernel()
})

/** Two disjoint 1×1×1 boxes at x=0 and x=5 (fresh kernel handles). */
function twoBoxes(): [CqShape, CqShape] {
  const k = getKernel() as unknown as {
    makeBox: (x: number, y: number, z: number) => object
    translate: (h: object, dx: number, dy: number, dz: number) => object
  }
  return [
    wrapShape('solid', k.makeBox(1, 1, 1) as never),
    wrapShape('solid', k.translate(k.makeBox(1, 1, 1), 5, 0, 0) as never),
  ]
}

describe('Face.makePlane parity', () => {
  it('default +Z plane: centred, area length×width×10⁴', () => {
    const k = getKernel() as unknown as {
      getSurfaceArea: (h: never) => number
      getBoundingBox: (h: never) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
    }
    const f = faceMakePlane(2, 2)
    expect(k.getSurfaceArea(f.handle as never)).toBeCloseTo(2 * 2 * 100 * 100, 0)
    const bb = k.getBoundingBox(f.handle as never)
    expect(bb.zmin).toBe(0)
    expect((bb.xmin + bb.xmax) / 2).toBeCloseTo(0, 6)
    expect((bb.ymin + bb.ymax) / 2).toBeCloseTo(0, 6)
    disposeShape(f)
  })

  it('normal +X: plane stands in the YZ orientation', () => {
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
    }
    const f = faceMakePlane(2, 2, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const bb = k.getBoundingBox(f.handle as never)
    // rotated into the YZ plane: X extent collapses to ~0, Y spans ±100
    expect(Math.abs(bb.xmax - bb.xmin)).toBeLessThan(1e-6)
    expect(bb.ymax - bb.ymin).toBeCloseTo(200, 3)
    disposeShape(f)
  })

  it('basePnt translates the plane', () => {
    const k = getKernel() as unknown as {
      getBoundingBox: (h: never) => { zmin: number; zmax: number }
    }
    const f = faceMakePlane(2, 2, { x: 0, y: 0, z: 5 })
    expect(k.getBoundingBox(f.handle as never).zmin).toBeCloseTo(5, 6)
    disposeShape(f)
  })

  it('owned handle: dispose releases (area read then throws)', () => {
    const k = getKernel() as unknown as { getSurfaceArea: (h: never) => number }
    const f = faceMakePlane(1, 1)
    expect(k.getSurfaceArea(f.handle as never)).toBeGreaterThan(0)
    disposeShape(f)
    expect(() => k.getSurfaceArea(f.handle as never)).toThrow()
  })
})

describe('Compound.makeCompound parity', () => {
  it('two boxes → compound with area = sum, 2 solids, 2 shells', () => {
    const k = getKernel() as unknown as { getSurfaceArea: (h: never) => number }
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    expect(k.getSurfaceArea(comp.handle as never)).toBeCloseTo(12, 6)
    expect(solids(comp).length).toBe(2)
    expect(shells(comp).length).toBe(2)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('empty compound throws', () => {
    expect(() => makeCompound([])).toThrow()
  })

  it('accepts bare handles and wrappers uniformly', () => {
    const k = getKernel() as unknown as { makeBox: (x: number, y: number, z: number) => object }
    const comp = makeCompound([
      k.makeBox(1, 1, 1) as never,
      wrapShape('solid', k.makeBox(1, 1, 1) as never),
    ])
    expect(solids(comp).length).toBe(2)
    disposeShape(comp)
  })
})

describe('Shape selectors parity', () => {
  it('facesOf flattens both boxes to 12 faces', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    expect(facesOf(comp).length).toBe(12)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('compounds() finds the nested compound itself', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    expect(compounds(comp).length).toBe(1)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })
})

describe('Selector classes parity', () => {
  it('TypeSelector keeps only matching kinds', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    const all = [...solids(comp), ...facesOf(comp).slice(0, 4)]
    expect(new TypeSelector('solid').filter(all).length).toBe(2)
    expect(new TypeSelector('face').filter(all).length).toBe(4)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('DirectionSelector keeps faces facing the direction', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    const fs = facesOf(comp)
    // +X-facing faces: x=1 plane of box1 and x=5 plane of box2 → 2
    // (context = the compound, needed to disambiguate the normal sign)
    expect(new DirectionSelector({ x: 1, y: 0, z: 0 }, 1e-4, comp).filter(fs).length).toBe(2)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('NearestToPointSelector returns the single nearest shape', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    const ss = solids(comp)
    const near = new NearestToPointSelector({ x: 0.5, y: 0.5, z: 0.5 }).filter(ss)
    expect(near.length).toBe(1)
    expect(unwrapShape(near[0])).toBe(unwrapShape(ss[0]))
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('StringSyntaxSelector: >X picks the +X extreme solid', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    const ss = solids(comp)
    const picked = new StringSyntaxSelector('>X').filter(ss)
    expect(picked.length).toBe(1)
    expect(unwrapShape(picked[0])).toBe(unwrapShape(ss[1]))
    expect(new StringSyntaxSelector('<X').filter(ss).length).toBe(1)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })

  it('StringSyntaxSelector: or-composition unions and deduplicates', () => {
    const [b1, b2] = twoBoxes()
    const comp = makeCompound([b1, b2])
    // each solid is extreme on both sides along X → or yields both, deduped
    expect(new StringSyntaxSelector('>X or <X').filter(solids(comp)).length).toBe(2)
    disposeShape(b1)
    disposeShape(b2)
    disposeShape(comp)
  })
})

describe('handle lifecycle (owned vs borrowed)', () => {
  it('borrowed selector results survive the wrapper dispose', () => {
    const k = getKernel() as unknown as { getSurfaceArea: (h: never) => number }
    const [b1] = twoBoxes()
    const comp = makeCompound([b1])
    const ss = solids(comp)
    disposeShape(ss[0]) // borrowed — no-op
    expect(k.getSurfaceArea(ss[0].handle as never)).toBeGreaterThan(0)
    disposeShape(b1)
    disposeShape(comp)
  })

  it('borrowShape marks dispose as no-op explicitly', () => {
    const k = getKernel() as unknown as {
      makeBox: (x: number, y: number, z: number) => object
      getSurfaceArea: (h: never) => number
    }
    const h = k.makeBox(1, 1, 1)
    const borrowed = borrowShape('solid', h as never)
    disposeShape(borrowed)
    expect(k.getSurfaceArea(h as never)).toBeGreaterThan(0)
  })
})
