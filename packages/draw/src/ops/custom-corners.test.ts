/**
 * custom-corners (D3) tests — chamfer2d + fillet2d on axis-aligned corners.
 *
 * Pure TS, no WASM. Verifies the spliced boundary curves and the fillet's
 * center/radius geometry for the unit 90° case and a mirror (4th-quadrant) case.
 */
import { describe, expect, it } from 'vitest'
import { evaluateCurve2d, curveBounds, type Curve2dObj } from '@faicad/faijs/geometry2d'
import { chamfer2d, fillet2d, type Point2d } from './custom-corners'

const closePt = (p: [number, number], x: number, y: number, eps = 1e-9) => {
  expect(Math.abs(p[0] - x)).toBeLessThan(eps)
  expect(Math.abs(p[1] - y)).toBeLessThan(eps)
}
const dist = (a: Point2d, b: Point2d) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** Evaluate a curve at its two domain endpoints. */
const ends = (c: Curve2dObj) => {
  const b = curveBounds(c)
  return [evaluateCurve2d(c, b.first), evaluateCurve2d(c, b.last)] as [[number, number], [number, number]]
}

describe('chamfer2d', () => {
  it('chops a 90° corner into retained segments + a straight edge', () => {
    const { first, corner, second, tangent, tangent2 } = chamfer2d([0, 0], [10, 0], [0, 10], 2)
    closePt(tangent, 2, 0)
    closePt(tangent2, 0, 2)
    const e1 = ends(first)
    closePt(e1[0], 10, 0) // retained segment starts at p
    closePt(e1[1], 2, 0) // ... ends at the tangent point
    const ec = ends(corner)
    closePt(ec[0], 2, 0) // chamfer edge (2,0)→(0,2)
    closePt(ec[1], 0, 2)
    const e2 = ends(second)
    closePt(e2[0], 0, 2) // retained second segment (0,2)→(0,10)
    closePt(e2[1], 0, 10)
  })

  it('the chamfer edge length is inset*sqrt(2) for a right corner', () => {
    const { tangent, tangent2 } = chamfer2d([0, 0], [10, 0], [0, 10], 3)
    expect(dist(tangent, tangent2)).toBeCloseTo(3 * Math.SQRT2, 9)
  })
})

describe('fillet2d', () => {
  it('fillets a 90° corner with tangent points and center on the bisector', () => {
    const f = fillet2d([0, 0], [10, 0], [0, 10], 2)
    closePt(f.tangent, 2, 0)
    closePt(f.tangent2, 0, 2)
    closePt(f.center, 2, 2, 1e-6)
    expect(f.radius).toBe(2)
    expect(dist(f.center, f.tangent)).toBeCloseTo(2, 9)
    expect(dist(f.center, f.tangent2)).toBeCloseTo(2, 9)
  })

  it('the fillet arc stays on radius r and spans the two tangent points', () => {
    const f = fillet2d([0, 0], [10, 0], [0, 10], 2)
    const a0 = evaluateCurve2d(f.corner, 0) as [number, number]
    const aMid = evaluateCurve2d(f.corner, 0.5) as [number, number]
    const a1 = evaluateCurve2d(f.corner, 1) as [number, number]
    closePt(a0, 2, 0, 1e-6)
    closePt(a1, 0, 2, 1e-6)
    expect(dist(f.center, a0)).toBeCloseTo(2, 6)
    expect(dist(f.center, aMid)).toBeCloseTo(2, 6)
    expect(dist(f.center, a1)).toBeCloseTo(2, 6)
  })

  it('fillets the mirrored quadrant corner', () => {
    const f = fillet2d([0, 0], [-10, 0], [0, -10], 2)
    closePt(f.tangent, -2, 0)
    closePt(f.tangent2, 0, -2)
    expect(dist(f.center, f.tangent)).toBeCloseTo(2, 9)
    expect(dist(f.center, f.tangent2)).toBeCloseTo(2, 9)
  })
})