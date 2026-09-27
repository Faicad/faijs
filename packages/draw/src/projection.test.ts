/**
 * projection tests — 3D outline → 2D Blueprint (C4).
 * Verifies the projection is the exact inverse of core's `liftPointToPlane` and
 * that a projected face outline carries the expected 2D extent.
 */

import { describe, it, expect } from 'vitest'
import { drawProjection, drawFaceOutline, projectPointToPlane, projectWire } from './index'
import type { Curve2dObj } from '@faicad/faijs/geometry2d'
import { namedPlane, liftPointToPlane, type Vec3 } from '@faicad/faijs/geometry2d/bridge/plane'

/** A 3×4 rectangle sitting in the XY plane at z=0. */
const RECT: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 20, y: 0, z: 0 },
  { x: 20, y: 10, z: 0 },
  { x: 0, y: 10, z: 0 },
]

/** Max |x2-y1|-type extent over the line segments of a line contour. */
function extent(bp: { curves: readonly Curve2dObj[] }): { w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const c of bp.curves) {
    if (c.kind2d !== 'line') continue
    const x1 = c.ox, y1 = c.oy
    const x2 = c.ox + c.dx * c.len, y2 = c.oy + c.dy * c.len
    minX = Math.min(minX, x1, x2)
    maxX = Math.max(maxX, x1, x2)
    minY = Math.min(minY, y1, y2)
    maxY = Math.max(maxY, y1, y2)
  }
  return { w: maxX - minX, h: maxY - minY }
}

describe('projectPointToPlane', () => {
  it('is the exact inverse of liftPointToPlane (roundtrip)', () => {
    const plane = namedPlane('XY')
    const lifts = [0, 0, 3, 5, -2, 7.5]
    for (let i = 0; i < lifts.length; i += 2) {
      const p = liftPointToPlane(plane, lifts[i]!, lifts[i + 1]!)
      const [px, py] = projectPointToPlane(plane, p)
      expect(px).toBeCloseTo(lifts[i]!, 12)
      expect(py).toBeCloseTo(lifts[i + 1]!, 12)
    }
  })

  it('maps a on-plane 3D wire to 2D frame coordinates', () => {
    const plane = namedPlane('XY')
    const pts = projectWire(plane, RECT)
    expect(pts).toHaveLength(4)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[2]).toEqual([20, 10])
  })
})

describe('drawFaceOutline / drawProjection', () => {
  it('projects a face outline onto the XY plane at its 2D extent', () => {
    const bp = drawFaceOutline('XY', RECT)
    expect(bp.curves).toHaveLength(4)
    const { w, h } = extent(bp)
    expect(w).toBeCloseTo(20, 6)
    expect(h).toBeCloseTo(10, 6)
  })

  it('drawProjection plots each wire as a closed contour', () => {
    const outer: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
    ]
    const bp = drawProjection('XY', [outer])
    expect(bp.curves).toHaveLength(4)
  })

  it('an XZ-frame projection preserves the in-plane shape (2D y → world Z)', () => {
    const plane = namedPlane('XZ')
    // A 20×10 rectangle living in the XZ plane (world y=0): 2D y is the world Z.
    const xzRect: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
      { x: 20, y: 0, z: 10 },
      { x: 0, y: 0, z: 10 },
    ]
    const bp = drawFaceOutline(plane, xzRect)
    const { w, h } = extent(bp)
    expect(w).toBeCloseTo(20, 6)
    expect(h).toBeCloseTo(10, 6)
  })
})