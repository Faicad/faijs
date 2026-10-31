/**
 * GD&T advanced features tests (Phase 5).
 *
 * Verifies that:
 * 1. Datum targets with parameters are created and serialized correctly.
 * 2. Composite tolerance segments (PLTZF + FRTZF) are created and serialized.
 * 3. Projected tolerance zone is created and serialized.
 * 4. Asymmetric tolerance (non-symmetric upper/lower) is created and serialized.
 * 5. All advanced features survive JSON round-trip.
 * 6. Advanced features work with Shape methods and query functions.
 */

import { describe, it, expect } from 'vitest'
import {
  dimension, gdt, datum,
  type PmiSet, type PmiGdt, type PmiDatum,
} from '../../../src/api/pmi/types'
import { pmiItems, pmiOn, pmiDatums } from '../../../src/api/pmi/query'
import { solid } from '../../../src/shape'
import type { FaceTopoRef } from '../../../src/topology/naming/types'

const faceRef: FaceTopoRef = {
  kind: 'face',
  origin: 's1' as never,
  role: 'top',
  hint: { kind: 'face', surfaceType: 'plane', normal: [0, 0, 1] },
}

function makeShape() {
  return solid({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  })
}

describe('Datum targets', () => {
  it('creates datum target with point parameters', () => {
    const d: PmiDatum = datum({
      identifier: 'A',
      datumType: 'datumTarget',
      target: faceRef,
      datumTargetParams: { u: 0.5, v: 0.5, radius: 5 },
    })
    expect(d.datumType).toBe('datumTarget')
    expect(d.datumTargetParams?.u).toBe(0.5)
    expect(d.datumTargetParams?.v).toBe(0.5)
    expect(d.datumTargetParams?.radius).toBe(5)
  })

  it('creates datum target with rectangular area', () => {
    const d: PmiDatum = datum({
      identifier: 'B',
      datumType: 'datumTarget',
      target: faceRef,
      datumTargetParams: { width: 10, height: 5 },
    })
    expect(d.datumTargetParams?.width).toBe(10)
    expect(d.datumTargetParams?.height).toBe(5)
  })

  it('datum target survives JSON round-trip', () => {
    const d = datum({
      identifier: 'C',
      datumType: 'datumTarget',
      target: faceRef,
      datumTargetParams: { u: 0.3, v: 0.7, radius: 2.5 },
    })
    const json = JSON.stringify(d)
    const parsed = JSON.parse(json) as PmiDatum
    expect(parsed.identifier).toBe('C')
    expect(parsed.datumType).toBe('datumTarget')
    expect(parsed.datumTargetParams?.u).toBe(0.3)
    expect(parsed.datumTargetParams?.radius).toBe(2.5)
  })

  it('datum target works with pmiDatums query', () => {
    const s = makeShape()
    s.addDatum({
      identifier: 'A',
      datumType: 'datumTarget',
      target: faceRef,
      datumTargetParams: { u: 0.5, v: 0.5, radius: 5 },
    })
    const datums = pmiDatums(s)
    expect(datums['A']).toBeDefined()
    expect(datums['A'].datumType).toBe('datumTarget')
  })
})

describe('Composite tolerance segments', () => {
  it('creates composite tolerance with PLTZF + FRTZF', () => {
    const g: PmiGdt = gdt({
      gdtType: 'position',
      target: faceRef,
      tolerance: 0.5, // PLTZF (primary segment)
      datums: ['A', 'B', 'C'],
      compositeSegments: [
        // FRTZF (refining segment)
        { tolerance: 0.1, datums: ['A'] },
      ],
    })
    expect(g.compositeSegments).toHaveLength(1)
    expect(g.compositeSegments![0].tolerance).toBe(0.1)
    expect(g.compositeSegments![0].datums).toEqual(['A'])
  })

  it('composite tolerance with multiple FRTZF segments', () => {
    const g: PmiGdt = gdt({
      gdtType: 'profileSurface',
      target: faceRef,
      tolerance: 1.0, // PLTZF
      datums: ['A', 'B', 'C'],
      compositeSegments: [
        { tolerance: 0.5, datums: ['A', 'B'] },
        { tolerance: 0.2, datums: ['A'] },
      ],
    })
    expect(g.compositeSegments).toHaveLength(2)
    expect(g.compositeSegments![0].tolerance).toBe(0.5)
    expect(g.compositeSegments![1].tolerance).toBe(0.2)
  })

  it('composite tolerance survives JSON round-trip', () => {
    const g = gdt({
      gdtType: 'position',
      target: faceRef,
      tolerance: 0.5,
      datums: ['A', 'B', 'C'],
      compositeSegments: [
        { tolerance: 0.1, materialCondition: 'MMC', datums: ['A'] },
      ],
    })
    const json = JSON.stringify(g)
    const parsed = JSON.parse(json) as PmiGdt
    expect(parsed.compositeSegments).toHaveLength(1)
    expect(parsed.compositeSegments![0].tolerance).toBe(0.1)
    expect(parsed.compositeSegments![0].materialCondition).toBe('MMC')
    expect(parsed.compositeSegments![0].datums).toEqual(['A'])
  })

  it('composite tolerance works with Shape methods', () => {
    const s = makeShape()
    s.addGdt({
      gdtType: 'position',
      target: faceRef,
      tolerance: 0.5,
      datums: ['A', 'B', 'C'],
      compositeSegments: [{ tolerance: 0.1, datums: ['A'] }],
    })
    const gdts = pmiItems(s, { kind: 'gdt' })
    expect(gdts).toHaveLength(1)
    expect((gdts[0] as PmiGdt).compositeSegments).toHaveLength(1)
  })
})

