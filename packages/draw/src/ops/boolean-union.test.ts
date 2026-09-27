/**
 * boolean-union (D1) tests — booleanUnion2d / booleanIntersect2d.
 *
 * Pure TS, no kernel. Two overlapping CCW squares: A = [0,4]², B = [2,6]².
 * Union is the L-shaped 8-vertex staircase (area 28); the intersection is the
 * [2,4]² overlap (area 4). All asserts compare the signed area so they are
 * insensitive to loop start/rotation.
 */
import { describe, expect, it } from 'vitest'
import { booleanUnion2d, booleanIntersect2d } from './boolean-union'
import type { Point2d } from './custom-corners'

const area = (pts: Point2d[]): number => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

const A: Point2d[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]
const B: Point2d[] = [
  [2, 2],
  [6, 2],
  [6, 6],
  [2, 6],
]

describe('booleanUnion2d', () => {
  it('merged two overlapping squares into one 8-corner loop', () => {
    const loops = booleanUnion2d(A, B)
    expect(loops).toHaveLength(1)
    const loop = loops[0]!
    expect(loop.length).toBe(8)
    expect(area(loop)).toBeCloseTo(28, 6)
  })

  it('left the not-included quadrant', () => {
    const loop = booleanUnion2d(A, B)[0]!
    const xs = loop.map((p) => p[0])
    const ys = loop.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(6, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(6, 6)
  })
})

describe('booleanIntersect2d', () => {
  it('keeps the overlapping square', () => {
    const loops = booleanIntersect2d(A, B)
    expect(loops).toHaveLength(1)
    const loop = loops[0]!
    expect(loop.length).toBe(4)
    expect(area(loop)).toBeCloseTo(4, 6)
  })
})