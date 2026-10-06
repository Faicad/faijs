import { describe, it, expect } from 'vitest'
import { meshToAsciiStl } from './meshReconstruct'

describe('meshToAsciiStl', () => {
  it('emits one facet block per triangle with normalized cross-product normal', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ])
    const indices = new Uint32Array([0, 1, 2])
    const stl = meshToAsciiStl(positions, indices)
    expect(stl.startsWith('solid mesh_reconstruct')).toBe(true)
    expect(stl.endsWith('endsolid mesh_reconstruct')).toBe(true)
    // XY-plane triangle → CCW normal is +Z
    // (b-a) x (c-a) = (1,0,0) x (0,1,0) = (0,0,1)
    expect(stl).toContain('facet normal 0 0 1')
    expect(stl).toContain('vertex 0 0 0')
    expect(stl).toContain('vertex 1 0 0')
    expect(stl).toContain('vertex 0 1 0')
    expect(stl).toContain('endfacet')
  })

  it('throws when there is no mesh data', () => {
    expect(() => meshToAsciiStl(new Float32Array(), new Uint32Array())).toThrow(
      /no mesh data/,
    )
  })

  it('emits one facet per triangle across multiple triangles', () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5])
    const stl = meshToAsciiStl(positions, indices)
    const facetCount = (stl.match(/facet normal/g) ?? []).length
    expect(facetCount).toBe(2)
  })
})