describe('Projected tolerance zone', () => {
  it('creates projected tolerance zone', () => {
    const g: PmiGdt = gdt({
      gdtType: 'position',
      target: faceRef,
      tolerance: 0.05,
      projectedToleranceZone: { length: 10, direction: [0, 0, 1] },
    })
    expect(g.projectedToleranceZone).toBeDefined()
    expect(g.projectedToleranceZone!.length).toBe(10)
    expect(g.projectedToleranceZone!.direction).toEqual([0, 0, 1])
  })

  it('projected tolerance zone survives JSON round-trip', () => {
    const g = gdt({
      gdtType: 'position',
      target: faceRef,
      tolerance: 0.05,
      projectedToleranceZone: { length: 15, direction: [1, 0, 0] },
    })
    const json = JSON.stringify(g)
    const parsed = JSON.parse(json) as PmiGdt
    expect(parsed.projectedToleranceZone).toBeDefined()
    expect(parsed.projectedToleranceZone!.length).toBe(15)
    expect(parsed.projectedToleranceZone!.direction).toEqual([1, 0, 0])
  })
})

describe('Asymmetric tolerance', () => {
  it('creates asymmetric tolerance (non-symmetric upper/lower)', () => {
    const d = dimension({
      dimType: 'diameter',
      targets: [faceRef],
      upperTolerance: 0.021,
      lowerTolerance: 0, // asymmetric: 0 to +0.021
      symmetric: false,
    })
    expect(d.upperTolerance).toBe(0.021)
    expect(d.lowerTolerance).toBe(0)
    expect(d.symmetric).toBe(false)
  })

  it('creates symmetric tolerance', () => {
    const d = dimension({
      dimType: 'diameter',
      targets: [faceRef],
      upperTolerance: 0.01,
      lowerTolerance: -0.01,
      symmetric: true,
    })
    expect(d.symmetric).toBe(true)
    expect(d.upperTolerance).toBe(0.01)
    expect(d.lowerTolerance).toBe(-0.01)
  })

  it('asymmetric tolerance survives JSON round-trip', () => {
    const d = dimension({
      dimType: 'linear',
      targets: [faceRef],
      upperTolerance: 0.015,
      lowerTolerance: -0.005,
      symmetric: false,
    })
    const json = JSON.stringify(d)
    const parsed = JSON.parse(json)
    expect(parsed.upperTolerance).toBe(0.015)
    expect(parsed.lowerTolerance).toBe(-0.005)
    expect(parsed.symmetric).toBe(false)
  })

  it('theoretically exact dimension (boxed, no tolerance)', () => {
    const d = dimension({
      dimType: 'linear',
      targets: [faceRef],
      theoreticalExact: true,
    })
    expect(d.theoreticalExact).toBe(true)
    expect(d.upperTolerance).toBeUndefined()
    expect(d.lowerTolerance).toBeUndefined()
  })
})

describe('All advanced features together', () => {
  it('combined PMI set with all advanced features', () => {
    const pmi: PmiSet = {
      items: [
        // Datum target
        datum({
          identifier: 'A',
          datumType: 'datumTarget',
          target: faceRef,
          datumTargetParams: { u: 0.5, v: 0.5, radius: 5 },
        }),
        // Composite tolerance
        gdt({
          gdtType: 'position',
          target: faceRef,
          tolerance: 0.5,
          datums: ['A', 'B', 'C'],
          compositeSegments: [{ tolerance: 0.1, datums: ['A'] }],
        }),
        // Projected tolerance zone
        gdt({
          gdtType: 'perpendicularity',
          target: faceRef,
          tolerance: 0.05,
          projectedToleranceZone: { length: 10, direction: [0, 0, 1] },
        }),
        // Asymmetric tolerance
        dimension({
          dimType: 'diameter',
          targets: [faceRef],
          upperTolerance: 0.021,
          lowerTolerance: 0,
          symmetric: false,
        }),
      ],
    }
    expect(pmi.items).toHaveLength(4)

    // Full JSON round-trip
    const json = JSON.stringify(pmi)
    const parsed: PmiSet = JSON.parse(json)
    expect(parsed.items).toHaveLength(4)

    const parsedDatums = parsed.items.filter((i) => i.kind === 'datum')
    expect(parsedDatums).toHaveLength(1)

    const parsedGdts = parsed.items.filter((i) => i.kind === 'gdt')
    expect(parsedGdts).toHaveLength(2)

    const parsedDims = parsed.items.filter((i) => i.kind === 'dimension')
    expect(parsedDims).toHaveLength(1)
  })
})
