import { describe, it, expect } from 'vitest'
import { extractMeshData } from '../../src/primitives/brep-primitives'
import type { Shape } from '../../src/mesh/types'

describe('extractMeshData', () => {
  it('copies position/indices from a Shape', () => {
    const shape: Shape = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    }
    const { positions, indices } = extractMeshData(shape)
    expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(indices)).toEqual([0, 1, 2])
  })

  it('copies the arrays (result does not alias the source)', () => {
    const shape: Shape = {
      positions: new Float32Array([1, 2, 3]),
      indices: new Uint32Array(0),
    }
    const { positions } = extractMeshData(shape)
    positions[0] = 999
    expect(shape.positions[0]).toBe(1)
  })
})