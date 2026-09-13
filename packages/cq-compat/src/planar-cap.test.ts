/**
 * planarCap — cq-compat extension E6 tests.
 *
 * Build a wedge (triangular prism) from raw kernel faces, then close its two
 * open ends with planar caps from boundary edges lying on z-planes — the exact
 * pattern gears use (tooth-face patches + end caps → sewn solid).
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { planarCap, solidFromFaces } from './index'
import { setupNativeKernel, mkWP, kernel } from './gear-test-harness'
import { fromHandle } from '@faicad/faijs-core/sdk'
import { brepOf } from '@faicad/faijs-core/shape'
import type { Workplane } from './workplane'

beforeAll(async () => {
  await setupNativeKernel()
}, 120000)

/** Raw kernel handle of a Workplane's `.shape`. */
function rawOf(wp: Workplane): unknown {
  return brepOf(wp.shape as never)
}

/**
 * A triangular prism along Z: rectangle at z=0 (width w × depth d), collapsed
 * to a line at z=h. Returns the three extruded faces WITHOUT end caps.
 */
function wedgeFaces(w: number, d: number, h: number): Workplane[] {
  const k = kernel() as unknown as {
    makeLineEdge: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => unknown
    makeFace: (wire: unknown) => unknown
    extrude: (face: unknown, dx: number, dy: number, dz: number) => unknown
  }
  // Base rectangle at z=0
  const p = (x: number, y: number, z: number) => ({ x, y, z })
  const rectEdges = [
    k.makeLineEdge(p(0, 0, 0), p(w, 0, 0)),
    k.makeLineEdge(p(w, 0, 0), p(w, d, 0)),
    k.makeLineEdge(p(w, d, 0), p(0, d, 0)),
    k.makeLineEdge(p(0, d, 0), p(0, 0, 0)),
  ]
  const base = k.makeFace(k.makeLineEdge(p(0, 0, 0), p(w, 0, 0)) && rectEdges[0] && ((): unknown => {
    // makeWire from the 4 edges
    const mk = (kernel() as unknown as { makeWire: (edges: unknown[]) => unknown })
    return mk.makeWire(rectEdges)
  })())
  // Extrude each side region: simpler — extrude the base face to a box, then
  // take its 4 side faces (skip top/bottom, which is what the caps replace).
  const boxSolid = k.extrude(base, 0, 0, h)
  const kk = kernel() as unknown as { getSubShapes: (s: unknown, t: 'face') => unknown[] }
  const allFaces = kk.getSubShapes(boxSolid, 'face')
  // Keep only the 4 vertical side faces (those whose bbox spans full height)
  const kb = kernel() as unknown as {
    getBoundingBox: (s: unknown) => { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }
  }
  const sides = allFaces.filter((f) => {
    const bb = kb.getBoundingBox(f)
    return Math.abs(bb.zmin - 0) < 1e-9 && Math.abs(bb.zmax - h) < 1e-9
  })
  return sides.map((f) => ({ shape: fromHandle(f) }) as unknown as Workplane)
}

describe('planarCap (E6)', () => {
  it('caps an open wedge at both z-planes and sews it into a box-solid volume', async () => {
    const w = 10, d = 6, h = 4
    const sides = wedgeFaces(w, d, h)
    expect(sides.length).toBe(4)

    const bottom = await planarCap(mkWP(), sides, { origin: [0, 0, 0], normal: [0, 0, 1] })
    const top = await planarCap(mkWP(), sides, { origin: [0, 0, h], normal: [0, 0, 1] })

    const kb = kernel() as unknown as { getBoundingBox: (s: unknown) => { zmin: number; zmax: number } }
    expect(kb.getBoundingBox(rawOf(bottom)).zmin).toBeCloseTo(0, 9)
    expect(kb.getBoundingBox(rawOf(top)).zmax).toBeCloseTo(h, 9)

    // Sew sides + caps into a solid: must recover the box volume exactly.
    const solid = await solidFromFaces(mkWP(), [...sides, bottom, top])
    const kv = kernel() as unknown as { isSolid: (s: unknown) => boolean; getVolume: (s: unknown) => number }
    expect(kv.isSolid(rawOf(solid))).toBe(true)
    expect(kv.getVolume(rawOf(solid))).toBeCloseTo(w * d * h, 6)
  })

  it('throws when no boundary edges lie on the plane', async () => {
    const sides = wedgeFaces(10, 6, 4)
    await expect(
      planarCap(mkWP(), sides, { origin: [0, 0, 100], normal: [0, 0, 1] }),
    ).rejects.toThrow(/no boundary edges/)
  })
})
