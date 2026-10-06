/**
 * dimension-check.test.ts — P6/D8 静态量纲校验单元测试
 *
 * Tests R1–R6 rules from the unit-system design (D8).
 * Tests inferDim/checkDim directly (not through extractMetadata — that's
 * covered by check.test.ts end-to-end tests).
 *
 * Run: npx vitest run src/lang/dimension-check.test.ts
 */

import { describe, it, expect } from 'vitest'
import { extractMetadata, type OpDimMap } from '../../src/lang/metadata-extractor'
import { ParseError } from '../../src/lang/parse-error'

// ── helpers ──

/** Build a minimal OpDimMap for testing. */
function makeOpDims(callee: string, paramDims: Record<string, import('../../src/units').DimName>, slotMap?: any): OpDimMap {
  return {
    [callee]: {
      paramDims,
      ...(slotMap ? { slotMap } : {}),
    },
  }
}

/** Run extractMetadata on a flat-code snippet with given opDims. */
function checkCode(code: string, opDims?: OpDimMap): { ok: boolean; error?: ParseError } {
  try {
    extractMetadata(code, { opDims })
    return { ok: true }
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, error: err }
    throw err
  }
}

// ── R1: dimensioned slot must have a dimensioned expression ──

describe('Dimension check R1–R6', () => {
  const opDims = makeOpDims('cad.box', {
    width: 'length', depth: 'length', height: 'length',
  }, { keys: ['width', 'depth', 'height'] })

  it('R2: bare number literal → E_DIM_BARE_NUMBER (positional form)', () => {
    const r = checkCode('let p0 = cad.box(20, 20, 20, { centered: true })', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('R2: bare number literal → E_DIM_BARE_NUMBER (object form)', () => {
    const r = checkCode('let p0 = cad.box({ width: 10, depth: 10, height: 10 })', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('R2: 10 * MM is valid (not bare)', () => {
    const r = checkCode('let p0 = cad.box(10 * MM, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R2: 10 * INCH is valid (length unit)', () => {
    const r = checkCode('let p0 = cad.box(10 * INCH, 10 * INCH, 10 * INCH)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R2: base unit form 10 * MM is required (bare 10 is not ok even for base unit)', () => {
    const r = checkCode('let p0 = cad.box(10, 10, 10)', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('R3: dimension mismatch — DEGREE on length slot → E_DIM_MISMATCH', () => {
    const r = checkCode('let p0 = cad.box(45 * DEGREE, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_MISMATCH')
  })

  it('R3: same dim addition is valid (10 * MM + 5 * MM)', () => {
    const r = checkCode('let p0 = cad.box(10 * MM + 5 * MM, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R3: dim mismatch in addition → E_DIM_MISMATCH (10 * MM + 5 * DEGREE)', () => {
    const r = checkCode('let p0 = cad.box(10 * MM + 5 * DEGREE, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_MISMATCH')
  })

  it('R4: length * number → length (dimension propagation)', () => {
    const r = checkCode('let p0 = cad.box(10 * MM * 2, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R4: number * length → length (reversed multiply)', () => {
    const r = checkCode('let p0 = cad.box(2 * 10 * MM, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R4: length / number → length', () => {
    const r = checkCode('let p0 = cad.box(10 * MM / 2, 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R4: length / length → dimensionless (bare)', () => {
    // 10 * MM / (5 * MM) = 2 (bare number) → E_DIM_BARE_NUMBER on length slot
    const r = checkCode('let p0 = cad.box(10 * MM / (5 * MM), 10 * MM, 10 * MM)', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('R5: variable reference → pass through (cannot determine)', () => {
    const r = checkCode('const size = 10\nlet p0 = cad.box(size, size, size)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R5: function call result → pass through', () => {
    const r = checkCode([
      'function getSize() { return 10 }',
      'let p0 = cad.box(getSize(), getSize(), getSize())',
    ].join('\n'), opDims)
    expect(r.ok).toBe(true)
  })

  it('R5: negative literal → bare (same as positive)', () => {
    const r = checkCode('let p0 = cad.box(-10, -10, -10)', opDims)
    expect(r.ok).toBe(false)
    expect(r.error!.code).toBe('E_DIM_BARE_NUMBER')
  })

  it('R5: negative unit literal → valid (-10 * MM)', () => {
    // -10 * MM → UnaryExpression(-, BinaryExpression(10, *, MM)) → length
    const r = checkCode('let p0 = cad.box(-10 * MM, -10 * MM, -10 * MM)', opDims)
    expect(r.ok).toBe(true)
  })

  it('R1: dimensionless param (not in paramDims) → bare number is fine', () => {
    // sphere has no paramDims declared → bare number is ok
    const r = checkCode('let p0 = cad.sphere({ radius: 10 })')
    expect(r.ok).toBe(true)
  })

  it('no opDims passed → no dimension checking (all pass)', () => {
    const r = checkCode('let p0 = cad.box(20, 20, 20)')
    expect(r.ok).toBe(true)
  })

  it('positional and object form have same judgment', () => {
    // Both should be rejected with E_DIM_BARE_NUMBER
    const posR = checkCode('let p0 = cad.box(10, 10, 10)', opDims)
    const objR = checkCode('let p0 = cad.box({ width: 10, depth: 10, height: 10 })', opDims)
    expect(posR.ok).toBe(false)
    expect(objR.ok).toBe(false)
    expect(posR.error!.code).toBe('E_DIM_BARE_NUMBER')
    expect(objR.error!.code).toBe('E_DIM_BARE_NUMBER')
  })
})
