import { describe, it, expect } from 'vitest'
import {
  makePrimitiveGeo,
  applyPrimitiveOffset,
  mergeBufferGeometries,
  DEFAULT_SIZE,
  DEFAULT_SEGMENTS,
} from '../../src/primitives/mesh-primitives'
import type { PrimitiveType } from '../../src/primitives/types'
import { boundingBox } from '../../src/mesh/query'
import type { Shape } from '../../src/mesh/types'

/** Number of triangles = indices.length / 3. */
function triCount(geo: Shape): number {
  return geo.indices.length / 3
}

/** Number of vertices = position array items / 3. */
function vertexCount(geo: Shape): number {
  return geo.positions.length / 3
}

/** Number of raw floats in the position array data. */
function positionLen(geo: Shape): number {
  return geo.positions.length
}

describe('makePrimitiveGeo', () => {
  it('defaults size to DEFAULT_SIZE (20) and segments to DEFAULT_SEGMENTS (32)', () => {
    expect(DEFAULT_SIZE).toBe(20)
    expect(DEFAULT_SEGMENTS).toBe(32)
  })

  it('builds a cube for type cube with expected 24 verts / 12 tris', () => {
    const geo = makePrimitiveGeo('cube', 10)
    // three.js BoxGeometry produces 24 vertices and 36 indices (12 triangles).
    expect(vertexCount(geo)).toBe(24)
    expect(triCount(geo)).toBe(12)
    expect(positionLen(geo)).toBe(24 * 3)
    // nominal size: cube side = size, so axis-aligned extent is exactly size.
    const bb = boundingBox(geo)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 6)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(10, 6)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 6)
  })

  it('treats box as a synonym of cube (identical vertex/tri count)', () => {
    const boxGeo = makePrimitiveGeo('box', 5)
    const cubeGeo = makePrimitiveGeo('cube', 5)
    expect(vertexCount(boxGeo)).toBe(vertexCount(cubeGeo))
    expect(triCount(boxGeo)).toBe(triCount(cubeGeo))
  })

  it('builds a sphere with the expected triangle count for the given segments', () => {
    // SphereGeometry(w=segments, h=segments) triangle count = 2 * widthSegs * (heightSegs - 1).
    const segs = 16
    const geo = makePrimitiveGeo('sphere', 20, segs)
    expect(triCount(geo)).toBe(2 * segs * (segs - 1))
    expect(vertexCount(geo)).toBe((segs + 1) * (segs + 1))
    const bb = boundingBox(geo)
    // sphere radius = size/2 = 10
    expect(Math.abs(bb.max[0] - bb.min[0]) / 2).toBeCloseTo(10, 5)
    expect(Math.abs(bb.max[1] - bb.min[1]) / 2).toBeCloseTo(10, 5)
  })

  it('builds a cylinder with the expected triangle count', () => {
    const segs = 24
    const geo = makePrimitiveGeo('cylinder', 16, segs)
    // Cylinder: (2 side + 1 top cap + 1 bottom cap) per radial segment = 4 * radialSegments.
    expect(triCount(geo)).toBe(4 * segs)
    // three.js CylinderGeometry vertex count is 6*segs + 4 for heightSegments=1.
    expect(vertexCount(geo)).toBe(6 * segs + 4)
    const bb = boundingBox(geo)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(16, 5) // length along Z after Y→Z rotation
    // radius = size/2 = 8
    expect(Math.abs(bb.max[0] - bb.min[0]) / 2).toBeCloseTo(8, 5)
  })

  it('builds a cone with the expected triangle count', () => {
    const segs = 24
    const geo = makePrimitiveGeo('cone', 16, segs)
    // Cone has a side (2 triangles per segment, one degenerate) + bottom cap (1 per segment) = 3 * radialSegments.
    expect(triCount(geo)).toBe(3 * segs)
    // three.js ConeGeometry vertex count is 4*segs + 3.
    expect(vertexCount(geo)).toBe(4 * segs + 3)
  })

  it('builds a wedge with 8 vertices / 12 triangles (custom geometry)', () => {
    const geo = makePrimitiveGeo('wedge', 20)
    expect(vertexCount(geo)).toBe(8)
    expect(triCount(geo)).toBe(12)
    expect(positionLen(geo)).toBe(24)
  })

  it('honours the size arg (volume grows) for cube', () => {
    const small = makePrimitiveGeo('cube', 2)
    const large = makePrimitiveGeo('cube', 40)
    const sv = boundingBox(small).max[0] - boundingBox(small).min[0]
    const lv = boundingBox(large).max[0] - boundingBox(large).min[0]
    expect(sv).toBeCloseTo(2, 6)
    expect(lv).toBeCloseTo(40, 6)
  })

  it('honours the segments arg for curved primitives', () => {
    const low = makePrimitiveGeo('cylinder', 10, 6)
    const high = makePrimitiveGeo('cylinder', 10, 64)
    expect(triCount(low)).toBeLessThan(triCount(high))
  })

  it('produces a closed, indexed mesh (has indices) for every supported type', () => {
    const types: PrimitiveType[] = ['cube', 'box', 'sphere', 'cylinder', 'cone', 'wedge']
    for (const t of types) {
      const geo = makePrimitiveGeo(t as PrimitiveType)
      expect(geo.indices.length, `${t} should be indexed`).toBeGreaterThan(0)
      expect(vertexCount(geo)).toBeGreaterThan(0)
      expect(triCount(geo)).toBeGreaterThan(0)
      // every vertex is used
      expect(geo.indices.length % 3).toBe(0)
    }
  })
})

