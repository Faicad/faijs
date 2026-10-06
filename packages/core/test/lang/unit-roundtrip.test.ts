/**
 * P7/D10 unit roundtrip tests.
 *
 * Tests:
 * - base → formatCodeLine(units=u) → codeToArgs → base' relative error ≤ 1e-12
 * - Unit switching is idempotent (mm → inch → mm text identical)
 *
 * Three unit levels: mm / inch / meter
 */
import { describe, it, expect } from 'vitest'
import {
  formatCodeLine,
  formatUnitLiteral,
  type FormatCodeLineInput,
  type UnitSerializeOptions,
} from '../../src/lang/codegen'
import { codeToArgs, parseUnitLiteral } from '../../src/lang/code-to-args'
import type { UnitContext } from '../../src/units'

describe('unit roundtrip — base → format → parse → base', () => {
  // Test data: base-unit (mm) values for length parameters
  const testCases: { base: number; unit: UnitContext; dim: 'length' | 'angle' }[] = [
    // mm → mm
    { base: 10, unit: { length: 'mm', angle: 'degree' }, dim: 'length' },
    // mm → inch
    { base: 254, unit: { length: 'inch', angle: 'degree' }, dim: 'length' },
    // mm → meter
    { base: 1000, unit: { length: 'm', angle: 'degree' }, dim: 'length' },
    // degree → degree
    { base: 45, unit: { length: 'mm', angle: 'degree' }, dim: 'angle' },
    // degree → radian
    { base: 90, unit: { length: 'mm', angle: 'radian' }, dim: 'angle' },
    // Small values (precision test)
    { base: 1e-7, unit: { length: 'inch', angle: 'degree' }, dim: 'length' },
    { base: 1e-7, unit: { length: 'mm', angle: 'degree' }, dim: 'length' },
  ]

  for (const { base, unit, dim } of testCases) {
    it(`${base} ${dim} via ${dim === 'length' ? unit.length : unit.angle} → roundtrip error ≤ 1e-12`, () => {
      // Format: base → unit literal text
      const unitName = dim === 'length' ? unit.length : unit.angle
      const text = formatUnitLiteral(base, dim, unitName)

      // Parse: text → base'
      const parsed = parseUnitLiteral(text)
      expect(parsed).not.toBeNull()
      expect(parsed!.dim).toBe(dim)

      // Roundtrip error
      const relErr = Math.abs(parsed!.base - base) / Math.max(Math.abs(base), 1e-15)
      expect(relErr).toBeLessThanOrEqual(1e-12)
    })
  }
})

describe('unit switching idempotency', () => {
  // mm → inch → mm must produce byte-identical text
  it('mm → inch → mm text is identical', () => {
    const baseValue = 254 // 10 inches in mm

    // Format in mm
    const mmText = formatUnitLiteral(baseValue, 'length', 'mm')
    // Format in inch
    const inchText = formatUnitLiteral(baseValue, 'length', 'inch')
    // Parse inch text back to base
    const parsed = parseUnitLiteral(inchText)!
    // Format parsed base in mm again
    const mmText2 = formatUnitLiteral(parsed.base, 'length', 'mm')

    expect(mmText).toBe(mmText2)
  })

  it('inch → mm → inch text is identical', () => {
    const baseValue = 254

    const inchText = formatUnitLiteral(baseValue, 'length', 'inch')
    const mmText = formatUnitLiteral(baseValue, 'length', 'mm')
    const parsed = parseUnitLiteral(mmText)!
    const inchText2 = formatUnitLiteral(parsed.base, 'length', 'inch')

    expect(inchText).toBe(inchText2)
  })

  it('meter → mm → meter text is identical', () => {
    const baseValue = 1000 // 1 meter in mm

    const meterText = formatUnitLiteral(baseValue, 'length', 'm')
    const mmText = formatUnitLiteral(baseValue, 'length', 'mm')
    const parsed = parseUnitLiteral(mmText)!
    const meterText2 = formatUnitLiteral(parsed.base, 'length', 'm')

    expect(meterText).toBe(meterText2)
  })

  it('degree → radian → degree text is identical', () => {
    const baseValue = 90 // 90 degrees

    const degText = formatUnitLiteral(baseValue, 'angle', 'degree')
    const radText = formatUnitLiteral(baseValue, 'angle', 'radian')
    const parsed = parseUnitLiteral(radText)!
    const degText2 = formatUnitLiteral(parsed.base, 'angle', 'degree')

    expect(degText).toBe(degText2)
  })

  it('multiple switches (n=3) same as n=1', () => {
    const baseValue = 254

    // One switch: mm → inch
    const inchText1 = formatUnitLiteral(baseValue, 'length', 'inch')

    // Three switches: mm → inch → mm → inch
    let currentBase = baseValue
    // mm → inch
    currentBase = parseUnitLiteral(formatUnitLiteral(currentBase, 'length', 'inch'))!.base
    // inch → mm
    currentBase = parseUnitLiteral(formatUnitLiteral(currentBase, 'length', 'mm'))!.base
    // mm → inch
    const inchText3 = formatUnitLiteral(currentBase, 'length', 'inch')

    expect(inchText1).toBe(inchText3)
  })
})

describe('formatCodeLine → codeToArgs roundtrip', () => {
  it('full line roundtrip: format with inch → codeToArgs returns base mm', () => {
    const baseValue = 254 // 10 inches
    const input: FormatCodeLineInput = {
      callee: 'fai_extrude',
      positional: [{ length: baseValue }],
      outputs: ['part0'],
    }
    const opts: UnitSerializeOptions = {
      units: { length: 'inch', angle: 'degree' },
      dims: { byKey: { length: 'length' } },
    }
    const code = formatCodeLine(input, opts)
    // Parse back
    const result = codeToArgs(code)
    expect(result.args.length).toBe(baseValue)
    expect(result.args.length).not.toBe(0) // GOTCHA anti-regression
  })

  it('full line roundtrip: format with mm → codeToArgs returns same value', () => {
    const baseValue = 42
    const input: FormatCodeLineInput = {
      callee: 'fai_extrude',
      positional: [{ length: baseValue }],
      outputs: ['part0'],
    }
    const opts: UnitSerializeOptions = {
      units: { length: 'mm', angle: 'degree' },
      dims: { byKey: { length: 'length' } },
    }
    const code = formatCodeLine(input, opts)
    const result = codeToArgs(code)
    expect(result.args.length).toBe(baseValue)
  })

  it('vec3 roundtrip: format with inch → codeToArgs returns base mm', () => {
    const baseValues: [number, number, number] = [254, 508, 762] // 10, 20, 30 inches
    const input: FormatCodeLineInput = {
      callee: 'box',
      positional: [{ size: baseValues }],
      outputs: ['part0'],
    }
    const opts: UnitSerializeOptions = {
      units: { length: 'inch', angle: 'degree' },
      dims: { byKey: { size: 'length' } },
    }
    const code = formatCodeLine(input, opts)
    const result = codeToArgs(code)
    // size should be parsed back as an array
    const size = result.args.size
    expect(Array.isArray(size)).toBe(true)
    const arr = size as unknown[]
    expect(Number(arr[0])).toBe(254)
    expect(Number(arr[1])).toBe(508)
    expect(Number(arr[2])).toBe(762)
  })
})
