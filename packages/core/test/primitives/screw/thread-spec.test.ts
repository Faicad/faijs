/**
 * primitives/screw/thread-spec — parseThreadSpec unit tests (plan U1).
 *
 * Pins the drawing-callout grammar: metric / imperial / pipe bodies,
 * tolerance-class suffix ('-6H' / '-2B'), depth suffix ('↧' / '↓' → depth),
 * space & case tolerance, specLabel normalization (no class, no depth), the
 * metric table extension to M64 (ISO 261 values asserted), and explicit
 * E_THREAD_SPEC failures — never a silent fallback.
 *
 * Run: npx vitest run test/primitives/screw/thread-spec.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseThreadSpec, ThreadSpecError } from '../../../src/primitives/screw/thread-spec'
import type { ResolvedThreadSpec } from '../../../src/primitives/screw/thread-spec'
import { getScrewSpec, threadToPitchMm, PIPE_SPECS } from '../../../src/primitives/screw/screw-db'

describe('parseThreadSpec — metric', () => {
  it('M16: coarse defaults, pilot = dia − pitch, no class/depth', () => {
    const r: ResolvedThreadSpec = parseThreadSpec('M16')
    expect(r.system).toBe('metric')
    expect(r.specIdx).toBe(10)
    expect(r.nominalDiameter).toBe(16)
    expect(r.pitch).toBeCloseTo(2, 9)
    expect(r.specLabel).toBe('M16')
    expect(r.pilotDia).toBe(14)
    expect(r.toleranceClass).toBeUndefined()
    expect(r.depth).toBeUndefined()
  })

  it('M16×1.5 / m16x1.5 / "M16 X 1.5": explicit pitch, case & space tolerant', () => {
    for (const s of ['M16×1.5', 'm16x1.5', 'M16 X 1.5']) {
      const r = parseThreadSpec(s)
      expect(r.pitch).toBeCloseTo(1.5, 9)
      expect(r.specLabel).toBe('M16×1.5')
      expect(r.pilotDia).toBe(14.5)
    }
  })

  it('M2.5 resolves to the fractional table entry', () => {
    const r = parseThreadSpec('M2.5')
    expect(r.specIdx).toBe(1)
    expect(r.specLabel).toBe('M2.5')
  })

  it('metric table extends to M64 with ISO 261 coarse/fine values', () => {
    const expected: ReadonlyArray<readonly [string, number, number]> = [
      ['M30', 3.5, 2], ['M36', 4, 3], ['M42', 4.5, 3],
      ['M48', 5, 3], ['M56', 5.5, 4], ['M64', 6, 4],
    ]
    for (const [label, coarse, fine] of expected) {
      const r = parseThreadSpec(label)
      const spec = getScrewSpec('metric', r.specIdx)
      expect(spec.label).toBe(label)
      expect(r.pitch).toBeCloseTo(coarse, 9)
      expect(r.pilotDia).toBeCloseTo(Number(label.slice(1)) - coarse, 9)
      expect(spec.fine).toBe(fine)
    }
  })
})

describe('parseThreadSpec — combined suffixes (D10)', () => {
  it("'M4 X 0.7 - 6H': class from string, specLabel without class/depth", () => {
    const r = parseThreadSpec('M4 X 0.7 - 6H')
    expect(r.system).toBe('metric')
    expect(r.nominalDiameter).toBe(4)
    expect(r.pitch).toBeCloseTo(0.7, 9)
    expect(r.toleranceClass).toBe('6H')
    expect(r.specLabel).toBe('M4×0.7')
    expect(r.pilotDia).toBe(3.3)
    expect(r.depth).toBeUndefined()
  })

  it("'M16-6H↧18': depth from ↧ suffix; '↓' equivalent", () => {
    const a = parseThreadSpec('M16-6H↧18')
    const b = parseThreadSpec('M16-6H↓18')
    expect(a.toleranceClass).toBe('6H')
    expect(a.depth).toBe(18)
    expect(a.specLabel).toBe('M16')
    expect(b.depth).toBe(18)
  })

  it('G-class (plating allowance) accepted: M16-6G', () => {
    expect(parseThreadSpec('M16-6G').toleranceClass).toBe('6G')
  })
})

describe('parseThreadSpec — imperial', () => {
  it('1/4"-20: fraction + TPI', () => {
    const r = parseThreadSpec('1/4"-20')
    expect(r.system).toBe('imperial')
    expect(r.specIdx).toBe(4)
    expect(r.nominalDiameter).toBeCloseTo(6.35, 9)
    expect(r.pitch).toBeCloseTo(1.27, 9)
    expect(r.specLabel).toBe('1/4"-20')
    expect(r.pilotDia).toBe(5.08)
  })

  it('#4-40: gauge form', () => {
    const r = parseThreadSpec('#4-40')
    expect(r.nominalDiameter).toBeCloseTo(2.844, 9)
    expect(r.pitch).toBeCloseTo(0.635, 9)
    expect(r.specLabel).toBe('#4-40')
  })

  it('1/4": omitted TPI defaults to coarse', () => {
    const r = parseThreadSpec('1/4"')
    expect(r.pitch).toBeCloseTo(1.27, 9)
    expect(r.specLabel).toBe('1/4"')
  })

  it('0.25" decimal form canonicalizes to the table label', () => {
    expect(parseThreadSpec('0.25"').specLabel).toBe('1/4"')
  })

  it("'1/4\"-20-2B↧10': TPI + class + depth together", () => {
    const r = parseThreadSpec('1/4"-20-2B↧10')
    expect(r.toleranceClass).toBe('2B')
    expect(r.depth).toBe(10)
    expect(r.specLabel).toBe('1/4"-20')
  })
})

describe('parseThreadSpec — pipe', () => {
  it('PT1/8: tabulated tap drill, not majorDia − pitch', () => {
    const r = parseThreadSpec('PT1/8')
    expect(r.system).toBe('pipe')
    expect(r.specIdx).toBe(0)
    expect(r.nominalDiameter).toBeCloseTo(9.728, 9)
    expect(r.pitch).toBeCloseTo(0.907, 9)
    expect(r.pilotDia).toBe(8.4)
    expect(r.specLabel).toBe('PT1/8')
  })

  it('R / Rc aliases resolve to the same PT table entry', () => {
    expect(parseThreadSpec('R1/2').specLabel).toBe('PT1/2')
    expect(parseThreadSpec('rc3/8').specLabel).toBe('PT3/8')
    expect(parseThreadSpec('R1/2').specIdx).toBe(3)
  })

  it('PT1/8↧12: depth suffix', () => {
    expect(parseThreadSpec('PT1/8↧12').depth).toBe(12)
  })
})

describe('parseThreadSpec — explicit failures (E_THREAD_SPEC, no silent fallback)', () => {
  const bad = [
    'NPT1/2',   // unsupported standard
    'M99',      // outside the metric table
    'M16x',     // trailing × without pitch
    '-9Z',      // tolerance class outside [4-8][GH]
    'M16-9Z',   // idem, in-string
    'PT1/8-6H', // pipe takes no class suffix
    '',         // empty
    '   ',      // whitespace only
    'M16↓0',    // zero depth suffix is not a callout
    'M16×0',    // zero pitch
    'M16-6H-6H', // duplicated class
  ]
  for (const s of bad) {
    it(`${JSON.stringify(s)} throws ThreadSpecError`, () => {
      expect(() => parseThreadSpec(s)).toThrow(ThreadSpecError)
      expect(() => parseThreadSpec(s)).toThrow(/E_THREAD_SPEC/)
    })
  }

  it('ThreadSpecError is an Error carrying code E_THREAD_SPEC', () => {
    const e = new ThreadSpecError('probe')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('E_THREAD_SPEC')
    expect(e.message).toContain('probe')
  })
})

describe('parseThreadSpec — equivalence with the three-key path (U12 parser half)', () => {
  it("thread:'M16' and screwSystem:'metric' + screwSpecIdx:10 + coarse resolve identically", () => {
    const r = parseThreadSpec('M16')
    const spec = getScrewSpec('metric', 10)
    const pitch = threadToPitchMm('metric', spec, 'coarse')
    expect(r.specIdx).toBe(10)
    expect(r.specLabel).toBe(spec.label)
    expect(r.pitch).toBeCloseTo(pitch, 9)
    expect(r.pilotDia).toBe(Math.round((spec.dia - pitch) * 1000) / 1000)
  })

  it('pipe parity: PT1/8 matches PIPE_SPECS[0]', () => {
    const r = parseThreadSpec('PT1/8')
    expect(r.pilotDia).toBe(PIPE_SPECS[0]!.pilotDia)
    expect(r.specLabel).toBe(PIPE_SPECS[0]!.label)
  })
})
