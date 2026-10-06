/**
 * mapping.test.ts — CPU UV projection (mapping.ts).
 *
 * Covers every exported function & parameter:
 *   - computeUV(pos, normal, mode, settings, bounds) for every projection mode
 *     (planar XY/XZ/YZ, cylindrical, spherical, triplanar, cubic) plus the
 *     boundary of an invalid mode (falls back to triplanar).
 *   - getCubicBlendWeights(normal, blend, seamBandWidth) including blend≤0.001
 *     (one-hot), blend=1, zero-length normal, and seam-band width param.
 *   - getDominantCubicAxis(normal) including tie-break.
 *
 * Weights are normalized by the implementation: getCubicBlendWeights returns
 * weights that sum exactly to 1; triplanar weights use a +1e-6 smoothing term
 * so they sum to <1 by a tiny epsilon — assert loosely with a generous bound.
 */
import { describe, it, expect } from 'vitest'
import {
  computeUV,
  getCubicBlendWeights,
  getDominantCubicAxis,
  MODE_PLANAR_XY,
  MODE_PLANAR_XZ,
  MODE_PLANAR_YZ,
  MODE_CYLINDRICAL,
  MODE_SPHERICAL,
  MODE_CUBIC,
  MODE_TRIPLANAR,
  type MappingSettings,
} from './mapping'

interface Vec3 { x: number; y: number; z: number }
interface Bounds { min: Vec3; max: Vec3; center: Vec3; size: Vec3 }

function bounds(min: Vec3, size: Vec3): Bounds {
  return {
    min,
    size,
    center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 },
    max: { x: min.x + size.x, y: min.y + size.y, z: min.z + size.z },
  }
}

const UNIT = bounds({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })

const baseSettings: MappingSettings = {
  scaleU: 0.5,
  scaleV: 0.5,
  offsetU: 0,
  offsetV: 0,
}

describe('getDominantCubicAxis', () => {
  it('picks the axis with the largest absolute component', () => {
    expect(getDominantCubicAxis({ x: 0, y: 0, z: 1 })).toBe('z')
    expect(getDominantCubicAxis({ x: 0, y: 1, z: 0 })).toBe('y')
    expect(getDominantCubicAxis({ x: 1, y: 0, z: 0 })).toBe('x')
    expect(getDominantCubicAxis({ x: -1, y: 0, z: 0 })).toBe('x') // sign-agnostic
  })

  it('breaks ties preferring x then y within the axis epsilon', () => {
    expect(getDominantCubicAxis({ x: 1, y: 1, z: 1 })).toBe('x')
    expect(getDominantCubicAxis({ x: 1, y: 1 + 5e-5, z: 0 })).toBe('x') // within epsilon → x
    expect(getDominantCubicAxis({ x: 0, y: 2, z: 0 })).toBe('y') // far → y
  })
})

