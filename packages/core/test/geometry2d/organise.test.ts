/**
 * Blueprint / CompoundBlueprint / Blueprints / organiseBlueprints tests (plan B1-B3).
 * Pure TS, no WASM — verifies container semantics and hole classification.
 */
import { describe, expect, it } from 'vitest'
import { makeLine2d, makeArc2dThreePoints } from '../../src/geometry2d/curve2d'
import { Blueprint } from '../../src/geometry2d/blueprint'
import { CompoundBlueprint } from '../../src/geometry2d/compound-blueprint'
import { organiseBlueprints } from '../../src/geometry2d/organise'

// convenience rect builder (CCW)
function rect(x1: number, y1: number, x2: number, y2: number): Blueprint {
  return new Blueprint([
    makeLine2d(x1, y1, x2, y1),
    makeLine2d(x2, y1, x2, y2),
    makeLine2d(x2, y2, x1, y2),
    makeLine2d(x1, y2, x1, y1),
  ])
}

describe('Blueprint container', () => {
  it('boundingBox & orientation of a CCW square', () => {
    const bp = rect(0, 0, 10, 10)
    expect(bp.boundingBox.xMin).toBe(0)
    expect(bp.boundingBox.xMax).toBe(10)
    expect(bp.boundingBox.yMin).toBe(0)
    expect(bp.boundingBox.yMax).toBe(10)
    expect(bp.orientation).toBe('counterClockwise')
    expect(bp.isClosed()).toBe(true)
  })

  it('transforms produce new Blueprint', () => {
    const bp = rect(1, 1, 2, 2)
    const t = bp.translate(100, 0)
    expect(t.firstPoint[0]).toBe(101)
    expect(bp.firstPoint[0]).toBe(1) // original untouched
    const s = bp.scale(2, [0, 0])
    expect(s.boundingBox.xMax).toBe(4)
  })

  it('isInside ray-cast correct for interior / exterior / boundary', () => {
    const bp = rect(0, 0, 10, 10)
    expect(bp.isInside([5, 5])).toBe(true)
    expect(bp.isInside([-1, 5])).toBe(false)
    expect(bp.isInside([15, 5])).toBe(false)
    expect(bp.isInside([0, 5])).toBe(false) // on boundary
  })

  it('isInside with arc boundary', () => {
    const arc = makeArc2dThreePoints(0, 0, 1, 0, 0, 0) // half circle-ish; ensure no crash
    const bp = new Blueprint([arc])
    // degenerate open probe — just assert it doesn't throw
    expect(() => bp.isInside([0.2, 0.2])).not.toThrow()
  })
})

describe('organiseBlueprints', () => {
  it('single outer → Blueprint', () => {
    const or = organiseBlueprints([rect(0, 0, 10, 10)])
    expect(or.blueprints).toHaveLength(1)
    expect(or.blueprints[0]).toBeInstanceOf(Blueprint)
  })

  it('outer + inner hole → CompoundBlueprint', () => {
    const or = organiseBlueprints([rect(0, 0, 10, 10), rect(3, 3, 7, 7)])
    expect(or.blueprints).toHaveLength(1)
    expect(or.blueprints[0]).toBeInstanceOf(CompoundBlueprint)
    const cb = or.blueprints[0] as CompoundBlueprint
    expect(cb.blueprints).toHaveLength(2)
    expect(cb.blueprints[0]!.boundingBox.xMax).toBe(10) // outer
    expect(cb.blueprints[1]!.boundingBox.xMax).toBe(7) // inner hole
  })

  it('two disjoint rings → two Blueprints', () => {
    const or = organiseBlueprints([rect(0, 0, 5, 5), rect(20, 20, 25, 25)])
    expect(or.blueprints).toHaveLength(2)
    expect(or.blueprints.every((b) => b instanceof Blueprint)).toBe(true)
  })

  it('three-level nesting → outer(with mid hole) + inner island', () => {
    // outer 0..100, middle 20..80, inner 40..60
    const or = organiseBlueprints([rect(0, 0, 100, 100), rect(20, 20, 80, 80), rect(40, 40, 60, 60)])
    // brepjs semantics: outer+mid merge into a Compound; the innermost (>1 ancestor)
    // is split off as its own top-level blueprint.
    expect(or.blueprints.length).toBeGreaterThanOrEqual(2)
    const compound = or.blueprints.find((b) => b instanceof CompoundBlueprint) as CompoundBlueprint
    expect(compound).toBeDefined()
    expect(compound.blueprints).toHaveLength(2) // outer + mid-as-hole
    expect(compound.blueprints[0]!.boundingBox.xMax).toBe(100) // outer
    expect(compound.blueprints[1]!.boundingBox.xMax).toBe(80) // mid hole
  })

  it('two islands each with their own hole', () => {
    const or = organiseBlueprints([
      rect(0, 0, 10, 10),
      rect(4, 4, 6, 6), // hole of island 1
      rect(50, 0, 60, 10),
      rect(54, 4, 56, 6), // hole of island 2
    ])
    // two compounds
    expect(or.blueprints).toHaveLength(2)
    expect(or.blueprints[0]).toBeInstanceOf(CompoundBlueprint)
    expect(or.blueprints[1]).toBeInstanceOf(CompoundBlueprint)
  })

  it('bbox-overlap but not containing → remains disjoint compounds (beyond-simple containment)', () => {
    // two rectangles sharing an edge region but not nested: single outer detection
    // should treat both as outer → two separate Blueprints
    const or = organiseBlueprints([rect(0, 0, 10, 10), rect(5, 0, 15, 10)])
    expect(or.blueprints).toHaveLength(2)
  })
})