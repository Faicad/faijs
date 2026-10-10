/**
 * codegen — DimSpec recursive serialization tests (方案 D).
 *
 * Verifies:
 * 1. No opts → byte-identical to pre-P7 behavior (regression guard).
 * 2. `dims` (flat) → unit literals on numbers/arrays.
 * 3. `spec` (recursive DimSpec) → unit literals on nested structures.
 * 4. Unknown discriminator / unlisted fields → bare (zero-impact passthrough).
 * 5. Display unit (inch) → correct conversion.
 */
import { describe, it, expect } from 'vitest'
import { formatCodeLine, type FormatCodeLineInput, type UnitSerializeOptions } from '../../src/lang/codegen'
import type { DimSpec } from '../../src/units'
import type { HostArg } from '../../src/lang/host-arg'

/** Helper: single-positional-arg line with `let` declaration. */
function line(positional: HostArg[], opts?: UnitSerializeOptions): string {
  return formatCodeLine({ callee: 'f', positional, outputs: ['r'] }, opts)
}

describe('formatCodeLine — no opts (regression guard)', () => {
  it('numbers → bare', () => {
    expect(formatCodeLine({ callee: 'box', positional: [100, 200, 300], outputs: ['b'] }))
      .toBe('let b = cad.box(100, 200, 300)')
  })

  it('object → spaced braces, bare values', () => {
    expect(line([{ w: 100, h: 50, tag: 'g1' }]))
      .toBe("let r = cad.f({ w:100, h:50, tag:'g1' })")
  })

  it('nested array → compact, bare', () => {
    expect(line([[10, 20, 30]]))
      .toBe('let r = cad.f([10,20,30])')
  })

  it('opts with no dims and no spec → fast path (byte-identical)', () => {
    expect(formatCodeLine({ callee: 'box', positional: [100, 200], outputs: ['b'] }, {}))
      .toBe('let b = cad.box(100, 200)')
  })

  it('opts with only units (no dims/spec) → fast path', () => {
    expect(formatCodeLine(
      { callee: 'box', positional: [100], outputs: ['b'] },
      { units: { length: 'inch', angle: 'degree' } },
    )).toBe('let b = cad.box(100)')
  })
})

describe('formatCodeLine — dims (flat)', () => {
  it('positional length → unit literal (mm)', () => {
    expect(formatCodeLine(
      { callee: 'box', positional: [100, 200, 300], outputs: ['b'] },
      { dims: { positional: ['length', 'length', 'length'] } },
    )).toBe('let b = cad.box(100 * MM, 200 * MM, 300 * MM)')
  })

  it('positional length → unit literal (inch)', () => {
    expect(formatCodeLine(
      { callee: 'box', positional: [25.4, 254], outputs: ['b'] },
      { dims: { positional: ['length', 'length'] }, units: { length: 'inch', angle: 'degree' } },
    )).toBe('let b = cad.box(1 * INCH, 10 * INCH)')
  })

  it('array (vec3) with dim → element-wise unit literals', () => {
    expect(line(
      [[10, 20, 30]],
      { dims: { positional: ['length'] } },
    )).toBe('let r = cad.f([10 * MM,20 * MM,30 * MM])')
  })

  it('byKey dim → unit literal', () => {
    expect(line(
      [{ offset: [1, 2, 3] }],
      { dims: { byKey: { offset: 'length' } } },
    )).toBe('let r = cad.f({ offset:[1 * MM,2 * MM,3 * MM] })')
  })
})

describe('formatCodeLine — spec (recursive DimSpec)', () => {
  const LENGTH: DimSpec = { kind: 'dim', dim: 'length' }

  it('spec dim → number gets unit literal', () => {
    expect(line([100], { spec: LENGTH })).toBe('let r = cad.f(100 * MM)')
  })

  it('spec dim → array (point) element-wise', () => {
    expect(line([[10, 20]], { spec: LENGTH })).toBe('let r = cad.f([10 * MM,20 * MM])')
  })

  it('spec dim → inch display unit', () => {
    expect(line([254], { spec: LENGTH, units: { length: 'inch', angle: 'degree' } }))
      .toBe('let r = cad.f(10 * INCH)')
  })

  it('spec array → element-wise with item spec', () => {
    const spec: DimSpec = { kind: 'array', item: LENGTH }
    expect(line([[10, 20, 30]], { spec }))
      .toBe('let r = cad.f([10 * MM,20 * MM,30 * MM])')
  })

  it('spec object (top-level) → spaced braces, per-field spec', () => {
    const spec: DimSpec = {
      kind: 'object',
      fields: { w: LENGTH, h: LENGTH },
    }
    expect(line([{ w: 100, h: 50, tag: 'g1' }], { spec }))
      .toBe("let r = cad.f({ w:100 * MM, h:50 * MM, tag:'g1' })")
  })

  it('spec object → unlisted fields bare', () => {
    const spec: DimSpec = { kind: 'object', fields: { w: LENGTH } }
    expect(line([{ w: 100, n: 6, angle: 0.5 }], { spec }))
      .toBe("let r = cad.f({ w:100 * MM, n:6, angle:0.5 })")
  })

  it('spec object → non-object value falls through to bare', () => {
    const spec: DimSpec = { kind: 'object', fields: {} }
    expect(line([42], { spec })).toBe('let r = cad.f(42)')
  })

  it('spec tagged → dispatch by discriminator', () => {
    const spec: DimSpec = {
      kind: 'tagged',
      key: 'kind',
      cases: {
        rect: { kind: 'object', fields: { w: LENGTH } },
        circle: { kind: 'object', fields: { r: LENGTH } },
      },
    }
    expect(line([{ kind: 'rect', w: 100, tag: 'g1' }], { spec }))
      .toBe("let r = cad.f({kind:'rect', w:100 * MM, tag:'g1'})")
    expect(line([{ kind: 'circle', r: 50, tag: 'g2' }], { spec }))
      .toBe("let r = cad.f({kind:'circle', r:50 * MM, tag:'g2'})")
  })

  it('spec tagged → unknown kind falls through to bare', () => {
    const spec: DimSpec = {
      kind: 'tagged',
      key: 'kind',
      cases: { rect: { kind: 'object', fields: { w: LENGTH } } },
    }
    expect(line([{ kind: 'unknown', w: 100 }], { spec }))
      .toBe("let r = cad.f({kind:'unknown', w:100})")
  })

  it('spec tagged → non-object value falls through to bare', () => {
    const spec: DimSpec = {
      kind: 'tagged',
      key: 'kind',
      cases: { rect: { kind: 'object', fields: { w: LENGTH } } },
    }
    expect(line([42], { spec })).toBe('let r = cad.f(42)')
  })

  it('spec nested array of objects (bspline poles)', () => {
    const spec: DimSpec = {
      kind: 'object',
      fields: {
        poles: {
          kind: 'array',
          item: { kind: 'object', fields: { x: LENGTH, y: LENGTH } },
        },
      },
    }
    expect(line([{ poles: [{ x: 0, y: 0 }, { x: 10, y: 20 }], degree: 3 }], { spec }))
      .toBe('let r = cad.f({ poles:[{x:0 * MM, y:0 * MM},{x:10 * MM, y:20 * MM}], degree:3 })')
  })

  it('spec supersedes dims for positional args', () => {
    const spec: DimSpec = { kind: 'object', fields: { w: LENGTH } }
    expect(line(
      [{ w: 100 }],
      { spec, dims: { positional: ['angle'] } },
    )).toBe('let r = cad.f({ w:100 * MM })')
  })
})