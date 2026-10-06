import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { makeScrew } from '../../../src/primitives/screw/screw'
import type { ScrewParams } from '../../../src/primitives/screw/screw-db'

function base(): ScrewParams {
  return {
    system: 'metric',
    specIdx: 4, // M5
    thread: 'coarse',
    pitchCustom: 0,
    length: 20,
    head: 'none',
    nRad: 32,
  }
}

function vertexCount(g: THREE.BufferGeometry): number {
  return (g.getAttribute('position') as THREE.BufferAttribute).count
}
function triCount(g: THREE.BufferGeometry): number {
  return (g.index?.count ?? 0) / 3
}

describe('makeScrew', () => {
  it('builds a non-empty index mesh for default M5 coarse parameters', () => {
    const geo = makeScrew(base())
    expect(vertexCount(geo)).toBeGreaterThan(0)
    expect(triCount(geo)).toBeGreaterThan(0)
    expect(geo.index).toBeTruthy()
  })

  describe('system / specIdx', () => {
    it('builds geometry for both metric and imperial systems', () => {
      for (const system of ['metric', 'imperial'] as const) {
        const geo = makeScrew({ ...base(), system })
        expect(vertexCount(geo)).toBeGreaterThan(0)
        expect(triCount(geo)).toBeGreaterThan(0)
      }
    })

    it('specIdx selects the diameter (M5 vs M10 differ in radius thus wider mesh)', () => {
      const m5 = makeScrew({ ...base(), specIdx: 4 })
      const m10 = makeScrew({ ...base(), specIdx: 8 })
      m5.computeBoundingBox()
      m10.computeBoundingBox()
      expect(m10.boundingBox!.max.x).toBeGreaterThan(m5.boundingBox!.max.x)
    })

    it('out-of-range specIdx is clamped without throwing', () => {
      expect(() => makeScrew({ ...base(), specIdx: -1 })).not.toThrow()
      expect(() => makeScrew({ ...base(), specIdx: 9999 })).not.toThrow()
    })
  })

  describe('thread', () => {
    it('supports coarse, fine, identity-none and custom', () => {
      for (const thread of ['coarse', 'fine', 'none', 'custom'] as const) {
        const params = { ...base(), thread }
        if (thread === 'custom') params.pitchCustom = 1.2
        const geo = makeScrew(params)
        expect(vertexCount(geo)).toBeGreaterThan(0)
        expect(triCount(geo)).toBeGreaterThan(0)
      }
    })

    it('thread none yields a plain (ungrooved) shank → radius stays crest, fewer side vertices', () => {
      const withThread = makeScrew({ ...base(), thread: 'coarse' })
      const none = makeScrew({ ...base(), thread: 'none' })
      // thread=0 → nAxial=4, coarse uses length/pitch formula → many more rings
      expect(vertexCount(none)).toBeLessThan(vertexCount(withThread))
    })

    it('custom pitch is honoured via pitchCustom (a larger pitch gives winding fewer rings)', () => {
      const coarsePitch = makeScrew({ ...base(), thread: 'custom', pitchCustom: 0.2 })
      const finePitch = makeScrew({ ...base(), thread: 'custom', pitchCustom: 4.0 })
      // smaller pitch → more rings; a zero/very small pitch rings formula, larger → fewer
      expect(vertexCount(finePitch)).toBeLessThan(vertexCount(coarsePitch))
    })
  })

  describe('length', () => {
    it('produces a taller mesh for a longer screw length', () => {
      const short = makeScrew({ ...base(), length: 10 })
      const long = makeScrew({ ...base(), length: 80 })
      short.computeBoundingBox()
      long.computeBoundingBox()
      expect(long.boundingBox!.max.z - long.boundingBox!.min.z).toBeGreaterThan(
        short.boundingBox!.max.z - short.boundingBox!.min.z,
      )
    })

    it('the shank is centred: |min z| ≈ max z for a symmetric thread-none body', () => {
      const geo = makeScrew({ ...base(), thread: 'none', length: 30 })
      geo.computeBoundingBox()
      expect(Math.abs(geo.boundingBox!.min.z)).toBeCloseTo(Math.abs(geo.boundingBox!.max.z), 2)
    })
  })

  describe('head', () => {
    it('supports hex, chc and none heads', () => {
      for (const head of ['hex', 'chc', 'none'] as const) {
        const geo = makeScrew({ ...base(), head })
        expect(vertexCount(geo)).toBeGreaterThan(0)
        expect(triCount(geo)).toBeGreaterThan(0)
      }
    })

    it('a head adds height, so hex/chc meshes are taller than none', () => {
      const none = makeScrew({ ...base(), head: 'none' })
      const hex = makeScrew({ ...base(), head: 'hex' })
      const chc = makeScrew({ ...base(), head: 'chc' })
      none.computeBoundingBox()
      hex.computeBoundingBox()
      chc.computeBoundingBox()
      const hNone = none.boundingBox!.max.z - none.boundingBox!.min.z
      const hHex = hex.boundingBox!.max.z - hex.boundingBox!.min.z
      const hChc = chc.boundingBox!.max.z - chc.boundingBox!.min.z
      expect(hHex).toBeGreaterThan(hNone)
      expect(hChc).toBeGreaterThan(hNone)
      // chc head is shorter than hex head (0.5*dia vs 0.6*dia)
      expect(hChc).toBeLessThan(hHex)
    })

    it('head vertex count scales with the head (chc adds rings at the shank end)', () => {
      const none = makeScrew({ ...base(), head: 'none' })
      const hex = makeScrew({ ...base(), head: 'hex' })
      expect(vertexCount(hex)).toBeGreaterThan(vertexCount(none))
    })
  })

  describe('nRad (radial resolution)', () => {
    it('a higher radial resolution produces more vertices per ring', () => {
      const low = makeScrew({ ...base(), nRad: 16 })
      const high = makeScrew({ ...base(), nRad: 96 })
      expect(vertexCount(high)).toBeGreaterThan(vertexCount(low))
    })

    it('supports the documented resolutions 32 | 48 | 64 | 96', () => {
      for (const nRad of [32, 48, 64, 96]) {
        const geo = makeScrew({ ...base(), nRad })
        expect(vertexCount(geo)).toBeGreaterThan(0)
      }
    })
  })

  it('produces triangular faces only (index length divisible by 3) for all head/thread combos', () => {
    for (const head of ['hex', 'chc', 'none'] as const) {
      for (const thread of ['coarse', 'fine', 'custom', 'none'] as const) {
        const params: ScrewParams = { ...base(), head, thread }
        if (thread === 'custom') params.pitchCustom = 1.5
        const geo = makeScrew(params)
        expect(geo.index!.count % 3, `${head}/${thread}`).toBe(0)
        expect(triCount(geo)).toBeGreaterThan(0)
      }
    }
  })
})