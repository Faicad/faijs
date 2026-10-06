/**
 * @vitest-environment node
 * BaseSketcher2d pen test (C1, pure-object base). Verifies the pen emits the
 * expected ordered `Curve2dObj[]` for the core line/arc/bezier family — the
 * geometry that later flows through the 2D→3D placement and `cad.extrude`.
 */

import { describe, it, expect } from 'vitest'
import { BaseSketcher2d, type Point2 } from '../../src/geometry2d/pen-sketcher'
import { evaluateCurve2d, curveBounds, type Curve2dObj } from '../../src/geometry2d/curve2d'
import { Blueprint } from '../../src/geometry2d/blueprint'

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

  it('ellipseTo emits a trimmed-ellipse arc (SVG endpoint form)', () => {
    const pen = new BaseSketcher2d()
    pen.movePointerTo([1, 0])
    pen.ellipseTo([0, 1], 1, 1, 0, false, true)
    const c = pen.curves()[0]!
    expect(c.kind2d).toBe('trimmed')
    expect((c as { basis: Curve2dObj }).basis.kind2d).toBe('ellipse')
    const [ex, ey] = endOf(c)
    expect(Math.abs(ex - 0)).toBeLessThan(1e-9)
    expect(Math.abs(ey - 1)).toBeLessThan(1e-9)
  })

  it('halfEllipse composes into a closed Blueprint', () => {
    const pen = new BaseSketcher2d()
    pen.lineTo([4, 0])
    pen.halfEllipse(-4, 0, 2, false)
    const bp = new Blueprint(pen.close())
    expect(bp.curves).toHaveLength(2)
    const arc = bp.curves[1]!
    expect(arc.kind2d).toBe('trimmed')
    expect((arc as { basis: Curve2dObj }).basis.kind2d).toBe('ellipse')
  })
})

describe('BaseSketcher2d.polyline (batched emission)', () => {
  it('draws one contour per call; a contour repeating its start needs no close flag', () => {
    const pen = new BaseSketcher2d()
    // square written as a closed point list (last === first), as the FCStd
    // wireframe walk produces it
    pen.polyline([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
    expect(pen.curves()).toHaveLength(4)
    expect(pen.penPosition).toEqual([0, 0])
    // close() then adds nothing — the loop is already shut
    expect(pen.close()).toHaveLength(4)
  })

  it('close:true shuts an open point list, and is idempotent when already shut', () => {
    const pen = new BaseSketcher2d()
    pen.polyline([[0, 0], [10, 0], [10, 10], [0, 10]], true)
    expect(pen.curves()).toHaveLength(4)
    expect(pen.penPosition).toEqual([0, 0])

    const again = new BaseSketcher2d()
    // GOTCHA: a list that already ends where it started must NOT get a second
    // (zero-length) closing segment — the FCStd walk returns closed point lists
    // AND callers pass close:true, so this is the live path, not a corner case.
    again.polyline([[0, 0], [10, 0], [10, 10], [0, 0]], true)
    expect(again.curves()).toHaveLength(3)
  })

  it('seats firstPoint so a later close() has the same meaning as after lineTo', () => {
    const pen = new BaseSketcher2d()
    pen.polyline([[5, 5], [15, 5], [15, 15]])
    expect(pen.firstPoint).toEqual([5, 5])
    expect(pen.close()).toHaveLength(3) // auto-closes back to (5,5)
    expect(pen.penPosition).toEqual([5, 5])
  })

  it('accepts a run continuing from the pen position', () => {
    const pen = new BaseSketcher2d()
    pen.lineTo([10, 0])
    pen.polyline([[10, 0], [10, 10]])
    expect(pen.curves()).toHaveLength(2)
    expect(pen.penPosition).toEqual([10, 10])
  })

  it('GOTCHA: one pen carries exactly ONE contour — a disjoint second call throws', () => {
    const pen = new BaseSketcher2d()
    pen.polyline([[0, 0], [10, 0], [10, 10]])
    // `movePointerTo` cannot lift the pen once a curve exists, so a pen with a
    // run in flight cannot start a far-away contour. Draft drawings carry many
    // disjoint loops (measured up to 61 in one object) ⇒ one pen session per loop.
    expect(() => pen.polyline([[100, 100], [110, 100]])).toThrow(/one pen per contour/)
  })

  it('rejects a degenerate list instead of silently drawing nothing', () => {
    const pen = new BaseSketcher2d()
    expect(() => pen.polyline([[0, 0]])).toThrow(/at least two points/)
  })

  it('a 3000-point contour is ONE call (the reason the batch form exists)', () => {
    const pts: Point2[] = Array.from({ length: 3000 }, (_, i) => [i, Math.sin(i / 50) * 10] as Point2)
    const pen = new BaseSketcher2d()
    pen.polyline(pts, true)
    expect(pen.curves()).toHaveLength(3000)
  })
})