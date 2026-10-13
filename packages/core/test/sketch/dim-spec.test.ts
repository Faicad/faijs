/**
 * dim-spec — end-to-end tests for `sketchDimSpec()` with `formatCodeLine`.
 *
 * Verifies that `cad.sketch`'s shapes / constraints / plane fields get the
 * correct unit wrapping (length → `n * MM` / `n * INCH`) while angle, count,
 * boolean and string fields stay bare.
 */
import { describe, it, expect } from 'vitest'
import { formatCodeLine, type UnitSerializeOptions } from '@faicad/faijs/lang/codegen'
import type { HostArg } from '@faicad/faijs/lang/host-arg'
import { sketchDimSpec, shapesDimSpec, constraintsDimSpec } from '../../src/sketch/dim-spec.js'

/** Helper: format a `cad.sketch` call with one positional options object. */
function sketch(positional: HostArg[], opts?: UnitSerializeOptions): string {
  return formatCodeLine({ callee: 'sketch', positional, outputs: ['s'] }, opts)
}

const SPEC = { spec: sketchDimSpec() }
const INCH = { spec: sketchDimSpec(), units: { length: 'inch' as const, angle: 'degree' as const } }

describe('sketchDimSpec — shapes', () => {
  it('rect → w/d/cx/cy get MM, tag bare', () => {
    expect(sketch([{ shapes: [{ kind: 'rect', w: 100, d: 50, cx: 10, cy: 20, tag: 'g1' }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'rect', w:100 * MM, d:50 * MM, cx:10 * MM, cy:20 * MM, tag:'g1'}] })")
  })

  it('rect without cx/cy → only w/d get MM', () => {
    expect(sketch([{ shapes: [{ kind: 'rect', w: 100, d: 50 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'rect', w:100 * MM, d:50 * MM}] })")
  })

  it('roundedRect → w/d/r get MM', () => {
    expect(sketch([{ shapes: [{ kind: 'roundedRect', w: 100, d: 50, r: 10 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'roundedRect', w:100 * MM, d:50 * MM, r:10 * MM}] })")
  })

  it('circle → r/cx/cy get MM', () => {
    expect(sketch([{ shapes: [{ kind: 'circle', r: 50, cx: 10, cy: 20 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM, cx:10 * MM, cy:20 * MM}] })")
  })

  it('ellipse → rx/ry/cx/cy get MM, angle gets DEGREE', () => {
    expect(sketch([{ shapes: [{ kind: 'ellipse', rx: 50, ry: 30, cx: 10, cy: 20, angle: 0.5 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'ellipse', rx:50 * MM, ry:30 * MM, cx:10 * MM, cy:20 * MM, angle:0.5 * DEGREE}] })")
  })

  it('polygon → r/cx/cy get MM, n bare, angle gets DEGREE', () => {
    expect(sketch([{ shapes: [{ kind: 'polygon', n: 6, r: 50, angle: 0.5 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'polygon', n:6, r:50 * MM, angle:0.5 * DEGREE}] })")
  })

  it('slot → w/d/cx/cy get MM', () => {
    expect(sketch([{ shapes: [{ kind: 'slot', w: 100, d: 30, cx: 5, cy: 5 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'slot', w:100 * MM, d:30 * MM, cx:5 * MM, cy:5 * MM}] })")
  })

  it('trapezoid → w/h/cx/cy get MM, a1/a2 get DEGREE', () => {
    expect(sketch([{ shapes: [{ kind: 'trapezoid', w: 100, h: 50, a1: 0.5, a2: 0.7 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'trapezoid', w:100 * MM, h:50 * MM, a1:0.5 * DEGREE, a2:0.7 * DEGREE}] })")
  })

  it('line → from/to get MM (element-wise)', () => {
    expect(sketch([{ shapes: [{ kind: 'line', from: [10, 20], to: [30, 40] }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'line', from:[10 * MM,20 * MM], to:[30 * MM,40 * MM]}] })")
  })

  it('arc → cx/cy/r get MM, a0/a1 get DEGREE, ccw bare', () => {
    expect(sketch([{ shapes: [{ kind: 'arc', cx: 0, cy: 0, r: 50, a0: 0, a1: 1.5, ccw: true }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'arc', cx:0 * MM, cy:0 * MM, r:50 * MM, a0:0 * DEGREE, a1:1.5 * DEGREE, ccw:true}] })")
  })

  it('bspline → pts get MM (nested array of pairs), degree bare', () => {
    expect(sketch([{ shapes: [{ kind: 'bspline', pts: [[0, 0], [10, 20], [30, 40]], degree: 3 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'bspline', pts:[[0 * MM,0 * MM],[10 * MM,20 * MM],[30 * MM,40 * MM]], degree:3}] })")
  })

  it('point → x/y get MM', () => {
    expect(sketch([{ shapes: [{ kind: 'point', x: 10, y: 20 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'point', x:10 * MM, y:20 * MM}] })")
  })

  it('close → all bare (ref is string)', () => {
    expect(sketch([{ shapes: [{ kind: 'close', ref: 'g1' }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'close', ref:'g1'}] })")
  })

  it('unknown shape kind → all bare (passthrough)', () => {
    expect(sketch([{ shapes: [{ kind: 'futureShape', w: 100, n: 6 }] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'futureShape', w:100, n:6}] })")
  })
})

describe('sketchDimSpec — constraints', () => {
  it('length constraint → value gets MM', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], constraints: [{ kind: 'length', of: { tag: 'g1' }, value: 100 }] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], constraints:[{kind:'length', of:{tag:'g1'}, value:100 * MM}] })")
  })

  it('distance/distanceX/distanceY → value gets MM', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], constraints: [
        { kind: 'distance', a: { tag: 'g1' }, b: { tag: 'g2' }, value: 30 },
        { kind: 'distanceX', a: { tag: 'g1' }, b: { tag: 'g2' }, value: 10 },
        { kind: 'distanceY', a: { tag: 'g1' }, b: { tag: 'g2' }, value: 20 },
      ] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], constraints:[{kind:'distance', a:{tag:'g1'}, b:{tag:'g2'}, value:30 * MM},{kind:'distanceX', a:{tag:'g1'}, b:{tag:'g2'}, value:10 * MM},{kind:'distanceY', a:{tag:'g1'}, b:{tag:'g2'}, value:20 * MM}] })")
  })

  it('radius/diameter → value gets MM', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], constraints: [
        { kind: 'radius', of: { tag: 'g1' }, value: 25 },
        { kind: 'diameter', of: { tag: 'g1' }, value: 50 },
      ] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], constraints:[{kind:'radius', of:{tag:'g1'}, value:25 * MM},{kind:'diameter', of:{tag:'g1'}, value:50 * MM}] })")
  })

  it('angle/arcAngle → value gets DEGREE', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], constraints: [
        { kind: 'angle', a: { tag: 'g1' }, b: { tag: 'g2' }, value: 1.5 },
        { kind: 'arcAngle', of: { tag: 'g1' }, value: 0.8 },
      ] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], constraints:[{kind:'angle', a:{tag:'g1'}, b:{tag:'g2'}, value:1.5 * DEGREE},{kind:'arcAngle', of:{tag:'g1'}, value:0.8 * DEGREE}] })")
  })

  it('orientation → dir bare (direction vector)', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'line', from: [0, 0], to: [10, 0] }], constraints: [
        { kind: 'orientation', of: { tag: 'g1' }, dir: [1, 0] },
      ] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'line', from:[0 * MM,0 * MM], to:[10 * MM,0 * MM]}], constraints:[{kind:'orientation', of:{tag:'g1'}, dir:[1,0]}] })")
  })

  it('constraint with no length fields → all bare', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], constraints: [
        { kind: 'coincident', a: { tag: 'g1' }, b: { tag: 'g2' } },
        { kind: 'horizontal', of: { tag: 'g1' } },
      ] }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], constraints:[{kind:'coincident', a:{tag:'g1'}, b:{tag:'g2'}},{kind:'horizontal', of:{tag:'g1'}}] })")
  })
})

