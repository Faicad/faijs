import { describe, expect, it } from 'vitest'
import { evaluateCurve2d, type Curve2dObj } from './curve2d'
import { makeEllipseArcFromSvgParams, normalizeEllipseRadii } from './svg-ellipse'

function near(a: [number, number], b: [number, number], eps = 1e-9): void {
  expect(Math.abs(a[0] - b[0])).toBeLessThan(eps)
  expect(Math.abs(a[1] - b[1])).toBeLessThan(eps)
}

function sample(c: Curve2dObj, t: number): [number, number] {
  return evaluateCurve2d(c, t)
}

describe('normalizeEllipseRadii', () => {
  it('keeps major axis horizontal when h >= v', () => {
    expect(normalizeEllipseRadii(5, 3, 0)).toEqual({ majorRadius: 5, minorRadius: 3, rotationAngle: 0 })
  })
  it('swaps radii and adds 90 when h < v', () => {
    expect(normalizeEllipseRadii(3, 5, 10)).toEqual({ majorRadius: 5, minorRadius: 3, rotationAngle: 100 })
  })
})

describe('makeEllipseArcFromSvgParams', () => {
  it('sweeps a clockwise quadrant from (1,0) to (0,1) on the unit circle', () => {
    const arc = makeEllipseArcFromSvgParams([1, 0], [0, 1], 1, 1, 0, false, true)
    expect(arc.kind2d).toBe('trimmed')
    const basis = (arc as { basis: Curve2dObj }).basis
    expect(basis.kind2d).toBe('ellipse')
    near(sample(arc, 0), [1, 0])
    near(sample(arc, 1), [0, 1])
  })

  it('mid-parameter lands on the ellipse between start and end', () => {
    const arc = makeEllipseArcFromSvgParams([1, 0], [0, 1], 1, 1.5, 0, false, true)
    near(sample(arc, 0), [1, 0])
    near(sample(arc, 1), [0, 1])
    const mid = sample(arc, 0.5)
    const d = Math.hypot(mid[0], mid[1])
    expect(d).toBeGreaterThan(0.5)
    expect(d).toBeLessThan(2)
  })
})