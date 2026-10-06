/**
 * units.test.ts — the faijs unit system.
 *
 * Covers the invariants required by the unit-system design (§7 test matrix):
 * - base invariant: any ValueWithUnits.value is a base-unit number
 * - dimension mismatch throws for add/sub/as/divBy
 * - compound dimensions (AREA, VOLUME, FORCE)
 * - pow / divBy / eqZero
 * - UNIT_SCALE / UNIT_DIM / UNIT_DIMS three-table consistency
 * - radian === 180 / Math.PI (angle base = degree)
 * - toBase / fromBase are inverses
 */
import { describe, expect, it } from 'vitest'
import {
  AREA, ANGLE, BASE_UNITS, CM, FOOT, INCH, M, MASS, MICRON, MM,
  RADIAN, TIME, UNIT_DIM, UNIT_DIMS, UNIT_SCALE, VOLUME,
  centimeter, degree, fromBase, gram, inch, isAngle, isLength, kilogram,
  meter, micron, mm, radian, second, specOfDim, toBase, unitEquals, unitFor,
  unitScale,
} from '../src/units'

describe('base invariant', () => {
  it('any ValueWithUnits.value is a base-unit number', () => {
    expect(inch.mul(2).value).toBe(25.4 * 2) // mm is the base
    expect(meter.value).toBe(1000)
    expect(centimeter.value).toBe(10)
    expect(micron.value).toBe(0.001)
    expect(radian.value).toBeCloseTo(180 / Math.PI, 12)
  })

  it('pure-number constants are base-unit scale factors', () => {
    expect(MM).toBe(1)
    expect(CM).toBe(10)
    expect(M).toBe(1000)
    expect(MICRON).toBe(0.001)
    expect(INCH).toBe(25.4)
    expect(FOOT).toBe(304.8)
  })
})

describe('dimension mismatch throws', () => {
  it('add of differing dimensions throws', () => {
    expect(() => meter.add(degree)).toThrow(/dimension mismatch/)
  })
  it('sub of differing dimensions throws', () => {
    expect(() => meter.sub(degree)).toThrow(/dimension mismatch/)
  })
  it('as of differing dimensions throws', () => {
    expect(() => inch.as(degree)).toThrow(/dimension mismatch/)
  })
  it('divBy of differing dimensions throws', () => {
    expect(() => inch.divBy(degree)).toThrow(/dimension mismatch/)
  })
  it('matching dimensions succeed', () => {
    expect(inch.add(inch).value).toBe(50.8)
    expect(inch.as(mm)).toBe(25.4)
    expect(meter.divBy(inch)).toBeCloseTo(1000 / 25.4, 12)
    expect(gram.mul(2).value).toBe(2)
    expect(kilogram.value).toBe(1000)
    expect(second.value).toBe(1)
  })
})

describe('dimension primitives', () => {
  it('AREA/VOLUME carry the expected exponents', () => {
    expect(unitEquals(AREA, { length: 2 })).toBe(true)
    expect(unitEquals(VOLUME, { length: 3 })).toBe(true)
    expect(unitEquals(MASS, { mass: 1 })).toBe(true)
    expect(unitEquals(ANGLE, { angle: 1 })).toBe(true)
    expect(unitEquals(TIME, { time: 1 })).toBe(true)
  })
  it('UNIT_DIM / specOfDim are consistent', () => {
    expect(unitEquals(UNIT_DIMS.mm, specOfDim('length'))).toBe(true)
    expect(unitEquals(UNIT_DIMS.degree, specOfDim('angle'))).toBe(true)
    expect(unitEquals(UNIT_DIMS.gram, specOfDim('mass'))).toBe(true)
  })
  it('isLength/isAngle predicates', () => {
    expect(isLength(mm)).toBe(true)
    expect(isLength(degree)).toBe(false)
    expect(isAngle(degree)).toBe(true)
    expect(isAngle(inch)).toBe(false)
  })
})

describe('pow / eqZero', () => {
  it('pow squares area', () => {
    const area = mm.mul(10).pow(2)
    expect(area.value).toBe(100)
    expect(unitEquals(area.spec, AREA)).toBe(true)
  })
  it('pow keeps sign for odd exponents', () => {
    expect(mm.mul(-2).pow(3).value).toBe(-8)
  })
  it('pow with non-integer exponent throws', () => {
    expect(() => meter.pow(0.5)).toThrow()
  })
  it('eqZero within default epsilon', () => {
    expect(mm.mul(1e-10).eqZero()).toBe(true)
    expect(mm.mul(1).eqZero()).toBe(false)
  })
  it('eqZero with explicit same-dimension epsilon', () => {
    expect(mm.mul(3).eqZero(mm.mul(5))).toBe(true)
    expect(mm.mul(7).eqZero(mm.mul(5))).toBe(false)
  })
})

describe('table consistency', () => {
  it('UNIT_SCALE / UNIT_DIM / UNIT_DIMS agree', () => {
    for (const name of Object.keys(UNIT_SCALE) as (keyof typeof UNIT_SCALE)[]) {
      expect(UNIT_DIM[name]).toBeDefined()
      expect(UNIT_DIMS[name]).toBeDefined()
      expect(unitEquals(UNIT_DIMS[name]!, specOfDim(UNIT_DIM[name] as never))).toBe(true)
    }
  })
  it('all 3MF unit enum values are present', () => {
    for (const u of ['micron', 'millimeter', 'centimeter', 'inch', 'foot', 'meter'] as const) {
      const key = u === 'millimeter' ? 'mm' : u === 'centimeter' ? 'cm' : u === 'meter' ? 'm' : (u as keyof typeof UNIT_SCALE)
      expect(UNIT_SCALE[key]).toBeDefined()
    }
  })
  it('radian === 180 / Math.PI', () => {
    expect(RADIAN).toBeCloseTo(180 / Math.PI, 12)
  })
  it('BASE_UNITS defaults to base', () => {
    expect(BASE_UNITS).toEqual({ length: 'mm', angle: 'degree' })
    expect(unitFor('length')).toBe('mm')
    expect(unitFor('angle')).toBe('degree')
    expect(unitFor('length', { length: 'inch', angle: 'degree' })).toBe('inch')
  })
  it('unitScale returns the scale factor', () => {
    expect(unitScale('inch')).toBe(25.4)
  })
})

describe('toBase / fromBase', () => {
  it('are inverses across units', () => {
    for (const name of Object.keys(UNIT_SCALE) as (keyof typeof UNIT_SCALE)[]) {
      const dim = UNIT_DIM[name]
      const v = 123.456
      expect(fromBase(toBase(v, name as never, dim), name as never, dim)).toBeCloseTo(v, 12)
    }
  })
  it('inch conversion is symmetric', () => {
    expect(toBase(10, 'inch', 'length')).toBe(254)
    expect(fromBase(254, 'inch', 'length')).toBe(10)
  })
  it('unit/dimension mismatch throws', () => {
    expect(() => toBase(1, 'inch', 'angle')).toThrow(/expected angle/)
    expect(() => fromBase(1, 'degree', 'length')).toThrow(/expected length/)
  })
})