describe('sketchDimSpec — plane', () => {
  it('plane string → passthrough (bare)', () => {
    expect(sketch([{ shapes: [{ kind: 'circle', r: 50 }], plane: 'XZ' }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], plane:'XZ' })")
  })

  it('plane object → origin gets MM, normal/xAxis bare', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], plane: { origin: [10, 20, 30], normal: [0, 1, 0], xAxis: [1, 0, 0] } }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], plane:{origin:[10 * MM,20 * MM,30 * MM], normal:[0,1,0], xAxis:[1,0,0]} })")
  })

  it('plane object without xAxis → origin gets MM, normal bare', () => {
    expect(sketch(
      [{ shapes: [{ kind: 'circle', r: 50 }], plane: { origin: [0, 0, 0], normal: [0, 0, 1] } }],
      SPEC,
    )).toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], plane:{origin:[0 * MM,0 * MM,0 * MM], normal:[0,0,1]} })")
  })
})

describe('sketchDimSpec — geoms (expanded canonical)', () => {
  it('line geom → x1/y1/x2/y2 get MM', () => {
    expect(sketch([{ geoms: [{ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 50, tag: 'g1' }] }], SPEC))
      .toBe("let s = cad.sketch({ geoms:[{kind:'line', x1:0 * MM, y1:0 * MM, x2:100 * MM, y2:50 * MM, tag:'g1'}] })")
  })

  it('circle geom → cx/cy/r get MM', () => {
    expect(sketch([{ geoms: [{ kind: 'circle', cx: 10, cy: 20, r: 50 }] }], SPEC))
      .toBe("let s = cad.sketch({ geoms:[{kind:'circle', cx:10 * MM, cy:20 * MM, r:50 * MM}] })")
  })

  it('arc geom → cx/cy/r get MM, a0/a1 get DEGREE', () => {
    expect(sketch([{ geoms: [{ kind: 'arc', cx: 0, cy: 0, r: 50, a0: 0, a1: 1.5 }] }], SPEC))
      .toBe("let s = cad.sketch({ geoms:[{kind:'arc', cx:0 * MM, cy:0 * MM, r:50 * MM, a0:0 * DEGREE, a1:1.5 * DEGREE}] })")
  })

  it('bspline geom → poles get MM, knots/degree bare', () => {
    expect(sketch([{ geoms: [{ kind: 'bspline', poles: [{ x: 0, y: 0 }, { x: 10, y: 20 }], knots: [0, 0, 1, 1], degree: 3 }] }], SPEC))
      .toBe("let s = cad.sketch({ geoms:[{kind:'bspline', poles:[{x:0 * MM, y:0 * MM},{x:10 * MM, y:20 * MM}], knots:[0,0,1,1], degree:3}] })")
  })
})

