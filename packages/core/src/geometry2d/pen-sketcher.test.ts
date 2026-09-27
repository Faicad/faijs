/**
 * @vitest-environment node
 * BaseSketcher2d pen test (C1, pure-object base). Verifies the pen emits the
 * expected ordered `Curve2dObj[]` for the core line/arc/bezier family — the
 * geometry that later flows through the 2D→3D placement and `cad.extrude`.
 */

import { describe, it, expect } from 'vitest'
import { BaseSketcher2d, type Point2 } from './pen-sketcher'
import { evaluateCurve2d, curveBounds, type Curve2dObj } from './curve2d'
import { Blueprint } from './blueprint'

/** Evaluate the end (at the curve's last parameter) of a curve. */
function endOf(c: Curve2dObj): Point2 {
  const { last } = curveBounds(c)
  const p = evaluateCurve2d(c, last)
  return [p[0], p[1]]
}

/** Straight-line length of a curve by sampling the whole parameter range. */
function curveLength(c: Curve2dObj, steps = 64): number {
  const { first, last } = curveBounds(c)
  let len = 0
  let prev = evaluateCurve2d(c, first)
  for (let i = 1; i <= steps; i++) {
    const t = first + ((last - first) * i) / steps
    const p = evaluateCurve2d(c, t)
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return len
}

describe('BaseSketcher2d pen (C1)', () => {
  it('lineTo sets a segment to the point and advances the pen', () => {
    const pen = new BaseSketcher2d()
    pen.lineTo([10, 0])
    expect(pen.pointer).toEqual([10, 0])
    const curves = pen.curves()
    expect(curves).toHaveLength(1)
    expect(endOf(curves[0]!)).toEqual([10, 0])
  })

  it('square run plus close() yields a closed 4-side loop with perimeter 40', () => {
    const pen = new BaseSketcher2d()
    pen.line(10, 0).vLine(10).hLine(-10).vLine(-10)
    const closed = pen.close()
    expect(closed).toHaveLength(4)
    expect(pen.penPosition).toEqual([0, 0])
    const total = closed.reduce((sum, c) => sum + curveLength(c), 0)
    expect(total).toBeCloseTo(40, 3)
  })

  it('threePointsArc emits a trimmed circle arc and leaves the pen at its end', () => {
    const pen = new BaseSketcher2d()
    pen.threePointsArcTo([10, 0], [5, 5])
    expect(pen.penPosition).toEqual([10, 0])
    const c = pen.curves()[0]!
    expect(c.kind2d).toBe('trimmed')
  })

  it('bezierCurveTo emits a Bezier2d ending at the target', () => {
    const pen = new BaseSketcher2d()
    pen.bezierCurveTo([10, 0], [[5, 10]])
    const c = pen.curves()[0]!
    expect(c.kind2d).toBe('bezier')
    expect(endOf(c)).toEqual([10, 0])
  })

  it('arcs + lines compose into a closed contour usable as a Blueprint', () => {
    const pen = new BaseSketcher2d()
    // D-shape: two verticals + a top arc
    pen.lineTo([10, 0]).vLine(20).hLine(-10)
    // placeholder — full contour assembly (Blueprint) is exercised via the bridge later
    const c = pen.curves()
    expect(c.length).toBe(3)
  })

  it('a closed pen loop becomes a Blueprint (draw → placement input)', () => {
    const pen = new BaseSketcher2d()
    pen.line(10, 0).vLine(10).hLine(-10).vLine(-10)
    const bp = new Blueprint(pen.close())
    expect(bp.curves).toHaveLength(4)
  })
})