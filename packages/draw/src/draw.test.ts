/**
 * draw package tests — the fluent `cad.draw` entry and its primitives.
 * Verifies that sessions close into a `Blueprint` and that the factory
 * namespace builds valid contours ready for placement.
 */

import { describe, it, expect } from 'vitest'
import { draw, rectangle, circle, ellipse, polygon, roundedRectangle } from './index'
import { type Curve2dObj } from '@faicad/faijs/geometry2d'

function curveCount(bp: { curves: readonly Curve2dObj[] }): number {
  return bp.curves.length
}

describe('draw session', () => {
  it('closes a chained session into a Blueprint with the drawn curves', () => {
    const bp = draw((pen) => pen.hLine(10).vLine(10).hLine(-10).vLineTo(0))
    expect(curveCount(bp)).toBe(4)
  })
})

describe('draw factory namespace', () => {
  it('rectangle produces 4 straight sides', () => {
    const bp = rectangle(20, 10)
    expect(curveCount(bp)).toBe(4)
    for (const c of bp.curves) expect(c.kind2d).toBe('line')
  })

  it('circle produces a single full-circle contour', () => {
    const bp = circle(5)
    expect(curveCount(bp)).toBe(1)
    expect(bp.curves[0]!.kind2d).toBe('circle')
  })

  it('ellipse produces a single full-ellipse contour with the given radii', () => {
    const bp = ellipse(6, 3, [1, 2], 0)
    expect(curveCount(bp)).toBe(1)
    const e = bp.curves[0]!
    if (e.kind2d !== 'ellipse') throw new Error(`expected ellipse, got ${e.kind2d}`)
    expect(e.cx).toBe(1)
    expect(e.cy).toBe(2)
    expect(e.majorRadius).toBe(6)
    expect(e.minorRadius).toBe(3)
  })

  it('ellipse is reachable via the draw namespace', () => {
    expect(draw.ellipse(4, 2).curves[0]!.kind2d).toBe('ellipse')
  })

  it('polygon produces the requested number of sides', () => {
    expect(curveCount(polygon(10, 6))).toBe(6)
    expect(curveCount(polygon(10, 3, 2))).toBe(3)
  })

  it('roundedRectangle produces arcs + lines', () => {
    const bp = roundedRectangle(20, 10, 3)
    const kinds = bp.curves.map((c) => c.kind2d)
    expect(kinds.filter((k) => k === 'trimmed')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'line')).toHaveLength(4)
  })

  it('is accessible both via the draw callable and its properties', () => {
    const fromCallable = draw.rectangle(20, 10)
    const fromFactory = rectangle(20, 10)
    expect(fromCallable.curves).toHaveLength(fromFactory.curves.length)
  })
})