describe('sketchDimSpec — display unit & regression', () => {
  it('inch display unit → length in INCH', () => {
    expect(sketch([{ shapes: [{ kind: 'rect', w: 254, d: 127 }] }], INCH))
      .toBe("let s = cad.sketch({ shapes:[{kind:'rect', w:10 * INCH, d:5 * INCH}] })")
  })

  it('no spec → byte-identical to raw (old code)', () => {
    expect(sketch([{ shapes: [{ kind: 'rect', w: 100, d: 50, tag: 'g1' }] }]))
      .toBe("let s = cad.sketch({ shapes:[{kind:'rect', w:100, d:50, tag:'g1'}] })")
  })

  it('as field → bare (string enum)', () => {
    expect(sketch([{ shapes: [{ kind: 'circle', r: 50 }], as: 'wire' }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'circle', r:50 * MM}], as:'wire' })")
  })

  it('multiple shapes → each gets unit wrapping', () => {
    expect(sketch([{ shapes: [
      { kind: 'rect', w: 100, d: 50 },
      { kind: 'circle', r: 25, cx: 100 },
    ] }], SPEC))
      .toBe("let s = cad.sketch({ shapes:[{kind:'rect', w:100 * MM, d:50 * MM},{kind:'circle', r:25 * MM, cx:100 * MM}] })")
  })
})

describe('shapesDimSpec / constraintsDimSpec (standalone)', () => {
  it('shapesDimSpec → array of tagged shapes', () => {
    const opts: UnitSerializeOptions = { spec: shapesDimSpec() }
    expect(formatCodeLine(
      { callee: 'f', positional: [[{ kind: 'rect', w: 100, d: 50 }]], outputs: ['r'] },
      opts,
    )).toBe("let r = cad.f([{kind:'rect', w:100 * MM, d:50 * MM}])")
  })

  it('constraintsDimSpec → array of tagged constraints', () => {
    const opts: UnitSerializeOptions = { spec: constraintsDimSpec() }
    expect(formatCodeLine(
      { callee: 'f', positional: [[{ kind: 'length', of: { tag: 'g1' }, value: 100 }]], outputs: ['r'] },
      opts,
    )).toBe("let r = cad.f([{kind:'length', of:{tag:'g1'}, value:100 * MM}])")
  })
})