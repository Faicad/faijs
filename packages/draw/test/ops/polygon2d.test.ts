/**
 * polygon2d (D2) tests — polygonSignedArea / isSimplePolygon / segmentsProperlyCross.
 *
 * Pure TS, no kernel. Pins shoelace sign, proper-crossing classification, and the
 * simplicity test used by the offset self-intersection prune.
 */
import { describe, expect, it } from 'vitest'
import { polygonSignedArea, isSimplePolygon, segmentsProperlyCross, decomposeSelfIntersections, pruneSelfIntersections } from '../../src/ops/polygon2d'
import type { Point2d } from '../../src/ops/custom-corners'

const CCW_SQ: Point2d[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

describe('polygonSignedArea', () => {
  it('is positive for a counter-clockwise square', () => {
    expect(polygonSignedArea(CCW_SQ)).toBeCloseTo(16, 9)
  })

  it('is negative for a clockwise rewinding', () => {
    expect(polygonSignedArea([...CCW_SQ].reverse())).toBeCloseTo(-16, 9)
  })
})

describe('segmentsProperlyCross', () => {
  it('detects a transversal crossing', () => {
    expect(segmentsProperlyCross([0, 0], [4, 4], [0, 4], [4, 0])).toBe(true)
  })

  it('rejects parallel, disjoint, and endpoint-touching pairs', () => {
    expect(segmentsProperlyCross([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false)
    expect(segmentsProperlyCross([0, 0], [4, 0], [2, 2], [4, 2])).toBe(false)
    expect(segmentsProperlyCross([0, 0], [2, 0], [2, 0], [2, 2])).toBe(false)
  })
})

describe('isSimplePolygon', () => {
  it('accepts a convex square', () => {
    expect(isSimplePolygon(CCW_SQ)).toBe(true)
  })

  it('rejects a self-crossing bowtie', () => {
    const bowtie: Point2d[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]
    expect(isSimplePolygon(bowtie)).toBe(false)
  })
})

describe('pruneSelfIntersections', () => {
  it('passes a simple polygon through unchanged', () => {
    const loops = pruneSelfIntersections(CCW_SQ)
    expect(loops).toHaveLength(1)
    expect(polygonSignedArea(loops[0]!)).toBeCloseTo(16, 9)
  })

  it('splits a self-crossing bowtie into its single positive lobe', () => {
    const bowtie: Point2d[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]
    expect(decomposeSelfIntersections(bowtie)).toHaveLength(2)
    const loops = pruneSelfIntersections(bowtie)
    expect(loops).toHaveLength(1)
    expect(polygonSignedArea(loops[0]!)).toBeCloseTo(4, 9)
  })
})