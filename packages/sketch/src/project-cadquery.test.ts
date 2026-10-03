/**
 * CadQuery-side constraint projection — the **single** name table every consumer
 * shares (faijs-cadquery's `constrain`/`toCanonical` reads it; nothing else may
 * hand-roll a CQ-name switch).
 *
 * Two facts are pinned here because they bite consumers:
 * 1. `fixed` has TWO CadQuery spellings (`Fixed` / `FixedPoint`) and the reverse
 *    map must accept both;
 * 2. this table is the 8 kinds the planegcs bridge can express — the other
 *    CadQuery names (Horizontal/Vertical/Parallel/Perpendicular/Tangent/
 *    DistanceX/DistanceY/Diameter/Equal) are upstream-accepted but NOT bridgeable,
 *    so a consumer that knows the upstream name list can still reject them early
 *    with a clear message instead of failing later.
 *
 * Angles are **degrees** on the CadQuery side and **radians** in the canonical
 * model; that conversion belongs to the CQ boundary (faijs-cadquery), NOT to this
 * table — `constraintKindFromCadQuery` only answers "which canonical kind".
 */
import { describe, it, expect } from 'vitest'
import {
  CADQUERY_TO_CONSTRAINT_KIND, CONSTRAINT_KIND_TO_CADQUERY,
  constraintKindFromCadQuery, constraintKindToCadQuery,
} from './project.js'
import { SketchProjectionError } from './project.js'

describe('CadQuery constraint names → canonical kinds', () => {
  it('bridgeable set is exactly the 8 the planegcs projection supports', () => {
    expect([...new Set(Object.values(CADQUERY_TO_CONSTRAINT_KIND))].sort()).toEqual([
      'angle', 'arcAngle', 'coincident', 'distance', 'fixed', 'length', 'orientation', 'radius',
    ])
    // 9 names for 8 kinds — `fixed` is spelled twice (see below).
    expect(Object.keys(CADQUERY_TO_CONSTRAINT_KIND).sort()).toEqual([
      'Angle', 'ArcAngle', 'Coincident', 'Distance', 'Fixed', 'FixedPoint', 'Length', 'Orientation', 'Radius',
    ])
  })

  it('fixed: forward gives FixedPoint, reverse accepts Fixed too', () => {
    expect(constraintKindToCadQuery('fixed')).toBe('FixedPoint')
    expect(constraintKindFromCadQuery('FixedPoint')).toBe('fixed')
    expect(constraintKindFromCadQuery('Fixed')).toBe('fixed')
  })

  it('round-trips every bridgeable kind through its forward name', () => {
    for (const [kind, name] of Object.entries(CONSTRAINT_KIND_TO_CADQUERY)) {
      expect(constraintKindFromCadQuery(name!)).toBe(kind)
    }
  })

  it('unknown name → E_SKETCHC_UNSUPPORTED_CONSTRAINT（不静默降级）', () => {
    expect(() => constraintKindFromCadQuery('Tangent')).toThrow(SketchProjectionError)
    expect(() => constraintKindFromCadQuery('Nope')).toThrow(/E_SKETCHC_UNSUPPORTED_CONSTRAINT/)
  })

  it('unbridgeable kinds → E_SKETCHC_UNSUPPORTED_BY_CQ', () => {
    for (const kind of ['horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal'] as const) {
      expect(() => constraintKindToCadQuery(kind)).toThrow(/E_SKETCHC_UNSUPPORTED_BY_CQ/)
    }
  })
})
