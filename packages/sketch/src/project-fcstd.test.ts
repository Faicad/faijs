/**
 * A1 (2026-09-28 plan) — FCStd → canonical constraint reverse projection tests.
 *
 * Covers the full constraint set roundtrip (canonical → FCStd → canonical),
 * the geoId negative-value semantics GOTCHAs (HAxis -1 / VAxis -2 / external
 * <= -3), reference (non-driving) constraints, and the 1-ref Distance ↔ length
 * symmetry with `mapConstraint`'s length encoding.
 */
import { describe, expect, it } from 'vitest'
import {
  fromFreeCadConstraints,
  toFreeCadConstraints,
  toFreeCadGeoms,
  fromFreeCadGeoms,
  SketchProjectionError,
} from './project.js'
import { ConstraintType, type FcstdSketchCon, type FcstdGeoRef } from './fcstd-types.js'
import type { SketchConstraint, SketchGeom } from './canonical.js'

/** Helper: build an FCStd constraint. */
function con(index: number, type: number, refs: FcstdGeoRef[], value = 0, opts?: { name?: string; isDriving?: boolean }): FcstdSketchCon {
  return { index, type, refs, value, isDriving: opts?.isDriving ?? true, name: opts?.name ?? '' }
}

describe('fromFreeCadConstraints — forward mapping coverage', () => {
  it('projects all pure-geometry constraint types', () => {
    const cons: FcstdSketchCon[] = [
      con(0, ConstraintType.Coincident, [{ geoId: 0, pos: 2 }, { geoId: 1, pos: 1 }]),
      con(1, ConstraintType.Horizontal, [{ geoId: 1, pos: 0 }]),
      con(2, ConstraintType.Vertical, [{ geoId: 2, pos: 0 }]),
      con(3, ConstraintType.Parallel, [{ geoId: 1, pos: 0 }, { geoId: 2, pos: 0 }]),
      con(4, ConstraintType.Perpendicular, [{ geoId: 1, pos: 0 }, { geoId: 2, pos: 0 }]),
      con(5, ConstraintType.Tangent, [{ geoId: 0, pos: 0 }, { geoId: 3, pos: 0 }]),
      con(6, ConstraintType.Equal, [{ geoId: 3, pos: 0 }, { geoId: 4, pos: 0 }]),
      con(7, ConstraintType.PointOnObject, [{ geoId: 0, pos: 2 }, { geoId: 2, pos: 0 }]),
      con(8, ConstraintType.Symmetric, [{ geoId: 0, pos: 1 }, { geoId: 0, pos: 2 }, { geoId: 1, pos: 0 }]),
    ]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped).toEqual([])
    expect(constraints).toEqual([
      { kind: 'coincident', a: { index: 0, at: 'end' }, b: { index: 1, at: 'start' } },
      { kind: 'horizontal', of: { index: 1 } },
      { kind: 'vertical', of: { index: 2 } },
      { kind: 'parallel', a: { index: 1 }, b: { index: 2 } },
      { kind: 'perpendicular', a: { index: 1 }, b: { index: 2 } },
      { kind: 'tangent', a: { index: 0 }, b: { index: 3 } },
      { kind: 'equal', a: { index: 3 }, b: { index: 4 } },
      { kind: 'pointOnObject', p: { index: 0, at: 'end' }, on: { index: 2 } },
      { kind: 'symmetric', p1: { index: 0, at: 'start' }, p2: { index: 0, at: 'end' }, about: { index: 1 } },
    ])
  })

  it('projects dimensional constraints with values (edge-at = whole element)', () => {
    const cons: FcstdSketchCon[] = [
      con(0, ConstraintType.Distance, [{ geoId: 0, pos: 1 }, { geoId: 1, pos: 2 }], 42),
      con(1, ConstraintType.DistanceX, [{ geoId: 0, pos: 1 }, { geoId: 1, pos: 1 }], 10),
      con(2, ConstraintType.DistanceY, [{ geoId: 0, pos: 1 }, { geoId: 1, pos: 1 }], 20),
      con(3, ConstraintType.Radius, [{ geoId: 3, pos: 0 }], 7.5),
      con(4, ConstraintType.Diameter, [{ geoId: 3, pos: 0 }], 15),
      con(5, ConstraintType.Angle, [{ geoId: 1, pos: 0 }, { geoId: 2, pos: 0 }], 1.5707963267948966),
    ]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped).toEqual([])
    expect(constraints).toEqual([
      { kind: 'distance', a: { index: 0, at: 'start' }, b: { index: 1, at: 'end' }, value: 42 },
      { kind: 'distanceX', a: { index: 0, at: 'start' }, b: { index: 1, at: 'start' }, value: 10 },
      { kind: 'distanceY', a: { index: 0, at: 'start' }, b: { index: 1, at: 'start' }, value: 20 },
      { kind: 'radius', of: { index: 3 }, value: 7.5 },
      { kind: 'diameter', of: { index: 3 }, value: 15 },
      { kind: 'angle', a: { index: 1 }, b: { index: 2 }, value: 1.5707963267948966 },
    ])
  })

  it('GOTCHA: 1-ref Distance is the FCStd encoding of canonical `length` (mapConstraint expands length → 2 own-end points; the reverse collapses it back)', () => {
    // canonical length → forward: Distance over the line's own start/end
    const geoms: SketchGeom[] = [{ kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }]
    const canonical: SketchConstraint[] = [{ kind: 'length', of: { index: 0 }, value: 40 }]
    const fwd = toFreeCadConstraints(canonical, geoms)
    expect(fwd.constraints).toHaveLength(1)
    expect(fwd.constraints[0]!.type).toBe(ConstraintType.Distance)
    expect(fwd.constraints[0]!.refs).toEqual([
      { geoId: 0, pos: 1 }, { geoId: 0, pos: 2 },
    ])
    // reverse: 1-ref Distance → length again (roundtrip closes)
    const back = fromFreeCadConstraints(fwd.constraints, geoms)
    expect(back.unmapped).toEqual([])
    expect(back.constraints).toEqual([{ kind: 'length', of: { index: 0 }, value: 40 }])
  })

  it('GOTCHA: a genuine 2-ref Distance between two DIFFERENT geoms stays `distance` (not length)', () => {
    const cons = [con(0, ConstraintType.Distance, [{ geoId: 0, pos: 2 }, { geoId: 1, pos: 1 }], 30)]
    const { constraints } = fromFreeCadConstraints(cons, [])
    expect(constraints[0]).toMatchObject({ kind: 'distance', value: 30 })
  })

  it('GOTCHA: Angle value passes through in file units (radians in FCStd XML) — no conversion here', () => {
    // 90° = π/2 rad as stored by FreeCAD; reverse projection must NOT scale it
    const cons = [con(0, ConstraintType.Angle, [{ geoId: 0, pos: 0 }, { geoId: 1, pos: 0 }], Math.PI / 2)]
    const { constraints } = fromFreeCadConstraints(cons, [])
    expect(constraints[0]).toMatchObject({ kind: 'angle', value: Math.PI / 2 })
    // and the forward projection also passes through → roundtrip is unit-consistent
    const geoms: SketchGeom[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 },
    ]
    const fwd = toFreeCadConstraints(constraints, geoms)
    expect(fwd.constraints[0]!.value).toBe(Math.PI / 2)
  })
})

