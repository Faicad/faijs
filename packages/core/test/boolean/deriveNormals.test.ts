import { describe, it, expect } from 'vitest'
import { deriveNormals } from '../../src/boolean/deriveNormals'
import { computeVertexNormals } from '../../src/mesh/meshdata/ops'
import type { Shape } from '../../src/mesh/types'

// Indexed "folded plane": two triangles sharing edge (v0,v1) with a 90° dihedral
// fold. The shared vertices v0/v1 sit on the crease.
//   Triangle A (v0,v1,v2) lies in the XY plane  → face normal +Z
//   Triangle B (v0,v1,v3) lies in the XZ plane  → face normal -Y
function foldedPlane(): Shape {
  const positions = new Float32Array([
    0, 0, 0, // v0
    1, 0, 0, // v1
    0.5, 0.5, 0, // v2
    0.5, 0, 0.5, // v3
  ])
  const indices = new Uint32Array([0, 1, 2, 0, 1, 3])
  return { positions, indices }
}

describe('deriveNormals', () => {
  it('returns non-indexed geometry (sharp edges cannot share a vertex normal)', () => {
    const geo = foldedPlane()
    const out = deriveNormals(geo)
    // non-indexed = sequential indices (0,1,2,...)
    expect(out.indices[0]).toBe(0)
    expect(out.indices[1]).toBe(1)
    expect(out.normals).toBeTruthy()
    expect(out.normals!.length).toBe(out.positions.length)
  })

  it('preserves the 90° fold as sharp (perpendicular face normals)', () => {
    const geo = foldedPlane()
    const out = deriveNormals(geo)
    const n = out.normals!
    // Triangle A vertices 0,1,2 should all share the same face normal ≈ +Z
    const a0x = n[0], a0y = n[1], a0z = n[2]
    const a2x = n[6], a2y = n[7], a2z = n[8]
    const dotA = a0x * a2x + a0y * a2y + a0z * a2z
    expect(dotA).toBeCloseTo(1, 5) // uniform normal within triangle A
    // Triangle B vertices 3,4,5 should share face normal ≈ -Y
    const b3x = n[9], b3y = n[10], b3z = n[11]
    // The two faces meet at 90°: their normals are perpendicular → sharp edge.
    const dotAB = Math.abs(a0x * b3x + a0y * b3y + a0z * b3z)
    expect(dotAB).toBeLessThan(1e-3)
  })

  it('contrast: computeVertexNormals keeps geometry indexed and rounds the fold', () => {
    const geo = foldedPlane()
    const smoothNormals = computeVertexNormals(geo)
    // Shared vertex v0 (index 0) gets the averaged normal, while v2 (unique to
    // triangle A) keeps the pure +Z face normal → proves the crease is rounded.
    const v0x = smoothNormals[0], v0y = smoothNormals[1], v0z = smoothNormals[2]
    const v2x = smoothNormals[6], v2y = smoothNormals[7], v2z = smoothNormals[8]
    const dot = v0x * v2x + v0y * v2y + v0z * v2z
    expect(dot).toBeLessThan(0.9) // blended, not the pure +Z face normal
  })
})
