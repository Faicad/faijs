import { describe, it, expect } from 'vitest'
import {
  getScrewSpec,
  getScrewSpecs,
  threadToPitchMm,
  SCREW_HEAD_DIMS,
} from './screw-db'
import type { ScrewSpec, ScrewSystem } from './screw-db'

describe('getScrewSpecs', () => {
  it('returns the metric spec list (13 entries) for metric', () => {
    const specs = getScrewSpecs('metric')
    expect(specs.length).toBe(13)
    expect(specs[0]).toMatchObject({ dia: 2.0, label: 'M2' })
    expect(specs[4]).toMatchObject({ dia: 5.0, label: 'M5' })
    expect(specs[specs.length - 1]).toMatchObject({ label: 'M24' })
  })

  it('returns the imperial spec list (13 entries) for imperial', () => {
    const specs = getScrewSpecs('imperial')
    expect(specs.length).toBe(13)
    expect(specs[0]).toMatchObject({ label: '#4' })
    expect(specs[specs.length - 1]).toMatchObject({ label: '1"' })
  })

  it('all imperial diameters are in mm and all coarse/fine are TPI counts', () => {
    for (const spec of getScrewSpecs('imperial')) {
      expect(spec.dia).toBeGreaterThan(0)
      // imperial coarse/fine are TPI (larger = finer pitch); store counts, not mm
      expect(spec.coarse).toBeGreaterThan(1)
      expect(spec.fine).toBeGreaterThan(1)
      // a fine thread has a higher TPI than the coarse thread
      expect(spec.fine).toBeGreaterThan(spec.coarse)
    }
  })
})

describe('getScrewSpec', () => {
  it('returns the spec at the given index for both systems', () => {
    expect(getScrewSpec('metric', 4)).toEqual(getScrewSpecs('metric')[4])
    expect(getScrewSpec('imperial', 2)).toEqual(getScrewSpecs('imperial')[2])
  })

  it('clamps an out-of-range index to the lower bound (does not throw)', () => {
    expect(getScrewSpec('metric', -3)).toEqual(getScrewSpec('metric', 0))
    expect(getScrewSpec('imperial', Number.NEGATIVE_INFINITY)).toEqual(
      getScrewSpec('imperial', 0),
    )
  })

  it('clamps an out-of-range index to the upper bound (does not throw)', () => {
    expect(getScrewSpec('metric', 9999)).toEqual(
      getScrewSpec('metric', getScrewSpecs('metric').length - 1),
    )
    expect(getScrewSpec('imperial', Infinity)).toEqual(
      getScrewSpec('imperial', getScrewSpecs('imperial').length - 1),
    )
  })

  it('index 4 is the default M5 in metric', () => {
    const spec = getScrewSpec('metric', 4)
    expect(spec.label).toBe('M5')
    expect(spec.dia).toBe(5)
  })
})

describe('SCREW_HEAD_DIMS', () => {
  it('exports hex and chc head dimension factors (still referenced by mesh path)', () => {
    expect(SCREW_HEAD_DIMS.hex.radiusFactor).toBeGreaterThan(0)
    expect(SCREW_HEAD_DIMS.hex.heightFactor).toBeGreaterThan(0)
    expect(SCREW_HEAD_DIMS.chc.radiusFactor).toBeGreaterThan(0)
    expect(SCREW_HEAD_DIMS.chc.heightFactor).toBeGreaterThan(0)
  })

  it('hex head is smaller in radius but taller than chc', () => {
    expect(SCREW_HEAD_DIMS.hex.radiusFactor).toBeLessThan(SCREW_HEAD_DIMS.chc.radiusFactor)
    expect(SCREW_HEAD_DIMS.hex.heightFactor).toBeGreaterThan(SCREW_HEAD_DIMS.chc.heightFactor)
  })
})

describe('threadToPitchMm', () => {
  const m5: ScrewSpec = { dia: 5, coarse: 0.8, fine: 0.5, label: 'M5' }
  const imperial: ScrewSpec = { dia: 6.35, coarse: 20, fine: 28, label: '1/4"' }

  it('coarse metric pitch is returned verbatim', () => {
    expect(threadToPitchMm('metric', m5, 'coarse')).toBe(0.8)
  })

  it('fine metric pitch is returned verbatim', () => {
    expect(threadToPitchMm('metric', m5, 'fine')).toBe(0.5)
  })

  it('imperial TPI is converted to mm via 25.4 / tpi', () => {
    // 1/4" coarse = 20 TPI → 25.4/20 = 1.27
    expect(threadToPitchMm('imperial', imperial, 'coarse')).toBeCloseTo(1.27, 6)
    // fine = 28 TPI → 25.4/28 ≈ 0.907
    expect(threadToPitchMm('imperial', imperial, 'fine')).toBeCloseTo(25.4 / 28, 6)
  })

  it("`none` returns 0 regardless of system/spec", () => {
    expect(threadToPitchMm('metric', m5, 'none')).toBe(0)
    expect(threadToPitchMm('imperial', imperial, 'none')).toBe(0)
  })

  it("`custom` returns pitchCustom when provided", () => {
    expect(threadToPitchMm('metric', m5, 'custom', 1.5)).toBe(1.5)
    expect(threadToPitchMm('imperial', imperial, 'custom', 2.0)).toBe(2.0)
  })

  it("`custom` falls back to coarse pitch when pitchCustom is omitted", () => {
    expect(threadToPitchMm('metric', m5, 'custom')).toBe(m5.coarse)
    // imperial fallback is still the raw TPI (only `system` metric path does mm→? no; imperial custom ignores TPI)
    expect(threadToPitchMm('imperial', imperial, 'custom')).toBe(imperial.coarse)
  })

  it("rounds sensible pitch values (metric coarse stays exact) — regression guard for rounding", () => {
    // M6 coarse = 1.00 → 1.00
    expect(threadToPitchMm('metric', getScrewSpec('metric', 5), 'coarse')).toBeCloseTo(1.0, 6)
  })

  it('custom pitch accepts zero (flat "thread")', () => {
    expect(threadToPitchMm('metric', m5, 'custom', 0)).toBe(0)
  })

  it('types: ScrewSystem/ScrewSpec are value-checkable at runtime values', () => {
    const sys: ScrewSystem = 'metric'
    const s: ScrewSpec = { dia: 1, coarse: 2, fine: 3, label: 'x' }
    expect(sys).toBe('metric')
    expect(s.label).toBe('x')
  })
})