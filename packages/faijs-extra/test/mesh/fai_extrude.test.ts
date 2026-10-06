/**
 * mesh/fai_extrude — `extrude` (exported as `meshExtrude`) coverage.
 *
 * The function shells out to the manifold CSG backend through
 * `buildExtrudeParts` (split twice) + an optional boolean union, so this
 * exercises the real geometry path on a small box. All three extrusion
 * modes and height/offset parameters are covered.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { extrude } from '../../src/mesh/fai_extrude'
import { geoToManifoldMesh } from '@faicad/faijs/boolean/csg-backend'
import type { Shape } from '@faicad/faijs/mesh/types'

/** A world-space box occupying z ∈ [5, 7], horizon at planeDistance=6. */
function box(): Shape {
  const g = new THREE.BoxGeometry(4, 4, 2)
  g.translate(0, 0, 6)
  return geoToManifoldMesh(g)
}

function zRange(p: Float32Array): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 2; i < p.length; i += 3) {
    if (p[i] < min) min = p[i]
    if (p[i] > max) max = p[i]
  }
  return { min, max }
}

describe('meshExtrude (extrude) — real extrusion through the manifold backend', () => {
  it('centered mode keeps the solid centred on the cutting plane (height split)', async () => {
    const out = await extrude(box(), {
      normal: [0, 0, 1],
      planeDistance: 6,
      length: 10,
      mode: 'centered',
    })
    // Result must be a single non-empty mesh.
    expect(out.positions.length).toBeGreaterThan(0)
    expect(out.indices.length).toBeGreaterThan(0)
    // offsetFront = +5, offsetBack = -5, original box spans [5,7]:
    // back shrunk segment to [0,2]-ish, front grows to [10,12]-ish, total ≈ [0,12].
    const z = zRange(out.positions)
    expect(z.min).toBeCloseTo(0, 5)
    expect(z.max).toBeCloseTo(12, 5)
  })

  it('forward mode pushes the top half upward by length', async () => {
    const out = await extrude(box(), {
      normal: [0, 0, 1],
      planeDistance: 6,
      length: 10,
      mode: 'forward',
    })
    // offsetFront = +10, offsetBack = 0 → bottom intact at z=5, top at 5+10=... box top=7 → 7+10...
    // front segment (above plane) shifted +10: [8,17]; the ¬ remember original box [5,7] so
    // roughly bottom stays near 0 and top ≈ 17.
    const z = zRange(out.positions)
    expect(z.min).toBeGreaterThanOrEqual(4.9)
    expect(z.max).toBeCloseTo(17, 5)
  })

  it('backward mode pulls the bottom segment down by length', async () => {
    const out = await extrude(box(), {
      normal: [0, 0, 1],
      planeDistance: 6,
      length: 10,
      mode: 'backward',
    })
    // offsetFront = 0, offsetBack = -10 → top stays ≈ 7, bottom (box min z=5) goes to 5-10 = -5.
    const z = zRange(out.positions)
    expect(z.min).toBeCloseTo(-5, 5)
    expect(z.max).toBeLessThanOrEqual(7.2)
  })

  it('mode defaults to "centered" when omitted', async () => {
    const out = await extrude(box(), {
      normal: [0, 0, 1],
      planeDistance: 6,
      length: 10,
    })
    const z = zRange(out.positions)
    expect(z.min).toBeCloseTo(0, 5)
    expect(z.max).toBeCloseTo(12, 5)
  })

  it('extrudes along a non-axis-aligned-cutting normal (Y)', async () => {
    // Box centred at origin spanning y∈[-2,2]; cut on the Y=0 plane.
    const yBox = geoToManifoldMesh(new THREE.BoxGeometry(4, 4, 4))
    const out = await extrude(yBox, {
      normal: [0, 1, 0],
      planeDistance: 0,
      length: 4,
      mode: 'centered',
    })
    expect(out.indices.length).toBeGreaterThan(0)
    // centered → halves pushed +2/-2 along Y; original y∈[-2,2] becomes [-4,4].
    let minY = Infinity, maxY = -Infinity
    for (let i = 1; i < out.positions.length; i += 3) {
      if (out.positions[i] < minY) minY = out.positions[i]
      if (out.positions[i] > maxY) maxY = out.positions[i]
    }
    expect(minY).toBeCloseTo(-4, 5)
    expect(maxY).toBeCloseTo(4, 5)
  })
})