import { describe, expect, it } from 'vitest'
import {
  ensureCounterClockwise,
  loopInsideLoop,
  makeFaceTriangleFilter,
  point2Key,
  pointInPolygon,
  polygonArea,
  simplifyLoop,
  toMachinePoint,
  triangleBounds,
  trianglesFromMesh,
} from '../src/geometry.js'
import { makeBoxMesh } from './helpers.js'

describe('trianglesFromMesh', () => {
  it('extracts one triangle per index triplet', () => {
    const mesh = makeBoxMesh([20, 20, 10])
    const triangles = trianglesFromMesh(mesh.positions, mesh.indices)
    expect(triangles.length).toBe(12)
    for (const triangle of triangles) {
      expect(triangle.length).toBe(3)
      for (const point of triangle) expect(point.length).toBe(3)
    }
  })

  it('applies a triangle filter over triangle index', () => {
    const mesh = makeBoxMesh([20, 20, 10])
    const filtered = trianglesFromMesh(mesh.positions, mesh.indices, (t) => t % 2 === 0)
    expect(filtered.length).toBe(6)
  })
})

describe('makeFaceTriangleFilter', () => {
  it('selects triangles of a face by index', () => {
    const mesh = makeBoxMesh([20, 20, 10])
    const filter = makeFaceTriangleFilter(mesh.faceRanges, [4]) // +x face
    expect(filter).not.toBeNull()
    const selected = trianglesFromMesh(mesh.positions, mesh.indices, filter!)
    expect(selected.length).toBe(2)
    const bounds = triangleBounds(selected)!
    // +x face: x == 10
    expect(bounds.min[0]).toBe(10)
    expect(bounds.max[0]).toBe(10)
  })

  it('returns null when faceRanges are absent (boolean/imported shape)', () => {
    expect(makeFaceTriangleFilter(undefined, [0])).toBeNull()
    expect(makeFaceTriangleFilter([], [0])).toBeNull()
  })

  it('returns null when the face index is out of range', () => {
    const mesh = makeBoxMesh([20, 20, 10])
    expect(makeFaceTriangleFilter(mesh.faceRanges, [99])).toBeNull()
  })
})

describe('2D polygon primitives', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]] as Array<[number, number]>

  it('polygonArea is positive for CCW square', () => {
    expect(polygonArea(square)).toBe(100)
  })

  it('ensureCounterClockwise flips CW input', () => {
    const cw = [[0, 0], [0, 10], [10, 10], [10, 0]] as Array<[number, number]>
    const ccw = ensureCounterClockwise(cw)
    expect(polygonArea(ccw)).toBe(100)
  })

  it('simplifyLoop removes duplicate closing point and near-collinear points', () => {
    const loop = [[0, 0], [0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Array<[number, number]>
    const simplified = simplifyLoop(loop)
    expect(simplified.length).toBeLessThan(loop.length)
    expect(simplified.length).toBeGreaterThanOrEqual(3)
  })

  it('pointInPolygon handles inside/outside', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true)
    expect(pointInPolygon([15, 5], square)).toBe(false)
  })

  it('loopInsideLoop detects containment', () => {
    const inner = [[2, 2], [4, 2], [4, 4], [2, 4]] as Array<[number, number]>
    expect(loopInsideLoop(inner, square)).toBe(true)
    expect(loopInsideLoop(square, inner)).toBe(false)
  })

  it('point2Key rounds coordinates', () => {
    expect(point2Key([1.00001, 2.5])).toBe('1,2.5')
  })
})

describe('toMachinePoint', () => {
  it('is identity for +Z-up scenes (D4)', () => {
    expect(toMachinePoint([1, 2, 3])).toEqual([1, 2, 3])
  })
})
