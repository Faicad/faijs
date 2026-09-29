/**
 * ellipse sketch end-to-end (2026-09-28, fcstd-port P2-1 follow-up).
 *
 * The `ellipse` kind was previously rejected at `toFreeCadGeoms`
 * (E_SKETCHC_UNSUPPORTED_GEOM) although the whole downstream chain —
 * planegcs-backend (push/pull) and contour.ts (64-chord closed polyline) —
 * already consumed it. These tests pin the reopened path:
 * - to/from FreeCAD round-trip preserves center/radii/rotation;
 * - a solved constrained ellipse feeds extractContours into one closed loop;
 * - the projected record carries the computed foci (FreeCAD stores them).
 *
 * Run: npx vitest run src/ellipse-sketch-e2e.test.ts
 */
import { describe, it, expect } from 'vitest'
import { toFreeCadGeoms, fromFreeCadGeoms } from './project.js'
import { extractContours } from './contour.js'
import type { SketchGeom } from './canonical.js'

const ELLIPSE: SketchGeom = {
  kind: 'ellipse',
  cx: 10, cy: 5,
  rx: 20, ry: 10,
  angle: Math.PI / 4,
}

describe('ellipse sketch geometry (entry reopened)', () => {
  it('toFreeCadGeoms projects ellipse with computed foci', () => {
    const [g] = toFreeCadGeoms([ELLIPSE])
    expect(g.kind).toBe('ellipse')
    if (g.kind !== 'ellipse') return
    expect(g.cx).toBe(10)
    expect(g.cy).toBe(5)
    expect(g.majorRadius).toBe(20)
    expect(g.minorRadius).toBe(10)
    expect(g.angleXU).toBeCloseTo(Math.PI / 4, 12)
    // focal distance c = sqrt(20² − 10²) = sqrt(300)
    const c = Math.sqrt(300)
    expect(g.fx1).toBeCloseTo(10 - c * Math.cos(Math.PI / 4), 10)
    expect(g.fy1).toBeCloseTo(5 - c * Math.sin(Math.PI / 4), 10)
    expect(g.fx2).toBeCloseTo(10 + c * Math.cos(Math.PI / 4), 10)
    expect(g.fy2).toBeCloseTo(5 + c * Math.sin(Math.PI / 4), 10)
  })

  it('to/from FreeCAD round-trip preserves the canonical ellipse', () => {
    const [back] = fromFreeCadGeoms(toFreeCadGeoms([ELLIPSE]))
    expect(back.kind).toBe('ellipse')
    if (back.kind !== 'ellipse') return
    expect(back.cx).toBe(10)
    expect(back.cy).toBe(5)
    expect(back.rx).toBe(20)
    expect(back.ry).toBe(10)
    expect(back.angle).toBeCloseTo(Math.PI / 4, 12)
  })

  it('solved ellipse feeds extractContours into one closed loop', () => {
    const projected = toFreeCadGeoms([ELLIPSE])
    const contours = extractContours(projected)
    expect(contours.length).toBe(1)
    expect(contours[0]!.closed).toBe(true)
    // 64-chord sampling: 64 segments
    expect(contours[0]!.segments.length).toBe(64)
    // the chord run starts and ends on the ellipse: first point at t=0 is
    // (cx + rx·cosθ, cy + rx·sinθ) for the major-axis rotation
    const s0 = contours[0]!.segments[0]!
    expect(s0.x1).toBeCloseTo(10 + 20 * Math.cos(Math.PI / 4), 6)
    expect(s0.y1).toBeCloseTo(5 + 20 * Math.sin(Math.PI / 4), 6)
  })
})

describe('point sketch geometry (entry reopened 2026-09-28)', () => {
  const PT: SketchGeom = { kind: 'point', x: 3, y: 7 }

  it('toFreeCadGeoms projects point with z=0 (planar sketch plane)', () => {
    const [g] = toFreeCadGeoms([PT])
    expect(g).toMatchObject({ kind: 'point', index: 0, x: 3, y: 7, z: 0 })
  })

  it('to/from FreeCAD round-trip preserves the canonical point', () => {
    const [back] = fromFreeCadGeoms(toFreeCadGeoms([PT]))
    expect(back).toEqual({ kind: 'point', x: 3, y: 7 })
  })

  it('standalone points produce NO contours (no profile use)', () => {
    expect(extractContours(toFreeCadGeoms([PT]))).toEqual([])
  })
})
