/**
 * C2 canned-shape tests — the pen-driven `Blueprint` factories that feed the
 * placement pipeline. Verifies contour shape/count/closure for each factory.
 */

import { describe, it, expect } from 'vitest'
import { polysidesBlueprint, roundedRectangleBlueprint } from './canned-blueprints'
import { evaluateCurve2d, curveBounds, type Curve2dObj } from './curve2d'

function curveCount(bp: { curves: Curve2dObj[] }): number {
  return bp.curves.length
}

/** End point of the contour's last curve. */
function contourEnd(bp: { curves: Curve2dObj[] }): [number, number] {
  const last = bp.curves[bp.curves.length - 1]!
  const { last: t } = curveBounds(last)
  return evaluateCurve2d(last, t)
}

/** Start point of the contour's first curve. */
function contourStart(bp: { curves: Curve2dObj[] }): [number, number] {
  const first = bp.curves[0]!
  const { first: t } = curveBounds(first)
  return evaluateCurve2d(first, t)
}

/** Assert the contour is closed (last end == first start). */
function expectClosed(bp: { curves: Curve2dObj[] }, eps = 1e-9): void {
  const s = contourStart(bp)
  const e = contourEnd(bp)
  expect(Math.abs(e[0] - s[0])).toBeLessThan(eps)
  expect(Math.abs(e[1] - s[1])).toBeLessThan(eps)
}

describe('polysidesBlueprint', () => {
  it('builds a 6-gon (hexagon) register closed on the circumcircle', () => {
    const bp = polysidesBlueprint(10, 6)
    expect(curveCount(bp)).toBe(6)
    for (const c of bp.curves) expect(c.kind2d).toBe('line')
    // every segment start lies on the circumscribed circle (radius 10)
    for (const c of bp.curves) {
      const { first: t } = curveBounds(c)
      const p = evaluateCurve2d(c, t)
      expect(Math.abs(Math.hypot(p[0], p[1]) - 10)).toBeLessThan(1e-9)
    }
    expectClosed(bp)
  })

  it('uses sagitta arcs when sagitta is non-zero', () => {
    const bp = polysidesBlueprint(10, 3, 2)
    expect(curveCount(bp)).toBe(3)
    expect(bp.curves[0]!.kind2d).toBe('trimmed')
  })
})

describe('roundedRectangleBlueprint', () => {
  it('sharp rectangle has 4 straight sides and closes', () => {
    const bp = roundedRectangleBlueprint(20, 10)
    expect(curveCount(bp)).toBe(4)
    for (const c of bp.curves) expect(c.kind2d).toBe('line')
    expectClosed(bp)
  })

  it('circular rounded corners produce 4 arcs + 4 lines and close', () => {
    const bp = roundedRectangleBlueprint(20, 10, 3)
    const kinds = bp.curves.map((c) => c.kind2d)
    expect(kinds.filter((k) => k === 'trimmed')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'line')).toHaveLength(4)
    expectClosed(bp)
  })

  it('elliptical corners use an ellipse basis', () => {
    const bp = roundedRectangleBlueprint(20, 10, { rx: 4, ry: 2 })
    const arcs = bp.curves.filter((c) => c.kind2d === 'trimmed')
    expect(arcs).toHaveLength(4)
    for (const a of arcs) {
      expect((a as { basis: Curve2dObj }).basis.kind2d).toBe('ellipse')
    }
  })
})