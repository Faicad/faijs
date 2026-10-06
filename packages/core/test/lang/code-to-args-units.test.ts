/**
 * P7/D10 codeToArgs unit literal parsing tests.
 *
 * Tests:
 * ① `{length: 10 * INCH}` → 254 (!== 0 assertion, GOTCHA: old projection was 0)
 * ② `10 * MM` → 10
 * ③ `10 * MM + 2 * MM` → 12
 * ④ Lines with unit literals have hasComputedArgs === true (host read-only downgrade)
 * ⑤ parseUnitLiteral basic tests
 */
import { describe, it, expect } from 'vitest'
import { codeToArgs, parseUnitLiteral } from '../../src/lang/code-to-args'
import { extractMetadata } from '../../src/lang/metadata-extractor'

describe('codeToArgs — unit literal folding (P7/D10.4)', () => {
  // ① GOTCHA: Before P7 fix, `codeToArgs('…{ length: 10 * INCH }')` returned
  // `{ length: 0 }` because the sentinel declaration `let INCH = 0` shadowed
  // the global unit constant, causing `10 * INCH` to fold to `10 * 0 = 0`.
  // After P7: unit constants are excluded from sentinel declarations and
  // recognized in tryFoldConstExpr, so `10 * INCH` folds to `10 * 25.4 = 254`.
  it('① {length: 10 * INCH} → 254 (GOTCHA: was 0 before fix)', () => {
    const result = codeToArgs('let part0 = cad.fai_extrude({ length: 10 * INCH })')
    expect(result.args.length).toBe(254)
    expect(result.args.length).not.toBe(0) // explicit anti-regression assertion
  })

  // ② 10 * MM → 10 (base unit, identity scaling)
  it('② {length: 10 * MM} → 10', () => {
    const result = codeToArgs('let part0 = cad.fai_extrude({ length: 10 * MM })')
    expect(result.args.length).toBe(10)
  })

  // ③ 10 * MM + 2 * MM → 12 (compound expression with unit constants)
  it('③ {length: 10 * MM + 2 * MM} → 12', () => {
    const result = codeToArgs('let part0 = cad.fai_extrude({ length: 10 * MM + 2 * MM })')
    expect(result.args.length).toBe(12)
  })

  // ④ Lines with unit literals must set hasComputedArgs = true
  //    (host read-only downgrade — prevents folded base value from being
  //     written back to source, which would lose the unit literal form)
  it('④ hasComputedArgs is true for unit literal lines', () => {
    const code = 'let part0 = cad.fai_extrude({ length: 10 * INCH })'
    const meta = extractMetadata(code, { looseLocalCalls: true })
    const last = meta.lines[meta.lines.length - 1]
    expect(last).toBeDefined()
    expect(last!.hasComputedArgs).toBe(true)
  })

  it('④ hasComputedArgs is true for MM unit literal lines', () => {
    const code = 'let part0 = cad.fai_extrude({ length: 10 * MM })'
    const meta = extractMetadata(code, { looseLocalCalls: true })
    const last = meta.lines[meta.lines.length - 1]
    expect(last!.hasComputedArgs).toBe(true)
  })

  // ⑤ Non-unit expressions still work as before
  it('⑤ plain literal still folds without computed', () => {
    const result = codeToArgs('let part0 = cad.fai_extrude({ length: 10 })')
    expect(result.args.length).toBe(10)
  })

  it('⑤ param expression still works', () => {
    // 'height' is not a unit constant → becomes a sentinel param
    const result = codeToArgs('let part0 = cad.fai_extrude({ length: height + 5 })')
    // height=0 sentinel → 0 + 5 = 5
    expect(result.args.length).toBe(5)
  })
})

describe('parseUnitLiteral (P7/D10.3)', () => {
  it('parses `10 * INCH`', () => {
    const r = parseUnitLiteral('10 * INCH')
    expect(r).not.toBeNull()
    expect(r!.base).toBe(254)
    expect(r!.dim).toBe('length')
    expect(r!.unitName).toBe('inch')
  })

  it('parses `10 * MM`', () => {
    const r = parseUnitLiteral('10 * MM')
    expect(r).not.toBeNull()
    expect(r!.base).toBe(10)
    expect(r!.dim).toBe('length')
    expect(r!.unitName).toBe('mm')
  })

  it('parses `45 * DEGREE`', () => {
    const r = parseUnitLiteral('45 * DEGREE')
    expect(r).not.toBeNull()
    expect(r!.base).toBe(45)
    expect(r!.dim).toBe('angle')
    expect(r!.unitName).toBe('degree')
  })

  it('parses `1 * METER`', () => {
    const r = parseUnitLiteral('1 * METER')
    expect(r).not.toBeNull()
    expect(r!.base).toBe(1000)
    expect(r!.dim).toBe('length')
    expect(r!.unitName).toBe('m')
  })

  it('parses decimal values', () => {
    const r = parseUnitLiteral('0.5 * INCH')
    expect(r).not.toBeNull()
    expect(r!.base).toBeCloseTo(12.7, 10)
  })

  it('parses negative values', () => {
    const r = parseUnitLiteral('-5 * MM')
    expect(r).not.toBeNull()
    expect(r!.base).toBe(-5)
  })

  it('returns null for non-unit-literal expressions', () => {
    expect(parseUnitLiteral('10 + 5')).toBeNull()
    expect(parseUnitLiteral('height')).toBeNull()
    expect(parseUnitLiteral('10')).toBeNull()
    expect(parseUnitLiteral('')).toBeNull()
  })

  it('returns null for unknown unit constant names', () => {
    expect(parseUnitLiteral('10 * UNKNOWN')).toBeNull()
  })
})
