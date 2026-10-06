/**
 * svg (D4) tests — contourToSvgPath / svgPathToContours roundtrip.
 *
 * Pure text, no kernel. Pins the exact roundtrip for polygonal contours plus
 * hand-written absolute (M/L/H/V) and relative (m/l) paths.
 */
import { describe, expect, it } from 'vitest'
import { contourToSvgPath, svgPathToContours } from '../../src/ops/svg'
import type { Point2d } from '../../src/ops/custom-corners'

const approx = (a: Point2d[], b: Point2d[]): boolean =>
  a.length === b.length && a.every((p, k) => Math.hypot(p[0] - b[k]![0], p[1] - b[k]![1]) < 1e-7)

const L: Point2d[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [6, 2],
  [6, 6],
  [2, 6],
  [2, 4],
  [0, 4],
]

describe('contourToSvgPath', () => {
  it('produces an M/L/Z path and round-trips exactly', () => {
    const d = contourToSvgPath([L])
    expect(d.startsWith('M 0 0 L 4 0 L 4 2')).toBe(true)
    const back = svgPathToContours(d)
    expect(back).toHaveLength(1)
    expect(approx(back[0]!, L)).toBe(true)
  })

  it('round-trips a pre-closed loop without duplicating the closer', () => {
    const closed = [...L, [0, 0]] as Point2d[]
    const back = svgPathToContours(contourToSvgPath([closed]))
    expect(approx(back[0]!, L)).toBe(true)
  })
})

describe('svgPathToContours', () => {
  it('reads absolute H/V commands', () => {
    const loops = svgPathToContours('M0,0 H4 V4 H0 Z')
    expect(approx(loops[0]!, [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(true)
  })

  it('reads relative commands', () => {
    const loops = svgPathToContours('m0,0 l4,0 l0,4 l-4,0 z')
    expect(approx(loops[0]!, [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(true)
  })

  it('returns multiple closed loops', () => {
    const loops = svgPathToContours('M0 0 L2 0 L2 2 L0 2 Z M4 4 L6 4 L6 6 L4 6 Z')
    expect(loops).toHaveLength(2)
    expect(approx(loops[0]!, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true)
    expect(approx(loops[1]!, [[4, 4], [6, 4], [6, 6], [4, 6]])).toBe(true)
  })
})