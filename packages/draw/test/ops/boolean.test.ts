/**
 * boolean-helpers (D1) tests — pointInContour + segmentIntersection.
 *
 * Pure TS, no kernel. Pins inside/outside classification on a square and an
 * L-shaped non-convex contour, and segment-cross cases (proper, disjoint,
 * parallel, shared endpoint).
 */
import { describe, expect, it } from 'vitest'
import { pointInContour, segmentIntersection } from '../../src/ops/boolean'
import type { Point2d } from '../../src/ops/custom-corners'

const square: Point2d[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

describe('pointInContour', () => {
  it('classifies points inside/outside a square', () => {
    expect(pointInContour([2, 2], square)).toBe(true)
    expect(pointInContour([5, 5], square)).toBe(false)
    expect(pointInContour([2, -1], square)).toBe(false)
    expect(pointInContour([-0.5, 2], square)).toBe(false)
  })

  it('classifies points against a non-convex L contour', () => {
    const l: Point2d[] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ]
    expect(pointInContour([1, 1], l)).toBe(true) // bottom-left column
    expect(pointInContour([1, 3], l)).toBe(true) // top-left column
    expect(pointInContour([3, 1], l)).toBe(true) // bottom strip
    expect(pointInContour([3, 3], l)).toBe(false) // top-right notch
  })
})

describe('segmentIntersection', () => {
  it('finds the crossing point of two diagonals', () => {
    const r = segmentIntersection([0, 0], [4, 4], [0, 4], [4, 0])!
    expect(r).toBeTruthy()
    expect(r.point[0]).toBeCloseTo(2, 9)
    expect(r.point[1]).toBeCloseTo(2, 9)
    expect(r.t).toBeCloseTo(0.5, 9)
    expect(r.u).toBeCloseTo(0.5, 9)
  })

  it('returns null for disjoint and parallel segments', () => {
    expect(segmentIntersection([0, 0], [1, 0], [2, 1], [3, 1])).toBeNull()
    expect(segmentIntersection([0, 0], [1, 1], [0, 2], [1, 2])).toBeNull() // parallel, disjoint
  })

  it('reports a shared-endpoint touch at the end of the first segment', () => {
    const r = segmentIntersection([0, 0], [2, 0], [2, 0], [2, 2])!
    expect(r).toBeTruthy()
    expect(r.point[0]).toBeCloseTo(2, 9)
    expect(r.point[1]).toBeCloseTo(0, 9)
    expect(r.t).toBeCloseTo(1, 9)
    expect(r.u).toBeCloseTo(0, 9)
  })
})