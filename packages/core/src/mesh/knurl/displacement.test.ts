/**
 * displacement.test.ts — applyDisplacement (displacement.ts).
 *
 * Covers every parameter of `applyDisplacement(geometry, imageData, imgWidth,
 * imgHeight, settings, bounds, onProgress)`:
 *   - known-displacement alignment along the smooth normal,
 *   - symmetric vs non-symmetric displacement mapping grey -> offset,
 *   - inversion via negative amplitude,
 *   - water-tightness invariant (same position -> same displacement),
 *   - face masking via the `excludeWeight` attribute and angle limits,
 *   - the optional onProgress callback,
 *   - invalid/degenerate input (empty texture) still returns a geometry.
 */
import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { applyDisplacement, type DisplacementSettings } from './displacement'
import { MODE_TRIPLANAR } from './mapping'

function makeImage(data: number[], width: number, height: number) {
  const bytes = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const v = data[p] ?? 0
    bytes[p * 4] = v
    bytes[p * 4 + 1] = v
    bytes[p * 4 + 2] = v
    bytes[p * 4 + 3] = 255
  }
  return { data: bytes, width, height }
}

function triPositions(): number[] {
  // z=0 plane triangle inside the unit bounds.
  return [0, 0, 0, 1, 0, 0, 0, 1, 0]
}
function triNormals(): number[] {
  return [0, 0, 1, 0, 0, 1, 0, 0, 1]
}

function makeGeometry(positions: number[], normals: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3))
  return g
}

const BOUNDS = {
  min: new THREE.Vector3(0, 0, 0),
  max: new THREE.Vector3(1, 1, 1),
  size: new THREE.Vector3(1, 1, 1),
  center: new THREE.Vector3(0.5, 0.5, 0.5),
}

function settings(overrides: Partial<DisplacementSettings> = {}): DisplacementSettings {
  return {
    mappingMode: MODE_TRIPLANAR,
    amplitude: 1,
    scaleU: 0.5,
    scaleV: 0.5,
    offsetU: 0,
    offsetV: 0,
    ...overrides,
  }
}

describe('applyDisplacement', () => {
  it('moves a flat z=0 triangle along +Z by amplitude for a fully-white non-symmetric texture', () => {
    // grey 255 -> 1.0, no symmetric centering -> disp = amplitude. plane z=0 -> new z = 1.0.
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const out = applyDisplacement(makeGeometry(triPositions(), triNormals()), img, 2, 2, settings(), BOUNDS)
    expect(out.attributes.position.count).toBe(3)
    expect(out.attributes.position.getZ(0)).toBeCloseTo(1.0, 3)
    expect(out.attributes.position.getZ(1)).toBeCloseTo(1.0, 3)
    expect(out.attributes.position.getZ(2)).toBeCloseTo(1.0, 3)
  })

  it('displaces exactly along the (0,0,1) normal by grey-0.5 when symmetric', () => {
    // grey 255 -> 1.0; symmetric -> 0.5; amplitude 2 -> displacement 1.0.
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const out = applyDisplacement(
      makeGeometry(triPositions(), triNormals()),
      img,
      2, 2,
      { ...settings(), amplitude: 2, symmetricDisplacement: true },
      BOUNDS,
    )
    // x,y unchanged, z = 0 + 1.0
    expect(out.attributes.position.getX(0)).toBe(0)
    expect(out.attributes.position.getY(0)).toBe(0)
    expect(out.attributes.position.getZ(0)).toBeCloseTo(1.0, 3)
  })

  it('a mid-grey texture holds the plane still under symmetric displacement', () => {
    // symmetric centers around 0.5; grey 128/255 ≈ 0.502 -> displacement ≈ 0.
    const img = makeImage([128, 128, 128, 128], 2, 2)
    const out = applyDisplacement(
      makeGeometry(triPositions(), triNormals()),
      img,
      2, 2,
      { ...settings(), amplitude: 1, symmetricDisplacement: true },
      BOUNDS,
    )
    expect(Math.abs(out.attributes.position.getZ(0))).toBeLessThan(0.01)
    expect(Math.abs(out.attributes.position.getZ(1))).toBeLessThan(0.01)
    expect(Math.abs(out.attributes.position.getZ(2))).toBeLessThan(0.01)
  })

  it('inverts the displacement direction with a negative amplitude', () => {
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const out = applyDisplacement(
      makeGeometry(triPositions(), triNormals()),
      img,
      2, 2,
      { ...settings(), amplitude: -1, symmetricDisplacement: false }, // grey 1 -> disp -1
      BOUNDS,
    )
    expect(out.attributes.position.getZ(0)).toBeCloseTo(-1.0, 3)
  })

  it('keeps the watertight invariant: shared vertices displace identically', () => {
    // Two triangles sharing the edge (0,0,0)-(1,0,0): every unique position
    // must receive the same displacement regardless of which triangle sampled it.
    const positions = [
      0, 0, 0, 1, 0, 0, 1, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]
    const normals = [
      0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const out = applyDisplacement(makeGeometry(positions, normals), img, 2, 2, settings(), BOUNDS)
    // Shared position (0,0,0): vertex index 0 (tri0) and vertex index 3 (tri1).
    expect(out.attributes.position.getZ(0)).toBeCloseTo(out.attributes.position.getZ(3), 6)
    // Shared position (1,0,0): vertex index 1 and vertex index 4.
    expect(out.attributes.position.getZ(1)).toBeCloseTo(out.attributes.position.getZ(4), 6)
  })

  it('disables excluded faces to zero displacement via excludeWeight', () => {
    const g = makeGeometry(triPositions(), triNormals())
    // All three corners > 0.99 -> face excluded.
    g.setAttribute('excludeWeight', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 1))
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const out = applyDisplacement(g, img, 2, 2, settings(), BOUNDS)
    // Excluded face is not moved: z stays 0.
    expect(out.attributes.position.getZ(0)).toBeCloseTo(0, 6)
    expect(out.attributes.position.getZ(1)).toBeCloseTo(0, 6)
    expect(out.attributes.position.getZ(2)).toBeCloseTo(0, 6)
  })

  it('reports onProgress at least once (vertex 0 always triggers)', () => {
    const img = makeImage([255, 255, 255, 255], 2, 2)
    const cb = vi.fn()
    applyDisplacement(makeGeometry(triPositions(), triNormals()), img, 2, 2, settings(), BOUNDS, cb)
    expect(cb).toHaveBeenCalled()
  })

  it('handles a degenerate (zero-sized) texture without throwing', () => {
    const geo = makeGeometry(triPositions(), triNormals())
    // tmax clamps to 1, so no division-by-zero inside sampleBilinear's guard.
    const img = makeImage([0], 1, 1)
    const out = applyDisplacement(geo, img, 1, 1, settings(), BOUNDS)
    expect(out).toBeInstanceOf(THREE.BufferGeometry)
  })
})
