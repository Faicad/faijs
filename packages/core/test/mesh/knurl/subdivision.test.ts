/**
 * subdivision.test.ts — adaptive edge subdivision (subdivision.ts).
 *
 * Covers `subdivide(geometry, maxEdgeLength, onProgress, faceWeights)`:
 *   - unchanged output when all edges already fit,
 *   - subdivision until every edge <= maxEdgeLength,
 *   - indexed inputs are expanded first,
 *   - faceWeights excludes faces from refinement,
 *   - the safety-cap flag surface and onProgress callback.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { subdivide } from '../../../src/mesh/knurl/subdivision'

function triangleGeometry(verts: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
  return g
}

/** Return the longest edge length found across every triangle of a geometry. */
function longestEdge(geometry: THREE.BufferGeometry): number {
  const pos = geometry.attributes.position
  let max = 0
  for (let t = 0; t < pos.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = t + e
      const b = t + ((e + 1) % 3)
      const dx = pos.getX(a) - pos.getX(b)
      const dy = pos.getY(a) - pos.getY(b)
      const dz = pos.getZ(a) - pos.getZ(b)
      max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz))
    }
  }
  return max
}

describe('subdivide', () => {
  it('returns the geometry unchanged when all edges are already within limit', async () => {
    // Right triangle with legs 1; largest edge sqrt(2) ~ 1.41 <= 2.
    const geo = triangleGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const { geometry, safetyCapHit } = await subdivide(geo, 2)
    expect(geometry.attributes.position.count).toBe(3) // single triangle
    expect(longestEdge(geometry)).toBeLessThanOrEqual(2.0)
    expect(safetyCapHit).toBe(false)
  })

  it('subdivides a large triangle so every edge is within maxEdgeLength', async () => {
    // Legs of 10 -> longest edge ~14.14. Bring all below 3.
    const g = triangleGeometry([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const target = 3
    const { geometry, safetyCapHit } = await subdivide(g, target)
    expect(geometry.attributes.position.count).toBeGreaterThan(9)
    expect(longestEdge(geometry)).toBeLessThanOrEqual(target + 1e-6)
    expect(safetyCapHit).toBe(false)
  })

  it('accepts an indexed input by expanding it to non-indexed first', async () => {
    const fake = new THREE.BufferGeometry()
    fake.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), 3))
    fake.setIndex([0, 1, 2])
    const { geometry } = await subdivide(fake, 3)
    expect(geometry.index).toBeNull() // output is non-indexed
    expect(geometry.attributes.position.count).toBeGreaterThan(9)
  })

  it('honours faceWeights: an excluded face is never refined', async () => {
    const g = triangleGeometry([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const faceWeights = new Float32Array([1, 1, 1]) // exclude the only face
    const { geometry, safetyCapHit } = await subdivide(g, 1, undefined, faceWeights)
    expect(geometry.attributes.position.count).toBe(3) // unchanged single face
    expect(longestEdge(geometry)).toBeGreaterThan(5) // still coarse
    expect(safetyCapHit).toBe(false)
  })

  it('reports progress through the onProgress callback', async () => {
    const g = triangleGeometry([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const seen: number[] = []
    await subdivide(g, 3, (p) => seen.push(p))
    expect(seen.length).toBeGreaterThan(0)
    for (const p of seen) {
      expect(typeof p).toBe('number')
    }
  })

  it('excludes faces by faceWeights averaged presence of "tri exclusion"', async () => {
    // Mixed mesh: one huge triangle (excluded) + one small triangle (not).
    const verts = [
      0, 0, 0, 10, 0, 0, 0, 10, 0, // face 0: big, excluded
      0, 0, 0, 1, 0, 0, 0, 1, 0, // face 1: small
    ]
    const g = triangleGeometry(verts)
    const faceWeights = new Float32Array([1, 1, 1, 0, 0, 0]) // face0 excluded only
    const { geometry } = await subdivide(g, 1, undefined, faceWeights)
    // The excluded face (0..2) keeps its long edge; the mesh stays intact.
    expect(longestEdge(geometry)).toBeGreaterThan(10)
  })
})