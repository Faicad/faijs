/**
 * export-model.test.ts — unit-aware export invariants (unit-system §10.6).
 *
 * Invariant under test (§10.3): the declared unit in the written file equals
 * the unit exportModel was asked for, and the coordinate scale equals
 * base / unitScale(unit). readDeclaredUnit is the round-trip checker.
 */
import { describe, expect, it } from 'vitest'
import { exportModelSync, readDeclaredUnit, UNIT_NAME_TO_3MF, type ExportEntry } from './export-model'
import { UNIT_SCALE } from '../../units'
import { detectStepUnit } from '../../mesh/io'

/** Two-triangle quad spanning [0, size] on X/Y (z=0), base-unit coordinates. */
function quadEntry(size: number, name?: string): ExportEntry {
  return {
    mesh: {
      positions: new Float32Array([
        0, 0, 0, size, 0, 0, size, size, 0,
        0, 0, 0, size, size, 0, 0, size, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    },
    ...(name ? { name } : {}),
  }
}

/** Max coordinate of the interleaved positions in a binary STL buffer. */
function stlMaxCoord(buf: ArrayBuffer): number {
  const dv = new DataView(buf)
  const triCount = dv.getUint32(80, true)
  let max = 0
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) {
        const val = Math.abs(dv.getFloat32(base + 12 + v * 12 + c * 4, true))
        if (val > max) max = val
      }
    }
  }
  return max
}

describe('exportModel — STL (no declared unit)', () => {
  it('scales coordinates to the target unit (10mm → 0.3937 in)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'inch' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10 / UNIT_SCALE.inch, 4)
  })

  it('mm export keeps base coordinates byte-identical in scale', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl', { unit: 'mm' })
    expect(stlMaxCoord(buf)).toBeCloseTo(10, 5)
  })

  it('readDeclaredUnit returns null (format cannot declare)', () => {
    const buf = exportModelSync([quadEntry(10)], 'stl')
    expect(readDeclaredUnit(buf, 'stl')).toBeNull()
  })
})

describe('UNIT_NAME_TO_3MF', () => {
  it('has no yard entry (3MF enum lacks it → forced pair-fallback to mm)', () => {
    expect(UNIT_NAME_TO_3MF.yard).toBeUndefined()
    expect(UNIT_NAME_TO_3MF.mm).toBe('millimeter')
    expect(UNIT_NAME_TO_3MF.inch).toBe('inch')
  })
})

describe('detectStepUnit — fixture-backed parsing', () => {
  it('parses SI_UNIT(.MILLI.,.METRE.) as mm', () => {
    const step = `DATA;
#35=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('mm')
  })

  it('parses CONVERSION_BASED_UNIT METRE as m', () => {
    const step = `DATA;
#65=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0),#66);
#66=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#67=(CONVERSION_BASED_UNIT('METRE',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('m')
  })

  it('parses CONVERSION_BASED_UNIT INCH as inch', () => {
    const step = `DATA;
#67=(CONVERSION_BASED_UNIT('INCH',#65)LENGTH_UNIT()NAMED_UNIT(#68));
ENDSEC;`
    expect(detectStepUnit(step)).toBe('inch')
  })

  it('returns null when no length-unit declaration exists', () => {
    expect(detectStepUnit('DATA;\n#1=POINT(0,0,0);\nENDSEC;')).toBeNull()
  })

  it('ignores HEADER section position — entity found past 8 lines', () => {
    const lines = ['ISO-10303-21;', 'HEADER;', 'ENDSEC;', 'DATA;']
    for (let i = 0; i < 30; i++) lines.push('#' + (i + 1) + '=DUMMY();')
    lines.push('#99=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));', 'ENDSEC;')
    expect(detectStepUnit(lines.join('\n'))).toBe('mm')
  })
})
