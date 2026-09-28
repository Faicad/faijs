/**
 * P7/D10 codegen unit serialization tests.
 *
 * Tests:
 * ① Missing opts → output byte-identical to pre-P7 behavior (regression)
 * ② units={length:'inch'} → `10 * INCH`
 * ③ Base unit → `10 * MM`
 * ④ vec3 element-wise
 * ⑤ Non-dimensioned parameters not wrapped
 * ⑥ fmtUnitNum(1e-7) === '1e-7' (prevent silent zeroing)
 */
import { describe, it, expect } from 'vitest'
import {
  formatCodeLine,
  fmtUnitNum,
  formatUnitLiteral,
  type FormatCodeLineInput,
  type UnitSerializeOptions,
} from './codegen'

describe('fmtUnitNum', () => {
  it('uses JS shortest round-trip representation (not fmtNum)', () => {
    // fmtNum(1e-7) === '0' (6 decimal places truncation) — must NOT happen
    expect(fmtUnitNum(1e-7)).toBe('1e-7')
    expect(fmtUnitNum(0.39370078740157477)).toBe('0.39370078740157477')
    expect(fmtUnitNum(10)).toBe('10')
    expect(fmtUnitNum(-0.5)).toBe('-0.5')
    expect(fmtUnitNum(254)).toBe('254')
  })
})

describe('formatUnitLiteral', () => {
  it('formats base-unit value as unit literal expression', () => {
    // 254 mm → 10 inches
    expect(formatUnitLiteral(254, 'length', 'inch')).toBe('10 * INCH')
    // 10 mm → 10 mm (base unit)
    expect(formatUnitLiteral(10, 'length', 'mm')).toBe('10 * MM')
    // 45 degrees → 45 degrees (base unit)
    expect(formatUnitLiteral(45, 'angle', 'degree')).toBe('45 * DEGREE')
    // 1000 mm → 1 meter
    expect(formatUnitLiteral(1000, 'length', 'm')).toBe('1 * METER')
  })

  it('uses fmtUnitNum (not fmtNum) for the number', () => {
    // 1e-7 mm in inches = 3.937007874015748e-9 inches — must not be zeroed
    const text = formatUnitLiteral(1e-7, 'length', 'inch')
    expect(text).not.toContain('0 * INCH')
    // The number part should be a valid JS number representation
    const numPart = text.split(' * ')[0]
    expect(Number(numPart)).toBeCloseTo(1e-7 / 25.4, 15)
  })
})

describe('formatCodeLine — unit serialization (P7/D10)', () => {
  // Helper: a simple box call input
  const boxInput: FormatCodeLineInput = {
    callee: 'box',
    positional: [{ size: [10, 20, 30] }],
    outputs: ['part0'],
  }

  // ① Missing opts → byte-identical to pre-P7
  it('① missing opts → original behavior (byte-identical)', () => {
    const result = formatCodeLine(boxInput)
    expect(result).toBe('let part0 = cad.box({ size:[10,20,30] })')
  })

  it('① opts without dims → also original behavior', () => {
    const opts: UnitSerializeOptions = {
      units: { length: 'inch', angle: 'degree' },
    }
    const result = formatCodeLine(boxInput, opts)
    // No dims → no unit wrapping → same as raw
    expect(result).toBe('let part0 = cad.box({ size:[10,20,30] })')
  })

  // ② units={length:'inch'} → `10 * INCH` etc.
  it('② inch units → unit literals in inches', () => {
    const opts: UnitSerializeOptions = {
      units: { length: 'inch', angle: 'degree' },
      dims: { byKey: { size: 'length' } },
    }
    // 10mm = 0.3937... inches, 20mm = 0.7874... inches, 30mm = 1.1811... inches
    const result = formatCodeLine(boxInput, opts)
    expect(result).toContain('* INCH')
    // Should NOT be bare numbers anymore
    expect(result).not.toBe('let part0 = cad.box({ size:[10,20,30] })')
  })

  // ③ Base unit → `10 * MM`
  it('③ base unit → unit literals in MM', () => {
    const opts: UnitSerializeOptions = {
      units: { length: 'mm', angle: 'degree' },
      dims: { byKey: { size: 'length' } },
    }
    const result = formatCodeLine(boxInput, opts)
    expect(result).toBe('let part0 = cad.box({ size:[10 * MM,20 * MM,30 * MM] })')
  })

  // ④ vec3 element-wise
  it('④ vec3 element-wise wrapping (byKey dims)', () => {
    const opts: UnitSerializeOptions = {
      units: { length: 'mm', angle: 'degree' },
      dims: { byKey: { offset: 'length' } },
    }
    const input: FormatCodeLineInput = {
      callee: 'translate',
      positional: [{ kind: 'var-ref', name: 'part0' }, { offset: [1, 2, 3] }],
      outputs: ['part0'],
      outputDeclared: true,
    }
    const result = formatCodeLine(input, opts)
    expect(result).toContain('part0 = cad.translate(part0')
    expect(result).toContain('1 * MM')
    expect(result).toContain('2 * MM')
    expect(result).toContain('3 * MM')
  })

  // ⑤ Non-dimensioned parameters not wrapped
  it('⑤ non-dimensioned parameters remain bare', () => {
    const opts: UnitSerializeOptions = {
      units: { length: 'mm', angle: 'degree' },
      dims: { byKey: { size: 'length' } },
    }
    const input: FormatCodeLineInput = {
      callee: 'box',
      positional: [{ size: [10, 20, 30], segments: 64 }],
      outputs: ['part0'],
    }
    const result = formatCodeLine(input, opts)
    // segments has no dim → bare number
    expect(result).toContain('segments:64')
    // size elements should be wrapped
    expect(result).toContain('10 * MM')
  })

  // ⑥ HostExprRef.bare → no parentheses
  it('⑥ bare expr-ref emits without parentheses', () => {
    const input: FormatCodeLineInput = {
      callee: 'box',
      positional: [{ length: { kind: 'expr-ref', text: '10 * INCH', refs: [], params: [], bare: true } }],
      outputs: ['part0'],
    }
    const result = formatCodeLine(input)
    expect(result).toContain('length:10 * INCH')
    expect(result).not.toContain('(10 * INCH)')
  })

  it('⑥ non-bare expr-ref still gets parentheses', () => {
    const input: FormatCodeLineInput = {
      callee: 'box',
      positional: [{ length: { kind: 'expr-ref', text: '10 * INCH', refs: [], params: [] } }],
      outputs: ['part0'],
    }
    const result = formatCodeLine(input)
    expect(result).toContain('length:(10 * INCH)')
  })
})
