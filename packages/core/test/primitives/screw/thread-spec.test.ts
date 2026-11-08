/**
 * primitives/screw/thread-spec — parseThreadSpec unit tests (plan U1).
 *
 * Pins the drawing-callout grammar: metric / imperial / pipe bodies,
 * tolerance-class suffix ('-6H' / '-2B'), depth suffix ('↧' / '↓' → depth),
 * space & case tolerance, specLabel normalization (no class, no depth), the
 * metric table extension to M64 (ISO 261 values asserted), and explicit
 * E_THREAD_SPEC failures — never a silent fallback.
 *
 * OCR variant whitelist (three layers, security-hardened):
 *   L1 character equivalence classes (NFKC, dash/×/quote/arrow lookalikes,
 *      digit-comma decimals, leading-dot inches, edge-junk strip);
 *   L2 THRU/THROUGH and '<n> DEEP' keyword suffixes (contradictions reject);
 *   L3 closed-alphabet class repair ('GH'→'6H', unique candidate only — the
 *      GOTCHA test pins the TPI-never-stolen guard);
 *   security boundary: homoglyphs / control chars / injection payloads /
 *      overlong input all reject; error suggestions never auto-apply.
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

describe('parseThreadSpec — OCR L1: character equivalence classes', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Ｍ１６', 'M16'],              // full-width (NFKC)
    ['１／４＂－２０', '1/4"-20'],  // full-width incl. ／ ＂ －
    ['M16–6H', 'M16-6H'],           // en dash U+2013
    ['M16−6H', 'M16-6H'],           // minus sign U+2212
    ['M16—6H', 'M16-6H'],           // em dash U+2014
    ['M16*2', 'M16×2'],             // '*' → ×
    ['M16·2', 'M16×2'],             // middle dot U+00B7 → ×
    ['M16∗2', 'M16×2'],             // asterisk operator U+2217 → ×
    ['1/4”-20', '1/4"-20'],         // curly right double quote U+201D
    ['1/4″-20', '1/4"-20'],         // double prime U+2033
    ['M16⇩18', 'M16↓18'],          // U+21E9 → ↓
    ['M16⤓18', 'M16↓18'],          // U+2913 → ↓
    ['M16×1,5', 'M16×1.5'],         // digit-comma decimal
    ['M16×1, 5', 'M16×1.5'],        // digit-comma decimal with space
    ['.25"', '0.25"'],              // leading-dot decimal inch
  ]
  for (const [variant, canonical] of cases) {
    it(`${JSON.stringify(variant)} ≡ ${JSON.stringify(canonical)}`, () => {
      expect(parseThreadSpec(variant)).toEqual(parseThreadSpec(canonical))
    })
  }

  it('OCR edge junk stripped: "  (M16)  " and "M16。" parse as M16', () => {
    expect(parseThreadSpec('  (M16)  ')).toEqual(parseThreadSpec('M16'))
    expect(parseThreadSpec('M16。')).toEqual(parseThreadSpec('M16'))
  })

  it('fraction glyph: ½" canonicalizes to the 1/2" table entry (NFKC + U+2044 map)', () => {
    expect(parseThreadSpec('½"').specLabel).toBe('1/2"')
  })
})

describe('parseThreadSpec — OCR L2: THRU / DEEP keyword suffixes', () => {
  it("'M16 THRU': thru=true, depth undefined; 'M16 THROUGH' and 'M16THRU' equivalent", () => {
    for (const s of ['M16 THRU', 'M16 THROUGH', 'M16THRU']) {
      const r = parseThreadSpec(s)
      expect(r.thru).toBe(true)
      expect(r.depth).toBeUndefined()
      expect(r.specLabel).toBe('M16')
    }
  })

  it("'M16' (no keyword) carries no thru field at all", () => {
    expect(parseThreadSpec('M16').thru).toBeUndefined()
  })

  it("'1/4\"-20-2B THRU': class + through on imperial", () => {
    const r = parseThreadSpec('1/4"-20-2B THRU')
    expect(r.toleranceClass).toBe('2B')
    expect(r.thru).toBe(true)
    expect(r.specLabel).toBe('1/4"-20')
  })

  it("'PT1/8 THRU': pipe through hole", () => {
    const r = parseThreadSpec('PT1/8 THRU')
    expect(r.system).toBe('pipe')
    expect(r.thru).toBe(true)
  })

  it("'M16 18 DEEP': bare-number depth ≡ ↧18 (no thru)", () => {
    expect(parseThreadSpec('M16 18 DEEP')).toEqual(parseThreadSpec('M16↧18'))
  })

  it("'M16-6H 18 DEEP': class + DEEP depth", () => {
    const r = parseThreadSpec('M16-6H 18 DEEP')
    expect(r.toleranceClass).toBe('6H')
    expect(r.depth).toBe(18)
    expect(r.thru).toBeUndefined()
  })

  it("'PT1/8 12 DEEP': pipe + DEEP depth", () => {
    expect(parseThreadSpec('PT1/8 12 DEEP').depth).toBe(12)
  })

  it("'M16 0 DEEP': zero DEEP depth rejected", () => {
    expect(() => parseThreadSpec('M16 0 DEEP')).toThrow(ThreadSpecError)
  })

  it("'M16↧18 THRU': THRU + ↓ depth contradiction", () => {
    expect(() => parseThreadSpec('M16↧18 THRU')).toThrow(/through hole has no depth/)
  })

  it("'M16 18 DEEP THRU' and 'M16 THRU 18 DEEP': THRU + DEEP contradiction", () => {
    expect(() => parseThreadSpec('M16 18 DEEP THRU')).toThrow(ThreadSpecError)
    expect(() => parseThreadSpec('M16 THRU 18 DEEP')).toThrow(ThreadSpecError)
  })

  it("'M16↧18 DEEP': ↓ + DEEP rejected (keep exactly one depth notation)", () => {
    expect(() => parseThreadSpec('M16↧18 DEEP')).toThrow(ThreadSpecError)
  })
})

describe('parseThreadSpec — Chinese drawing keywords (完全贯穿 / 深<n> / ▼<n>)', () => {
  it("'M16-6H 完全贯穿' ≡ 'M16-6H THRU': CN through keyword", () => {
    expect(parseThreadSpec('M16-6H 完全贯穿')).toEqual(parseThreadSpec('M16-6H THRU'))
  })

  it("'M16完全贯穿' (no space) parses as through", () => {
    expect(parseThreadSpec('M16完全贯穿').thru).toBe(true)
  })

  it("'PT1/8 完全贯穿': CN through on pipe", () => {
    expect(parseThreadSpec('PT1/8 完全贯穿').thru).toBe(true)
  })

  it("'M16深18' / 'M16 深18' ≡ 'M16↧18': CN depth prefix", () => {
    expect(parseThreadSpec('M16深18')).toEqual(parseThreadSpec('M16↧18'))
    expect(parseThreadSpec('M16 深18')).toEqual(parseThreadSpec('M16↓18'))
  })

  it("'M16▼18': ▼ (U+25BC, CN drawing arrow) ≡ ↓", () => {
    expect(parseThreadSpec('M16▼18').depth).toBe(18)
  })

  it("'M16-6H 深18': class + CN depth", () => {
    const r = parseThreadSpec('M16-6H 深18')
    expect(r.toleranceClass).toBe('6H')
    expect(r.depth).toBe(18)
  })

  it("'M16 深18 THRU': CN depth + through contradiction rejects", () => {
    expect(() => parseThreadSpec('M16 深18 THRU')).toThrow(/through hole has no depth/)
  })

  it("'M16深0': zero CN depth rejected", () => {
    expect(() => parseThreadSpec('M16深0')).toThrow(ThreadSpecError)
  })

  it("'M16 贯穿' (unenumerated shorter keyword) stays outside the whitelist", () => {
    expect(() => parseThreadSpec('M16 贯穿')).toThrow(ThreadSpecError)
  })
})

describe('parseThreadSpec — OCR L3: closed-alphabet class repair (unique candidate only)', () => {
  it("'M16-GH' repairs to 6H (G/6 confusion)", () => {
    expect(parseThreadSpec('M16-GH').toleranceClass).toBe('6H')
  })

  it("'M16-SH' repairs to 5H", () => {
    expect(parseThreadSpec('M16-SH').toleranceClass).toBe('5H')
  })

  it("'M16-6N' repairs to 6H (N/H confusion)", () => {
    expect(parseThreadSpec('M16-6N').toleranceClass).toBe('6H')
  })

  it("'M16-4N' repairs to 4H", () => {
    expect(parseThreadSpec('M16-4N').toleranceClass).toBe('4H')
  })

  it("'1/4\"-20-ZB' repairs to 2B", () => {
    expect(parseThreadSpec('1/4"-20-ZB').toleranceClass).toBe('2B')
  })

  it("'1/4\"-IB' repairs to 1B (I/1 confusion)", () => {
    expect(parseThreadSpec('1/4"-IB').toleranceClass).toBe('1B')
  })

  it("'M16-6B' rejects (B has no G/H lookalike target)", () => {
    expect(() => parseThreadSpec('M16-6B')).toThrow(ThreadSpecError)
  })

  it("'M16-9Z' rejects", () => {
    expect(() => parseThreadSpec('M16-9Z')).toThrow(ThreadSpecError)
  })

  it("'M16-SB' rejects (5B is not a metric class)", () => {
    expect(() => parseThreadSpec('M16-SB')).toThrow(ThreadSpecError)
  })

  it("'1/4\"-20-2D' rejects", () => {
    expect(() => parseThreadSpec('1/4"-20-2D')).toThrow(ThreadSpecError)
  })

  // GOTCHA: TPI must never be stolen as a repaired class — '8'→'B' would turn
  // '-18' (a TPI) into class 1B and silently drop the TPI. Repair runs only
  // on letter-tailed tokens ('-2B'), never digit-tailed ones ('-18').
  it("'1/4\"-18' stays TPI 18, never repaired into class 1B (CRITICAL guard)", () => {
    const r = parseThreadSpec('1/4"-18')
    expect(r.toleranceClass).toBeUndefined()
    expect(r.specLabel).toBe('1/4"-18')
    expect(r.pitch).toBeCloseTo(25.4 / 18, 9)
  })

  it("'1/4\"-20' stays TPI 20 (digit-tailed token is a TPI, not a class)", () => {
    const r = parseThreadSpec('1/4"-20')
    expect(r.toleranceClass).toBeUndefined()
    expect(r.specLabel).toBe('1/4"-20')
  })
})

describe('parseThreadSpec — security boundary (out-of-whitelist explicit rejects)', () => {
  const hostile = [
    'М16',                        // Cyrillic М U+041C homoglyph
    'M1Ο',                        // Greek capital omicron U+039F
    'M16\u200B-6H',               // zero-width space injection
    'M16\u202E6H',                // RTL override bidi spoofing
    '\uFEFFM16',                  // BOM / zero-width no-break space
    'M16; DROP TABLE parts',      // SQL injection payload
    '<svg onload=alert(1)>M16',   // XSS markup payload
    'M16`rm -rf /`',              // shell injection payload
    'M16 HELLO',                  // out-of-whitelist keyword
  ]
  for (const s of hostile) {
    it(`${JSON.stringify(s)} throws ThreadSpecError`, () => {
      expect(() => parseThreadSpec(s)).toThrow(ThreadSpecError)
      expect(() => parseThreadSpec(s)).toThrow(/E_THREAD_SPEC/)
    })
  }

  it('overlong input (>64 chars) rejected before any normalization work', () => {
    expect(() => parseThreadSpec('M' + '1'.repeat(80))).toThrow(ThreadSpecError)
  })

  it('length cap 64 is generous: longest legit callouts still pass', () => {
    expect(parseThreadSpec('1/4"-20-2B↧999.99').depth).toBe(999.99)
    expect(parseThreadSpec('M64×6-8H 999.99 DEEP').depth).toBe(999.99)
  })
})

describe('parseThreadSpec — error suggestions (nearest table entry, never auto-applied)', () => {
  it("'M1O' throws and suggests 'M10' (O/0 half-cost beats the 1-edit ties)", () => {
    expect(() => parseThreadSpec('M1O')).toThrow(/nearest table entry: 'M10'/)
  })

  it("'M17' throws and suggests 'M16' (numeric tiebreak among 1-edit ties)", () => {
    expect(() => parseThreadSpec('M17')).toThrow(/nearest table entry: 'M16'/)
  })

  it("'M99' throws and suggests 'M64'", () => {
    expect(() => parseThreadSpec('M99')).toThrow(/nearest table entry: 'M64'/)
  })

  it("'NPT1/2' throws and suggests the pipe entry 'PT1/2'", () => {
    expect(() => parseThreadSpec('NPT1/2')).toThrow(/nearest table entry: 'PT1\/2'/)
  })

  it("no suggestion beyond 2 OCR edits: 'M16 HELLO' stays a plain error", () => {
    expect(() => parseThreadSpec('M16 HELLO')).toThrow(/cannot parse metric spec/)
  })
})