describe('fromFreeCadConstraints — unmapped ledger', () => {
  it('GOTCHA (UPDATED 2026-10-04): axis refs (-1/-2) DO project now — old behavior (unmapped external-or-axis-ref) was the mass-gap bug', () => {
    // typical FreeCAD pattern: anchor the first line start onto the origin via the axes
    const cons: FcstdSketchCon[] = [
      con(0, ConstraintType.Coincident, [{ geoId: 0, pos: 1 }, { geoId: -1, pos: 1 }]),
      con(1, ConstraintType.DistanceX, [{ geoId: -1, pos: 1 }, { geoId: 0, pos: 1 }], 5),
      con(2, ConstraintType.PointOnObject, [{ geoId: 0, pos: 1 }, { geoId: -2, pos: 0 }]),
    ]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped).toEqual([])
    // the axis anchors ride into canonical as negative Ref indices verbatim
    expect(constraints[0]).toMatchObject({ kind: 'coincident', b: { index: -1 } })
    expect(constraints[2]).toMatchObject({ kind: 'pointOnObject', on: { index: -2 } })
  })

  it('GOTCHA: axis-anchor Refs round-trip through toFreeCadConstraints (canonical → FCStd)', () => {
    const geoms: SketchGeom[] = [{ kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]
    const constraints: SketchConstraint[] = [
      { kind: 'coincident', a: { index: 0, at: 'start' }, b: { index: -1 } },
      { kind: 'distanceY', a: { index: 0, at: 'end' }, b: { index: -2 }, value: 7 },
    ]
    const fwd = toFreeCadConstraints(constraints, geoms)
    expect(fwd.constraints).toHaveLength(2)
    expect(fwd.constraints[0]).toMatchObject({ type: ConstraintType.Coincident, refs: [{ geoId: 0, pos: 1 }, { geoId: -1, pos: 0 }] })
    expect(fwd.constraints[1]).toMatchObject({ type: ConstraintType.DistanceY, refs: [expect.objectContaining({ geoId: 0 }), { geoId: -2 }] })
    // and projecting them back reproduces the same canonical anchors
    const back = fromFreeCadConstraints(fwd.constraints, geoms)
    expect(back.unmapped).toEqual([])
    expect(back.constraints[0]).toMatchObject({ kind: 'coincident', b: { index: -1 } })
    expect(back.constraints[1]).toMatchObject({ kind: 'distanceY', b: { index: -2 }, value: 7 })
  })

  it('GOTCHA (UPDATED 2026-10-04): external refs (<= -3) DO project now — resolution is the converter\'s static job (external param), not the projection\'s', () => {
    const cons = [con(0, ConstraintType.Coincident, [{ geoId: 0, pos: 1 }, { geoId: -3, pos: 2 }])]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped).toEqual([])
    // the external geoId rides into canonical verbatim; the emitted
    // `cad.sketch` carries the resolved fixed polylines as its `external`
    // param and the backend pins them as fixed points (static resolution).
    expect(constraints[0]).toMatchObject({ kind: 'coincident', b: { index: -3 } })
  })

  it('non-driving (reference) constraints are ledgered as reference-driven', () => {
    const cons = [con(0, ConstraintType.Distance, [{ geoId: 0, pos: 1 }, { geoId: 1, pos: 2 }], 12, { isDriving: false })]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(constraints).toEqual([])
    expect(unmapped).toEqual([expect.objectContaining({ index: 0, reason: 'reference-driven' })])
  })

  it('unsupported types (InternalAlignment/Block/Weight/…) are ledgered with their names', () => {
    const cons: FcstdSketchCon[] = [
      con(0, ConstraintType.InternalAlignment, [{ geoId: 0, pos: 3 }]),
      con(1, ConstraintType.Block, [{ geoId: 0, pos: 0 }]),
      con(2, 99, []),
    ]
    const { unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped.map((u) => u.reason)).toEqual(['unsupported-type', 'unsupported-type', 'unsupported-type'])
    expect(unmapped[0]!.typeName).toBe('InternalAlignment')
    expect(unmapped[1]!.typeName).toBe('Block')
    expect(unmapped[2]!.typeName).toBe('type#99')
  })

  it('a 1-ref Angle has no canonical counterpart → ambiguous-refs', () => {
    const cons = [con(0, ConstraintType.Angle, [{ geoId: 0, pos: 0 }], 0.5)]
    const { unmapped } = fromFreeCadConstraints(cons, [])
    expect(unmapped).toEqual([expect.objectContaining({ index: 0, reason: 'ambiguous-refs' })])
  })

  // GOTCHA (2026-09-28): FreeCAD writes an absolute-coordinate constraint as a
  // 1-ref DistanceY when the axis is implicit (Bathroom_cabinet_sink Sketch259:
  // `{geoId: 0, pos: 1}` = the start point's y = 70, matching the stored y1=70).
  // Before the REFS_REQUIRED guard this dereferenced the absent second ref and
  // threw `Cannot read properties of undefined (reading 'pos')` — reported by
  // the converter as `solver-throw`, which failed 436/900 corpus files.
  it('a 1-ref DistanceY (implicit axis) is ledgered, never thrown', () => {
    const cons = [con(0, ConstraintType.DistanceY, [{ geoId: 0, pos: 1 }], 70)]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(constraints).toEqual([])
    expect(unmapped).toEqual([expect.objectContaining({ index: 0, reason: 'ambiguous-refs' })])
  })

  it('under-specified constraints of any type never throw out of the projection', () => {
    const cons: FcstdSketchCon[] = [
      con(0, ConstraintType.Coincident, []),
      con(1, ConstraintType.PointOnObject, [{ geoId: 0, pos: 0 }]),
      con(2, ConstraintType.Symmetric, [{ geoId: 0, pos: 1 }, { geoId: 0, pos: 2 }]),
      con(3, ConstraintType.Horizontal, []),
      con(4, ConstraintType.DistanceX, [{ geoId: 0, pos: 1 }]),
    ]
    const { constraints, unmapped } = fromFreeCadConstraints(cons, [])
    expect(constraints).toEqual([])
    expect(unmapped.map((u) => u.index)).toEqual([0, 1, 2, 3, 4])
    expect(unmapped.every((u) => u.reason === 'ambiguous-refs')).toBe(true)
  })
})

