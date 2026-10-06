/**
 * boolean-union collinear/splice (D1) tests.
 *
 * Classic booleans must stay correct when the two inputs share a boundary
 * edge (collinear, zero-area touch) — the case where even-odd point-in-contour
 * would classify a shared-seam midpoint as "inside" and leave a degenerate
 * dangling loop. A collinear-splice pass on the assembled loops (merge
 * collinear interior vertices, drop zero-area loops) plus an empty-intersection
 * short-circuit in difference keeps union/intersection/difference correct.
 *
 * Cases:
 * - union of two edge-adjacent squares ⇒ the merged rectangle (one 4-gon);
 * - intersection of two edge-adjacent squares ⇒ empty (they only touch);
 * - difference of a wide strip minus an edge-adjacent strip ⇒ the wide strip.
 */
import { describe, expect, it } from 'vitest'
import { booleanUnion2d, booleanIntersect2d, booleanDifference2d } from '../../src/ops/boolean-union'
import type { Point2d } from '../../src/ops/custom-corners'

const area = (pts: Point2d[]): number => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}
const totalArea = (loops: Point2d[][]): number => loops.reduce((m, L) => m + area(L), 0)

// L occupies x∈[-4,0], y∈[0,4] (area 16); R the strip x∈[0,1] (area 4).
const L: Point2d[] = [[-4, 0], [0, 0], [0, 4], [-4, 4]]
const R: Point2d[] = [[0, 0], [1, 0], [1, 4], [0, 4]]

describe('union', () => {
  it('two edge-adjacent squares merge into one clean rectangle', () => {
    const loops = booleanUnion2d(L, R)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toHaveLength(4) // collinear seam points merged away
    expect(totalArea(loops)).toBeCloseTo(20, 6) // merged rectangle x∈[-4,1] × y∈[0,4] = 20
  })
})

describe('intersection', () => {
  it('edge-adjacent squares have empty intersection (zero overlap area)', () => {
    const loops = booleanIntersect2d(L, R)
    expect(loops).toHaveLength(0)
  })
})

describe('difference', () => {
  it('edge-adjacent subtractor leaves the base unchanged (=A)', () => {
    const loops = booleanDifference2d(L, R)
    expect(loops).toHaveLength(1)
    expect(totalArea(loops)).toBeCloseTo(16, 6) // area of L
  })
})