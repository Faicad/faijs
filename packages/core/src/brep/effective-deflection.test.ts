import { describe, it, expect } from 'vitest'
import { computeEffectiveDeflection } from './effective-deflection'

const DEFAULT_LD = 0.1 // DEFAULT_LINEAR_DEFLECTION.as(mm)

function kernelWith(bb: { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number }) {
  const fns = {
    getBoundingBox: () => bb,
    getBoundingBoxTri: () => bb,
  }
  return fns as any
}

describe('computeEffectiveDeflection', () => {
  it('returns scalar deflections when relative is off (default)', () => {
    const k = kernelWith({ xmin: 0, xmax: 10, ymin: 0, ymax: 10, zmin: 0, zmax: 10 })
    const { linearDeflection, angularDeflection } = computeEffectiveDeflection(k, {} as never)
    expect(linearDeflection).toBe(DEFAULT_LD)
    expect(angularDeflection).toBe(0.5)
  })

  it('uses caller-provided deflection overrides (relative off)', () => {
    const k = kernelWith({ xmin: 0, xmax: 10, ymin: 0, ymax: 10, zmin: 0, zmax: 10 })
    const r = computeEffectiveDeflection(k, {} as never, {
      linearDeflection: 2.5,
      angularDeflection: 0.25,
    })
    expect(r.linearDeflection).toBe(2.5)
    expect(r.angularDeflection).toBe(0.25)
  })

  it('scales linear deflection by the bounding-box diagonal when relative', () => {
    // box 3x4x... choose 3,4,? diag = 5 requires (3,4,0)
    const k = kernelWith({ xmin: 0, xmax: 3, ymin: 0, ymax: 4, zmin: 0, zmax: 0 })
    const r = computeEffectiveDeflection(k, {}, { relative: true })
    // diag = sqrt(3² + 4²) = 5
    expect(r.linearDeflection).toBeCloseTo(DEFAULT_LD * 5)
    expect(r.angularDeflection).toBe(0.5)
  })

  it('falls back to non-relative defaults when the kernel cannot produce a bbox', () => {
    const k = { getBoundingBox: () => { throw new Error('kernel fail') } } as never
    const r = computeEffectiveDeflection(k, {}, { relative: true })
    expect(r.linearDeflection).toBe(DEFAULT_LD)
    expect(r.angularDeflection).toBe(0.5)
  })

  it('falls back to triangulation when exact bbox throws', () => {
    let calls = 0
    const k = {
      getBoundingBox: (s: unknown, useTri?: boolean) => {
        calls++
        if (useTri) return { xmin: 0, xmax: 1, ymin: 0, ymax: 1, zmin: 0, zmax: 1 }
        throw new Error('exact fail')
      },
    } as never
    const r = computeEffectiveDeflection(k, {}, { relative: true })
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(r.linearDeflection).toBeCloseTo(DEFAULT_LD * Math.sqrt(3))
  })
})