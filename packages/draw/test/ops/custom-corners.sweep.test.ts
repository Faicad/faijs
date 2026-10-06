/**
 * custom-corners full-angle sweep (D3) tests.
 *
 * GOTCHA (kept as a regression guard): the D3 primitives originally only
 * covered the 90° corner. Driving fillet/chamfer across the full corner sweep
 * surfaced that on a sharp (acute) corner the fillet tangent points sit back
 * `radius·cot(θ/2)` along each segment — a reach that can exceed the adjacent
 * edge and push a tangent off the boundary. Fillet radius (and chamfer inset)
 * are clamped to the largest value that keeps both tangent points on their
 * edges, so an over-large radius never yields a tangent beyond a vertex.
 */
import { describe, expect, it } from 'vitest'
import { evaluateCurve2d, curveBounds, type Curve2dObj } from '@faicad/faijs/geometry2d'
import { chamfer2d, fillet2d, type Point2d } from '../../src/ops/custom-corners'

const dist = (a: Point2d, b: Point2d) => Math.hypot(a[0] - b[0], a[1] - b[1])
const eps = 1e-9
/** Corner at origin; `p=(L,0)`; `q` at `deg` from +x. */
function cornerAt(deg: number, L = 10): { corner: Point2d; p: Point2d; q: Point2d } {
  const t = (deg * Math.PI) / 180
  return { corner: [0, 0], p: [L, 0], q: [L * Math.cos(t), L * Math.sin(t)] }
}
/** Average distance from `center` to three points spread along the curve's domain. */
function effectiveRadius(c: Curve2dObj, center: Point2d): number {
  const b = curveBounds(c)
  const a0 = evaluateCurve2d(c, b.first)
  const am = evaluateCurve2d(c, (b.first + b.last) / 2)
  const a1 = evaluateCurve2d(c, b.last)
  return (dist(center, a0) + dist(center, am) + dist(center, a1)) / 3
}

const L = 10
const ANGLES = [35, 90, 150, 179, 200]

describe('fillet2d full-angle sweep (D3)', () => {
  it('tangent points always lie on both adjacent segments across the sweep', () => {
    for (const deg of ANGLES) {
      const st = cornerAt(deg)
      const f = fillet2d(st.corner, st.p, st.q, 2)
      expect(dist(st.corner, f.tangent)).toBeLessThanOrEqual(L + eps)
      expect(dist(st.corner, f.tangent2)).toBeLessThanOrEqual(L + eps)
    }
  })

  it('draws a clean circular arc on the requested radius when it fits (right corner)', () => {
    const st = cornerAt(90)
    const f = fillet2d(st.corner, st.p, st.q, 2)
    close(f.tangent, 2, 0)
    close(f.tangent2, 0, 2)
    expect(f.radius).toBe(2)
    expect(dist(f.center, f.tangent)).toBeCloseTo(2, 9)
    expect(dist(f.center, f.tangent2)).toBeCloseTo(2, 9)
  })

  it('an obtuse and near-straight corner keep radius and on-segment tangents', () => {
    for (const deg of [150, 179]) {
      const st = cornerAt(deg)
      const f = fillet2d(st.corner, st.p, st.q, 2)
      expect(f.radius).toBeCloseTo(2, 9)
      expect(effectiveRadius(f.corner, f.center)).toBeCloseTo(2, 5)
    }
  })

  it('a sharp (10°) corner where the fit reach exceeds the edge clamps to the edge', () => {
    const st = cornerAt(10, L)
    const f = fillet2d(st.corner, st.p, st.q, 2)
    // Clamped so the tangent sits exactly at the segment rim: radius = min-edge·tan(θ/2).
    expect(f.radius).toBeCloseTo(L * Math.tan((10 * Math.PI) / 360), 5)
    expect(dist(st.corner, f.tangent)).toBeCloseTo(L, 5) // tangent reaches (but never passes) p
    expect(dist(st.corner, f.tangent2)).toBeCloseTo(L, 5)
    expect(effectiveRadius(f.corner, f.center)).toBeCloseTo(f.radius, 5)
  })

  it('zero radius collapses the fillet to the corner', () => {
    const st = cornerAt(90)
    const f = fillet2d(st.corner, st.p, st.q, 0)
    close(f.tangent, 0, 0)
    close(f.tangent2, 0, 0)
    expect(f.radius).toBe(0)
  })
})

describe('chamfer2d full-angle sweep (D3)', () => {
  it('an inset bigger than the edge clamps so cut points stay on the boundary', () => {
    const st = cornerAt(90)
    const c = chamfer2d(st.corner, st.p, st.q, 200)
    expect(dist(st.corner, c.tangent)).toBeCloseTo(L, 9)
    expect(dist(st.corner, c.tangent2)).toBeCloseTo(L, 9)
  })

  it('a negative inset clamps to zero (no cut) without throwing', () => {
    const st = cornerAt(90)
    const c = chamfer2d(st.corner, st.p, st.q, -4)
    expect(dist(st.corner, c.tangent)).toBe(0)
    expect(dist(st.corner, c.tangent2)).toBe(0)
  })
})

function close(p: [number, number], x: number, y: number) {
  expect(Math.abs(p[0] - x)).toBeLessThan(eps)
  expect(Math.abs(p[1] - y)).toBeLessThan(eps)
}
