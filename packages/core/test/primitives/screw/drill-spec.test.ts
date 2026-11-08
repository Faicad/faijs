/**
 * primitives/screw/drill-spec — parseDrillSpec unit tests.
 *
 * Pins the drill-callout grammar: diameter body, depth suffixes
 * ('↧'/'↓'/'▼'/'深<n>'/'<n> DEEP'), THRU/THROUGH/完全贯穿, the through-hole
 * default for a suffix-less callout, and the shared OCR whitelist
 * (diameter-symbol variants Ø/⌀/Φ/φ/ϕ/∅, NFKC, edge junk, comma decimals).
 *
 * GOTCHA pin (multi-number guard BEFORE compaction): 'Ø2.5 10' must reject —
 * compacting it would silently read as a valid 2.51 mm pilot.
 *
 * Security boundary: homoglyphs / control chars / injection payloads /
 * overlong input all reject with E_THREAD_SPEC — never a silent fallback.
 *
 * Run: npx vitest run test/primitives/screw/drill-spec.test.ts
 */

import { describe, it, expect } from 'vitest'
import { parseDrillSpec } from '../../../src/primitives/screw/drill-spec'
import type { ResolvedDrillSpec } from '../../../src/primitives/screw/drill-spec'
import { ThreadSpecError } from '../../../src/primitives/screw/thread-spec'

describe('parseDrillSpec — base grammar', () => {
  it("'Ø2.5 完全贯穿': through pilot", () => {
    const r: ResolvedDrillSpec = parseDrillSpec('Ø2.5 完全贯穿')
    expect(r.diameter).toBe(2.5)
    expect(r.depth).toBe(0)
    expect(r.thru).toBe(true)
  })

  it("'Ø2.5' (no suffix) defaults to a through hole", () => {
    const r = parseDrillSpec('Ø2.5')
    expect(r.diameter).toBe(2.5)
    expect(r.depth).toBe(0)
    expect(r.thru).toBe(true)
  })

  it("'Ø5 深10': blind depth, thru false", () => {
    const r = parseDrillSpec('Ø5 深10')
    expect(r.diameter).toBe(5)
    expect(r.depth).toBe(10)
    expect(r.thru).toBe(false)
  })

  it("'Ø5深10' (no space) ≡ 'Ø5 ↓10'", () => {
    expect(parseDrillSpec('Ø5深10')).toEqual(parseDrillSpec('Ø5 ↓10'))
  })

  it("depth arrows: '↧' / '↓' / '▼' all → depth", () => {
    expect(parseDrillSpec('Ø5 ↧10').depth).toBe(10)
    expect(parseDrillSpec('Ø5 ↓10').depth).toBe(10)
    expect(parseDrillSpec('Ø5 ▼10').depth).toBe(10)
  })

  it("'Ø14 18 DEEP' ≡ 'Ø14 ↓18'", () => {
    expect(parseDrillSpec('Ø14 18 DEEP')).toEqual(parseDrillSpec('Ø14 ↓18'))
  })

  it("'Ø2.5 THRU' / 'Ø2.5 THROUGH' / 'Ø2.5THRU': through", () => {
    for (const s of ['Ø2.5 THRU', 'Ø2.5 THROUGH', 'Ø2.5THRU']) {
      const r = parseDrillSpec(s)
      expect(r.diameter).toBe(2.5)
      expect(r.depth).toBe(0)
      expect(r.thru).toBe(true)
    }
  })

  it('fractional / decimal diameters: Ø5.5, Ø0.6', () => {
    expect(parseDrillSpec('Ø5.5 深12').diameter).toBe(5.5)
    expect(parseDrillSpec('Ø0.6').diameter).toBe(0.6)
  })
})

describe('parseDrillSpec — OCR L1: character equivalence whitelist', () => {
  it('diameter symbol variants Ø/⌀/Φ/φ/ϕ/∅/ø all resolve', () => {
    for (const s of ['Ø2.5 完全贯穿', '⌀2.5 完全贯穿', 'Φ2.5 完全贯穿', 'φ2.5 完全贯穿', 'ϕ2.5 完全贯穿', '∅2.5 完全贯穿', 'ø2.5 完全贯穿']) {
      const r = parseDrillSpec(s)
      expect(r.diameter).toBe(2.5)
      expect(r.thru).toBe(true)
    }
  })

  it('full-width digits NFKC-fold: Ｏ... → still rejected (letter), but ／ and full-width digits work via NFKC', () => {
    // Full-width digits fold through NFKC: 'Ø２.５' → 'Ø2.5'.
    expect(parseDrillSpec('Ø２.５').diameter).toBe(2.5)
  })

  it('comma decimal: ⌀2,5 ≡ Ø2.5', () => {
    expect(parseDrillSpec('⌀2,5 深10')).toEqual(parseDrillSpec('Ø2.5 ↓10'))
  })

  it('OCR edge junk stripped: "  (Ø2.5)  " and "（Ø2.5 完全贯穿）" parse clean', () => {
    expect(parseDrillSpec('  (Ø2.5)  ')).toEqual(parseDrillSpec('Ø2.5'))
    expect(parseDrillSpec('（Ø2.5 完全贯穿）')).toEqual(parseDrillSpec('Ø2.5 完全贯穿'))
  })
})