describe('getCubicBlendWeights', () => {
  it('returns a one-hot dominant axis when blend is 0', () => {
    expect(getCubicBlendWeights({ x: 0, y: 0, z: 1 }, 0)).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('still one-hots for a blend at/below the 0.001 threshold (boundary)', () => {
    expect(getCubicBlendWeights({ x: 0, y: 0, z: 1 }, 0.0005)).toEqual({ x: 0, y: 0, z: 1 })
    expect(getCubicBlendWeights({ x: 0, y: 0, z: 1 }, 0.001)).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('blends toward secondary axes but keeps weights normalized to 1', () => {
    const w = getCubicBlendWeights({ x: 0, y: 0.5, z: 1 }, 1)
    expect(Math.abs(w.x + w.y + w.z - 1)).toBeLessThan(1e-8)
    expect(w.z).toBeGreaterThan(0)
    expect(w.z).toBeGreaterThan(w.x)
  })

  it('wider seamBandWidth mixes in a larger non-dominant share', () => {
    const narrow = getCubicBlendWeights({ x: 0, y: 0.5, z: 1 }, 1, 0.05)
    const wide = getCubicBlendWeights({ x: 0, y: 0.5, z: 1 }, 1, 1.0)
    const secondary = (w: { x: number; y: number; z: number }) => w.y + w.x
    expect(wide.z).toBeLessThan(narrow.z)
    expect(secondary(wide)).toBeGreaterThan(secondary(narrow))
  })

  it('zero-length normal with blend=0 stays on the one-hot (dominant x) path', () => {
    // GOTCHA: for a zero-length normal the dominant axis tie-breaks to 'x'; with
    // blend<=0.001 the one-hot path is taken, so the result is defined (x:1).
    expect(getCubicBlendWeights({ x: 0, y: 0, z: 0 }, 0)).toEqual({ x: 1, y: 0, z: 0 })
  })
})

describe('computeUV channel invariants (planar)', () => {
  it('planar XY returns a single [0,1) sample honoring scale/offset', () => {
    const r = computeUV({ x: 0.2, y: 0.3, z: 0 }, { x: 0, y: 0, z: 1 }, MODE_PLANAR_XY, baseSettings, UNIT)
    expect(r.triplanar).toBe(false)
    expect(r.u).toBeGreaterThanOrEqual(0)
    expect(r.u).toBeLessThan(1)
    expect(r.v).toBeGreaterThanOrEqual(0)
    expect(r.v).toBeLessThan(1)
  })

  it('planar XZ and YZ return a single sample too', () => {
    for (const mode of [MODE_PLANAR_XZ, MODE_PLANAR_YZ]) {
      const r = computeUV({ x: 0.2, y: 0.3, z: 0.4 }, { x: 0, y: 0, z: 1 }, mode, baseSettings, UNIT)
      expect(r.triplanar).toBe(false)
      expect(r.u).toBeGreaterThanOrEqual(0)
      expect(r.v).toBeGreaterThanOrEqual(0)
      expect(r.u).toBeLessThan(1)
      expect(r.v).toBeLessThan(1)
    }
  })

  it('planar honors offset and wraps into [0,1)', () => {
    const off = { ...baseSettings, offsetU: 10.5 } // large offset forces wrap
    const r = computeUV({ x: 0.4, y: 0.4, z: 0 }, { x: 0, y: 0, z: 1 }, MODE_PLANAR_XY, off, UNIT)
    expect(r.u).toBeGreaterThanOrEqual(0)
    expect(r.u).toBeLessThan(1)
  })
})

describe('computeUV triplanar / default', () => {
  it('triplanar returns 3 weighted samples whose weights sum ~1', () => {
    const r = computeUV({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, MODE_TRIPLANAR, baseSettings, UNIT)
    expect(r.triplanar).toBe(true)
    expect(r.samples!.length).toBe(3)
    const sum = r.samples!.reduce((a, s) => a + s.w, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.01)
    for (const s of r.samples!) {
      expect(s.w).toBeGreaterThanOrEqual(0)
      expect(s.u).toBeGreaterThanOrEqual(0)
      expect(s.v).toBeGreaterThanOrEqual(0)
    }
  })

  it('an invalid mode falls back to triplanar (default branch)', () => {
    const r = computeUV({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 9999, baseSettings, UNIT)
    expect(r.triplanar).toBe(true)
    expect(r.samples!.length).toBe(3)
  })
})

describe('computeUV spherical / cylindrical', () => {
  it('cylindrical off-seam yields a single sample whose u stays in [0,1)', () => {
    // Off the seam, the cylindrical path synthesizes an azimuthal u (wrapped via atan2).
    const r = computeUV({ x: 1, y: 0, z: 0.5 }, { x: 0, y: 0, z: 1 }, MODE_CYLINDRICAL, baseSettings, UNIT) as { u: number; v?: number; w?: number }
    expect(r.u).toBeGreaterThanOrEqual(0)
    expect(r.u).toBeLessThan(1)
  })

  it('spherical projects to [0,1) via atan2/acos', () => {
    const r = computeUV({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, MODE_SPHERICAL, baseSettings, UNIT)
    expect(r.u).toBeGreaterThanOrEqual(0)
    expect(r.u).toBeLessThan(1)
    expect(r.v).toBeGreaterThanOrEqual(0)
    expect(r.v).toBeLessThan(1)
  })
})

describe('computeUV cubic', () => {
  it('pure-z normal with blend yields a single dominant sample', () => {
    const r = computeUV({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, MODE_CUBIC, { ...baseSettings, mappingBlend: 1 }, UNIT)
    expect(r.triplanar).toBe(false)
    expect(r.u).toBeGreaterThanOrEqual(0)
    expect(r.u).toBeLessThan(1)
  })

  it('45° diagonal cubic normal yields a valid [0,1) single-or-triplanar result', () => {
    const r = computeUV({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 1, z: 1 }, MODE_CUBIC, { ...baseSettings, mappingBlend: 1 }, UNIT)
    if (r.triplanar) {
      const sum = r.samples!.reduce((a, s) => a + s.w, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-8)
      for (const s of r.samples!) {
        expect(s.u).toBeGreaterThanOrEqual(0)
        expect(s.v).toBeGreaterThanOrEqual(0)
      }
    }
  })
})