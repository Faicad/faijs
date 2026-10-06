import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  makePrimitiveGeo,
  applyPrimitiveOffset,
  mergeBufferGeometries,
  DEFAULT_SIZE,
  DEFAULT_SEGMENTS,
} from '../../src/primitives/mesh-primitives'
import type { PrimitiveType } from '../../src/primitives/types'

/** Number of triangles = indices.length / 3. */
function triCount(geo: THREE.BufferGeometry): number {
  return (geo.index?.count ?? 0) / 3
}

/** Number of vertices = position array items / 3. */
function vertexCount(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position')
  return pos ? pos.count : 0
}

/** Number of raw floats in the position attribute data. */
function positionLen(geo: THREE.BufferGeometry): number {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined
  return pos ? pos.array.length : 0
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
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(10, 6)
    expect(bb.max.y - bb.min.y).toBeCloseTo(10, 6)
    expect(bb.max.z - bb.min.z).toBeCloseTo(10, 6)
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
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    // sphere radius = size/2 = 10
    expect(Math.abs(bb.max.x - bb.min.x) / 2).toBeCloseTo(10, 5)
    expect(Math.abs(bb.max.y - bb.min.y) / 2).toBeCloseTo(10, 5)
  })

  it('builds a cylinder with the expected triangle count', () => {
    const segs = 24
    const geo = makePrimitiveGeo('cylinder', 16, segs)
    // Cylinder: (2 side + 1 top cap + 1 bottom cap) per radial segment = 4 * radialSegments.
    expect(triCount(geo)).toBe(4 * segs)
    // three.js CylinderGeometry vertex count is 6*segs + 4 for heightSegments=1.
    expect(vertexCount(geo)).toBe(6 * segs + 4)
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.z - bb.min.z).toBeCloseTo(16, 5) // length along Z after Y→Z rotation
    // radius = size/2 = 8
    expect(Math.abs(bb.max.x - bb.min.x) / 2).toBeCloseTo(8, 5)
  })

  it('builds a cone with the expected triangle count', () => {
    const segs = 24
    const geo = makePrimitiveGeo('cone', 16, segs)
    // Cone has a side (1 triangle per segment) + bottom cap (1 per segment) = 2 * radialSegments.
    expect(triCount(geo)).toBe(2 * segs)
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
    small.computeBoundingBox()
    large.computeBoundingBox()
    const sv = small.boundingBox!.max.x - small.boundingBox!.min.x
    const lv = large.boundingBox!.max.x - large.boundingBox!.min.x
    expect(sv).toBeCloseTo(2, 6)
    expect(lv).toBeCloseTo(40, 6)
  })

  it('honours the segments arg for curved primitives', () => {
    const low = makePrimitiveGeo('cylinder', 10, 6)
    const high = makePrimitiveGeo('cylinder', 10, 64)
    expect(triCount(low)).toBeLessThan(triCount(high))
  })

  it('produces a closed, indexed mesh (has index attribute) for every supported type', () => {
    const types: PrimitiveType[] = ['cube', 'box', 'sphere', 'cylinder', 'cone', 'wedge']
    for (const t of types) {
      const geo = makePrimitiveGeo(t as PrimitiveType)
      expect(geo.index, `${t} should be indexed`).toBeTruthy()
      expect(vertexCount(geo)).toBeGreaterThan(0)
      expect(triCount(geo)).toBeGreaterThan(0)
      // every vertex is used
      expect(geo.index!.count % 3).toBe(0)
    }
  })
})

