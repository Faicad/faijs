import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { deriveNormals } from './deriveNormals'

// Indexed "folded plane": two triangles sharing edge (v0,v1) with a 90° dihedral
// fold. The shared vertices v0/v1 sit on the crease.
//   Triangle A (v0,v1,v2) lies in the XY plane  → face normal +Z
//   Triangle B (v0,v1,v3) lies in the XZ plane  → face normal -Y
function foldedPlane(): THREE.BufferGeometry {
  const positions = new Float32Array([
    0, 0, 0, // v0
    1, 0, 0, // v1
    0.5, 0.5, 0, // v2
    0.5, 0, 0.5, // v3
  ])
  const indices = new Uint32Array([0, 1, 2, 0, 1, 3])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  return geo
}

describe('deriveNormals', () => {
  it('returns non-indexed geometry (sharp edges cannot share a vertex normal)', () => {
    const geo = foldedPlane()
    const out = deriveNormals(geo)
    expect(out.index).toBeNull()
    expect(out.getAttribute('normal')).toBeTruthy()
    expect(out.getAttribute('normal').count).toBe(out.getAttribute('position').count)
  })

  it('preserves the 90° fold as sharp (perpendicular face normals)', () => {
    const geo = foldedPlane()
    const out = deriveNormals(geo)
    const n = out.getAttribute('normal') as THREE.BufferAttribute
    // Triangle A vertices 0,1,2 should all share the same face normal ≈ +Z
    const a0 = new THREE.Vector3().fromBufferAttribute(n, 0)
    const a2 = new THREE.Vector3().fromBufferAttribute(n, 2)
    expect(a0.dot(a2)).toBeCloseTo(1, 5) // uniform normal within triangle A
    // Triangle B vertices 3,4,5 should share face normal ≈ -Y
    const b3 = new THREE.Vector3().fromBufferAttribute(n, 3)
    // The two faces meet at 90°: their normals are perpendicular → sharp edge.
    expect(Math.abs(a0.dot(b3))).toBeLessThan(1e-3)
  })

  it('contrast: computeVertexNormals keeps geometry indexed and rounds the fold', () => {
    const geo = foldedPlane()
    const smooth = geo.clone()
    smooth.computeVertexNormals()
    expect(smooth.index).not.toBeNull()
    // Shared vertex v0 (index 0) gets the averaged normal, while v2 (unique to
    // triangle A) keeps the pure +Z face normal → proves the crease is rounded.
    const n = smooth.getAttribute('normal') as THREE.BufferAttribute
    const v0 = new THREE.Vector3().fromBufferAttribute(n, 0)
    const v2 = new THREE.Vector3().fromBufferAttribute(n, 2)
    expect(v0.dot(v2)).toBeLessThan(0.9) // blended, not the pure +Z face normal
  })
})
