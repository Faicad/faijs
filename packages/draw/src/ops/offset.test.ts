/**
 * offsetOutline2d (D2) tests — miter parallel offset of a convex square.
 *
 * Pure TS, no kernel. Pins the outward and inward offset of an axis-aligned CCW
 * square exactly.
 */
import { describe, expect, it } from 'vitest'
import { offsetOutline2d } from './offset'
import type { Point2d } from './custom-corners'

const closePt = (p: [number, number], x: number, y: number, eps = 1e-9) => {
  expect(Math.abs(p[0] - x)).toBeLessThan(eps)
  expect(Math.abs(p[1] - y)).toBeLessThan(eps)
}

// CCW square with corners (1,1),(3,1),(3,3),(1,3); offset happens on outward normals.
const square: Point2d[] = [
  [1, 1],
  [3, 1],
  [3, 3],
  [1, 3],
]

describe('offsetOutline2d', () => {
  it('grows a square outward by miter', () => {
    const out = offsetOutline2d(square, 0.5)
    expect(out).toHaveLength(4)
    closePt(out[0]!, 0.5, 0.5)
    closePt(out[1]!, 3.5, 0.5)
    closePt(out[2]!, 3.5, 3.5)
    closePt(out[3]!, 0.5, 3.5)
  })

  it('shrinks a square inward with a negative offset', () => {
    const out = offsetOutline2d(square, -0.25)
    expect(out).toHaveLength(4)
    closePt(out[0]!, 1.25, 1.25)
    closePt(out[1]!, 2.75, 1.25)
    closePt(out[2]!, 2.75, 2.75)
    closePt(out[3]!, 1.25, 2.75)
  })

  it('zero offset returns a copy of the input', () => {
    const out = offsetOutline2d(square, 0)
    expect(out).toHaveLength(4)
    out.forEach((p, i) => closePt(p, square[i]![0], square[i]![1]))
  })

  it('edge cases: empty and single-point outlines', () => {
    expect(offsetOutline2d([], 1)).toEqual([])
    const one = offsetOutline2d([[2, 2]], 1)
    expect(one).toHaveLength(1)
    closePt(one[0]!, 2, 2)
  })
})