describe('applyPrimitiveOffset', () => {
  it('translates the geometry by (x, y) in mm', () => {
    const geo = makePrimitiveGeo('cube', 4)
    geo.computeBoundingBox()
    const before = geo.boundingBox!.clone()
    applyPrimitiveOffset(geo, 5, -3)
    geo.computeBoundingBox()
    expect(geo.boundingBox!.min.x).toBeCloseTo(before.min.x + 5, 6)
    expect(geo.boundingBox!.min.y).toBeCloseTo(before.min.y - 3, 6)
    expect(geo.boundingBox!.max.x).toBeCloseTo(before.max.x + 5, 6)
    expect(geo.boundingBox!.max.y).toBeCloseTo(before.max.y - 3, 6)
    // z unchanged
    expect(geo.boundingBox!.min.z).toBeCloseTo(before.min.z, 6)
    expect(geo.boundingBox!.max.z).toBeCloseTo(before.max.z, 6)
  })

  it('is a no-op when x and y are both zero', () => {
    const geo = makePrimitiveGeo('cube', 2)
    const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array.slice() as Float32Array
    applyPrimitiveOffset(geo, 0, 0)
    const after = (geo.getAttribute('position') as THREE.BufferAttribute).array
    expect(Array.from(after)).toEqual(Array.from(pos))
  })

  it('supports negative offsets', () => {
    const geo = makePrimitiveGeo('cube', 2)
    geo.computeBoundingBox()
    const before = geo.boundingBox!.clone()
    applyPrimitiveOffset(geo, -7, -9)
    geo.computeBoundingBox()
    expect(geo.boundingBox!.min.x).toBeCloseTo(before.min.x - 7, 6)
    expect(geo.boundingBox!.min.y).toBeCloseTo(before.min.y - 9, 6)
  })
})

describe('mergeBufferGeometries', () => {
  function cube(size = 2): THREE.BufferGeometry {
    const g = makePrimitiveGeo('cube', size)
    g.computeBoundingBox()
    return g
  }

  it('returns a clone when given a single geometry (does not alias input)', () => {
    const g = cube()
    const merged = mergeBufferGeometries([g])
    expect(merged).not.toBe(g)
    expect(vertexCount(merged)).toBe(vertexCount(g))
    expect(triCount(merged)).toBe(triCount(g))
    // mutating merged does not affect the input
    merged.translate(10, 0, 0)
    g.computeBoundingBox()
    expect(g.boundingBox!.min.x).toBeCloseTo(-1, 6)
  })

  it('merges two geometries, summing positions and indices', () => {
    const a = cube(2)
    const b = cube(3)
    const merged = mergeBufferGeometries([a, b])
    expect(vertexCount(merged)).toBe(vertexCount(a) + vertexCount(b))
    expect(positionLen(merged)).toBe(positionLen(a) + positionLen(b))
    expect(triCount(merged)).toBe(triCount(a) + triCount(b))
    expect(merged.index).toBeTruthy()
  })

  it('handles a mix of indexed and non-indexed inputs', () => {
    const indexed = cube(2)
    // build a non-indexed geometry
    const nonIndexed = new THREE.BufferGeometry()
    const verts = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    nonIndexed.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    expect(nonIndexed.index).toBeFalsy()

    const merged = mergeBufferGeometries([indexed, nonIndexed])
    expect(vertexCount(merged)).toBe(vertexCount(indexed) + 3)
    expect(merged.index).toBeTruthy()
    // non-indexed triangle range uses remapped sequential indices
    expect(triCount(merged)).toBe(triCount(indexed) + 1)
  })

  it('skips geometries that have no position attribute', () => {
    const empty = new THREE.BufferGeometry()
    const g = cube(2)
    const merged = mergeBufferGeometries([empty, g, empty])
    expect(vertexCount(merged)).toBe(vertexCount(g))
    expect(triCount(merged)).toBe(triCount(g))
  })

  it('produces a geometry with zero positions when all inputs are empty', () => {
    const g1 = new THREE.BufferGeometry()
    const g2 = new THREE.BufferGeometry()
    const merged = mergeBufferGeometries([g1, g2])
    expect(vertexCount(merged)).toBe(0)
    expect(triCount(merged)).toBe(0)
  })

  it('merging an empty array yields an empty indexed geometry', () => {
    const merged = mergeBufferGeometries([])
    expect(vertexCount(merged)).toBe(0)
  })
})