describe('applyPrimitiveOffset', () => {
  it('translates the geometry by (x, y) in mm', () => {
    const geo = makePrimitiveGeo('cube', 4)
    const before = boundingBox(geo)
    const moved = applyPrimitiveOffset(geo, 5, -3)
    const after = boundingBox(moved)
    expect(after.min[0]).toBeCloseTo(before.min[0] + 5, 6)
    expect(after.min[1]).toBeCloseTo(before.min[1] - 3, 6)
    expect(after.max[0]).toBeCloseTo(before.max[0] + 5, 6)
    expect(after.max[1]).toBeCloseTo(before.max[1] - 3, 6)
    // z unchanged
    expect(after.min[2]).toBeCloseTo(before.min[2], 6)
    expect(after.max[2]).toBeCloseTo(before.max[2], 6)
  })

  it('is a no-op when x and y are both zero', () => {
    const geo = makePrimitiveGeo('cube', 2)
    const pos = Array.from(geo.positions)
    const result = applyPrimitiveOffset(geo, 0, 0)
    expect(Array.from(result.positions)).toEqual(pos)
  })

  it('supports negative offsets', () => {
    const geo = makePrimitiveGeo('cube', 2)
    const before = boundingBox(geo)
    const moved = applyPrimitiveOffset(geo, -7, -9)
    const after = boundingBox(moved)
    expect(after.min[0]).toBeCloseTo(before.min[0] - 7, 6)
    expect(after.min[1]).toBeCloseTo(before.min[1] - 9, 6)
  })
})

describe('mergeBufferGeometries', () => {
  function cube(size = 2): Shape {
    return makePrimitiveGeo('cube', size)
  }

  it('returns a clone when given a single geometry (does not alias input)', () => {
    const g = cube()
    const merged = mergeBufferGeometries([g])
    expect(merged).not.toBe(g)
    expect(vertexCount(merged)).toBe(vertexCount(g))
    expect(triCount(merged)).toBe(triCount(g))
    // mutating merged does not affect the input
    merged.positions[0] = 999
    expect(g.positions[0]).not.toBe(999)
  })

  it('merges two geometries, summing positions and indices', () => {
    const a = cube(2)
    const b = cube(3)
    const merged = mergeBufferGeometries([a, b])
    expect(vertexCount(merged)).toBe(vertexCount(a) + vertexCount(b))
    expect(positionLen(merged)).toBe(positionLen(a) + positionLen(b))
    expect(triCount(merged)).toBe(triCount(a) + triCount(b))
    expect(merged.indices.length).toBeGreaterThan(0)
  })

  it('produces a geometry with zero positions when all inputs are empty', () => {
    const g1: Shape = { positions: new Float32Array(0), indices: new Uint32Array(0) }
    const g2: Shape = { positions: new Float32Array(0), indices: new Uint32Array(0) }
    const merged = mergeBufferGeometries([g1, g2])
    expect(vertexCount(merged)).toBe(0)
    expect(triCount(merged)).toBe(0)
  })

  it('merging an empty array yields an empty indexed geometry', () => {
    const merged = mergeBufferGeometries([])
    expect(vertexCount(merged)).toBe(0)
  })
})