describe('full roundtrip canonical → FCStd → canonical (mixed sketch)', () => {
  it('roundtrips a constrained rectangle sketch losslessly', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
      { kind: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
      { kind: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
      { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
    ]
    const canonical: SketchConstraint[] = [
      { kind: 'coincident', a: { index: 0, at: 'end' }, b: { index: 1, at: 'start' } },
      { kind: 'coincident', a: { index: 1, at: 'end' }, b: { index: 2, at: 'start' } },
      { kind: 'coincident', a: { index: 2, at: 'end' }, b: { index: 3, at: 'start' } },
      { kind: 'coincident', a: { index: 3, at: 'end' }, b: { index: 0, at: 'start' } },
      { kind: 'horizontal', of: { index: 0 } },
      { kind: 'vertical', of: { index: 1 } },
      { kind: 'length', of: { index: 0 }, value: 40 },
      { kind: 'length', of: { index: 1 }, value: 30 },
    ]
    const fwd = toFreeCadConstraints(canonical, geoms)
    expect(fwd.noops).toEqual([])
    const back = fromFreeCadConstraints(fwd.constraints, geoms)
    expect(back.unmapped).toEqual([])
    expect(back.constraints).toEqual(canonical)
  })

  it('roundtrips a constrained circle + arc sketch losslessly (fixed → noop is forward-only)', () => {
    const geoms: SketchGeom[] = [
      { kind: 'circle', cx: 10, cy: 10, r: 5 },
      { kind: 'arc', cx: 30, cy: 0, r: 10, a0: 0, a1: Math.PI },
    ]
    const canonical: SketchConstraint[] = [
      { kind: 'radius', of: { index: 0 }, value: 5 },
      { kind: 'diameter', of: { index: 0 }, value: 10 },
    ]
    // (arcAngle has no FCStd counterpart — forward projection throws
    // E_SKETCHC_UNMAPPED, so only the supported subset is roundtripped here.)
    const supported: SketchConstraint[] = [canonical[0]!, canonical[1]!]
    const fwd = toFreeCadConstraints(supported, toFreeCadGeoms(geoms).length ? geoms : geoms)
    const back = fromFreeCadConstraints(fwd.constraints, geoms)
    expect(back.unmapped).toEqual([])
    expect(back.constraints).toEqual(supported)
  })

  it('forward noop (fixed) never appears in reverse input; reverse throws E_SKETCHC_* errors keep their contract', () => {
    // sanity on the error type used across the projection boundary
    expect(() => {
      throw new SketchProjectionError('E_SKETCHC_BAD_REF', 'x')
    }).toThrow(SketchProjectionError)
  })
})
describe('construction flag roundtrip (canonical ⇄ FCStd)', () => {
  // F1 (2026-09-30): reference geometry (symmetry axes, centrelines, construction
  // circles) must survive the canonical → FCStd → canonical roundtrip so that
  // contour extraction can skip it (contour.ts filters on `construction`) while
  // the solver still sees it (planegcs pullBack spreads `{...g}`, preserving the
  // field). A lost flag would either drop reference geometry from the solve or,
  // worse, let it sneak into the profile wire.
  it('preserves construction:true on every supported geometry kind', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', construction: true, x1: 0, y1: 0, x2: 40, y2: 0 },
      { kind: 'circle', construction: true, cx: 10, cy: 10, r: 5 },
      { kind: 'arc', construction: true, cx: 30, cy: 0, r: 10, a0: 0, a1: Math.PI },
      { kind: 'point', construction: true, x: 5, y: 5 },
      { kind: 'ellipse', construction: true, cx: 0, cy: 0, rx: 10, ry: 6, angle: 0 },
    ]
    const fwd = toFreeCadGeoms(geoms)
    expect(fwd.every((g) => g.construction === true)).toBe(true)
    const back = fromFreeCadGeoms(fwd)
    expect(back.every((g) => g.construction === true)).toBe(true)
  })

  it('omits the flag entirely for ordinary geometry (no spurious construction key)', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
      { kind: 'circle', cx: 10, cy: 10, r: 5 },
      { kind: 'arc', cx: 30, cy: 0, r: 10, a0: 0, a1: Math.PI },
      { kind: 'point', x: 5, y: 5 },
    ]
    const fwd = toFreeCadGeoms(geoms)
    expect(fwd.every((g) => g.construction === undefined)).toBe(true)
    const back = fromFreeCadGeoms(fwd)
    expect(back.every((g) => g.construction === undefined)).toBe(true)
  })

  it('mixed sketch: construction geometry roundtrips alongside real geometry', () => {
    const geoms: SketchGeom[] = [
      { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
      { kind: 'line', construction: true, x1: 20, y1: -10, x2: 20, y2: 40 }, // centreline
      { kind: 'circle', cx: 20, cy: 15, r: 8 },
      { kind: 'circle', construction: true, cx: 20, cy: 15, r: 20 }, // construction ref circle
    ]
    const fwd = toFreeCadGeoms(geoms)
    const back = fromFreeCadGeoms(fwd)
    expect(back.map((g) => g.construction === true)).toEqual([false, true, false, true])
  })
})