describe('parseDrillSpec — GOTCHA: bare second number (reject BEFORE compaction)', () => {
  // 'Ø2.5 10' compacting to 'Ø2.510' would read as a VALID 2.51 mm pilot —
  // the multi-number guard must fire before whitespace removal.
  it("'Ø2.5 10' rejects (never silently becomes Ø2.510 / a depth)", () => {
    expect(() => parseDrillSpec('Ø2.5 10')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('Ø2.5 10')).toThrow(/bare second number/)
  })

  it("'Ø5 10 20' rejects", () => {
    expect(() => parseDrillSpec('Ø5 10 20')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 10.5' rejects too (decimal bare number is still a second number)", () => {
    expect(() => parseDrillSpec('Ø2.5 10.5')).toThrow(ThreadSpecError)
  })
})

describe('parseDrillSpec — contradictions & malformed', () => {
  it("'Ø2.5 ↓10 THRU': THRU + depth contradiction (trailing keyword order)", () => {
    expect(() => parseDrillSpec('Ø2.5 ↓10 THRU')).toThrow(/through hole has no depth/)
  })

  it("'Ø2.5 THRU ↓10' rejects too (mid-string THRU fails the closed alphabet)", () => {
    expect(() => parseDrillSpec('Ø2.5 THRU ↓10')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 完全贯穿 深10': CN through + CN depth contradiction", () => {
    expect(() => parseDrillSpec('Ø2.5 完全贯穿 深10')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 10 DEEP THRU' and 'Ø2.5 THRU 10 DEEP': THRU + DEEP contradiction", () => {
    expect(() => parseDrillSpec('Ø2.5 10 DEEP THRU')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('Ø2.5 THRU 10 DEEP')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 ↓10 深8': two depth notations reject", () => {
    expect(() => parseDrillSpec('Ø2.5 ↓10 深8')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 深0' / 'Ø2.5 0 DEEP' / 'Ø2.5 ↓0': zero depth rejected", () => {
    expect(() => parseDrillSpec('Ø2.5 深0')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('Ø2.5 0 DEEP')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('Ø2.5 ↓0')).toThrow(ThreadSpecError)
  })

  it("'2.5' (no diameter symbol) rejected", () => {
    expect(() => parseDrillSpec('2.5')).toThrow(ThreadSpecError)
  })

  it("'Ø' alone and 'Ø0' rejected", () => {
    expect(() => parseDrillSpec('Ø')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('Ø0')).toThrow(ThreadSpecError)
  })

  it("'Ø2.5 DEEP' (keyword without a number) rejected by the alphabet guard", () => {
    expect(() => parseDrillSpec('Ø2.5 DEEP')).toThrow(ThreadSpecError)
  })
})

describe('parseDrillSpec — security boundary (out-of-whitelist explicit rejects)', () => {
  const hostile = [
    'О2.5',                       // Cyrillic О U+041E homoglyph (not a diameter symbol)
    'Θ2.5',                       // Greek capital theta
    'Ø2.5\u200B',                 // zero-width space injection
    'Ø2.5\u202E10',               // RTL override bidi spoofing
    '\uFEFFØ2.5',                 // BOM / zero-width no-break space
    'Ø2.5; DROP TABLE parts',     // SQL injection payload
    '<svg onload=alert(1)>Ø2.5',  // XSS markup payload
    'Ø2.5`rm -rf /`',             // shell injection payload
    'Ø2.5 通孔',                   // out-of-whitelist CN keyword (only 完全贯穿/深 enumerated)
    '钻 Ø2.5',                    // out-of-whitelist CN lead-in
  ]
  for (const s of hostile) {
    it(`${JSON.stringify(s)} throws ThreadSpecError`, () => {
      expect(() => parseDrillSpec(s)).toThrow(ThreadSpecError)
      expect(() => parseDrillSpec(s)).toThrow(/E_THREAD_SPEC/)
    })
  }

  it('overlong input (>64 chars) rejected before any normalization work', () => {
    expect(() => parseDrillSpec('Ø' + '1'.repeat(80))).toThrow(ThreadSpecError)
  })

  it('empty / non-string input rejected', () => {
    expect(() => parseDrillSpec('')).toThrow(ThreadSpecError)
    expect(() => parseDrillSpec('   ')).toThrow(ThreadSpecError)
    // @ts-expect-error — defensive runtime check for non-string callers
    expect(() => parseDrillSpec(2.5)).toThrow(ThreadSpecError)
  })

  it('error carries the shared code E_THREAD_SPEC and drill grammar help', () => {
    try {
      parseDrillSpec('2.5')
      expect.unreachable()
    } catch (err) {
      const e = err as ThreadSpecError
      expect(e).toBeInstanceOf(ThreadSpecError)
      expect(e.code).toBe('E_THREAD_SPEC')
      expect(e.message).toMatch(/Ø<diameter>/u)
    }
  })
})
