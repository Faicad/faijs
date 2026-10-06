import { describe, it, expect } from 'vitest'
import { BufferGeometry, BufferAttribute } from 'three'
import { extractMeshData } from './brep-primitives'

describe('extractMeshData', () => {
  it('copies position/indices from an indexed geometry', () => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    geo.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1))
    const { positions, indices } = extractMeshData(geo)
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(indices)).toEqual([0, 1, 2])
  })

  it('creates sequential indices for a non-indexed geometry', () => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1]), 3))
    const { positions, indices } = extractMeshData(geo)
    expect(positions).toHaveLength(12)
    expect(Array.from(indices)).toEqual([0, 1, 2, 3])
  })

  it('throws when the geometry has no position attribute', () => {
    expect(() => extractMeshData(new BufferGeometry())).toThrow(/no position attribute/)
  })

  it('copies the arrays (result does not alias the source attribute)', () => {
    const geo = new BufferGeometry()
    const src = new Float32Array([1, 2, 3])
    geo.setAttribute('position', new BufferAttribute(src, 3))
    const { positions } = extractMeshData(geo)
    positions[0] = 999
    expect(src[0]).toBe(1)
  })
})