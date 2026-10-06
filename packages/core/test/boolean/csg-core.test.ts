import { describe, it, expect } from 'vitest'
import { weldPositionsWorker } from '../../src/boolean/csg-core'

describe('weldPositionsWorker', () => {
  it('uses the first occurrence of each quantized position as canonical', () => {
    // 3 unique verts, index buffer references them (vertex 2 == vertex 0 within 1e-6? no:
    // different → 3 unique). Use 4 indices where 0 and 2 land on the same point.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0])
    const indices = new Uint32Array([0, 1, 2, 3]) // verts 0 and 2 are the same position
    const r = weldPositionsWorker(positions, indices, indices.length)
    expect(r.indices[0]).toBe(r.indices[2]) // 0 and 2 share a welded id
    expect(r.positions).toHaveLength(3 * 3 * 1) // 3 unique verts may dedupe to fewer
  })

  it('deduplicates within the 1e-6 quantization tolerance', () => {
    const positions = new Float32Array([0, 0, 0, 1e-7, 0, 0, 1, 0, 0]) // vert0 ≈ vert1
    const indices = new Uint32Array([0, 1, 2])
    const { positions: wp, indices: wi } = weldPositionsWorker(positions, indices, 3)
    expect(wi[0]).toBe(wi[1]) // near-identical quantized → same id
    expect(wp).toHaveLength(2 * 3) // only 2 unique positions remain
  })

  it('preserves order and handles a single triangle', () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0])
    const indices = new Uint32Array([0,1,2])
    const r = weldPositionsWorker(positions, indices, 3)
    expect(Array.from(r.indices)).toEqual([0,1,2])
    expect(Array.from(r.positions)).toEqual([0,0,0,1,0,0,0,1,0])
  })
})